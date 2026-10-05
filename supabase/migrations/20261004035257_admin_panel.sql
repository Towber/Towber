create or replace function public.admin_partner_overview()
returns table (
  company_id uuid, company_name text, registration_number text, contact_phone text,
  is_verified boolean, created_at timestamptz, owner_email text,
  vehicles bigint, vehicles_online bigint, jobs_total bigint, jobs_completed bigint,
  rating_avg numeric, rating_count bigint, services text[]
)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.company_name::text, c.registration_number::text, c.contact_phone::text,
    coalesce(c.is_verified, false), c.created_at,
    (select p.email from public.user_profiles p where p.user_id = c.owner_user_id),
    (select count(*) from public.vehicles v where v.company_id = c.id),
    (select count(*) from public.vehicles v where v.company_id = c.id and v.is_active is true),
    (select count(*) from public.tow_requests r join public.vehicles v on v.id = r.assigned_vehicle_id where v.company_id = c.id),
    (select count(*) from public.tow_requests r join public.vehicles v on v.id = r.assigned_vehicle_id where v.company_id = c.id and r.status = 'completed'),
    (select round(avg(rt.rating)::numeric, 2) from public.request_ratings rt
       join public.tow_requests r on r.id = rt.request_id join public.vehicles v on v.id = r.assigned_vehicle_id
       where v.company_id = c.id and rt.admin_hidden is not true),
    (select count(*) from public.request_ratings rt
       join public.tow_requests r on r.id = rt.request_id join public.vehicles v on v.id = r.assigned_vehicle_id
       where v.company_id = c.id and rt.admin_hidden is not true),
    coalesce((select array_agg(s.service_code order by s.service_code) from public.company_services s where s.company_id = c.id), '{}')
  from public.towing_companies c
  order by c.created_at desc nulls last;
$$;

create or replace function public.admin_ratings_list(
  p_max_rating int default 5,
  p_visibility text default 'visible',
  p_company_id uuid default null,
  p_limit int default 100
)
returns table (
  rating_id uuid, request_id uuid, rating smallint, comment text, created_at timestamptz,
  admin_hidden boolean, rater_email text, company_id uuid, company_name text, vehicle_registration text
)
language sql stable security definer set search_path = ''
as $$
  select rt.id, rt.request_id, rt.rating, rt.comment, rt.created_at, rt.admin_hidden,
         p.email, c.id, c.company_name::text, v.registration_number::text
  from public.request_ratings rt
  join public.tow_requests r on r.id = rt.request_id
  left join public.vehicles v on v.id = r.assigned_vehicle_id
  left join public.towing_companies c on c.id = v.company_id
  left join public.user_profiles p on p.user_id = rt.rater_user_id
  where rt.rating <= p_max_rating
    and (p_company_id is null or c.id = p_company_id)
    and (p_visibility = 'all'
         or (p_visibility = 'hidden' and rt.admin_hidden is true)
         or (p_visibility = 'visible' and rt.admin_hidden is not true))
  order by rt.created_at desc
  limit least(greatest(p_limit, 1), 500);
$$;

create or replace function public.admin_set_tow_rate(
  p_company_id uuid, p_class text, p_callout numeric, p_per_km numeric, p_minimum numeric
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_callout < 0 or p_per_km < 0 or p_minimum < 0 then
    raise exception 'Fees cannot be negative' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tow_service_classes where code = p_class) then
    raise exception 'Unknown tow class' using errcode = '22023';
  end if;
  update public.tow_fare_rates set active = false, effective_to = now()
  where company_id = p_company_id and service_class_code = p_class and active is true;
  insert into public.tow_fare_rates (company_id, service_class_code, callout_fee_zar, per_km_rate_zar, minimum_fare_zar, currency, active)
  values (p_company_id, p_class, p_callout, p_per_km, p_minimum, 'ZAR', true);
end;
$$;

create or replace function public.admin_set_flat_rate(p_company_id uuid, p_service text, p_fee numeric)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_service not in ('jumpstart', 'lockout', 'fuel', 'tyre', 'repair') then
    raise exception 'Unknown service' using errcode = '22023';
  end if;
  if p_fee is not null and p_fee < 0 then
    raise exception 'Fees cannot be negative' using errcode = '22023';
  end if;
  update public.service_flat_rates set active = false, effective_to = now()
  where company_id is not distinct from p_company_id and service_code = p_service and active is true;
  if p_fee is not null then
    insert into public.service_flat_rates (company_id, service_code, flat_fee_zar, active)
    values (p_company_id, p_service, p_fee, true);
  end if;
end;
$$;

create or replace function public.admin_set_pricing_settings(
  p_company_id uuid, p_start time, p_end time, p_multiplier numeric
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_multiplier < 1 or p_multiplier > 3 then
    raise exception 'Multiplier must be between 1.00 and 3.00' using errcode = '22023';
  end if;
  update public.pricing_settings
  set after_hours_start = p_start, after_hours_end = p_end, after_hours_multiplier = p_multiplier, updated_at = now()
  where company_id is not distinct from p_company_id;
  if not found then
    insert into public.pricing_settings (company_id, after_hours_start, after_hours_end, after_hours_multiplier)
    values (p_company_id, p_start, p_end, p_multiplier);
  end if;
end;
$$;

create or replace function public.admin_set_partner_verified(p_company_id uuid, p_verified boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.towing_companies set is_verified = p_verified where id = p_company_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not p_verified then
    update public.vehicles set is_active = false where company_id = p_company_id;
  end if;
end;
$$;

revoke all on function public.admin_partner_overview() from public, anon, authenticated;
revoke all on function public.admin_ratings_list(int, text, uuid, int) from public, anon, authenticated;
revoke all on function public.admin_set_tow_rate(uuid, text, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.admin_set_flat_rate(uuid, text, numeric) from public, anon, authenticated;
revoke all on function public.admin_set_pricing_settings(uuid, time, time, numeric) from public, anon, authenticated;
revoke all on function public.admin_set_partner_verified(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_partner_overview() to service_role;
grant execute on function public.admin_ratings_list(int, text, uuid, int) to service_role;
grant execute on function public.admin_set_tow_rate(uuid, text, numeric, numeric, numeric) to service_role;
grant execute on function public.admin_set_flat_rate(uuid, text, numeric) to service_role;
grant execute on function public.admin_set_pricing_settings(uuid, time, time, numeric) to service_role;
grant execute on function public.admin_set_partner_verified(uuid, boolean) to service_role;

notify pgrst, 'reload schema';
