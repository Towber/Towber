-- Towber: private driver location broadcasts, verification documents, service
-- classes and company-configurable ZAR fares. No tariff amounts are seeded.
-- Apply this migration only after reviewing the deployment target.

create table if not exists public.tow_service_classes (
  code text primary key check (code in ('light_tow', 'heavy_duty', 'flatbed')),
  display_name text not null unique,
  sort_order smallint not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.tow_service_classes (code, display_name, sort_order)
values
  ('light_tow', 'Light Tow', 1),
  ('heavy_duty', 'Heavy Duty', 2),
  ('flatbed', 'Flatbed', 3)
on conflict (code) do update
set display_name = excluded.display_name,
    sort_order = excluded.sort_order;

alter table public.vehicles
  add column if not exists service_class_code text;

update public.vehicles
set service_class_code = case vehicle_type
  when 'heavy_duty' then 'heavy_duty'
  when 'flatbed_rollback' then 'flatbed'
  else 'light_tow'
end
where service_class_code is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vehicles_service_class_code_fkey'
      and conrelid = 'public.vehicles'::regclass
  ) then
    alter table public.vehicles
      add constraint vehicles_service_class_code_fkey
      foreign key (service_class_code)
      references public.tow_service_classes(code);
  end if;
end;
$$;

alter table public.vehicles
  alter column service_class_code set not null;

create or replace function public.default_vehicle_service_class()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.service_class_code is null then
      new.service_class_code := case new.vehicle_type
        when 'heavy_duty' then 'heavy_duty'
        when 'flatbed_rollback' then 'flatbed'
        else 'light_tow'
      end;
    end if;
  elsif new.vehicle_type is distinct from old.vehicle_type
     and new.service_class_code is not distinct from old.service_class_code then
    new.service_class_code := case new.vehicle_type
      when 'heavy_duty' then 'heavy_duty'
      when 'flatbed_rollback' then 'flatbed'
      else 'light_tow'
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.default_vehicle_service_class() from public, anon, authenticated;

drop trigger if exists set_vehicle_service_class on public.vehicles;
create trigger set_vehicle_service_class
before insert or update of vehicle_type, service_class_code
on public.vehicles
for each row
execute function public.default_vehicle_service_class();

