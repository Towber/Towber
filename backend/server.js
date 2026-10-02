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
const sessionToken = z.string().min(16).max(128);

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
  breakdownType: z.enum(['flatbed', 'jumpstart', 'lockout']).default('flatbed'),
});
const statusActionBody = z.object({
  action: z.enum(['en_route', 'arrived', 'completed']),
});

const ACTIVE_STATUSES = ['pending', 'accepted', 'en_route', 'arrived'];
const ACTIVE_REQUEST_ERROR = 'You already have an active tow request. Cancel it before requesting another tow.';
const autocompleteBody = z.object({
  input: z.string().trim().min(2).max(120),
  origin: point.optional(),
  sessionToken,
});
const routeBody = z.object({
  origin: point,
  placeId: z.string().regex(/^[A-Za-z0-9_-]{8,180}$/),
  sessionToken,
});

// ---- Helpers ----
const ewkt = (p) => `SRID=4326;POINT(${p.lng} ${p.lat})`;
const numeric = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status, publicMessage: message });

async function googleJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // Do not log the user's query/address or disclose provider diagnostics to clients.
    console.warn(`Google Maps proxy upstream error: HTTP ${response.status} (${body?.error?.status ?? 'unknown'})`);
    throw httpError(502, 'Google Maps is temporarily unavailable. Please try again.');
  }
  return body ?? {};
}

function mapsKeyOrRespond(res) {
  const key = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!key) {
    res.status(503).json({ error: 'Address search and road directions are not configured on the API server.' });
    return null;
  }
  return key;
}

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

// Maps transition_tow_request failures to HTTP statuses. The RPC raises
// machine-readable messages (not_found / forbidden / conflict:<reason>).
function mapTransitionError(error) {
  const message = String(error?.message ?? '');
  if (error?.code === 'P0002' || message.includes('not_found')) {
    return { status: 404, error: 'Not found' };
  }
  if (error?.code === '42501' || message.includes('forbidden')) {
    return { status: 403, error: 'You are not allowed to act on this request.' };
  }
  if (error?.code === '22023' || message.includes('invalid_transition_payload')) {
    return { status: 400, error: 'Invalid input' };
  }
  if (message.includes('conflict:')) {
    let reason = 'That action is not available right now.';
    if (message.includes('not_pending')) reason = 'This request is no longer waiting for a driver.';
    else if (message.includes('reassigned')) reason = 'This offer moved to another truck.';
    else if (message.includes('not_accepted')) reason = 'The driver has not accepted this request yet.';
    else if (message.includes('not_en_route')) reason = 'The driver has not started driving yet.';
    else if (message.includes('not_arrived')) reason = 'The driver has not arrived yet.';
    else if (message.includes('closed')) reason = 'This request is already closed.';
    return { status: 409, error: reason };
  }
  return null;
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
const placesLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many address searches. Please wait a moment and try again.' },
});
const routesLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many route requests. Please wait a moment and try again.' },
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// 1) Nearby trucks + the currently applicable fare quote for this trip.
app.get('/api/vehicles/nearby', wrap(async (req, res) => {
  const q = parse(nearbyQuery, req.query, res); if (!q) return;
  const vehicles = await findNearby(q);
  vehicles.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  res.json({ vehicles });
}));

// 2) Google Places Autocomplete (New). The restricted server key never reaches the app.
app.post('/api/places/autocomplete', requireUser, placesLimit, wrap(async (req, res) => {
  const body = parse(autocompleteBody, req.body, res); if (!body) return;
  const key = mapsKeyOrRespond(res); if (!key) return;
  const input = {
    input: body.input,
    includedRegionCodes: ['za'],
    languageCode: 'en',
    regionCode: 'za',
    includeQueryPredictions: false,
    sessionToken: body.sessionToken,
  };
  if (body.origin) {
    input.locationBias = {
      circle: {
        center: { latitude: body.origin.lat, longitude: body.origin.lng },
        radius: 50_000,
      },
    };
  }
  const result = await googleJson('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': [
        'suggestions.placePrediction.placeId',
        'suggestions.placePrediction.text.text',
        'suggestions.placePrediction.structuredFormat.mainText.text',
        'suggestions.placePrediction.structuredFormat.secondaryText.text',
      ].join(','),
    },
    body: JSON.stringify(input),
  });

  const suggestions = (result.suggestions ?? []).flatMap(({ placePrediction: p }) => {
    if (!p?.placeId || !p?.text?.text) return [];
    return [{
      placeId: p.placeId,
      description: p.text.text,
      primaryText: p.structuredFormat?.mainText?.text ?? p.text.text,
      secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
    }];
  });
  res.json({ suggestions });
}));

