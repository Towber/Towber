-- TowberPro: profile badge + Winch Bakkie / Sling Tow document rules.
-- ('winch_recovery' is the stored value for Winch Bakkie / Sling Tow; no enum change needed.)

-- 1) Required documents. Winch Bakkie / Sling Tow operators upload a Code 8/10 PrDP
--    (stored as 'prdp'), vehicle registration (licence disc), GIT insurance
--    ('towing_insurance') and winch setup photos ('equipment_photo').
--    Other tow operators are unchanged (they also need a Certificate of Fitness).
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
    if a.tow_vehicle_type = 'winch_recovery' then
      docs := docs || array['prdp', 'towing_insurance', 'equipment_photo'];
    else
      docs := docs || array['prdp', 'certificate_of_fitness', 'towing_insurance', 'equipment_photo'];
    end if;
  else
    docs := docs || array['drivers_license', 'vehicle_photo'];
  end if;
  return docs;
end;
$$;

revoke all on function public.partner_required_documents(uuid) from public, anon, authenticated;
grant execute on function public.partner_required_documents(uuid) to service_role;

-- 2) Profile badge for the signed-in TowberPro: 'towing' when their company offers
--    Towing & recovery, otherwise 'mobile_tech'. Null when no assignment exists.
create or replace function public.get_my_towberpro_kind()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.company_services cs
      where cs.company_id = v.company_id and cs.service_code = 'flatbed'
    ) then 'towing'
    else 'mobile_tech'
  end
  from public.vehicle_driver_assignments a
  join public.vehicles v on v.id = a.vehicle_id
  where a.driver_user_id = (select auth.uid())
    and a.revoked_at is null
  limit 1;
$$;

revoke all on function public.get_my_towberpro_kind() from public, anon;
grant execute on function public.get_my_towberpro_kind() to authenticated, service_role;