create table if not exists public.vehicle_driver_assignments (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  driver_user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by_user_id uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index if not exists vehicle_driver_assignments_one_active_driver_idx
  on public.vehicle_driver_assignments(vehicle_id)
  where revoked_at is null;
create index if not exists vehicle_driver_assignments_driver_active_idx
  on public.vehicle_driver_assignments(driver_user_id, vehicle_id)
  where revoked_at is null;

create or replace function public.is_tow_vehicle_owner(p_vehicle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.vehicles v
    join public.towing_companies c on c.id = v.company_id
    where v.id = p_vehicle_id
      and c.owner_user_id = (select auth.uid())
  );
$$;

create or replace function public.is_active_vehicle_driver(p_vehicle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.vehicle_driver_assignments a
    where a.vehicle_id = p_vehicle_id
      and a.driver_user_id = (select auth.uid())
      and a.revoked_at is null
  );
$$;

revoke all on function public.is_tow_vehicle_owner(uuid) from public, anon;
revoke all on function public.is_active_vehicle_driver(uuid) from public, anon;
grant execute on function public.is_tow_vehicle_owner(uuid) to authenticated, service_role;
grant execute on function public.is_active_vehicle_driver(uuid) to authenticated, service_role;

alter table public.vehicle_driver_assignments enable row level security;
revoke all on public.vehicle_driver_assignments from anon, authenticated;
grant select, insert, update, delete on public.vehicle_driver_assignments to authenticated;
grant all on public.vehicle_driver_assignments to service_role;

drop policy if exists "fleet owners manage vehicle drivers" on public.vehicle_driver_assignments;
create policy "fleet owners manage vehicle drivers"
  on public.vehicle_driver_assignments
  for all to authenticated
  using (public.is_tow_vehicle_owner(vehicle_id))
  with check (
    public.is_tow_vehicle_owner(vehicle_id)
    and assigned_by_user_id = (select auth.uid())
  );

drop policy if exists "drivers read their vehicle assignments" on public.vehicle_driver_assignments;
create policy "drivers read their vehicle assignments"
  on public.vehicle_driver_assignments
  for select to authenticated
  using (driver_user_id = (select auth.uid()));

create table if not exists public.driver_locations (
  vehicle_id uuid primary key references public.vehicles(id) on delete cascade,
  driver_user_id uuid references auth.users(id) on delete set null,
  location public.geography(Point, 4326) not null,
  heading_degrees smallint check (heading_degrees between 0 and 359),
  speed_mps double precision check (speed_mps between 0 and 100),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists driver_locations_location_gix
  on public.driver_locations using gist (location);
create index if not exists driver_locations_recorded_at_idx
  on public.driver_locations(recorded_at desc);

create index if not exists tow_requests_pickup_location_gix
  on public.tow_requests using gist (pickup_location);
create index if not exists tow_requests_dropoff_location_gix
  on public.tow_requests using gist (dropoff_location);

alter table public.driver_locations enable row level security;
revoke all on public.driver_locations from anon, authenticated;
grant all on public.driver_locations to service_role;

create table if not exists public.tow_fare_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.towing_companies(id) on delete cascade,
  service_class_code text not null references public.tow_service_classes(code),
  callout_fee_zar numeric(10, 2) not null check (callout_fee_zar >= 0),
  per_km_rate_zar numeric(10, 2) not null check (per_km_rate_zar >= 0),
  minimum_fare_zar numeric(10, 2) not null check (minimum_fare_zar >= 0),
  currency char(3) not null default 'ZAR' check (currency = 'ZAR'),
  active boolean not null default true,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

create index if not exists tow_fare_rates_lookup_idx
  on public.tow_fare_rates(company_id, service_class_code, effective_from desc)
  where active is true;

alter table public.tow_fare_rates enable row level security;
revoke all on public.tow_fare_rates from anon, authenticated;
grant all on public.tow_fare_rates to service_role;

alter table public.tow_service_classes enable row level security;
revoke all on public.tow_service_classes from anon, authenticated;
grant select on public.tow_service_classes to authenticated;
grant all on public.tow_service_classes to service_role;

drop policy if exists "authenticated users read active tow classes" on public.tow_service_classes;
create policy "authenticated users read active tow classes"
  on public.tow_service_classes
  for select to authenticated
  using (is_active is true);

-- Keep an auditable snapshot of the quote attached to each newly created request.
alter table public.tow_requests
  add column if not exists fare_service_class_code text references public.tow_service_classes(code),
  add column if not exists fare_currency char(3) not null default 'ZAR',
  add column if not exists quoted_callout_fee_zar numeric(10, 2),
  add column if not exists quoted_per_km_rate_zar numeric(10, 2),
  add column if not exists quoted_minimum_fare_zar numeric(10, 2),
  add column if not exists fare_quoted_at timestamptz;

create or replace function public.calculate_tow_fare(
  p_vehicle_id uuid,
  p_distance_km numeric
)
returns table (
  service_class_code text,
  currency text,
  distance_km numeric,
  callout_fee_zar numeric,
  per_km_rate_zar numeric,
  minimum_fare_zar numeric,
  total_zar numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_service_class_code text;
  v_callout_fee_zar numeric;
  v_per_km_rate_zar numeric;
  v_minimum_fare_zar numeric;
begin
  if p_vehicle_id is null
     or p_distance_km is null
     or p_distance_km < 0.5
     or p_distance_km > 1500 then
    raise exception 'Invalid vehicle or distance for fare quote'
      using errcode = '22023';
  end if;

  select v.company_id, v.service_class_code
    into v_company_id, v_service_class_code
  from public.vehicles v
  join public.towing_companies c on c.id = v.company_id
  where v.id = p_vehicle_id
    and v.is_active is true
    and c.is_verified is true;

  if not found then
    return;
  end if;

  select r.callout_fee_zar, r.per_km_rate_zar, r.minimum_fare_zar
    into v_callout_fee_zar, v_per_km_rate_zar, v_minimum_fare_zar
  from public.tow_fare_rates r
  where r.company_id = v_company_id
    and r.service_class_code = v_service_class_code
    and r.currency = 'ZAR'
    and r.active is true
    and r.effective_from <= now()
    and (r.effective_to is null or r.effective_to > now())
  order by r.effective_from desc, r.created_at desc
  limit 1;

  if not found then
    -- Compatibility fallback: existing company rate cards are already ZAR by
    -- default. No guessed tariffs are inserted by this migration.
    select rc.base_fee, rc.per_km_rate, rc.min_price
      into v_callout_fee_zar, v_per_km_rate_zar, v_minimum_fare_zar
    from public.rate_cards rc
    where rc.company_id = v_company_id
      and coalesce(rc.currency, 'ZAR') = 'ZAR'
      and rc.base_fee >= 0
      and rc.per_km_rate >= 0
      and rc.min_price >= 0
    order by rc.base_fee asc
    limit 1;
  end if;

  if not found then
    return;
  end if;

  return query
  select
    v_service_class_code,
    'ZAR'::text,
    round(p_distance_km, 2),
    v_callout_fee_zar,
    v_per_km_rate_zar,
    v_minimum_fare_zar,
    round(greatest(v_minimum_fare_zar, v_callout_fee_zar + v_per_km_rate_zar * p_distance_km), 2);
end;
$$;

revoke all on function public.calculate_tow_fare(uuid, numeric) from public, anon, authenticated;
grant execute on function public.calculate_tow_fare(uuid, numeric) to service_role;

-- This remains callable only by the trusted API server, which passes the user
-- ID obtained by verifying the caller's Supabase JWT.
create or replace function public.record_driver_location(
  p_vehicle_id uuid,
  p_actor_user_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_heading_degrees smallint default null,
  p_speed_mps double precision default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_vehicle_id is null
     or p_actor_user_id is null
     or p_lat is null or p_lat < -90 or p_lat > 90
     or p_lng is null or p_lng < -180 or p_lng > 180
     or (p_heading_degrees is not null and p_heading_degrees not between 0 and 359)
     or (p_speed_mps is not null and p_speed_mps not between 0 and 100) then
    raise exception 'Invalid driver location payload'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.vehicles v
    join public.towing_companies c on c.id = v.company_id
    where v.id = p_vehicle_id
      and v.is_active is true
      and (
        c.owner_user_id = p_actor_user_id
        or exists (
          select 1
          from public.vehicle_driver_assignments a
          where a.vehicle_id = v.id
            and a.driver_user_id = p_actor_user_id
            and a.revoked_at is null
        )
      )
  ) then
    raise exception 'User is not an active driver for this vehicle'
      using errcode = '42501';
  end if;

  insert into public.driver_locations (
    vehicle_id, driver_user_id, location, heading_degrees, speed_mps, recorded_at, updated_at
  ) values (
    p_vehicle_id,
    p_actor_user_id,
    public.st_setsrid(public.st_makepoint(p_lng, p_lat), 4326)::public.geography,
    p_heading_degrees,
    p_speed_mps,
    now(),
    now()
  )
  on conflict (vehicle_id) do update set
    driver_user_id = excluded.driver_user_id,
    location = excluded.location,
    heading_degrees = excluded.heading_degrees,
    speed_mps = excluded.speed_mps,
    recorded_at = excluded.recorded_at,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.record_driver_location(uuid, uuid, double precision, double precision, smallint, double precision) from public, anon, authenticated;
grant execute on function public.record_driver_location(uuid, uuid, double precision, double precision, smallint, double precision) to service_role;

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
      and r.status in ('pending', 'accepted', 'en_route')
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

revoke all on function public.broadcast_driver_location() from public, anon, authenticated;

drop trigger if exists broadcast_driver_location on public.driver_locations;
create trigger broadcast_driver_location
after insert or update of location, heading_degrees, speed_mps
on public.driver_locations
for each row
execute function public.broadcast_driver_location();

create index if not exists tow_requests_assigned_vehicle_status_idx
  on public.tow_requests(assigned_vehicle_id, status);

-- RLS helper functions avoid exposing request/location rows just to evaluate a
-- Realtime channel subscription or a private Storage object read.
create or replace function public.can_receive_tow_location(
  p_request_id uuid
)
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
      and r.status in ('pending', 'accepted', 'en_route')
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

revoke all on function public.can_receive_tow_location(uuid) from public, anon;
grant execute on function public.can_receive_tow_location(uuid) to authenticated, service_role;

drop policy if exists "tow participants receive private driver locations" on realtime.messages;
create policy "tow participants receive private driver locations"
  on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) like 'tow-request:%'
    and public.can_receive_tow_location(
      substring((select realtime.topic()) from length('tow-request:') + 1)::uuid
    )
  );

create table if not exists public.driver_verification_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in ('pdp', 'vehicle_license_disc')),
  submitted_by uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  object_path text not null unique,
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 10485760),
  expires_on date,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  check (document_type <> 'vehicle_license_disc' or vehicle_id is not null),
  check (object_path like submitted_by::text || '/%')
);

