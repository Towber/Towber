# Towber: first slice

```
towber/
├── backend/            Express API (server.js)
└── mobile/             Expo (React Native) motorist app
    ├── App.tsx
    └── src/{theme.ts, api.ts, components/, screens/HomeScreen.tsx}
```

## 1. Backend
```bash
cd backend
cp .env.example .env      # add SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev               # http://localhost:4000/health
```
Test: `curl "http://localhost:4000/api/vehicles/nearby?lat=-26.2041&lng=28.0473&distance_km=12"`

## 2. Supabase
- Authentication > Providers: enable **Anonymous sign-ins** (motorist requests).
- Schema assumptions to align with your tables (edit server.js if they differ):
  - `towing_companies.owner_user_id` (uuid, auth user who runs the fleet)
  - `tow_requests`: `user_id, vehicle_id, pickup_location, dropoff_location, trip_distance_km, estimate_min, estimate_max, status`
  - `get_nearby_vehicles` returns: vehicle id, company name, vehicle_type, lat/lng, distance (km or m), price min/max. `normalizeVehicle()` maps common names.
- Add RLS so motorists can only read their own `tow_requests`. The API uses the service-role key and checks ownership itself.

## 3. Mobile
```bash
npx create-expo-app@latest mobile-tmp --template blank-typescript
# copy this repo's mobile/ files over the generated project (App.tsx, src/, .env.example)
npx expo install react-native-maps expo-location expo-blur expo-haptics \
  react-native-reanimated react-native-gesture-handler react-native-safe-area-context \
  @react-native-async-storage/async-storage react-native-url-polyfill @expo/vector-icons
npm i @supabase/supabase-js @gorhom/bottom-sheet @expo-google-fonts/plus-jakarta-sans expo-font
cp .env.example .env      # set EXPO_PUBLIC_API_URL to your LAN IP on a real device
```
`react-native-maps` with Google provider and custom styling needs a dev build, not Expo Go:
```bash
npx expo install expo-dev-client
npx expo run:android      # or run:ios
```
Add your Google Maps API key in `app.json` (`android.config.googleMaps.apiKey`, `ios.config.googleMapsApiKey`).

## Known shortcuts (next steps)
- Route line is straight and distance is crow-flies x 1.3. Swap `roadKm` for Google Directions / Mapbox.
- Destination search uses device geocoding. Move to Google Places Autocomplete for suggestions.
- Driver app, job accept/decline, and request status tracking are not built yet.
