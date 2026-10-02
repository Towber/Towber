-- Towber app profiles and driver request alerts.
-- Driver roles are assigned by trusted operators/service_role, never by clients.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'client' check (role in ('client', 'driver')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;
revoke all on public.user_profiles from anon, authenticated;
grant select on public.user_profiles to authenticated;
grant all on public.user_profiles to service_role;

drop policy if exists "users can read their own app profile" on public.user_profiles;
create policy "users can read their own app profile"
  on public.user_profiles for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.create_towber_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (user_id, role)
  values (new.id, 'client')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_towber_user_profile() from public, anon, authenticated;
drop trigger if exists create_towber_user_profile on auth.users;
create trigger create_towber_user_profile
after insert on auth.users
for each row execute function public.create_towber_user_profile();

-- Give existing Auth accounts the non-privileged default role.
insert into public.user_profiles (user_id, role)
select id, 'client' from auth.users
on conflict (user_id) do nothing;

-- Store the selected breakdown service on each request. Older clients default
-- to Flatbed until they are updated.
alter table public.tow_requests
  add column if not exists breakdown_type text not null default 'flatbed';
update public.tow_requests
set breakdown_type = 'flatbed'
where breakdown_type is null
   or breakdown_type not in ('flatbed', 'jumpstart', 'lockout');
alter table public.tow_requests
  alter column breakdown_type set default 'flatbed',
  alter column breakdown_type set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tow_requests_breakdown_type_check'
      and conrelid = 'public.tow_requests'::regclass
  ) then
    alter table public.tow_requests
      add constraint tow_requests_breakdown_type_check
      check (breakdown_type in ('flatbed', 'jumpstart', 'lockout'));
  end if;
end;
$$;

-- An assigned driver may read only the requests assigned to the driver's
-- active vehicle. This RLS rule also gates Postgres Changes delivery.
drop policy if exists "assigned drivers can read their tow requests" on public.tow_requests;
create policy "assigned drivers can read their tow requests"
  on public.tow_requests for select to authenticated
  using (
    assigned_vehicle_id is not null
    and public.is_active_vehicle_driver(assigned_vehicle_id)
  );

-- Private channel authorization for the driver's request-alert subscription.
drop policy if exists "drivers receive private job alerts" on realtime.messages;
create policy "drivers receive private job alerts"
  on realtime.messages for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) like 'driver-job:%'
    and public.is_active_vehicle_driver(
      substring((select realtime.topic()) from length('driver-job:') + 1)::uuid
    )
  );

-- Supabase Realtime must publish tow_requests for postgres_changes alerts.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'tow_requests'
     ) then
    execute 'alter publication supabase_realtime add table public.tow_requests';
  end if;
end;
$$;