// 3) Resolve the chosen place (ending its Places billing session), then ask Routes API
// for the real driving distance, traffic-aware ETA, and encoded road polyline.
app.post('/api/routes', requireUser, routesLimit, wrap(async (req, res) => {
  const body = parse(routeBody, req.body, res); if (!body) return;
  const key = mapsKeyOrRespond(res); if (!key) return;

  const placeUrl = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(body.placeId)}`);
  placeUrl.searchParams.set('sessionToken', body.sessionToken);
  const place = await googleJson(placeUrl, {
    headers: {
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'id,formattedAddress,location',
    },
  });
  const destination = place.location;
  if (!Number.isFinite(destination?.latitude) || !Number.isFinite(destination?.longitude)) {
    throw httpError(422, 'Google did not return a routable location for this destination. Choose another result.');
  }

  const routeResult = await googleJson('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: body.origin.lat, longitude: body.origin.lng } } },
      destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      polylineQuality: 'OVERVIEW',
      polylineEncoding: 'ENCODED_POLYLINE',
      units: 'METRIC',
      regionCode: 'ZA',
    }),
  });
  const route = routeResult.routes?.[0];
  if (!route?.polyline?.encodedPolyline || !Number.isFinite(route.distanceMeters)) {
    throw httpError(422, 'No driving route was found for this destination. Choose another result.');
  }
  const durationSeconds = Number.parseFloat(String(route.duration ?? '').replace(/s$/, ''));
  res.json({
    destination: { lat: destination.latitude, lng: destination.longitude },
    address: place.formattedAddress ?? '',
    distanceKm: route.distanceMeters / 1000,
    durationMinutes: Number.isFinite(durationSeconds) ? Math.max(1, Math.round(durationSeconds / 60)) : null,
    encodedPolyline: route.polyline.encodedPolyline,
  });
}));

// 4) Driver GPS ping. The database verifies fleet ownership or an active driver assignment.
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

// 5) Create a tow request. Recompute the fare immediately before insert; never trust client prices.
app.post('/api/requests', requireUser, wrap(async (req, res) => {
  const b = parse(requestBody, req.body, res); if (!b) return;

  // Resolve any stale pending offer first, then enforce one active request
  // per motorist (the partial unique index is the race-proof backstop).
  const sweep = await supabase.rpc('expire_stale_tow_requests_for_user', { p_user_id: req.user.id });
  if (sweep.error) throw sweep.error;
  const { data: activeRow, error: activeError } = await supabase
    .from('tow_requests')
    .select('id')
    .eq('user_id', req.user.id)
    .in('status', ACTIVE_STATUSES)
    .limit(1)
    .maybeSingle();
  if (activeError) throw activeError;
  if (activeRow) return res.status(409).json({ error: ACTIVE_REQUEST_ERROR });

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
      breakdown_type: b.breakdownType,
      fare_service_class_code: fare.service_class_code,
      fare_currency: 'ZAR',
      quoted_callout_fee_zar: numeric(fare.callout_fee_zar),
      quoted_per_km_rate_zar: numeric(fare.per_km_rate_zar),
      quoted_minimum_fare_zar: numeric(fare.minimum_fare_zar),
      fare_quoted_at: new Date().toISOString(),
      status: 'pending',
    })
    .select('id, status, expires_at, assigned_vehicle_id, breakdown_type, estimated_price_min, estimated_price_max, fare_currency, fare_service_class_code, fare_quoted_at, created_at')
    .single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: ACTIVE_REQUEST_ERROR });
    throw error;
  }

  // Record the first dispatch offer so a later decline/expiry skips this truck.
  const { error: offerError } = await supabase
    .from('tow_request_offers')
    .insert({ request_id: data.id, vehicle_id: chosen.vehicleId });
  if (offerError && offerError.code !== '23505') throw offerError;

  res.status(201).json({ request: data, truck: { ...chosen, priceMin: total, priceMax: total } });
}));

// 6) The motorist's current request, if any. Sweeps stale offers first so a
// dead pending request never blocks a new one.
app.get('/api/requests/active', requireUser, wrap(async (req, res) => {
  const sweep = await supabase.rpc('expire_stale_tow_requests_for_user', { p_user_id: req.user.id });
  if (sweep.error) throw sweep.error;
  const { data, error } = await supabase
    .from('tow_requests')
    .select('*, towing_companies(company_name)')
    .eq('user_id', req.user.id)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  res.json({ request: data });
}));

// 7) Poll/read one of your own requests. A stale pending offer is resolved
// (re-dispatched or expired) as part of the read.
app.get('/api/requests/:id', requireUser, wrap(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Invalid request id' });
  const stale = await supabase.rpc('expire_tow_request_if_stale', { p_request_id: id.data });
  if (stale.error) throw stale.error;
  const { data, error } = await supabase
    .from('tow_requests')
    .select('*, towing_companies(company_name)')
    .eq('id', id.data)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json({ request: data });
}));

// 8) Dispatch state transitions. All of them delegate to the
// transition_tow_request state machine; the RPC enforces who may act and from
// which status, and returns 409s for stale/raced actions.
async function handleTransition(req, res, action) {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Invalid request id' });
  const { data, error } = await supabase.rpc('transition_tow_request', {
    p_request_id: id.data,
    p_actor_user_id: req.user.id,
    p_action: action,
  });
  if (error) {
    const mapped = mapTransitionError(error);
    if (mapped) return res.status(mapped.status).json({ error: mapped.error });
    throw error;
  }
  const request = Array.isArray(data) ? data[0] : data;
  if (!request) return res.status(404).json({ error: 'Not found' });
  res.json({ request });
}

app.post('/api/requests/:id/accept', requireUser, wrap((req, res) => handleTransition(req, res, 'accept')));
app.post('/api/requests/:id/decline', requireUser, wrap((req, res) => handleTransition(req, res, 'decline')));
app.post('/api/requests/:id/cancel', requireUser, wrap((req, res) => handleTransition(req, res, 'cancel')));
app.post('/api/requests/:id/status', requireUser, wrap(async (req, res) => {
  const b = parse(statusActionBody, req.body, res); if (!b) return;
  await handleTransition(req, res, b.action);
}));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.statusCode && err.publicMessage) {
    return res.status(err.statusCode).json({ error: err.publicMessage });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Try again.' });
});

app.listen(PORT, () => console.log(`Towber API listening on :${PORT}`));
