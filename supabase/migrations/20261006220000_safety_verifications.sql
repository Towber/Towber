-- Towber: on-demand live safety verification (mock provider contract for now).
-- A request is the existing Towber trip entity.

alter table public.tow_requests
  add column if not exists safety_alert boolean not null default false,
  add column if not exists safety_alert_at timestamptz,
  add column if not exists safety_alert_reason text;

create table if not exists public.safety_verifications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.tow_requests(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  target_user uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'failed', 'timed_out')),
  liveness_score double precision,
  id_matched boolean not null default false,
  failure_reason text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 seconds',
  completed_at timestamptz,
  check (requested_by <> target_user)
);

create index if not exists safety_verifications_request_created_idx
  on public.safety_verifications(request_id, created_at desc);
create index if not exists safety_verifications_target_status_idx
  on public.safety_verifications(target_user, status);

alter table public.safety_verifications enable row level security;
revoke all on public.safety_verifications from public, anon, authenticated;
grant select on public.safety_verifications to authenticated;
grant all on public.safety_verifications to service_role;

drop policy if exists "request participants read safety verifications" on public.safety_verifications;
create policy "request participants read safety verifications"
  on public.safety_verifications for select to authenticated
  using (
    requested_by = (select auth.uid()) or target_user = (select auth.uid())
  );

create or replace function public.request_safety_verification(p_request_id uuid)
returns public.safety_verifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.tow_requests%rowtype;
  v_target uuid;
  v_result public.safety_verifications;
begin
  select * into r from public.tow_requests where id = p_request_id for share;
  if not found or r.status not in ('accepted', 'en_route', 'arrived') then
    raise exception 'Safety verification is only available during an active job' using errcode = '22023';
  end if;

  select case
    when r.user_id = (select auth.uid()) then a.driver_user_id
    else r.user_id
  end into v_target
  from public.vehicle_driver_assignments a
  where a.vehicle_id = r.assigned_vehicle_id
    and a.revoked_at is null
    and (r.user_id = (select auth.uid()) or a.driver_user_id = (select auth.uid()))
  limit 1;

  if v_target is null or v_target = (select auth.uid()) then
    raise exception 'You are not an active participant in this request' using errcode = '42501';
  end if;

  update public.safety_verifications
  set status = 'timed_out', completed_at = pg_catalog.now(), failure_reason = 'Superseded by a new request'
  where request_id = p_request_id and status = 'pending';

  insert into public.safety_verifications (request_id, requested_by, target_user)
  values (p_request_id, (select auth.uid()), v_target)
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.complete_safety_verification(
  p_verification_id uuid,
  p_liveness_score double precision,
  p_id_matched boolean,
  p_passed boolean
)
returns public.safety_verifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.safety_verifications;
  v_status text;
  v_reason text;
begin
  select * into v_result
  from public.safety_verifications
  where id = p_verification_id and target_user = (select auth.uid())
  for update;

  if not found then raise exception 'Safety verification not found' using errcode = 'P0002'; end if;
  if v_result.status <> 'pending' then return v_result; end if;

  if v_result.expires_at < pg_catalog.now() then
    v_status := 'timed_out';
    v_reason := 'The 60-second verification window expired';
  elsif p_passed and p_id_matched and p_liveness_score >= 0.80 then
    v_status := 'verified';
    v_reason := null;
  else
    v_status := 'failed';
    v_reason := 'Mock liveness or ID match did not pass';
  end if;

  update public.safety_verifications
  set status = v_status,
      liveness_score = p_liveness_score,
      id_matched = p_id_matched,
      failure_reason = v_reason,
      completed_at = pg_catalog.now()
  where id = p_verification_id
  returning * into v_result;

  if v_status in ('failed', 'timed_out') then
    update public.tow_requests
    set safety_alert = true,
        safety_alert_at = pg_catalog.now(),
        safety_alert_reason = v_reason
    where id = v_result.request_id;
  end if;
  return v_result;
end;
$$;

revoke all on function public.request_safety_verification(uuid) from public, anon, authenticated;
revoke all on function public.complete_safety_verification(uuid, double precision, boolean, boolean) from public, anon, authenticated;
grant execute on function public.request_safety_verification(uuid) to authenticated;
grant execute on function public.complete_safety_verification(uuid, double precision, boolean, boolean) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'safety_verifications'
     ) then
    alter publication supabase_realtime add table public.safety_verifications;
  end if;
end;
$$;

notify pgrst, 'reload schema';
