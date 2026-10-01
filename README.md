# Towber

Towber is a React Native motorist app backed by an Express API and Supabase (Postgres + PostGIS). The repository includes an EAS-ready Expo app, a Railway-compatible API, and versioned Supabase migrations.

## Repository layout

```text
towber/
├── backend/                    Express API
├── mobile/                     Expo React Native motorist app
├── supabase/migrations/        Versioned database schema and RLS/RPC
└── README.md
```

## 1. Supabase setup

1. Create a Supabase project and enable **Anonymous sign-ins** under Authentication → Sign In / Providers. The motorist app uses anonymous Auth; it does not get the server service-role key.
2. Install the Supabase CLI, sign in, link the project, and apply migrations:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

   The migrations create or extend the live-compatible `towing_companies`, `vehicles`, `rate_cards`, and `tow_requests` schema; PostGIS geography columns and indexes; owner/request read policies; the API-only nearby/fare RPCs; private driver-location broadcasts; driver verification metadata; and a private Storage bucket. Review the migration history before applying it to an existing project.
3. The schema migration does not seed business data. Use existing verified fleet records in a linked project, or add approved companies, active vehicles, and rate cards before testing search. Do not mark unverified real companies as verified just to populate the map.

The live request columns are `user_id`, `selected_company_id`, `assigned_vehicle_id`, `pickup_location`, `dropoff_location`, `estimated_distance_km`, `estimated_price_min`, `estimated_price_max`, and `status`. The backend uses this deployed contract.

## 2. Backend (Railway or local development)

```bash
cd backend
cp .env.example .env
# Set SUPABASE_URL and the server-only SUPABASE_SERVICE_ROLE_KEY in .env
npm install
npm run dev
```

Health check: `GET /health`. Nearby vehicle example:

```bash
curl 'http://localhost:4000/api/vehicles/nearby?lat=-26.2041&lng=28.0473&distance_km=12'
```

For Railway, set the service root to `backend/`, use the start command `npm start`, and configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as Railway variables. Never put the service-role key in the mobile app or any `EXPO_PUBLIC_*` variable.

## 3. Mobile app and EAS cloud builds

```bash
cd mobile
npm ci
cp .env.example .env
# Fill in the public API URL, Supabase URL/anon key, and local map key values
npx expo start
```

The existing app uses native Google Maps and device location. Store the two Google Maps SDK keys as restricted keys in Google Cloud and configure `GOOGLE_MAPS_ANDROID_API_KEY` and `GOOGLE_MAPS_IOS_API_KEY` as **EAS build environment variables**. Restrict the Android key to `com.towber.motorist` and the EAS signing certificate SHA-1; restrict the iOS key to bundle ID `com.towber.motorist`. The app needs the Maps SDKs enabled in Google Cloud. The keys are client-side native configuration, not server secrets; never commit actual keys.

Set these app environment variables in the Expo project’s EAS environment:

```text
EXPO_PUBLIC_API_URL=https://<your-railway-service>.up.railway.app
EXPO_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
GOOGLE_MAPS_ANDROID_API_KEY=<restricted-android-key>
GOOGLE_MAPS_IOS_API_KEY=<restricted-ios-key>
```

Connect the local project to an Expo account once, then build in Expo’s cloud:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest build --platform android --profile development
```

Use `--profile preview` for an installable Android APK, or `--platform all --profile production` for store-ready binaries. The first EAS build requires an Expo account/project and configured environment variables. Native modules such as Maps require a development/preview/production build; Expo Go alone is not the final test binary.

> This workflow does not require Node.js or a native compiler to run on your phone. Edit on the phone in GitHub or a code editor; Railway runs the API and EAS builds the app in the cloud.

## 4. Driver location, verification, and fares

- Driver GPS uses `PATCH /api/vehicles/:id/location`. The API validates the user's Supabase JWT; the database accepts only the fleet owner or an actively assigned driver. A PostGIS trigger stores the latest fix, updates `vehicles.current_location`, and sends a minimal private Broadcast to each active `tow-request:<request-id>` topic. The motorist app subscribes only after request creation; it no longer joins a public fleet-wide channel.
- `mobile/src/driverLocation.ts` exposes foreground driver GPS streaming. Android requests a 1-second interval; operating systems may throttle updates, and background tracking is not enabled in this first implementation. Only authorized request participants can join a private topic. In Supabase Realtime settings, disable **Allow public access** so private-channel RLS is enforced.
- The `driver-verification-private` bucket is private, limits files to 10 MiB, and permits PDF/JPEG/PNG. `driver_verification_documents` stores PDP and vehicle licensing-disc metadata, expiry dates, and review status. Upload paths start with the submitting user's UUID. The mobile app has not yet added a document-picker/review screen.
- `tow_service_classes` maps vehicles to Light Tow, Heavy Duty, or Flatbed. `tow_fare_rates` supports company-specific, effective-dated ZAR call-out, per-kilometre, and minimum rates. No new tariff amounts are seeded. Until a class-specific tariff is configured, the fare RPC falls back to that company's existing ZAR `rate_cards`; if neither exists, that vehicle is not quoted. `POST /api/requests` recalculates the quote server-side and snapshots the ZAR components on the request. The estimate uses the app's straight-line × 1.3 distance until road routing is added.

## 5. Checks

```bash
cd mobile
npm ci
npm run typecheck
npx expo install --check
npx expo config --json
```

## 6. Current scope

The app contains the motorist map, nearby fleet cards, ZAR quote display, request submission, and private live-location tracking for the active request. The API accepts authorized driver GPS pings. Fleet dispatch/acceptance UI, verification-document upload/review UI, driver background location, request-status tracking, real road routing, and destination autocomplete remain future work. A fare quote is an estimate; the operator may confirm a different final price.
