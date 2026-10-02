-- Service selection + vehicle details captured on the new "What do you need?" screen.
-- Every new column is nullable/defaulted so older app builds keep working.

-- 1) More breakdown services (original three kept as-is).
alter table public.tow_requests drop constraint if exists tow_requests_breakdown_type_check;
alter table public.tow_requests
  add constraint tow_requests_breakdown_type_check
  check (breakdown_type in ('flatbed', 'jumpstart', 'lockout', 'fuel', 'tyre', 'repair'));

-- 2) Who the help is for and which vehicle is stuck.
alter table public.tow_requests
  add column if not exists service_for text not null default 'self',
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists vehicle_make_model text,
  add column if not exists vehicle_color text,
  add column if not exists vehicle_registration text,
  add column if not exists passengers smallint;

alter table public.tow_requests drop constraint if exists tow_requests_service_for_check;
alter table public.tow_requests
  add constraint tow_requests_service_for_check check (service_for in ('self', 'other'));

alter table public.tow_requests drop constraint if exists tow_requests_passengers_check;
alter table public.tow_requests
  add constraint tow_requests_passengers_check check (passengers is null or passengers between 0 and 12);
