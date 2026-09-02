import type { PoolClient } from 'pg';
import {
  validateTransition,
  stateFromLastEvent,
  withinGeofence,
  distanceMeters,
} from '@sonoqui/shared';
import type { StampEventType, MockLocationAction, StampMode } from '@sonoqui/shared';
import { ConflictError, ValidationError, ForbiddenError } from '../errors/index.js';
import { TENANT_TZ_SQL } from '../lib/tz.js';

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
  // Only clock_in is blocked by the geofence — see the comment on the geofence
  // block below. Every later event of the shift is accepted from anywhere and
  // flagged instead when the position can't be confirmed inside a branch
  // radius; for clock_out that flag surfaces to admins as a
  // 'clock_out_out_of_area' anomaly. distance is null when GPS was missing
  // entirely or the branch has no coordinates.
  outOfGeofence: boolean;
  geofenceDistanceM: number | null;
}

interface BranchGeo {
  id: string;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
  enforce_radius: boolean;
  smart_working: boolean;
}

const BRANCH_COLS = `b.id, b.latitude, b.longitude, b.radius_m, b.enforce_radius, b.smart_working`;

// A branch that never constrains the position: smart working, or one the tenant
// configured without a radius. Stamping against it is always "in area".
function unrestricted(b: BranchGeo): boolean {
  return b.smart_working || !b.enforce_radius;
}

interface PositionMatch {
  // Assigned branch the worker is standing in — or an unrestricted one as
  // fallback. Null when the position matches none of them.
  branch: BranchGeo | null;
  // Distance to `branch`, null when it is unrestricted (nothing to measure).
  distanceM: number | null;
  // Distance to the nearest assigned branch with coordinates, matched or not —
  // what the OUT_OF_GEOFENCE payload reports.
  closestDistanceM: number | null;
}

// Resolve the branch from the position over every branch assigned to the user.
// Physical branches win over smart-working / no-radius ones: short-circuiting
// on the first smart-working branch (as this used to) meant `out_of_geofence`
// could never fire for anyone assigned to one.
async function resolveByPosition(
  client: PoolClient,
  userId: string,
  at: { lat: number; lng: number }
): Promise<PositionMatch> {
  const r = await client.query<BranchGeo>(
    `SELECT ${BRANCH_COLS}
       FROM branches b
       JOIN branch_memberships bm ON bm.branch_id = b.id AND bm.user_id = $1
      WHERE b.deleted_at IS NULL AND b.active = TRUE`,
    [userId]
  );
  let best: { branch: BranchGeo; distanceM: number } | null = null;
  let fallback: BranchGeo | null = null;
  let closest: number | null = null;
  for (const b of r.rows) {
    if (unrestricted(b)) {
      fallback ??= b;
      continue;
    }
    if (b.latitude == null || b.longitude == null) continue;
    const distance = distanceMeters(at, { lat: b.latitude, lng: b.longitude });
    if (closest === null || distance < closest) closest = distance;
    if (distance <= b.radius_m && (best === null || distance < best.distanceM)) {
      best = { branch: b, distanceM: distance };
    }
  }
  if (best) return { branch: best.branch, distanceM: best.distanceM, closestDistanceM: closest };
  return { branch: fallback, distanceM: null, closestDistanceM: closest };
}

// The sede the currently open shift was started on — used to attribute a
// break/lunch/exit stamped away from every branch, so the row still carries a
// "Sede" for the grid, the presence board and the payroll export.
async function openShiftBranch(client: PoolClient, userId: string): Promise<BranchGeo | null> {
  const r = await client.query<BranchGeo>(
    `SELECT ${BRANCH_COLS}
       FROM stamps s
       JOIN branches b ON b.id = s.branch_id
      WHERE s.user_id = $1 AND s.deleted_at IS NULL
        AND s.event_type = 'clock_in' AND s.occurred_at <= now()
      ORDER BY s.occurred_at DESC, s.created_at DESC
      LIMIT 1`,
    [userId]
  );
  return r.rows[0] ?? null;
}

