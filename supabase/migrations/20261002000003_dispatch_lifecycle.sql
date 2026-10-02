-- Towber dispatch lifecycle: closes the gap between "request created as
-- pending" and a resolved job.
--
-- * widens tow_requests.status to the full lifecycle
--   (pending, accepted, en_route, arrived, completed, cancelled, declined, expired)
-- * adds an offer deadline (expires_at) with lazy expiry that re-dispatches
--   to the next-nearest eligible truck before giving up
-- * records every dispatch offer so trucks that already declined/expired are
--   skipped on the next attempt
-- * enforces one active request per motorist with a partial unique index
-- * adds transition_tow_request(), the single state machine used by the API.
--   Every new function is service_role-only; clients gain no write grants.

-- 1) Status lifecycle. Drop whatever status CHECK the target database has
-- (the live column was created inline, so the name may differ) and re-add
-- the canonical one. The old value set is a subset of the new one.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.tow_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%pending%'
  loop
    execute format('alter table public.tow_requests drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.tow_requests
  add constraint tow_requests_status_check
  check (status in (
    'pending', 'accepted', 'en_route', 'arrived',
    'completed', 'cancelled', 'declined', 'expired'
  ));

-- 2) Offer deadline and audit columns.
alter table public.tow_requests
  add column if not exists expires_at timestamptz,
  add column if not exists status_changed_at timestamptz,
  add column if not exists dispatch_attempt integer not null default 1;

update public.tow_requests
set status_changed_at = coalesce(status_changed_at, created_at)
where status_changed_at is null;

-- Existing pending rows get a deadline that has already passed; the lazy
-- sweeper resolves them on their next read.
update public.tow_requests
set expires_at = coalesce(created_at, now()) + interval '75 seconds'
where status = 'pending' and expires_at is null;

alter table public.tow_requests
  alter column status_changed_at set default now(),
  alter column status_changed_at set not null,
  alter column expires_at set default now() + interval '75 seconds';

create index if not exists tow_requests_pending_expiry_idx
  on public.tow_requests(expires_at)
  where status = 'pending';

-- 3) Every truck that was offered a request is recorded so re-dispatch never
-- re-offers a truck that declined or timed out.
create table if not exists public.tow_request_offers (
  request_id uuid not null references public.tow_requests(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  offered_at timestamptz not null default now(),
  outcome text not null default 'offered'
    check (outcome in ('offered', 'accepted', 'declined', 'expired')),
  responded_at timestamptz,
  primary key (request_id, vehicle_id)
);

create index if not exists tow_request_offers_vehicle_idx
  on public.tow_request_offers(vehicle_id);

alter table public.tow_request_offers enable row level security;
revoke all on public.tow_request_offers from public, anon, authenticated;
grant all on public.tow_request_offers to service_role;

-- 4) One active request per motorist. Older duplicate actives are cancelled
-- (keep the newest) before the unique index is created.
with ranked as (
  select id,
         row_number() over (
           partition by user_id
           order by created_at desc, id desc
         ) as rn
  from public.tow_requests
  where status in ('pending', 'accepted', 'en_route', 'arrived')
)
update public.tow_requests t
set status = 'cancelled',
    status_changed_at = now(),
    expires_at = null
from ranked r
where t.id = r.id
  and r.rn > 1;

create unique index if not exists tow_requests_one_active_per_user_idx
  on public.tow_requests(user_id)
  where status in ('pending', 'accepted', 'en_route', 'arrived');

-- 5) Re-dispatch: offer the request to the next-nearest eligible truck that
-- has not already seen it. Returns false when no candidate or the attempt
-- budget (3) is exhausted.
create or replace function public.try_reassign_tow_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.tow_requests%rowtype;
  v_next record;
