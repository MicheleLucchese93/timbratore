const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

export interface GeofenceInput {
  user: { lat: number; lng: number };
  branch: {
    lat: number | null;
    lng: number | null;
    radiusM: number;
    smartWorking: boolean;
  };
}

export interface GeofenceResult {
  allowed: boolean;
  distanceM: number | null;
  reason?: 'smart_working' | 'within_radius' | 'out_of_radius' | 'branch_missing_coords';
}

export function withinGeofence(input: GeofenceInput): GeofenceResult {
  if (input.branch.smartWorking) {
    return { allowed: true, distanceM: null, reason: 'smart_working' };
  }
  if (input.branch.lat == null || input.branch.lng == null) {
    return { allowed: false, distanceM: null, reason: 'branch_missing_coords' };
  }
  const distance = distanceMeters(
    { lat: input.user.lat, lng: input.user.lng },
    { lat: input.branch.lat, lng: input.branch.lng }
  );
  if (distance <= input.branch.radiusM) {
    return { allowed: true, distanceM: distance, reason: 'within_radius' };
  }
  return { allowed: false, distanceM: distance, reason: 'out_of_radius' };
}
