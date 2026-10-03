-- Towber: flat-fee services, after-hours surcharge, and partner onboarding.
-- No tariff amounts are seeded: until an admin sets flat fees (platform-wide
-- or per company), a service is simply not offered/priced.
-- Internal names keep "driver" (role value, vehicle_driver_assignments); the
-- app calls these users "partners".

-- ---------------------------------------------------------------------------
-- 1) Which services each partner company offers
-- ---------------------------------------------------------------------------
create table if not exists public.company_services (
  company_id uuid not null references public.towing_companies(id) on delete cascade,
  service_code text not null
    check (service_code in ('flatbed', 'jumpstart', 'lockout', 'fuel', 'tyre', 'repair')),
  created_at timestamptz not null default now(),
  primary key (company_id, service_code)
);

alter table public.company_services enable row level security;
revoke all on public.company_services from public, anon, authenticated;
grant select on public.company_services to authenticated;
grant all on public.company_services to service_role;

drop policy if exists "owners read their company services" on public.company_services;
create policy "owners read their company services"
  on public.company_services for select to authenticated
  using (exists (
    select 1 from public.towing_companies c
    where c.id = company_id and c.owner_user_id = (select auth.uid())
  ));

-- Existing companies were towing-only.
insert into public.company_services (company_id, service_code)
select id, 'flatbed' from public.towing_companies
on conflict do nothing;