// Pausa (coffee break) stamping is switched on or off per shift template.
// Resolve the template that governs the day the event belongs to — a correction
// filed for last week must be judged by the schedule in force back then, not by
// today's. A user with no assignment has no flag to read and keeps the break:
// the column defaults true, exactly like every template predating the switch.
export async function isBreakStampingEnabled(
  client: PoolClient,
  userId: string,
  occurredAtIso: string
): Promise<boolean> {
  const localDay = `($2::timestamptz AT TIME ZONE ${TENANT_TZ_SQL})::date`;
  const r = await client.query<{ break_enabled: boolean }>(
    `SELECT st.break_enabled
       FROM user_shift_assignments a
       JOIN shift_templates st ON st.id = a.shift_template_id
      WHERE a.user_id = $1
        AND a.valid_from <= ${localDay}
        AND (a.valid_to IS NULL OR a.valid_to >= ${localDay})
      ORDER BY a.valid_from DESC
      LIMIT 1`,
    [userId, occurredAtIso]
  );
  return r.rows[0]?.break_enabled !== false;
}

// Only the OPENING of a break is refused. `break_end` always goes through, so a
// break started before the flag was flipped can still be closed and the worker
// is never trapped in the `on_break` state.
export async function assertBreakStampAllowed(
  client: PoolClient,
  userId: string,
  eventType: StampEventType,
  occurredAtIso: string
): Promise<void> {
  if (eventType !== 'break_start') return;
  if (await isBreakStampingEnabled(client, userId, occurredAtIso)) return;
  throw new ForbiddenError('Break stamping disabled for this shift', 'BREAK_DISABLED');
}

/**
 * Upper bound on a declared queue age, in hours: the 30 days the mobile queue
 * keeps an undelivered punch for (QUEUE_TTL_MS in
 * apps/mobile/src/lib/offline-queue-policy.ts). Nothing older can legitimately
 * arrive from the queue, so nothing older is worth recording.
 */
export const MAX_QUEUED_HOURS = 30 * 24;

/**
 * How long the client says this punch sat in its offline queue (the
 * `X-Queued-Hours` header), or null when it did not say.
 *
 * The header is advisory metadata: it is recorded on the row, and nothing is
 * decided from it. So a malformed value is ignored rather than rejected —
 * losing a real punch over a bad header would be a worse failure than losing
 * the annotation. What must not happen is the raw `Number()` this replaces:
 * `Number('abc')` is NaN and `Number('1e999')` is Infinity, and Postgres
 * accepts both into the `double precision` column (003_stamps.sql), which puts
 * a value no arithmetic survives into payroll-adjacent data.
 *
 * Zero maps to null so that `queued_hours IS NOT NULL` keeps its plain meaning
 * of "this punch came from the queue".
 */
