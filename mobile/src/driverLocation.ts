import * as Location from 'expo-location';
import { sendDriverLocation } from './api';

/**
 * Start foreground GPS streaming for a vehicle. Android requests a 1-second
 * update interval; the operating system may throttle fixes, especially on iOS
 * or under battery/network pressure. This helper intentionally does not ask
 * for background-location permission.
 */
export async function startDriverLocationStream(
  vehicleId: string,
  onError?: (error: Error) => void,
): Promise<() => void> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    throw new Error('Location permission is required to share your location.');
  }

  let sending = false;
  const subscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: 1000,
      distanceInterval: 1,
    },
    (fix) => {
      if (sending) return;
      sending = true;
      const rawHeading = fix.coords.heading;
      const heading = rawHeading == null || !Number.isFinite(rawHeading)
        ? null
        : ((Math.round(rawHeading) % 360) + 360) % 360;
      const rawSpeed = fix.coords.speed;
      const speedMps = rawSpeed == null || !Number.isFinite(rawSpeed) || rawSpeed < 0
        ? null
        : rawSpeed;

      void sendDriverLocation(vehicleId, {
        vehicleId,
        lat: fix.coords.latitude,
        lng: fix.coords.longitude,
        heading,
        speedMps,
      })
        .catch((error: unknown) => {
          onError?.(error instanceof Error ? error : new Error('Could not send your location.'));
        })
        .finally(() => { sending = false; });
    },
  );

  return () => subscription.remove();
}
