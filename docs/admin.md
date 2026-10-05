# Towber admin console

Open **`https://<your-api-domain>/admin`** (for example `https://towber-production.up.railway.app/admin`).
It runs from the same Railway service as the API, so there is nothing extra to deploy.

## One-time setup: create the first administrator

1. Supabase dashboard → **Authentication → Users → Add user → Create new user**.
   Enter your email and a strong password and tick **Auto Confirm User**.
2. Make that account an administrator (Supabase **SQL Editor**):

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'you@example.com';
```

3. Open `/admin` and sign in with that email and password.

More administrators can then be added from the console itself (**Team & log**).
They need an existing Towber account (a password can be set from Supabase → Authentication → Users).

## What you can do

| Section | What it does |
|---|---|
| Overview | Applications waiting, verified partners, vehicles online, open requests, 30-day totals, average rating, 14-day chart |
| Applications | Open an application, view every uploaded document, mark each as checked or a problem, then **Approve**, **Request changes** or **Decline** with a note the applicant sees in the app |
| Partners | Verified/suspended status, vehicles, ratings, towing rate and flat-fee overrides. **Suspend** takes every vehicle offline at once |
| Ratings | Every rating with its comment, partner and rater. Filter low ratings; **Hide** removes a rating from averages (it is kept, not deleted) |
| Requests | Read-only list of recent jobs with status, partner and price |
| Pricing | Platform flat fees (jump start, lockout, fuel, tyre, repair) and the after-hours surcharge |
| Team & log | Add/remove administrators; every change is recorded in an activity log |

## How it connects to the app

* **Approve**: runs `admin_approve_partner_application`: creates the verified company, vehicle, services and driver
  assignment and switches the applicant's role to `driver`. The applicant signs out and in once to open the Partner app.
* **Request changes / Decline**: the note is saved on the application and shown to the applicant in the partner
  application screen. "Request changes" lets them edit and resubmit; "Decline" is final.
* **Prices**: a partner is only offered to motorists for a service that has a price. After approving, set towing
  rates (Partners → partner) and make sure flat fees exist (Pricing).
* **Ratings**: submitted by motorists after a completed job. Hidden ratings are excluded from partner averages.
* **Suspend**: sets the partner to unverified and every vehicle offline; they disappear from nearby search immediately.

## Security notes

* Sign-in is email + password, rate-limited to 10 attempts per 15 minutes per address range, and only accounts listed in
  `public.admin_users` can use any `/api/admin/*` route. The mobile app never has admin access.
* Partner documents are private; the console fetches short-lived (10 minute) signed links.
* Use a long unique password. Supabase can also require MFA for dashboard users, but this console signs in with a
  password only, so keep the admin list small.
