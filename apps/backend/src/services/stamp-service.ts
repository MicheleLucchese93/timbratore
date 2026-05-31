import type { PoolClient } from 'pg';
import {
  validateTransition,
  stateFromLastEvent,
  withinGeofence,
  distanceMeters,
} from '@sonoqui/shared';
import type { StampEventType, GeofencePolicy, MockLocationAction, StampMode } from '@sonoqui/shared';
import { ConflictError, ValidationError, ForbiddenError } from '../errors/index.js';

export interface StampInputBody {
  event_type: StampEventType;
  occurred_at: string;
  latitude?: number;
  longitude?: number;
  gps_accuracy_m?: number;
  branch_id?: string;
  is_mock_location?: boolean;
  device_platform?: string;
}

export interface EvaluateInput {
  userId: string;
  tenantId: string;
  body: StampInputBody;
  source: 'employee_app' | 'employee_correction' | 'admin_manual';
  now: Date;
}

export interface EvaluateResult {
  branchId: string | null;
  suspiciousMockLocation: boolean;
  // clock_out is never blocked by the geofence: a worker who forgot to stamp
  // out (e.g. a leaver) must always be able to close an open shift, even from
  // home. When the exit can't be confirmed inside the branch radius we let it
  // through but flag it — surfaced to admins as a 'clock_out_out_of_area'
  // anomaly. distance is null when GPS was missing entirely.
  outOfGeofence: boolean;
  geofenceDistanceM: number | null;
}