begin
  select * into v_request
  from public.tow_requests
  where id = p_request_id
    and status = 'pending'
  for update;

  if not found then
    return false;
  end if;

  if coalesce(v_request.dispatch_attempt, 1) >= 3 then
    return false;
  end if;

  select n.vehicle_id, n.company_id
    into v_next
  from public.get_nearby_vehicles(
         public.st_y(v_request.pickup_location::public.geometry),
         public.st_x(v_request.pickup_location::public.geometry),
         v_request.estimated_distance_km,
         50000
       ) n
  where n.vehicle_id is distinct from v_request.assigned_vehicle_id
    and not exists (
      select 1
      from public.tow_request_offers o
      where o.request_id = v_request.id
        and o.vehicle_id = n.vehicle_id
    )
  order by n.distance_meters asc
  limit 1;

  if not found then
    return false;
  end if;

  update public.tow_requests
  set assigned_vehicle_id = v_next.vehicle_id,
      selected_company_id = v_next.company_id,
      dispatch_attempt = dispatch_attempt + 1,
      expires_at = now() + interval '75 seconds'
  where id = v_request.id;

  insert into public.tow_request_offers (request_id, vehicle_id)
  values (v_request.id, v_next.vehicle_id)
  on conflict do nothing;

  return true;
end;
$$;

revoke all on function public.try_reassign_tow_request(uuid) from public, anon, authenticated;
grant execute on function public.try_reassign_tow_request(uuid) to service_role;

-- 6) Lazy expiry for a single request: tries re-dispatch first, otherwise
-- resolves the request as expired. Returns true when it changed anything.
create or replace function public.expire_tow_request_if_stale(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.tow_requests%rowtype;
begin
  select * into v_request
  from public.tow_requests
  where id = p_request_id
    and status = 'pending'
  for update;

  if not found
     or v_request.expires_at is null
     or v_request.expires_at > now() then
    return false;
  end if;

  update public.tow_request_offers
  set outcome = 'expired',
      responded_at = now()
  where request_id = v_request.id
    and vehicle_id = v_request.assigned_vehicle_id
    and outcome = 'offered';

  if public.try_reassign_tow_request(v_request.id) then
    return true;
  end if;

  update public.tow_requests
  set status = 'expired',
      status_changed_at = now(),
      expires_at = null
  where id = v_request.id
    and status = 'pending';

  return true;
end;
$$;

revoke all on function public.expire_tow_request_if_stale(uuid) from public, anon, authenticated;
grant execute on function public.expire_tow_request_if_stale(uuid) to service_role;

-- 7) Sweep every stale pending request a motorist still has, so the
-- one-active-request guard never blocks behind a dead offer.
create or replace function public.expire_stale_tow_requests_for_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user_id is null then
    return;
  end if;

  for v_id in
    select id
    from public.tow_requests
    where user_id = p_user_id
      and status = 'pending'
      and expires_at is not null
      and expires_at <= now()
  loop
    perform public.expire_tow_request_if_stale(v_id);
  end loop;
end;
$$;

revoke all on function public.expire_stale_tow_requests_for_user(uuid) from public, anon, authenticated;
grant execute on function public.expire_stale_tow_requests_for_user(uuid) to service_role;

-- 8) The state machine. Authorization:
--   * accept/decline/en_route/arrived/completed require an active driver of
--     the currently assigned vehicle
--   * cancel requires the motorist who created the request
-- Conflicts are raised as `conflict:<reason>` so the API can map them to 409s.
create or replace function public.transition_tow_request(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_action text
)
returns setof public.tow_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.tow_requests%rowtype;
  v_new_status text;
  v_is_driver boolean;
  v_was_offered boolean;
