import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PORT = 4000 } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---- Validation ----
const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const point = z.object({ lat, lng });

const nearbyQuery = z.object({
  lat, lng,
  distance_km: z.coerce.number().min(0.5).max(1500).default(10),
  radius_m: z.coerce.number().min(500).max(50000).default(15000),
});
const locationBody = z.object({
  lat,
  lng,
  heading: z.number().int().min(0).max(359).nullable().optional(),
  speedMps: z.number().min(0).max(100).nullable().optional(),
});
const requestBody = z.object({
  pickup: point,
  dropoff: point,
  vehicleId: z.string().uuid(),
  tripDistanceKm: z.number().min(0.5).max(1500),
});

// ---- Helpers ----
const ewkt = (p) => `SRID=4326;POINT(${p.lng} ${p.lat})`;
const numeric = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// Maps the stable get_nearby_vehicles RPC column contract into the mobile API.
function normalizeVehicle(r) {
  const distanceKm = r.distance_km ?? (r.distance_meters != null ? numeric(r.distance_meters) / 1000 : null);
  return {
    vehicleId: r.vehicle_id ?? r.id,
    companyId: r.company_id ?? null,
    companyName: r.company_name ?? r.name ?? 'Tow operator',
    vehicleType: r.vehicle_type,
    plate: r.registration_number ?? r.license_plate ?? null,
    lat: numeric(r.lat ?? r.latitude),
    lng: numeric(r.lng ?? r.longitude),
    distanceKm: distanceKm == null ? null : numeric(distanceKm),
    // Fallback ETA assumes ~40 km/h urban average. Replace with a routing ETA later.
    etaMin: r.eta_minutes ?? (distanceKm != null ? Math.max(2, Math.round((numeric(distanceKm) / 40) * 60)) : null),
    priceMin: numeric(r.price_min ?? r.estimated_price_min ?? r.min_price),
    priceMax: numeric(r.price_max ?? r.estimated_price_max ?? r.estimated_price),
  };
}

async function findNearby({ lat, lng, distance_km, radius_m }) {
  const { data, error } = await supabase.rpc('get_nearby_vehicles', {
    user_lat: lat,
    user_lng: lng,
    trip_distance_km: distance_km,
    search_radius_meters: radius_m,
  });
  if (error) throw error;
  return (data ?? []).map(normalizeVehicle);
}

// Validates the Supabase JWT sent by the app (anonymous sign-in is fine for motorists).
async function requireUser(req, res, next) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '');
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' });
  req.user = data.user;
  next();
}

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const parse = (schema, input, res) => {
  const r = schema.safeParse(input);
  if (!r.success) { res.status(400).json({ error: 'Invalid input', details: r.error.flatten() }); return null; }
  return r.data;
};

// ---- App ----
const app = express();
app.set('trust proxy', 1); // Railway sits behind a proxy
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 600 }));

app.get('/health', (_req, res) => res.json({ ok: true }));

// 1) Nearby trucks + the currently applicable fare quote for this trip.
app.get('/api/vehicles/nearby', wrap(async (req, res) => {
  const q = parse(nearbyQuery, req.query, res); if (!q) return;
  const vehicles = await findNearby(q);
  vehicles.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  res.json({ vehicles });
}));

// 2) Driver GPS ping. The database verifies fleet ownership or an active driver assignment.
// A trigger updates the vehicle's PostGIS point and broadcasts only to active request topics.
app.patch('/api/vehicles/:id/location', requireUser, wrap(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Invalid vehicle id' });
  const body = parse(locationBody, req.body, res); if (!body) return;

  const { error } = await supabase.rpc('record_driver_location', {
    p_vehicle_id: id.data,
    p_actor_user_id: req.user.id,
    p_lat: body.lat,
    p_lng: body.lng,
    p_heading_degrees: body.heading ?? null,
    p_speed_mps: body.speedMps ?? null,
  });
  if (error?.code === '42501') return res.status(403).json({ error: 'Not authorized to update this vehicle' });
  if (error?.code === '22023') return res.status(400).json({ error: 'Invalid driver location' });
  if (error) throw error;
  res.status(204).end();
}));

// 3) Create a tow request. Recompute the fare immediately before insert; never trust client prices.
app.post('/api/requests', requireUser, wrap(async (req, res) => {
  const b = parse(requestBody, req.body, res); if (!b) return;

  const candidates = await findNearby({
    lat: b.pickup.lat, lng: b.pickup.lng, distance_km: b.tripDistanceKm, radius_m: 50000,
  });
  const chosen = candidates.find((v) => v.vehicleId === b.vehicleId);
  if (!chosen) return res.status(409).json({ error: 'That truck is no longer available. Pick another.' });

  const { data: fareRows, error: fareError } = await supabase.rpc('calculate_tow_fare', {
    p_vehicle_id: chosen.vehicleId,
    p_distance_km: b.tripDistanceKm,
  });
  if (fareError) throw fareError;
  const fare = Array.isArray(fareRows) ? fareRows[0] : fareRows;
  if (!fare) return res.status(409).json({ error: 'No active ZAR fare is configured for this truck.' });

  const total = numeric(fare.total_zar, Number.NaN);
  if (!Number.isFinite(total) || total < 0) {
    throw new Error('Fare calculation returned an invalid total');
  }

  const { data, error } = await supabase
    .from('tow_requests')
    .insert({
      user_id: req.user.id,
      selected_company_id: chosen.companyId,
      assigned_vehicle_id: chosen.vehicleId,
      pickup_location: ewkt(b.pickup),
      dropoff_location: ewkt(b.dropoff),
      estimated_distance_km: b.tripDistanceKm,
      estimated_price_min: total,
      estimated_price_max: total,
      fare_service_class_code: fare.service_class_code,
      fare_currency: 'ZAR',
      quoted_callout_fee_zar: numeric(fare.callout_fee_zar),
      quoted_per_km_rate_zar: numeric(fare.per_km_rate_zar),
      quoted_minimum_fare_zar: numeric(fare.minimum_fare_zar),
      fare_quoted_at: new Date().toISOString(),
      status: 'pending',
    })
    .select('id, status, estimated_price_min, estimated_price_max, fare_currency, fare_service_class_code, fare_quoted_at, created_at')
    .single();
  if (error) throw error;

  res.status(201).json({ request: data, truck: { ...chosen, priceMin: total, priceMax: total } });
}));

// 4) Poll/read one of your own requests.
app.get('/api/requests/:id', requireUser, wrap(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Invalid request id' });
  const { data, error } = await supabase
    .from('tow_requests')
    .select('*')
    .eq('id', id.data)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json({ request: data });
}));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Try again.' });
});

app.listen(PORT, () => console.log(`Towber API listening on :${PORT}`));
