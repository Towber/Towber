-- Towber driver profile photos and client-facing active-trip driver details.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

GRANT UPDATE (full_name, phone, avatar_url) ON TABLE public.user_profiles TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'driver-avatars',
  'driver-avatars',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "public can read driver avatars" ON storage.objects;
CREATE POLICY "public can read driver avatars"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'driver-avatars');

DROP POLICY IF EXISTS "drivers upload their own avatar" ON storage.objects;
CREATE POLICY "drivers upload their own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'driver-avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "drivers update their own avatar" ON storage.objects;
CREATE POLICY "drivers update their own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'driver-avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'driver-avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "drivers delete their own avatar" ON storage.objects;
CREATE POLICY "drivers delete their own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'driver-avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

CREATE OR REPLACE FUNCTION public.get_active_tow_driver(p_request_id uuid)
RETURNS TABLE (
  driver_user_id uuid,
  driver_name text,
  driver_phone text,
  avatar_url text,
  vehicle_id uuid,
  vehicle_plate text,
  vehicle_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.driver_user_id,
    COALESCE(NULLIF(p.full_name, ''), 'Towber driver') AS driver_name,
    p.phone AS driver_phone,
    p.avatar_url,
    v.id AS vehicle_id,
    v.registration_number AS vehicle_plate,
    v.vehicle_type
  FROM public.tow_requests r
  JOIN public.vehicle_driver_assignments a
    ON a.vehicle_id = r.assigned_vehicle_id
   AND a.revoked_at IS NULL
  JOIN public.user_profiles p ON p.user_id = a.driver_user_id
  JOIN public.vehicles v ON v.id = r.assigned_vehicle_id
  WHERE r.id = p_request_id
    AND r.user_id = (SELECT auth.uid())
    AND r.status IN ('accepted', 'en_route')
  ORDER BY a.assigned_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_active_tow_driver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_tow_driver(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
