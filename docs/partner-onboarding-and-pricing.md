# Partner onboarding, approval and pricing

Migration: `supabase/migrations/20261003000001_flat_fees_and_partner_onboarding.sql`
(apply it with the **Supabase Production Migrations** workflow, or `supabase db push` on a test project first).

## 1. How a partner applies (in the app)

1. Sign-in screen → **Partners** card → enter email → **New here? Apply to become a partner**.
   A magic link creates a normal `client` account (no special access yet).
2. The link opens the application:
   1. **Services**: *Tow operator* or *Roadside responder*, then the services offered
      (towing, jump start, fuel, tyre, lockout, minor repairs). Jobs are only ever offered for the
      services chosen here.
   2. **Details**: trading name, registration (optional), phone, vehicle registration, tow vehicle type.
   3. **Documents** (PDF/JPG/PNG, max 10 MB, stored in the private `partner-documents-private` bucket):

      | Tier | Required | Optional |
      |---|---|---|
      | Tow operator | SA ID/passport, PrDP (EC1/C1), vehicle licence disc, Certificate of Fitness, towing/GIT insurance, equipment photo | Towing permit, trade certificate |
      | Roadside responder | SA ID/passport, driver's licence (Code 8), vehicle licence disc, vehicle photo | Trade test / qualification |
   4. **Review and submit**. The database refuses submission if a required document is missing.
3. Status is visible any time from the motorist home screen ("Your partner application").

Statuses: `draft` → `submitted` → `approved` / `rejected` / `needs_info` (applicant edits and resubmits).

## 2. How an admin verifies and approves

**Use the admin console at `/admin`** (see `docs/admin.md`). The SQL below still works and is what the console calls underneath.

Originally review was done in the Supabase dashboard (or SQL editor). The approve/reject
functions are callable by the service role only, never by the app.

**Find applications waiting for review**

```sql
select a.id, a.created_at, a.partner_tier, a.capabilities, a.business_name, a.contact_phone,
       u.email,
       (select count(*) from public.partner_documents d where d.application_id = a.id) as documents
from public.partner_applications a
join auth.users u on u.id = a.user_id
where a.status = 'submitted'
order by a.submitted_at;
```

**Open the documents**: Dashboard → Storage → `partner-documents-private` → folder `<user id>/<application id>/`
(the file name starts with the document type). Check each against the list above:
IDs match the applicant, PrDP is current and the right code, licence disc and CoF are valid and match the
registration entered, insurance is current, photos show the vehicle/equipment.

**Approve**: creates the verified company, vehicle, services, driver assignment and flips the role to `driver`.

```sql
select public.admin_approve_partner_application(
  '<application id>', '<your admin auth.users id>', 'Documents verified');
```

**Ask for changes / reject** (a note is mandatory; the applicant sees it):

```sql
select public.admin_review_partner_application(
  '<application id>', '<your admin auth.users id>', 'needs_info', 'PrDP photo is blurry, please re-upload');
-- or 'rejected'
```

## 3. After approval: make the partner bookable

A partner is only offered for a service once it has a price. No tariffs are seeded.

**Flat fees** (jump start, lockout, fuel call-out, tyre change, repair call-out). `company_id = null` is the
platform default; a company row overrides it.

```sql
insert into public.service_flat_rates (company_id, service_code, flat_fee_zar)
values (null, 'jumpstart', <ZAR amount>),
       (null, 'lockout',   <ZAR amount>),
       (null, 'fuel',      <ZAR amount>),   -- call-out only, fuel is charged at cost
       (null, 'tyre',      <ZAR amount>),
       (null, 'repair',    <ZAR amount>);   -- call-out/diagnostic, parts extra
```

**Towing** still needs a distance rate per company and truck class:

```sql
insert into public.tow_fare_rates (company_id, service_class_code, callout_fee_zar, per_km_rate_zar, minimum_fare_zar)
values ('<company id>', 'flatbed', <ZAR>, <ZAR per km>, <ZAR>);
```

**After-hours surcharge** (off until you set a multiplier above 1.00; times are South African time):

```sql
insert into public.pricing_settings (company_id, after_hours_start, after_hours_end, after_hours_multiplier)
values (null, '20:00', '05:00', 1.25);   -- platform default: +25% from 20:00 to 05:00
```

## 4. How a quote is calculated

* Towing: `max(minimum fare, call-out fee + per-km rate × distance)`
* Everything else: the flat fee
* Both are multiplied by the after-hours multiplier when it applies
* The motorist sees "Flat fee" or "Estimated fare", plus "After-hours rate" or a note such as
  "Fuel is charged at cost on delivery" when relevant
* The server recalculates the price when the request is created and stores the full breakdown on the request

## 5. Known gaps

* No admin web screen; approvals are SQL. Next step: a small admin dashboard that lists applications,
  shows documents and calls the two functions.
* Document expiry (PrDP, insurance, licence disc) is not tracked or re-checked automatically.
* Public holidays and weekends are not surcharged, only the daily time window.
* On re-dispatch to another partner the original quoted price is kept.
* Needs `npx expo install expo-document-picker` and a new native build (a new native module).
