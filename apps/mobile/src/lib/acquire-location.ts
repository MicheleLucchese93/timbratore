import * as Location from 'expo-location';
import { Platform } from 'react-native';

export interface AcquiredLocation {
  latitude: number;
  longitude: number;
  accuracyM: number;
  isMockLocation: boolean;
  acquiredAt: string;
}

const TARGET_ACCURACY_M = 30;
const DEADLINE_MS = 15_000;

export async function ensureLocationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') {
    // Browser geolocation handled directly via navigator.geolocation in acquireLocation
    return true;
  }
  const fg = await Location.requestForegroundPermissionsAsync();
  return fg.status === 'granted';
}

export async function acquireLocation(): Promise<AcquiredLocation> {
  if (Platform.OS === 'web') {
    return acquireLocationWeb();
  }
  if (!(await ensureLocationPermission())) {
    throw new Error('LOCATION_PERMISSION_DENIED');
  }
  let best: Location.LocationObject | null = null;
  let watcher: Location.LocationSubscription | null = null;
  const deadline = Date.now() + DEADLINE_MS;
  await new Promise<void>((resolve) => {
    const finish = () => {
      watcher?.remove();
      resolve();
    };
    const timeout = setTimeout(finish, DEADLINE_MS);
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 0, timeInterval: 500 },
      (loc) => {
        if (!best || (loc.coords.accuracy ?? 99999) < (best.coords.accuracy ?? 99999)) {
          best = loc;
        }
        if ((loc.coords.accuracy ?? 99999) <= TARGET_ACCURACY_M || Date.now() >= deadline) {
          clearTimeout(timeout);
          finish();
        }
      }
    ).then((sub) => {
      watcher = sub;
    });
  });
  if (!best) throw new Error('ACQUISITION_TIMEOUT');
  return {
    latitude: best.coords.latitude,
    longitude: best.coords.longitude,
    accuracyM: best.coords.accuracy ?? 99999,
    isMockLocation: (best as { mocked?: boolean }).mocked === true,
    acquiredAt: new Date(best.timestamp).toISOString(),
  };
}

function acquireLocationWeb(): Promise<AcquiredLocation> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('LOCATION_NOT_SUPPORTED'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyM: pos.coords.accuracy ?? 99999,
          isMockLocation: false,
          acquiredAt: new Date(pos.timestamp).toISOString(),
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) reject(new Error('LOCATION_PERMISSION_DENIED'));
        else if (err.code === err.TIMEOUT) reject(new Error('ACQUISITION_TIMEOUT'));
        else reject(new Error(err.message));
      },
      { enableHighAccuracy: true, timeout: DEADLINE_MS, maximumAge: 0 }
    );
  });
}