-- Roadside responders drive a bakkie/sedan, not a tow truck.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.vehicles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%vehicle_type%'
  loop
    execute format('alter table public.vehicles drop constraint %I', c.conname);
  end loop;
  alter table public.vehicles
    add constraint vehicles_vehicle_type_check
    check (vehicle_type in ('flatbed_rollback', 'standard_tow', 'heavy_duty', 'winch_recovery', 'roadside_unit'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Flat fees (non-towing services) and the after-hours surcharge
-- ---------------------------------------------------------------------------
create table if not exists public.service_flat_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.towing_companies(id) on delete cascade, -- null = platform default
  service_code text not null check (service_code in ('jumpstart', 'lockout', 'fuel', 'tyre', 'repair')),
  flat_fee_zar numeric(10, 2) not null check (flat_fee_zar >= 0),
  active boolean not null default true,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

create index if not exists service_flat_rates_lookup_idx
  on public.service_flat_rates(company_id, service_code, effective_from desc)
  where active is true;

alter table public.service_flat_rates enable row level security;
revoke all on public.service_flat_rates from public, anon, authenticated;
grant all on public.service_flat_rates to service_role;

-- company_id null = platform default. A company row overrides the default.
create table if not exists public.pricing_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.towing_companies(id) on delete cascade,
  after_hours_start time not null default '20:00',
  after_hours_end time not null default '05:00',
  -- 1.00 = no surcharge. Opt in by setting e.g. 1.25 (25% more).
  after_hours_multiplier numeric(4, 2) not null default 1.00
    check (after_hours_multiplier between 1.00 and 3.00),
  updated_at timestamptz not null default now()
);

create unique index if not exists pricing_settings_one_per_company_idx
  on public.pricing_settings(company_id) where company_id is not null;
create unique index if not exists pricing_settings_one_platform_default_idx
  on public.pricing_settings((true)) where company_id is null;

alter table public.pricing_settings enable row level security;
revoke all on public.pricing_settings from public, anon, authenticated;
grant all on public.pricing_settings to service_role;

-- Quote snapshot columns on each request.
alter table public.tow_requests
  add column if not exists fare_pricing_model text,
  add column if not exists quoted_flat_fee_zar numeric(10, 2),
  add column if not exists fare_surcharge_multiplier numeric(4, 2),
  add column if not exists fare_surcharge_label text,
  add column if not exists fare_price_note text;

-- Surcharge that applies to a company at a moment in time (South African time).
create or replace function public.pricing_surcharge(p_company_id uuid, p_at timestamptz default now())
returns table (multiplier numeric, label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s record;
  t time;
  v_active boolean;
begin
  select ps.after_hours_start, ps.after_hours_end, ps.after_hours_multiplier
    into s
  from public.pricing_settings ps
  where ps.company_id = p_company_id or ps.company_id is null
  order by (ps.company_id is null) asc
  limit 1;

  if not found or s.after_hours_multiplier <= 1 then
    return query select 1.00::numeric, null::text;
    return;
  end if;

  t := (p_at at time zone 'Africa/Johannesburg')::time;
  if s.after_hours_start = s.after_hours_end then
    v_active := false;
  elsif s.after_hours_start > s.after_hours_end then
    v_active := t >= s.after_hours_start or t < s.after_hours_end;  -- crosses midnight
  else
    v_active := t >= s.after_hours_start and t < s.after_hours_end;
  end if;

  if v_active then
    return query select s.after_hours_multiplier::numeric, 'After-hours rate'::text;
  else
    return query select 1.00::numeric, null::text;
  end if;
end;
$$;

revoke all on function public.pricing_surcharge(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.pricing_surcharge(uuid, timestamptz) to service_role;

-- One quote function for every service:
--   flatbed  -> existing distance fare (call-out + per km, minimum) x surcharge
--   others   -> flat fee x surcharge
-- Returns no row when the partner does not offer the service or has no price.
create or replace function public.calculate_service_fare(
  p_vehicle_id uuid,
  p_breakdown_type text,
  p_distance_km numeric,
  p_at timestamptz default now()
)
returns table (
  service_class_code text,
  currency text,
  distance_km numeric,
  callout_fee_zar numeric,
  per_km_rate_zar numeric,
  minimum_fare_zar numeric,
  pricing_model text,
  flat_fee_zar numeric,
  surcharge_multiplier numeric,
  surcharge_label text,
  price_note text,
  total_zar numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_class text;
  v_mult numeric;
  v_label text;
  v_base record;
  v_flat numeric;
begin
  if p_breakdown_type is null
     or p_breakdown_type not in ('flatbed', 'jumpstart', 'lockout', 'fuel', 'tyre', 'repair') then
    raise exception 'Unknown service for fare quote' using errcode = '22023';
  end if;

  select v.company_id, v.service_class_code
    into v_company_id, v_class
  from public.vehicles v
  where v.id = p_vehicle_id;
  if not found then return; end if;

  if not exists (
    select 1 from public.company_services cs
    where cs.company_id = v_company_id and cs.service_code = p_breakdown_type
  ) then
    return;
  end if;

  select s.multiplier, s.label into v_mult, v_label
  from public.pricing_surcharge(v_company_id, p_at) s;

  if p_breakdown_type = 'flatbed' then
    select f.* into v_base from public.calculate_tow_fare(p_vehicle_id, p_distance_km) f;
    if not found then return; end if;
    return query select
      v_base.service_class_code, 'ZAR'::text, v_base.distance_km,
      v_base.callout_fee_zar, v_base.per_km_rate_zar, v_base.minimum_fare_zar,
      'distance'::text, null::numeric, v_mult, v_label, null::text,
      round(v_base.total_zar * v_mult, 2);
    return;
  end if;

  select r.flat_fee_zar into v_flat
  from public.service_flat_rates r
  where r.service_code = p_breakdown_type
    and r.active is true
    and r.effective_from <= p_at
    and (r.effective_to is null or r.effective_to > p_at)
    and (r.company_id = v_company_id or r.company_id is null)
  order by (r.company_id is null) asc, r.effective_from desc, r.created_at desc
  limit 1;
  if not found then return; end if;

  return query select
    v_class, 'ZAR'::text, round(p_distance_km, 2),
    v_flat, 0::numeric, v_flat,
    'flat'::text, v_flat, v_mult, v_label,
    case p_breakdown_type
      when 'fuel' then 'Fuel is charged at cost on delivery.'
      when 'repair' then 'Parts are extra. Your technician confirms the final price on site.'
      else null
    end,
    round(v_flat * v_mult, 2);
end;
$$;

revoke all on function public.calculate_service_fare(uuid, text, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.calculate_service_fare(uuid, text, numeric, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Nearby search: only partners that offer the requested service and have a price
-- ---------------------------------------------------------------------------
drop function if exists public.get_nearby_vehicles(double precision, double precision, numeric, integer);

create or replace function public.get_nearby_vehicles(
  user_lat double precision,
  user_lng double precision,
  trip_distance_km numeric,
  search_radius_meters integer default 15000,
  p_breakdown_type text default 'flatbed'
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
  price_max numeric,
  pricing_model text,
  price_note text,
  surcharge_label text
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
    fare.total_zar as price_max,
    fare.pricing_model,
    fare.price_note,
    fare.surcharge_label
  from public.vehicles v
  join public.towing_companies c
    on c.id = v.company_id
   and c.is_verified is true
  cross join lateral (
    select public.st_setsrid(
      public.st_makepoint(user_lng, user_lat), 4326
    )::public.geography as point
  ) pickup
  join lateral public.calculate_service_fare(v.id, p_breakdown_type, trip_distance_km) fare on true
  where v.is_active is true
    and v.current_location is not null
    and trip_distance_km between 0.5 and 1500
    and search_radius_meters between 500 and 50000
    and (p_breakdown_type <> 'flatbed' or v.vehicle_type <> 'roadside_unit')
    and public.st_dwithin(v.current_location, pickup.point, search_radius_meters)
  order by distance_meters asc;
$$;

revoke all on function public.get_nearby_vehicles(double precision, double precision, numeric, integer, text) from public, anon, authenticated;
grant execute on function public.get_nearby_vehicles(double precision, double precision, numeric, integer, text) to service_role;

-- Re-dispatch must respect the requested service too (partners only ever see
-- jobs for services they offer).
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
         50000,
         coalesce(v_request.breakdown_type, 'flatbed')
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

-- ---------------------------------------------------------------------------
-- 4) Partner applications
-- ---------------------------------------------------------------------------
create table if not exists public.partner_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  partner_tier text not null check (partner_tier in ('tow_operator', 'roadside_responder')),
  capabilities text[] not null default '{}'
    check (capabilities <@ array['flatbed', 'jumpstart', 'lockout', 'fuel', 'tyre', 'repair']::text[]),
  business_name text not null,
  company_registration_number text,
  contact_phone text not null,
  vehicle_registration text not null,
  tow_vehicle_type text
    check (tow_vehicle_type is null or tow_vehicle_type in ('flatbed_rollback', 'standard_tow', 'heavy_duty', 'winch_recovery')),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'needs_info', 'approved', 'rejected')),
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  company_id uuid references public.towing_companies(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (partner_tier <> 'tow_operator' or ('flatbed' = any(capabilities) and tow_vehicle_type is not null)),
  check (partner_tier <> 'roadside_responder' or not ('flatbed' = any(capabilities)))
);

-- One open application per person.
create unique index if not exists partner_applications_one_open_idx
  on public.partner_applications(user_id)
  where status in ('draft', 'submitted', 'needs_info');

create table if not exists public.partner_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  document_type text not null check (document_type in (
    'id_document', 'drivers_license', 'prdp', 'vehicle_license_disc',
    'certificate_of_fitness', 'towing_insurance', 'towing_permit',
    'trade_certificate', 'vehicle_photo', 'equipment_photo'
  )),
  object_path text not null unique,
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 10485760),
  expires_on date,
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  check (object_path like submitted_by::text || '/%')
);

create index if not exists partner_documents_application_idx
  on public.partner_documents(application_id, document_type);

alter table public.partner_applications enable row level security;
alter table public.partner_documents enable row level security;
revoke all on public.partner_applications from public, anon, authenticated;
revoke all on public.partner_documents from public, anon, authenticated;
grant select, insert on public.partner_applications to authenticated;
grant update (partner_tier, capabilities, business_name, company_registration_number,
              contact_phone, vehicle_registration, tow_vehicle_type, updated_at)
  on public.partner_applications to authenticated;
grant select, insert, delete on public.partner_documents to authenticated;
grant all on public.partner_applications, public.partner_documents to service_role;

drop policy if exists "applicants read their application" on public.partner_applications;
create policy "applicants read their application"
  on public.partner_applications for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "applicants start their application" on public.partner_applications;
create policy "applicants start their application"
  on public.partner_applications for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'draft');

-- Editable only while it is a draft or the reviewer asked for more info.
drop policy if exists "applicants edit open application" on public.partner_applications;
create policy "applicants edit open application"
  on public.partner_applications for update to authenticated
  using (user_id = (select auth.uid()) and status in ('draft', 'needs_info'))
  with check (user_id = (select auth.uid()) and status in ('draft', 'needs_info'));

drop policy if exists "applicants read their documents" on public.partner_documents;
create policy "applicants read their documents"
  on public.partner_documents for select to authenticated
  using (submitted_by = (select auth.uid()));

drop policy if exists "applicants add documents to open application" on public.partner_documents;
create policy "applicants add documents to open application"
  on public.partner_documents for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and object_path like (select auth.uid())::text || '/%'
    and exists (
      select 1 from public.partner_applications a
      where a.id = application_id
        and a.user_id = (select auth.uid())
        and a.status in ('draft', 'needs_info')
    )
  );

