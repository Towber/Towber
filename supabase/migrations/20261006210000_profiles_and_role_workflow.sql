-- Towber: automatic auth profiles and safe role/verification handling.
-- The mobile app continues to use public.user_profiles(user_id, role) for
-- operational client/driver routing. This public.profiles table provides the
-- requested registration/approval contract without allowing a new user to
-- self-assign admin access.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'client'
    check (role in ('client', 'towber_pro', 'admin')),
  requested_role text not null default 'client'
    check (requested_role in ('client', 'towber_pro', 'admin')),
  full_name text,
  verification_status text not null default 'approved'
    check (verification_status in ('pending_verification', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_status_idx
  on public.profiles(role, verification_status);

alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

drop policy if exists "users can read their own profile" on public.profiles;
create policy "users can read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "users can update their own profile name" on public.profiles;
create policy "users can update their own profile name"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create or replace function public.touch_profiles_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.touch_profiles_updated_at() from public, anon, authenticated;

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at
  before update on public.profiles
  for each row execute function public.touch_profiles_updated_at();

-- raw_user_meta_data is treated as a registration request, not as an
-- authority claim. In particular, requesting admin never grants admin role.
-- A TowberPro request is visible to the admin workflow as pending_verification.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_role text;
  v_role text;
  v_status text;
begin
  v_requested_role := pg_catalog.lower(
    pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'role', 'client'))
  );

  if v_requested_role not in ('client', 'towber_pro', 'admin') then
    v_requested_role := 'client';
  end if;

  -- Only client and TowberPro may be requested at sign-up. Admin is granted
  -- later by a trusted admin/service-role operation.
  v_role := case when v_requested_role = 'towber_pro' then 'towber_pro' else 'client' end;
  v_status := case when v_role = 'towber_pro' then 'pending_verification' else 'approved' end;

  insert into public.profiles (id, email, role, requested_role, full_name, verification_status)
  values (
    new.id,
    new.email,
    v_role,
    v_requested_role,
    nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    v_status
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = pg_catalog.now();

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill existing Auth users without overwriting any existing profile.
insert into public.profiles (id, email, role, requested_role, full_name, verification_status)
select
  u.id,
  u.email,
  case when pg_catalog.lower(pg_catalog.btrim(coalesce(u.raw_user_meta_data ->> 'role', 'client'))) = 'towber_pro'
    then 'towber_pro' else 'client' end,
  case when pg_catalog.lower(pg_catalog.btrim(coalesce(u.raw_user_meta_data ->> 'role', 'client'))) in ('client', 'towber_pro', 'admin')
    then pg_catalog.lower(pg_catalog.btrim(coalesce(u.raw_user_meta_data ->> 'role', 'client')))
    else 'client' end,
  nullif(pg_catalog.btrim(u.raw_user_meta_data ->> 'full_name'), ''),
  case when pg_catalog.lower(pg_catalog.btrim(coalesce(u.raw_user_meta_data ->> 'role', 'client'))) = 'towber_pro'
    then 'pending_verification' else 'approved' end
from auth.users u
on conflict (id) do nothing;

notify pgrst, 'reload schema';
