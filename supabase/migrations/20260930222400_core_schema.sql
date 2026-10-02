-- Towber bootstrap schema, idempotent so it can be applied to both the
-- already-provisioned linked project and a fresh Supabase project. The live
-- database uses the legacy estimated_* request fields and PostGIS in public.

create extension if not exists postgis with schema public;
set search_path to public, extensions;

create table if not exists public.towing_companies (
  id uuid primary key default gen_random_uuid(),
  company_name character varying not null,
  registration_number character varying not null unique,
  vat_number character varying,
  contact_phone character varying not null,
  is_verified boolean default false,
  created_at timestamptz default now(),
  owner_user_id uuid references auth.users(id)
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.towing_companies(id) on delete cascade,
  registration_number character varying not null unique,
  vehicle_type character varying check (
    vehicle_type in ('flatbed_rollback', 'standard_tow', 'heavy_duty', 'winch_recovery')
  ),
  is_active boolean default true,
  current_location geography(Point, 4326),
  updated_at timestamptz default now()
);

create table if not exists public.rate_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.towing_companies(id) on delete cascade,
  operating_city character varying not null,
  base_fee numeric not null,
  per_km_rate numeric not null,
  min_price numeric not null,
  currency character varying default 'ZAR'
);

create table if not exists public.tow_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  pickup_location geography(Point, 4326) not null,
  dropoff_location geography(Point, 4326) not null,
  estimated_distance_km numeric not null,
  selected_company_id uuid references public.towing_companies(id),
  assigned_vehicle_id uuid references public.vehicles(id),
  estimated_price_min numeric not null,
  estimated_price_max numeric not null,
  final_price numeric,
  status character varying default 'pending' check (
    status in ('pending', 'accepted', 'en_route', 'completed', 'cancelled')
  ),
  created_at timestamptz default now()
);

alter table public.towing_companies enable row level security;
alter table public.vehicles enable row level security;
alter table public.rate_cards enable row level security;
alter table public.tow_requests enable row level security;
