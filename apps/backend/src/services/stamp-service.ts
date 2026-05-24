import type { PoolClient } from 'pg';
import {
  validateTransition,
  stateFromLastEvent,
  withinGeofence,
  distanceMeters,
} from '@cisono/shared';
import type { StampEventType, GeofencePolicy, MockLocationAction } from '@cisono/shared';
import { ConflictError, ValidationError, ForbiddenError } from '../errors/index.js';

export interface StampInputBody {
  event_type: StampEventType;
  occurred_at: string;
  latitude?: number;
  longitude?: number;
  gps_accuracy_m?: number;
  branch_id?: string;
  is_mock_location?: boolean;
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
    `SELECT geofence_policy, gps_accuracy_ceiling_m, mock_location_action
     FROM tenants WHERE id = $1`,
    [input.tenantId]
  );
  const t = tenant.rows[0] as {
    geofence_policy: GeofencePolicy;
    gps_accuracy_ceiling_m: number;
    mock_location_action: MockLocationAction;
  };

  let branchId: string | null = body.branch_id ?? null;
  let smartWorking = false;

  if (input.source !== 'admin_manual') {
    if (branchId) {
      const b = await client.query(
        `SELECT b.id, b.latitude, b.longitude, b.radius_m, b.smart_working
         FROM branches b
         JOIN branch_memberships bm ON bm.branch_id = b.id AND bm.user_id = $1
         WHERE b.id = $2 AND b.deleted_at IS NULL AND b.active = TRUE`,
        [input.userId, branchId]
      );
      if (b.rowCount === 0) throw new ForbiddenError('Branch not assigned', 'FORBIDDEN');
      smartWorking = b.rows[0].smart_working;
      if (!smartWorking) {
        if (body.latitude == null || body.longitude == null) {
          throw new ValidationError('GPS required', { code: 'GPS_REQUIRED' });
        }
        if (body.gps_accuracy_m != null && body.gps_accuracy_m > t.gps_accuracy_ceiling_m) {
          throw new ValidationError('GPS accuracy too low', {
            code: 'GPS_ACCURACY_TOO_LOW',
            value: body.gps_accuracy_m,
            ceiling: t.gps_accuracy_ceiling_m,
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
          policy: t.geofence_policy,
        });
        if (!gf.allowed) {
          throw new ConflictError(
            'Out of geofence',
            'OUT_OF_GEOFENCE',
            { distance_m: gf.distanceM, branch_id: branchId }
          );
        }
      }
    } else {
      if (body.latitude == null || body.longitude == null) {
        throw new ValidationError('GPS required', { code: 'GPS_REQUIRED' });
      }
      if (body.gps_accuracy_m != null && body.gps_accuracy_m > t.gps_accuracy_ceiling_m) {
        throw new ValidationError('GPS accuracy too low', {
          code: 'GPS_ACCURACY_TOO_LOW',
          value: body.gps_accuracy_m,
          ceiling: t.gps_accuracy_ceiling_m,
        });
      }
      const branches = await client.query(
        `SELECT b.id, b.latitude, b.longitude, b.radius_m, b.smart_working
         FROM branches b
         JOIN branch_memberships bm ON bm.branch_id = b.id AND bm.user_id = $1
         WHERE b.deleted_at IS NULL AND b.active = TRUE`,
        [input.userId]
      );
      let best: { id: string; distance: number } | null = null;
      for (const b of branches.rows) {
        if (b.smart_working) {
          best = { id: b.id, distance: 0 };
          smartWorking = true;
          break;
        }
        if (b.latitude == null || b.longitude == null) continue;
        const gf = withinGeofence({
          user: { lat: body.latitude, lng: body.longitude, accuracyM: body.gps_accuracy_m ?? null },
          branch: {
            lat: b.latitude,
            lng: b.longitude,
            radiusM: b.radius_m,
            smartWorking: false,
          },
          policy: t.geofence_policy,
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
        throw new ConflictError('Out of geofence', 'OUT_OF_GEOFENCE', {
          distance_m: fallbackDistance,
        });
      }
      branchId = best.id;
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
  return { branchId, suspiciousMockLocation: suspiciousMock };
}

export interface CurrentState {
  state: 'nothing' | 'clocked_in' | 'on_break';
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
