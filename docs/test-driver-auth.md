# Towber email test partner setup

> The app calls these users *partners*. Their database role is still named `driver`, so the SQL below is unchanged.

The app accepts email magic links only for users already invited to Supabase. The installed app's custom scheme is `towber`.

## Supabase Dashboard steps

1. In **Authentication → URL Configuration**, add `towber://auth/callback` to **Additional Redirect URLs** and save.
2. In **Authentication → Users**, choose **Add user → Invite user** and invite `kamogeloralph@gmail.com`.
3. After the Auth user has been created, open **SQL Editor** and run the following query to create or update only that user's application profile as a partner (role `driver`):

```sql
WITH invited_user AS (
  SELECT id
  FROM auth.users
  WHERE lower(email) = lower('kamogeloralph@gmail.com')
  LIMIT 1
)
INSERT INTO public.user_profiles (user_id, role)
SELECT id, 'driver'::public.user_role
FROM invited_user
ON CONFLICT (user_id)
DO UPDATE SET
  role = EXCLUDED.role,
  updated_at = now()
RETURNING user_id, role;
```

The query should return one row with `role = 'driver'`. If it returns no rows, the email invite has not created an Auth user yet; complete the invite first and run the query again.

## Sign in

After the mobile update is installed, enter `kamogeloralph@gmail.com` in Towber and request a sign-in link. Open the email link on the same phone; it returns to `towber://auth/callback`, exchanges the PKCE code, and routes according to the saved profile role. The app uses `shouldCreateUser: false`, so it does not silently create uninvited email accounts.

Do not share account passwords or Supabase service-role keys in chat. This flow uses a one-time email link instead.
