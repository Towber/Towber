create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from public, anon, authenticated;
grant all on public.admin_users to service_role;

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_user_id uuid references auth.users(id) on delete set null,
  admin_email text,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log(created_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;
grant all on public.admin_audit_log to service_role;

alter table public.request_ratings
  add column if not exists admin_hidden boolean not null default false,
  add column if not exists admin_hidden_at timestamptz;

create or replace view public.admin_company_overview
with (security_invoker = true) as
select
  c.id,
  c.company_name,
  c.registration_number,
  c.vat_number,
  c.contact_phone,
  c.is_verified,
  c.created_at,
  c.owner_user_id,
  up.email as owner_email,
  coalesce(v.vehicles, 0)::int as vehicles,
  coalesce(v.active_vehicles, 0)::int as active_vehicles,
  coalesce(s.services, '{}'::text[]) as services,
  coalesce(j.jobs_total, 0)::int as jobs_total,
  coalesce(j.jobs_completed, 0)::int as jobs_completed,
  r.rating_avg,
  coalesce(r.rating_count, 0)::int as rating_count
from public.towing_companies c
left join public.user_profiles up on up.user_id = c.owner_user_id
left join lateral (
  select count(*) as vehicles, count(*) filter (where x.is_active) as active_vehicles
  from public.vehicles x where x.company_id = c.id
) v on true
left join lateral (
  select array_agg(cs.service_code order by cs.service_code) as services
  from public.company_services cs where cs.company_id = c.id
) s on true
left join lateral (
  select count(*) as jobs_total, count(*) filter (where t.status = 'completed') as jobs_completed
  from public.tow_requests t where t.selected_company_id = c.id
) j on true
left join lateral (
  select round(avg(rr.rating)::numeric, 2) as rating_avg, count(*) as rating_count
  from public.request_ratings rr
  join public.tow_requests t on t.id = rr.request_id
  where t.selected_company_id = c.id and rr.admin_hidden is not true
) r on true;

revoke all on public.admin_company_overview from public, anon, authenticated;
grant select on public.admin_company_overview to service_role;

create or replace function public.admin_dashboard_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'applications_pending', (select count(*) from public.partner_applications where status = 'submitted'),
    'applications_needs_info', (select count(*) from public.partner_applications where status = 'needs_info'),
    'partners_total', (select count(*) from public.towing_companies),
    'partners_verified', (select count(*) from public.towing_companies where is_verified is true),
    'vehicles_online', (select count(*) from public.vehicles v join public.towing_companies c on c.id = v.company_id where v.is_active is true and c.is_verified is true),
    'requests_total', (select count(*) from public.tow_requests),
    'requests_today', (select count(*) from public.tow_requests
        where created_at >= (date_trunc('day', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg')),
    'requests_open', (select count(*) from public.tow_requests where status in ('pending', 'accepted', 'en_route', 'arrived')),
    'completed_30d', (select count(*) from public.tow_requests where status = 'completed' and created_at >= now() - interval '30 days'),
    'cancelled_30d', (select count(*) from public.tow_requests where status in ('cancelled', 'declined', 'expired') and created_at >= now() - interval '30 days'),
    'job_value_30d', (select coalesce(sum(coalesce(final_price, estimated_price_max)), 0) from public.tow_requests where status = 'completed' and created_at >= now() - interval '30 days'),
    'rating_avg', (select round(avg(rating)::numeric, 2) from public.request_ratings where admin_hidden is not true),
    'rating_count', (select count(*) from public.request_ratings where admin_hidden is not true),
    'low_ratings_7d', (select count(*) from public.request_ratings where admin_hidden is not true and rating <= 2 and created_at >= now() - interval '7 days'),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', to_char(g.day, 'YYYY-MM-DD'),
               'total', coalesce(x.total, 0),
               'completed', coalesce(x.completed, 0)
             ) order by g.day), '[]'::jsonb)
      from generate_series(
             (now() at time zone 'Africa/Johannesburg')::date - 13,
             (now() at time zone 'Africa/Johannesburg')::date,
             interval '1 day'
           ) as g(day)
      left join (
        select (t.created_at at time zone 'Africa/Johannesburg')::date as day,
               count(*) as total,
               count(*) filter (where t.status = 'completed') as completed
        from public.tow_requests t
        group by 1
      ) x on x.day = g.day::date
    )
  );
$$;
revoke all on function public.admin_dashboard_stats() from public, anon, authenticated;
grant execute on function public.admin_dashboard_stats() to service_role;

notify pgrst, 'reload schema';
