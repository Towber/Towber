-- Keep the mobile app's existing public.user_profiles(user_id, role) contract.
-- Client sessions may read their own profile and edit contact details, but only
-- trusted service_role operations may assign the client/driver role.

DO $$
DECLARE
  existing_labels text[];
BEGIN
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
    INTO existing_labels
  FROM pg_type AS t
  JOIN pg_namespace AS n ON n.oid = t.typnamespace
  JOIN pg_enum AS e ON e.enumtypid = t.oid
  WHERE n.nspname = 'public'
    AND t.typname = 'user_role';

  IF existing_labels IS NULL THEN
    EXECUTE 'CREATE TYPE public.user_role AS ENUM (''client'', ''driver'')';
  ELSIF existing_labels IS DISTINCT FROM ARRAY['client', 'driver']::text[] THEN
    RAISE EXCEPTION 'public.user_role already exists with unexpected labels: %', existing_labels;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.user_role NOT NULL DEFAULT 'client'::public.user_role,
  email text,
  full_name text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- The earlier app migration used a text CHECK; convert it to the two-value enum.
ALTER TABLE public.user_profiles
  ALTER COLUMN role DROP DEFAULT;
ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles
  ALTER COLUMN role TYPE public.user_role
  USING role::text::public.user_role;
ALTER TABLE public.user_profiles
  ALTER COLUMN role SET DEFAULT 'client'::public.user_role;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_profiles TO authenticated;
GRANT UPDATE (full_name, phone) ON TABLE public.user_profiles TO authenticated;
GRANT ALL ON TABLE public.user_profiles TO service_role;

DROP POLICY IF EXISTS "users can read their own app profile" ON public.user_profiles;
CREATE POLICY "users can read their own app profile"
  ON public.user_profiles FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "users can update their own profile details" ON public.user_profiles;
CREATE POLICY "users can update their own profile details"
  ON public.user_profiles FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_user_profiles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_user_profiles_updated_at()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS touch_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER touch_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_user_profiles_updated_at();

CREATE OR REPLACE FUNCTION public.create_towber_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, role, email, full_name, phone)
  VALUES (
    NEW.id,
    'client'::public.user_role,
    NEW.email,
    NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(pg_catalog.btrim(COALESCE(NEW.phone, NEW.raw_user_meta_data ->> 'phone')), '')
  )
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.create_towber_user_profile()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_towber_user_profile_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.user_profiles
  SET email = NEW.email,
      updated_at = pg_catalog.now()
  WHERE user_id = NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_towber_user_profile_email()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS create_towber_user_profile ON auth.users;
CREATE TRIGGER create_towber_user_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_towber_user_profile();

DROP TRIGGER IF EXISTS sync_towber_user_profile_email ON auth.users;
CREATE TRIGGER sync_towber_user_profile_email
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_towber_user_profile_email();

-- Backfill existing Auth users. Existing role assignments are never overwritten.
INSERT INTO public.user_profiles AS current_profile
  (user_id, role, email, full_name, phone)
SELECT
  id,
  'client'::public.user_role,
  email,
  NULLIF(pg_catalog.btrim(raw_user_meta_data ->> 'full_name'), ''),
  NULLIF(pg_catalog.btrim(COALESCE(phone, raw_user_meta_data ->> 'phone')), '')
FROM auth.users
ON CONFLICT (user_id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = COALESCE(current_profile.full_name, EXCLUDED.full_name),
      phone = COALESCE(current_profile.phone, EXCLUDED.phone),
      updated_at = pg_catalog.now();

NOTIFY pgrst, 'reload schema';
