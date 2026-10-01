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

   The migrations create the live-compatible `towing_companies`, `vehicles`, `rate_cards`, and `tow_requests` schema; PostGIS geography columns and indexes; owner/request read policies; and the API-only `get_nearby_vehicles` RPC. The migration set includes the recorded RPC migration so local and remote history can be reconciled.
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

## 4. Checks

```bash
cd mobile
npm ci
npm run typecheck
npx expo install --check
npx expo config --json
```

## Current scope

The app contains the motorist map, nearby fleet cards, indicative pricing, and request submission. The authenticated API accepts fleet GPS pings; fleet dispatch/acceptance UI, request-status tracking UI, real road routing, and destination autocomplete remain future work. The current price range is an indicative calculation from each company’s lowest active rate card and is not a final quote.