export function parseQueuedHours(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, MAX_QUEUED_HOURS);
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
    // A client that predates the pausa switch (an app install still on an older
    // JS bundle) keeps showing "Inizio pausa"; refuse it here rather than
    // recording a break the orario says doesn't exist.
    await assertBreakStampAllowed(client, input.userId, body.event_type, body.occurred_at);
  }

  // Only clock_in is gated by the position: it is the single point where being
  // on site is verified. Every later event of the shift — breaks, lunch, exit —
  // is accepted from anywhere, so a worker who moves between branches mid-shift
  // or closes a forgotten shift from home is never stuck. When the position
  // can't be confirmed inside a branch radius the stamp goes through flagged
  // `out_of_geofence`; only clock_out turns that flag into an admin anomaly
  // ('clock_out_out_of_area', routes/shifts.ts).
  const isClockIn = body.event_type === 'clock_in';
  let outOfGeofence = false;
  let geofenceDistanceM: number | null = null;
  const at =
    body.latitude != null && body.longitude != null
      ? { lat: body.latitude, lng: body.longitude }
      : null;

  // A branch declared by the client must always belong to the worker, whatever
  // the event type or the stamp mode.
  let declared: BranchGeo | null = null;
  if (branchId && input.source !== 'admin_manual') {
    const b = await client.query<BranchGeo>(
      `SELECT ${BRANCH_COLS}
         FROM branches b
         JOIN branch_memberships bm ON bm.branch_id = b.id AND bm.user_id = $1
        WHERE b.id = $2 AND b.deleted_at IS NULL AND b.active = TRUE`,
      [input.userId, branchId]
    );
    if (b.rowCount === 0) throw new ForbiddenError('Branch not assigned', 'FORBIDDEN');
    declared = b.rows[0]!;
  }

  if (enforceGeofence) {
    const match = at ? await resolveByPosition(client, input.userId, at) : null;

    if (isClockIn) {
      // Entry honours the declared sede as-is (the worker picked it); with no
      // declaration the position decides which branch is entered.
      const target = declared ?? match?.branch ?? null;
      if (!target) {
        if (!at) throw new ValidationError('GPS required', { code: 'GPS_REQUIRED' });
        throw new ConflictError('Out of geofence', 'OUT_OF_GEOFENCE', {
          distance_m: match?.closestDistanceM ?? null,
        });
      }
      if (!unrestricted(target)) {
        if (!at) throw new ValidationError('GPS required', { code: 'GPS_REQUIRED' });
        const gf = withinGeofence({
          user: at,
          branch: {
            lat: target.latitude,
            lng: target.longitude,
            radiusM: target.radius_m,
            smartWorking: false,
          },
        });
        if (!gf.allowed) {
          throw new ConflictError('Out of geofence', 'OUT_OF_GEOFENCE', {
            distance_m: gf.distanceM,
            branch_id: target.id,
          });
        }
      }
      branchId = target.id;
    } else if (match?.branch) {
      // Mid-shift the position decides the sede, not the picker: a worker who
      // clocked in at A and is now inside B's radius is stamped on B instead of
      // being flagged out of area at A. `geofence_distance_m` stays null — it
      // only ever carries the distance of an out-of-area stamp.
      branchId = match.branch.id;
    } else {
      // Near none of the assigned branches (or no GPS at all): keep the stamp
      // attributed to the sede the shift was opened on, and flag it.
      const target = declared ?? (await openShiftBranch(client, input.userId));
      branchId = target?.id ?? null;
      if (!target || !unrestricted(target)) {
        outOfGeofence = true;
        geofenceDistanceM =
          at && target && target.latitude != null && target.longitude != null
            ? distanceMeters(at, { lat: target.latitude, lng: target.longitude })
            : null;
      }
    }
  } else if (declared) {
    branchId = declared.id;
  }

  if (input.source !== 'admin_manual') {
    const last = await client.query(
      // Only events that have already happened define the current state. A
      // future-dated stamp (e.g. an admin pre-entering a planned clock_out)
      // must not be treated as the "last" event, or it would let duplicate
      // clock_ins slip past the transition check.
      `SELECT event_type, occurred_at FROM stamps
       WHERE user_id = $1 AND deleted_at IS NULL AND occurred_at <= now()
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
    // A spoofed position must not trap a worker inside an open shift: with
    // 'block' only the entry is refused, later events are recorded and flagged
    // — same rule as the geofence above.
    if (t.mock_location_action === 'block' && isClockIn) {
      throw new ForbiddenError('Mock location blocked', 'MOCK_LOCATION_BLOCKED');
    }
    if (t.mock_location_action !== 'allow') {
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
    // Live state reflects only events up to now; a future-dated stamp (e.g. a
    // planned clock_out entered ahead of time) must not flip the button.
    `SELECT event_type, occurred_at FROM stamps
     WHERE user_id = $1 AND deleted_at IS NULL AND occurred_at <= now()
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