drop policy if exists "applicants remove documents from open application" on public.partner_documents;
create policy "applicants remove documents from open application"
  on public.partner_documents for delete to authenticated
  using (
    submitted_by = (select auth.uid())
    and exists (
      select 1 from public.partner_applications a
      where a.id = application_id
        and a.user_id = (select auth.uid())
        and a.status in ('draft', 'needs_info')
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'partner-documents-private', 'partner-documents-private', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "applicants upload own partner documents" on storage.objects;
create policy "applicants upload own partner documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'partner-documents-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "applicants read own partner documents" on storage.objects;
create policy "applicants read own partner documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'partner-documents-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "applicants delete own partner documents" on storage.objects;
create policy "applicants delete own partner documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'partner-documents-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Required documents per application. Towing needs the PrDP + insurance;
-- trade certificate is optional (shown for repairs).
create or replace function public.partner_required_documents(p_application_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.partner_applications%rowtype;
  docs text[] := array['id_document', 'vehicle_license_disc'];
begin
  select * into a from public.partner_applications where id = p_application_id;
  if not found then return '{}'; end if;
  if a.partner_tier = 'tow_operator' then
    docs := docs || array['prdp', 'certificate_of_fitness', 'towing_insurance', 'equipment_photo'];
  else
    docs := docs || array['drivers_license', 'vehicle_photo'];
  end if;
  return docs;
end;
$$;

revoke all on function public.partner_required_documents(uuid) from public, anon, authenticated;
grant execute on function public.partner_required_documents(uuid) to service_role;

-- Applicant submits for review. Only the owner, only when every required
-- document has been uploaded.
create or replace function public.submit_partner_application(p_application_id uuid)
returns public.partner_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.partner_applications%rowtype;
  v_missing text[];
begin
  select * into a
  from public.partner_applications
  where id = p_application_id and user_id = (select auth.uid())
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if a.status not in ('draft', 'needs_info') then
    raise exception 'conflict:already_submitted' using errcode = '23000';
  end if;
  if coalesce(array_length(a.capabilities, 1), 0) = 0 then
    raise exception 'invalid_application:no_services' using errcode = '22023';
  end if;

  select array_agg(req) into v_missing
  from unnest(public.partner_required_documents(p_application_id)) req
  where not exists (
    select 1 from public.partner_documents d
    where d.application_id = p_application_id and d.document_type = req
  );
  if v_missing is not null then
    raise exception 'invalid_application:missing_documents:%', array_to_string(v_missing, ',')
      using errcode = '22023';
  end if;

  update public.partner_applications
  set status = 'submitted', submitted_at = now(), updated_at = now()
  where id = p_application_id
  returning * into a;
  return a;
end;
$$;

revoke all on function public.submit_partner_application(uuid) from public, anon;
grant execute on function public.submit_partner_application(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Admin review. Run from the Supabase SQL editor / service role only.
-- ---------------------------------------------------------------------------
create or replace function public.admin_approve_partner_application(
  p_application_id uuid,
  p_reviewer_user_id uuid,
  p_notes text default null
)
returns uuid  -- the new company id
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.partner_applications%rowtype;
  v_company_id uuid;
  v_vehicle_id uuid;
  v_service text;
begin
  select * into a from public.partner_applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if a.status <> 'submitted' then
    raise exception 'conflict:not_submitted' using errcode = '23000';
  end if;

  insert into public.towing_companies (
    company_name, registration_number, contact_phone, is_verified, owner_user_id
  ) values (
    a.business_name,
    coalesce(nullif(trim(a.company_registration_number), ''), 'IND-' || replace(a.id::text, '-', '')),
    a.contact_phone, true, a.user_id
  ) returning id into v_company_id;

  insert into public.vehicles (company_id, registration_number, vehicle_type, is_active)
  values (
    v_company_id, a.vehicle_registration,
    case when a.partner_tier = 'tow_operator' then a.tow_vehicle_type else 'roadside_unit' end,
    true
  ) returning id into v_vehicle_id;

  foreach v_service in array a.capabilities loop
    insert into public.company_services (company_id, service_code)
    values (v_company_id, v_service)
    on conflict do nothing;
  end loop;

  insert into public.vehicle_driver_assignments (vehicle_id, driver_user_id, assigned_by_user_id)
  values (v_vehicle_id, a.user_id, p_reviewer_user_id);

  update public.user_profiles set role = 'driver', updated_at = now() where user_id = a.user_id;

  update public.partner_documents set review_status = 'approved'
  where application_id = a.id and review_status = 'pending';

  update public.partner_applications
  set status = 'approved', reviewed_by = p_reviewer_user_id, reviewed_at = now(),
      review_notes = p_notes, company_id = v_company_id, updated_at = now()
  where id = a.id;

  return v_company_id;
end;
$$;

create or replace function public.admin_review_partner_application(
  p_application_id uuid,
  p_reviewer_user_id uuid,
  p_decision text,           -- 'needs_info' | 'rejected'
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_decision not in ('needs_info', 'rejected') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  if coalesce(trim(p_notes), '') = '' then
    raise exception 'A note is required so the applicant knows what to fix' using errcode = '22023';
  end if;
  update public.partner_applications
  set status = p_decision, reviewed_by = p_reviewer_user_id, reviewed_at = now(),
      review_notes = p_notes, updated_at = now()
  where id = p_application_id and status = 'submitted';
  if not found then
    raise exception 'conflict:not_submitted' using errcode = '23000';
  end if;
end;
$$;

revoke all on function public.admin_approve_partner_application(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_review_partner_application(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_approve_partner_application(uuid, uuid, text) to service_role;
grant execute on function public.admin_review_partner_application(uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
