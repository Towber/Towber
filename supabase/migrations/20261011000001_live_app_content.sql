-- Towber: one authoritative, realtime content source for the mobile app and admin console.
create table if not exists public.app_content (
  id uuid primary key default gen_random_uuid(),
  content_type text not null default 'poster' check (content_type in ('poster', 'announcement', 'banner')),
  title text not null check (char_length(trim(title)) between 1 and 160),
  body text not null default '' check (char_length(body) <= 2000),
  image_url text,
  action_url text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_content_published_at_check check (status <> 'published' or published_at is not null)
);

create index if not exists app_content_published_idx
  on public.app_content (published_at desc, updated_at desc)
  where status = 'published';
create index if not exists app_content_updated_idx
  on public.app_content (updated_at desc);

alter table public.app_content enable row level security;
revoke all on public.app_content from anon, authenticated;
grant select on public.app_content to anon, authenticated;
grant all on public.app_content to service_role;

drop policy if exists "published content is readable" on public.app_content;
create policy "published content is readable"
  on public.app_content for select to anon, authenticated
  using (status = 'published' and published_at is not null and published_at <= now());

create or replace function public.touch_app_content_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  if new.status = 'published' and (old.status is distinct from 'published' or new.published_at is null) then
    new.published_at = pg_catalog.now();
  elsif new.status <> 'published' then
    new.published_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists app_content_touch_updated_at on public.app_content;
create trigger app_content_touch_updated_at
before insert or update on public.app_content
for each row execute function public.touch_app_content_updated_at();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'app_content'
     ) then
    alter publication supabase_realtime add table public.app_content;
  end if;
end;
$$;

notify pgrst, 'reload schema';