export async function evaluateStamp(
  client: PoolClient,
  input: EvaluateInput
): Promise<EvaluateResult> {
  const { body, now } = input;

  if (input.source !== 'admin_manual') {
    const occurredAt = new Date(body.occurred_at).getTime();
    const skewSeconds = Math.abs(occurredAt - now.getTime()) / 1000;
    if (skewSeconds > 300) {
      throw new ValidationError('Clock skew too large', { code: 'CLOCK_SKEW', seconds: skewSeconds });
    }
  }

  const tenant = await client.query(
    `SELECT mock_location_action FROM tenants WHERE id = $1`,
    [input.tenantId]
  );
  const t = tenant.rows[0] as {
    mock_location_action: MockLocationAction;
  };

  let branchId: string | null = body.branch_id ?? null;
  let smartWorking = false;
  let enforceGeofence = false;

  if (input.source !== 'admin_manual') {
    const memberModes = await client.query(
      `SELECT stamp_modes FROM memberships
        WHERE user_id = $1 AND deleted_at IS NULL`,
      [input.userId]
    );
    const modes: StampMode[] = memberModes.rows[0]?.stamp_modes ?? [];
    const isWeb = body.device_platform === 'web';
    if (modes.length === 0) {
      throw new ForbiddenError('Stamping disabled for this user', 'STAMPING_DISABLED');
    }
    if (isWeb && !modes.includes('remote')) {
      throw new ForbiddenError('Web clock-in disabled for this user', 'WEB_CLOCK_IN_DISABLED');
    }
    if (!isWeb && !modes.includes('gps') && !modes.includes('remote')) {
      // Only an unimplemented mode (e.g. 'wifi') — cannot clock in yet.
      throw new ForbiddenError('Stamping disabled for this user', 'STAMPING_DISABLED');
    }
    // Geofence is enforced only for mobile GPS clock-in. Remote clock-in
    // (web, or mobile for a user without the 'gps' mode) skips the geofence.
    enforceGeofence = !isWeb && modes.includes('gps');
  }

  // clock_out is allowed even when the geofence check fails — see EvaluateResult.
  const allowOutOfArea = body.event_type === 'clock_out';
  let outOfGeofence = false;
  let geofenceDistanceM: number | null = null;

  if (enforceGeofence) {
    if (branchId) {
      const b = await client.query(
        `SELECT b.id, b.latitude, b.longitude, b.radius_m, b.enforce_radius, b.smart_working,
                b.geofence_policy, b.gps_accuracy_ceiling_m
         FROM branches b
         JOIN branch_memberships bm ON bm.branch_id = b.id AND bm.user_id = $1
         WHERE b.id = $2 AND b.deleted_at IS NULL AND b.active = TRUE`,
        [input.userId, branchId]
      );
      if (b.rowCount === 0) throw new ForbiddenError('Branch not assigned', 'FORBIDDEN');
      smartWorking = b.rows[0].smart_working;
      if (!smartWorking) {
        if (body.latitude == null || body.longitude == null) {
          if (allowOutOfArea) {
            outOfGeofence = true; // exit with no GPS — location unverifiable
          } else {
            throw new ValidationError('GPS required', { code: 'GPS_REQUIRED' });
          }
        } else if (b.rows[0].enforce_radius) {
          const ceiling = b.rows[0].gps_accuracy_ceiling_m as number;
          const policy = b.rows[0].geofence_policy as GeofencePolicy;
          if (body.gps_accuracy_m != null && body.gps_accuracy_m > ceiling && !allowOutOfArea) {
            throw new ValidationError('GPS accuracy too low', {
              code: 'GPS_ACCURACY_TOO_LOW',
              value: body.gps_accuracy_m,
              ceiling,
            });
          }
          const gf = withinGeofence({
            user: { lat: body.latitude, lng: body.longitude, accuracyM: body.gps_accuracy_m ?? null },
            branch: {
              lat: b.rows[0].latitude,
              lng: b.rows[0].longitude,
              radiusM: b.rows[0].radius_m,
              smartWorking: false,
            },
            policy,
          });
          if (!gf.allowed) {
            if (allowOutOfArea) {
              outOfGeofence = true;
              geofenceDistanceM = gf.distanceM;
            } else {
              throw new ConflictError(
                'Out of geofence',
                'OUT_OF_GEOFENCE',
                { distance_m: gf.distanceM, branch_id: branchId }
              );
            }
          }
        }
      }
    } else if (body.latitude == null || body.longitude == null) {
      if (allowOutOfArea) {
        outOfGeofence = true; // exit with no GPS — location unverifiable
      } else {
        throw new ValidationError('GPS required', { code: 'GPS_REQUIRED' });
      }
    } else {
      const branches = await client.query(
        `SELECT b.id, b.latitude, b.longitude, b.radius_m, b.enforce_radius, b.smart_working,
                b.geofence_policy, b.gps_accuracy_ceiling_m
         FROM branches b
         JOIN branch_memberships bm ON bm.branch_id = b.id AND bm.user_id = $1
         WHERE b.deleted_at IS NULL AND b.active = TRUE`,
        [input.userId]
      );
      let best: { id: string; distance: number } | null = null;
      let accuracyFailure: { value: number; ceiling: number } | null = null;
      for (const b of branches.rows) {
        if (b.smart_working) {
          best = { id: b.id, distance: 0 };
          smartWorking = true;
          break;
        }
        if (!b.enforce_radius) continue;
        if (b.latitude == null || b.longitude == null) continue;
        if (
          body.gps_accuracy_m != null &&
          body.gps_accuracy_m > (b.gps_accuracy_ceiling_m as number)
        ) {
          if (
            accuracyFailure === null ||
            (b.gps_accuracy_ceiling_m as number) > accuracyFailure.ceiling
          ) {
            accuracyFailure = {
              value: body.gps_accuracy_m,
              ceiling: b.gps_accuracy_ceiling_m as number,
            };
          }
          continue;
        }
        const gf = withinGeofence({
          user: { lat: body.latitude, lng: body.longitude, accuracyM: body.gps_accuracy_m ?? null },
          branch: {
            lat: b.latitude,
            lng: b.longitude,
            radiusM: b.radius_m,
            smartWorking: false,
          },
          policy: b.geofence_policy as GeofencePolicy,
        });
        if (gf.allowed && gf.distanceM != null && (best === null || gf.distanceM < best.distance)) {
          best = { id: b.id, distance: gf.distanceM };
        }
      }
      if (!best) {
        const fallbackDistance =
          branches.rows.length > 0 && branches.rows[0].latitude != null
            ? distanceMeters(
                { lat: body.latitude, lng: body.longitude },
                { lat: branches.rows[0].latitude, lng: branches.rows[0].longitude }
              )
            : null;
        if (allowOutOfArea) {
          outOfGeofence = true;
          geofenceDistanceM = fallbackDistance;
        } else if (accuracyFailure) {
          throw new ValidationError('GPS accuracy too low', {
            code: 'GPS_ACCURACY_TOO_LOW',
            value: accuracyFailure.value,
            ceiling: accuracyFailure.ceiling,
          });
        } else {
          throw new ConflictError('Out of geofence', 'OUT_OF_GEOFENCE', {
            distance_m: fallbackDistance,
          });
        }
      } else {
        branchId = best.id;
      }
    }
  }

  if (input.source !== 'admin_manual') {
    const last = await client.query(
      `SELECT event_type, occurred_at FROM stamps
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY occurred_at DESC, created_at DESC LIMIT 1`,
      [input.userId]
    );
    const lastEvent: StampEventType | null = last.rows[0]?.event_type ?? null;
    const lastAt = last.rows[0]?.occurred_at ? new Date(last.rows[0].occurred_at) : null;
    const v = validateTransition({
      currentState: stateFromLastEvent(lastEvent),
      lastEvent,
      lastEventAt: lastAt,
      requestedEvent: body.event_type,
      now,
    });
    if (!v.ok) {
      throw new ConflictError(v.code, v.code);
    }
  }

  let suspiciousMock = false;
  if (body.is_mock_location) {
    if (t.mock_location_action === 'block') {
      throw new ForbiddenError('Mock location blocked', 'MOCK_LOCATION_BLOCKED');
    }
    if (t.mock_location_action === 'flag') {
      suspiciousMock = true;
    }
  }
  return { branchId, suspiciousMockLocation: suspiciousMock, outOfGeofence, geofenceDistanceM };
}

export interface CurrentState {
  state: 'nothing' | 'clocked_in' | 'on_break' | 'on_lunch';
  lastEvent: StampEventType | null;
  lastEventAt: string | null;
}

export async function computeCurrentState(
  client: PoolClient,
  userId: string
): Promise<CurrentState> {
  const r = await client.query(
    `SELECT event_type, occurred_at FROM stamps
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY occurred_at DESC, created_at DESC LIMIT 1`,
    [userId]
  );
  if (r.rowCount === 0) return { state: 'nothing', lastEvent: null, lastEventAt: null };
  const lastEvent = r.rows[0].event_type as StampEventType;
  return {
    state: stateFromLastEvent(lastEvent),
    lastEvent,
    lastEventAt: new Date(r.rows[0].occurred_at).toISOString(),
  };
}