begin
  if p_request_id is null
     or p_actor_user_id is null
     or p_action not in ('accept', 'decline', 'en_route', 'arrived', 'completed', 'cancel') then
    raise exception 'invalid_transition_payload' using errcode = '22023';
  end if;

  select * into v_request
  from public.tow_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Resolve a stale offer first so nobody can act on a dead request.
  if v_request.status = 'pending'
     and v_request.expires_at is not null
     and v_request.expires_at <= now() then
    perform public.expire_tow_request_if_stale(v_request.id);
    select * into v_request
    from public.tow_requests
    where id = p_request_id;
  end if;

  v_is_driver := exists (
    select 1
    from public.vehicle_driver_assignments a
    where a.vehicle_id = v_request.assigned_vehicle_id
      and a.driver_user_id = p_actor_user_id
      and a.revoked_at is null
  );

  if p_action = 'cancel' then
    if v_request.user_id <> p_actor_user_id then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if v_request.status in ('completed', 'cancelled', 'declined', 'expired') then
      raise exception 'conflict:closed' using errcode = 'P0001';
    end if;
    v_new_status := 'cancelled';
  else
    if not v_is_driver then
      -- Distinguish "this offer moved to another truck" from plain spoofing.
      select exists (
        select 1
        from public.tow_request_offers o
        join public.vehicle_driver_assignments a
          on a.vehicle_id = o.vehicle_id
         and a.driver_user_id = p_actor_user_id
         and a.revoked_at is null
        where o.request_id = v_request.id
      ) into v_was_offered;

      if v_was_offered and v_request.status = 'pending' then
        raise exception 'conflict:reassigned' using errcode = 'P0001';
      end if;
      raise exception 'forbidden' using errcode = '42501';
    end if;

    case p_action
      when 'accept' then
        if v_request.status <> 'pending' then
          raise exception 'conflict:not_pending' using errcode = 'P0001';
        end if;
        v_new_status := 'accepted';
      when 'decline' then
        if v_request.status <> 'pending' then
          raise exception 'conflict:not_pending' using errcode = 'P0001';
        end if;
      when 'en_route' then
        if v_request.status <> 'accepted' then
          raise exception 'conflict:not_accepted' using errcode = 'P0001';
        end if;
        v_new_status := 'en_route';
      when 'arrived' then
        if v_request.status <> 'en_route' then
          raise exception 'conflict:not_en_route' using errcode = 'P0001';
        end if;
        v_new_status := 'arrived';
      when 'completed' then
        if v_request.status <> 'arrived' then
          raise exception 'conflict:not_arrived' using errcode = 'P0001';
        end if;
        v_new_status := 'completed';
    end case;
  end if;

  if p_action = 'decline' then
    update public.tow_request_offers
    set outcome = 'declined',
        responded_at = now()
    where request_id = v_request.id
      and vehicle_id = v_request.assigned_vehicle_id
      and outcome = 'offered';

    -- Hand the job to the next-nearest eligible truck; only when no
    -- candidate remains does the motorist see a declined request.
    if public.try_reassign_tow_request(v_request.id) then
      return query select * from public.tow_requests where id = v_request.id;
      return;
    end if;

    update public.tow_requests
    set status = 'declined',
        status_changed_at = now(),
        expires_at = null
    where id = v_request.id
      and status = 'pending';
  else
    update public.tow_requests
    set status = v_new_status,
        status_changed_at = now(),
        expires_at = null
    where id = v_request.id
      and status = v_request.status;

    if not found then
      raise exception 'conflict:not_pending' using errcode = 'P0001';
    end if;

    if p_action = 'accept' then
      update public.tow_request_offers
      set outcome = 'accepted',
          responded_at = now()
      where request_id = v_request.id
        and vehicle_id = v_request.assigned_vehicle_id;
    end if;
  end if;

  return query select * from public.tow_requests where id = v_request.id;
end;
$$;

revoke all on function public.transition_tow_request(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.transition_tow_request(uuid, uuid, text) to service_role;

-- 9) Live jobs stay visible to the motorist after the driver marks arrival.
create or replace function public.can_receive_tow_location(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tow_requests r
    left join public.towing_companies c on c.id = r.selected_company_id
    where r.id = p_request_id
      and r.status in ('pending', 'accepted', 'en_route', 'arrived')
      and (
        r.user_id = (select auth.uid())
        or c.owner_user_id = (select auth.uid())
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

create or replace function public.broadcast_driver_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_payload jsonb;
begin
  update public.vehicles
  set current_location = new.location,
      updated_at = new.updated_at
  where id = new.vehicle_id;

  v_payload := jsonb_build_object(
    'vehicleId', new.vehicle_id,
    'lat', public.st_y(new.location::public.geometry),
    'lng', public.st_x(new.location::public.geometry),
    'heading', new.heading_degrees,
    'speedMps', new.speed_mps,
    'recordedAt', new.recorded_at
  );

  for v_request_id in
    select r.id
    from public.tow_requests r
    where r.assigned_vehicle_id = new.vehicle_id
      and r.status in ('pending', 'accepted', 'en_route', 'arrived')
  loop
    begin
      perform realtime.send(
        v_payload,
        'driver_location',
        'tow-request:' || v_request_id::text,
        true
      );
    exception when others then
      -- Persist GPS fixes even when Realtime is temporarily unavailable; the
      -- next one-second fix can be broadcast after the private topic reconnects.
      raise warning 'Towber driver location broadcast failed for request %', v_request_id;
    end;
  end loop;

  return new;
end;
$$;

notify pgrst, 'reload schema';
