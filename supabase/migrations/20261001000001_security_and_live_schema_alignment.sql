-- Secure the existing Towber tables and formalize the schema already deployed.

create index if not exists towing_companies_owner_user_id_idx
  on public.towing_companies(owner_user_id);
create index if not exists vehicles_company_id_idx
  on public.vehicles(company_id);
create index if not exists vehicles_active_location_gix
  on public.vehicles using gist(current_location)
  where is_active is true and current_location is not null;
create index if not exists rate_cards_company_base_fee_idx
  on public.rate_cards(company_id, base_fee);
create index if not exists tow_requests_user_created_idx
  on public.tow_requests(user_id, created_at desc);
create index if not exists tow_requests_company_status_created_idx
  on public.tow_requests(selected_company_id, status, created_at desc);
create index if not exists tow_requests_pickup_gix
  on public.tow_requests using gist(pickup_location);

alter table public.towing_companies enable row level security;
alter table public.vehicles enable row level security;
alter table public.rate_cards enable row level security;
alter table public.tow_requests enable row level security;

revoke all on table public.towing_companies from anon, authenticated;
revoke all on table public.vehicles from anon, authenticated;
revoke all on table public.rate_cards from anon, authenticated;
revoke all on table public.tow_requests from anon, authenticated;

grant select on table public.towing_companies, public.vehicles, public.rate_cards to authenticated;
grant select on table public.tow_requests to authenticated;
grant all on table public.towing_companies, public.vehicles, public.rate_cards, public.tow_requests to service_role;

drop policy if exists "company owners can read their companies" on public.towing_companies;
create policy "company owners can read their companies"
  on public.towing_companies for select to authenticated
  using (owner_user_id = (select auth.uid()));

drop policy if exists "company owners can read their vehicles" on public.vehicles;
create policy "company owners can read their vehicles"
  on public.vehicles for select to authenticated
  using (
    exists (
      select 1 from public.towing_companies c
      where c.id = vehicles.company_id
        and c.owner_user_id = (select auth.uid())
    )
  );

drop policy if exists "company owners can read their rate cards" on public.rate_cards;
create policy "company owners can read their rate cards"
  on public.rate_cards for select to authenticated
  using (
    exists (
      select 1 from public.towing_companies c
      where c.id = rate_cards.company_id
        and c.owner_user_id = (select auth.uid())
    )
  );

drop policy if exists "motorists can read their own tow requests" on public.tow_requests;
create policy "motorists can read their own tow requests"
  on public.tow_requests for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "fleet owners can read requests for their companies" on public.tow_requests;
create policy "fleet owners can read requests for their companies"
  on public.tow_requests for select to authenticated
  using (
    exists (
      select 1 from public.towing_companies c
      where c.id = tow_requests.selected_company_id
        and c.owner_user_id = (select auth.uid())
    )
  );

-- Preserve the live RPC return names and types so create-or-replace can update
-- it in place. The security-definer search_path is empty; all objects/functions
-- are explicitly schema-qualified.
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
    pricing.price_min,
    round(pricing.price_min * 1.15, 0) as price_max
  from public.vehicles v
  join public.towing_companies c
    on c.id = v.company_id
   and c.is_verified is true
  cross join lateral (
    select public.st_setsrid(
      public.st_makepoint(user_lng, user_lat), 4326
    )::public.geography as point
  ) pickup
  join lateral (
    select greatest(
      rc.min_price,
      rc.base_fee + rc.per_km_rate * trip_distance_km
    ) as price_min
    from public.rate_cards rc
    where rc.company_id = c.id
    order by rc.base_fee asc
    limit 1
  ) pricing on true
  where v.is_active is true
    and v.current_location is not null
    and trip_distance_km between 0.5 and 1500
    and search_radius_meters between 500 and 50000
    and public.st_dwithin(v.current_location, pickup.point, search_radius_meters)
  order by distance_meters asc;
$$;

revoke all on function public.get_nearby_vehicles(
  double precision, double precision, numeric, integer
) from public, anon, authenticated;
grant execute on function public.get_nearby_vehicles(
  double precision, double precision, numeric, integer
) to service_role;

notify pgrst, 'reload schema';