create index if not exists driver_verification_documents_submitter_idx
  on public.driver_verification_documents(submitted_by, created_at desc);
create index if not exists driver_verification_documents_vehicle_idx
  on public.driver_verification_documents(vehicle_id, document_type, review_status);

alter table public.driver_verification_documents enable row level security;
revoke all on public.driver_verification_documents from anon, authenticated;
grant select, insert on public.driver_verification_documents to authenticated;
grant all on public.driver_verification_documents to service_role;

drop policy if exists "users read their verification documents" on public.driver_verification_documents;
create policy "users read their verification documents"
  on public.driver_verification_documents
  for select to authenticated
  using (
    submitted_by = (select auth.uid())
    or public.is_tow_vehicle_owner(vehicle_id)
    or public.is_active_vehicle_driver(vehicle_id)
  );

drop policy if exists "users submit their own verification documents" on public.driver_verification_documents;
create policy "users submit their own verification documents"
  on public.driver_verification_documents
  for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and object_path like (select auth.uid())::text || '/%'
    and (
      vehicle_id is null
      or public.is_tow_vehicle_owner(vehicle_id)
      or public.is_active_vehicle_driver(vehicle_id)
    )
  );

create or replace function public.can_read_driver_verification_object(
  p_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.driver_verification_documents d
    where d.object_path = p_object_path
      and (
        d.submitted_by = (select auth.uid())
        or exists (
          select 1
          from public.vehicles v
          join public.towing_companies c on c.id = v.company_id
          where v.id = d.vehicle_id
            and c.owner_user_id = (select auth.uid())
        )
        or exists (
          select 1
          from public.vehicle_driver_assignments a
          where a.vehicle_id = d.vehicle_id
            and a.driver_user_id = (select auth.uid())
            and a.revoked_at is null
        )
      )
  );
