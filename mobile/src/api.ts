import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const API = process.env.EXPO_PUBLIC_API_URL!;

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' } },
);

export type LatLng = { lat: number; lng: number };
export type VehicleType = 'flatbed_rollback' | 'standard_tow' | 'heavy_duty' | 'winch_recovery';

export type Truck = {
  vehicleId: string;
  companyName: string;
  vehicleType: VehicleType;
  plate: string | null;
  lat: number;
  lng: number;
  distanceKm: number | null;
  etaMin: number | null;
  priceMin: number;
  priceMax: number;
};

export type DriverLocation = LatLng & {
  vehicleId: string;
  heading: number | null;
  speedMps: number | null;
  recordedAt?: string;
};

export type LocationChannelStatus = 'connecting' | 'connected' | 'error';
export type BreakdownType = 'flatbed' | 'jumpstart' | 'lockout';
export type PlaceSuggestion = {
  placeId: string;
  description: string;
  primaryText: string;
  secondaryText: string;
};
export type RoadRoute = {
  destination: LatLng;
  address: string;
  distanceKm: number;
  durationMinutes: number | null;
  coordinates: LatLng[];
};
export type ActiveTripDriver = {
  driver_user_id: string;
  driver_name: string;
  driver_phone: string | null;
  avatar_url: string | null;
  vehicle_id: string;
  vehicle_plate: string;
  vehicle_type: string | null;
};

// Drivers use invited email links. Motorists may also use a temporary guest session.
async function token() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.access_token;
  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return anon.session!.access_token;
}

async function call<T>(path: string, init?: RequestInit, auth = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${await token()}`;
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Request failed');
  return body as T;
}

export const fetchNearby = (p: LatLng, distanceKm: number) =>
  call<{ vehicles: Truck[] }>(
    `/api/vehicles/nearby?lat=${p.lat}&lng=${p.lng}&distance_km=${distanceKm}`,
  ).then((r) => r.vehicles);

export function fetchPlaceSuggestions(input: string, origin: LatLng, sessionToken: string) {
  return call<{ suggestions: PlaceSuggestion[] }>('/api/places/autocomplete', {
    method: 'POST',
    body: JSON.stringify({ input, origin, sessionToken }),
  }, true).then((r) => r.suggestions);
}

function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

export function fetchRoadRoute(origin: LatLng, placeId: string, sessionToken: string) {
  return call<Omit<RoadRoute, 'coordinates'> & { encodedPolyline: string }>('/api/routes', {
    method: 'POST',
    body: JSON.stringify({ origin, placeId, sessionToken }),
  }, true).then((route): RoadRoute => ({
    ...route,
    coordinates: decodePolyline(route.encodedPolyline),
  }));
}

export const createRequest = (b: { pickup: LatLng; dropoff: LatLng; vehicleId: string; tripDistanceKm: number; breakdownType: BreakdownType }) =>
  call<{ request: { id: string; status: string; estimated_price_min: number; estimated_price_max: number } }>('/api/requests', { method: 'POST', body: JSON.stringify(b) }, true);

export async function uploadDriverAvatar(uri: string, userId: string) {
  const response = await fetch(uri);
  const blob = await response.blob();
  const path = `${userId}/avatar-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('driver-avatars').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;
  return supabase.storage.from('driver-avatars').getPublicUrl(path).data.publicUrl;
}

export async function fetchActiveTripDriver(requestId: string) {
  const { data, error } = await supabase.rpc('get_active_tow_driver', { p_request_id: requestId });
  if (error) throw error;
  return ((data ?? [])[0] as ActiveTripDriver | undefined) ?? null;
}

export function sendDriverLocation(vehicleId: string, position: DriverLocation) {
  return call<void>(`/api/vehicles/${encodeURIComponent(vehicleId)}/location`, {
    method: 'PATCH',
    body: JSON.stringify({
      lat: position.lat,
      lng: position.lng,
      heading: position.heading,
      speedMps: position.speedMps,
    }),
  }, true);
}

// Request-specific private topics prevent the old public "fleet" channel from
// exposing every operator's location to every app session.
export async function subscribeRequestDriverLocation(
  requestId: string,
  onMove: (location: DriverLocation) => void,
  onStatus?: (status: LocationChannelStatus) => void,
) {
  await token();
  await supabase.realtime.setAuth();

  const channel = supabase
    .channel(`tow-request:${requestId}`, { config: { private: true } })
    .on('broadcast', { event: 'driver_location' }, ({ payload }) => {
      const p = payload as Partial<DriverLocation> | null;
      if (!p || typeof p.vehicleId !== 'string' || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
      onMove({
        vehicleId: p.vehicleId,
        lat: Number(p.lat),
        lng: Number(p.lng),
        heading: typeof p.heading === 'number' ? p.heading : null,
        speedMps: typeof p.speedMps === 'number' ? p.speedMps : null,
        recordedAt: typeof p.recordedAt === 'string' ? p.recordedAt : undefined,
      });
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onStatus?.('connected');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus?.('error');
      else onStatus?.('connecting');
    });

  return () => { void supabase.removeChannel(channel); };
}

// Straight-line distance x 1.3 as a road-distance stand-in.
// Swap for Google Directions / Mapbox for real routes and ETAs.
export function roadKm(a: LatLng, b: LatLng) {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.max(0.5, 2 * R * Math.asin(Math.sqrt(h)) * 1.3);
}
