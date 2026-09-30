-- Run once in Supabase > SQL Editor.

-- 1) Lets a fleet owner's login update their own trucks' GPS.
alter table public.towing_companies
  add column if not exists owner_user_id uuid references auth.users(id);

-- 2) Nearby verified trucks with a price range for this trip.
create or replace function public.get_nearby_vehicles(
  user_lat double precision,
  user_lng double precision,
  trip_distance_km numeric,
  search_radius_meters integer default 15000
)
returns table (
  vehicle_id uuid,
  company_id uuid,
  company_name varchar,
  vehicle_type varchar,
  registration_number varchar,
  lat double precision,
  lng double precision,
  distance_meters double precision,
  price_min numeric,
  price_max numeric
)
language sql stable
set search_path = public
as $$
  select
    v.id,
    c.id,
    c.company_name,
    v.vehicle_type,
    v.registration_number,
    st_y(v.current_location::geometry),
    st_x(v.current_location::geometry),
    st_distance(v.current_location, st_point(user_lng, user_lat)::geography),
    round(greatest(r.min_price, r.base_fee + r.per_km_rate * trip_distance_km)),
    -- upper end of the range: +15% for traffic, waiting time, extras
    round(greatest(r.min_price, r.base_fee + r.per_km_rate * trip_distance_km) * 1.15)
  from public.vehicles v
  join public.towing_companies c on c.id = v.company_id and c.is_verified is true
  join lateral (
    select rc.* from public.rate_cards rc
    where rc.company_id = c.id
    order by rc.base_fee asc
    limit 1
  ) r on true
  where v.is_active is true
    and v.current_location is not null
    and st_dwithin(v.current_location, st_point(user_lng, user_lat)::geography, search_radius_meters)
  order by 8;
$$;

-- Only the API (service role) may call it.
revoke execute on function public.get_nearby_vehicles(double precision, double precision, numeric, integer) from public, anon, authenticated;
grant execute on function public.get_nearby_vehicles(double precision, double precision, numeric, integer) to service_role;
