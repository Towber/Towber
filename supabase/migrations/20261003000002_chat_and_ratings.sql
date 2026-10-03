-- Towber: request chat and post-job ratings.
-- Both anonymous guests and invited partners are authenticated Supabase users.

create or replace function public.can_access_tow_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tow_requests r
    where r.id = p_request_id
      and (
        r.user_id = (select auth.uid())
        or exists (
          select 1
          from public.vehicle_driver_assignments a
          where a.vehicle_id = r.assigned_vehicle_id
            and a.driver_user_id = (select auth.uid())
            and a.revoked_at is null
        )
      )
  );
$$;

create table if not exists public.request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.tow_requests(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists request_messages_request_created_idx
  on public.request_messages(request_id, created_at asc);

alter table public.request_messages enable row level security;
revoke all on public.request_messages from anon, authenticated;
grant select, insert on public.request_messages to authenticated;

drop policy if exists "request participants read chat" on public.request_messages;
create policy "request participants read chat"
  on public.request_messages for select to authenticated
  using (public.can_access_tow_request(request_id));

drop policy if exists "request participants send chat" on public.request_messages;
create policy "request participants send chat"
  on public.request_messages for insert to authenticated
  with check (
    sender_user_id = (select auth.uid())
    and public.can_access_tow_request(request_id)
  );

create table if not exists public.request_ratings (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.tow_requests(id) on delete cascade,
  rater_user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  unique (request_id, rater_user_id)
);

create index if not exists request_ratings_request_idx
  on public.request_ratings(request_id);

alter table public.request_ratings enable row level security;
revoke all on public.request_ratings from anon, authenticated;
grant select, insert on public.request_ratings to authenticated;

drop policy if exists "request participants read ratings" on public.request_ratings;
create policy "request participants read ratings"
  on public.request_ratings for select to authenticated
  using (public.can_access_tow_request(request_id));

drop policy if exists "motorists rate completed requests" on public.request_ratings;
create policy "motorists rate completed requests"
  on public.request_ratings for insert to authenticated
  with check (
    rater_user_id = (select auth.uid())
    and exists (
      select 1 from public.tow_requests r
      where r.id = request_id
        and r.user_id = (select auth.uid())
        and r.status = 'completed'
    )
  );

-- Enable realtime chat updates without exposing messages outside request RLS.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'request_messages'
     ) then
    alter publication supabase_realtime add table public.request_messages;
  end if;
end;
$$;

notify pgrst, 'reload schema';
