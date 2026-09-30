import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const API = process.env.EXPO_PUBLIC_API_URL!;

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
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

// Motorists sign in anonymously so requests are tied to a real auth user.
// Enable "Anonymous sign-ins" in Supabase > Authentication > Providers.
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

export const createRequest = (b: { pickup: LatLng; dropoff: LatLng; vehicleId: string; tripDistanceKm: number }) =>
  call<{ request: { id: string; status: string } }>('/api/requests', { method: 'POST', body: JSON.stringify(b) }, true);

// Live positions broadcast by the API whenever a driver pings their location.
export function subscribeFleet(onMove: (m: { vehicleId: string; lat: number; lng: number }) => void) {
  const ch = supabase
    .channel('fleet')
    .on('broadcast', { event: 'position' }, ({ payload }) => onMove(payload))
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

// Straight-line distance x 1.3 as a road-distance stand-in.
// Swap for Google Directions / Mapbox for real routes and ETAs.
export function roadKm(a: LatLng, b: LatLng) {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.max(0.5, 2 * R * Math.asin(Math.sqrt(h)) * 1.3);
}