$$;

revoke all on function public.can_read_driver_verification_object(text) from public, anon;
grant execute on function public.can_read_driver_verification_object(text) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'driver-verification-private',
  'driver-verification-private',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users upload own Towber verification files" on storage.objects;
create policy "users upload own Towber verification files"
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'driver-verification-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "authorized users read Towber verification files" on storage.objects;
create policy "authorized users read Towber verification files"
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'driver-verification-private'
    and public.can_read_driver_verification_object(name)
  );


-- Keep the established get_nearby_vehicles return signature for the API, but
-- source both displayed prices from the same authoritative ZAR fare function.
create or replace function public.get_nearby_vehicles(
  user_lat double precision,
  user_lng double precision,
  trip_distance_km numeric,
  search_radius_meters integer default 15000
)
returns table (
  vehicle_id uuid,
  company_id uuid,
  company_name character varying,
  vehicle_type character varying,
  registration_number character varying,
  lat double precision,
  lng double precision,
  distance_meters double precision,
  price_min numeric,
  price_max numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    v.id as vehicle_id,
    c.id as company_id,
    c.company_name,
    v.vehicle_type,
    v.registration_number,
    public.st_y(v.current_location::public.geometry) as lat,
    public.st_x(v.current_location::public.geometry) as lng,
    public.st_distance(v.current_location, pickup.point) as distance_meters,
    fare.total_zar as price_min,
    fare.total_zar as price_max
  from public.vehicles v
  join public.towing_companies c
    on c.id = v.company_id
   and c.is_verified is true
  cross join lateral (
    select public.st_setsrid(
      public.st_makepoint(user_lng, user_lat), 4326
    )::public.geography as point
  ) pickup
  join lateral public.calculate_tow_fare(v.id, trip_distance_km) fare on true
  where v.is_active is true
    and v.current_location is not null
    and trip_distance_km between 0.5 and 1500
    and search_radius_meters between 500 and 50000
    and public.st_dwithin(v.current_location, pickup.point, search_radius_meters)
  order by distance_meters asc;
$$;

revoke all on function public.get_nearby_vehicles(double precision, double precision, numeric, integer) from public, anon, authenticated;
grant execute on function public.get_nearby_vehicles(double precision, double precision, numeric, integer) to service_role;

notify pgrst, 'reload schema';
