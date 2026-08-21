/**
 * What a client is allowed to see of a stamps row, and the one place that says so.
 *
 * A punch needs its geofence *verdict*, not its position. The verdict is
 * `branch_id`, `out_of_geofence`, `geofence_distance_m` and
 * `suspicious_mock_location`; the raw `latitude` / `longitude` /
 * `gps_accuracy_m` that produced it are discarded once the check is done
 * (Garante provv. 8 settembre 2016 n. 350 — keep "soltanto sede, data e ora").
 *
 * Migration 060 holds those three columns permanently NULL and strips them from
 * the whole-row snapshots in `stamps_history`, `audit_log` and
 * `centrifugo_outbox`. This module is the application-side half: every `SELECT
 * s.*` and `RETURNING *` on stamps went out with the coordinate columns in the
 * payload — unrendered, but present in the JSON of the everyday list on every
 * browser and phone — and would have shipped any future column too.
 */

/** The GPS keys that never leave the server. */
export const STAMP_GPS_KEYS = ['latitude', 'longitude', 'gps_accuracy_m'] as const;

const STAMP_COLUMNS = [
  'id',
  'tenant_id',
  'user_id',
  'event_type',
  'occurred_at',
  'source',
  'branch_id',
  'device_platform',
  'device_app_version',
  'suspicious_mock_location',
  'out_of_geofence',
  'geofence_distance_m',
  'notes',
  'queued_hours',
  'reminder_sent_at',
  'original_occurred_at',
  'original_event_type',
  'edited_at',
  'edited_by_user_id',
  'edit_count',
  'deleted_at',
  'deleted_by_user_id',
  'deletion_reason',
  'created_at',
] as const;

/** `s.id, s.tenant_id, …` for a joined query; `id, tenant_id, …` with no alias. */
export function stampColumns(alias?: string): string {
  return STAMP_COLUMNS.map((c) => (alias ? `${alias}.${c}` : c)).join(', ');
}

/**
 * Recursively removes the coordinate keys from an audit/history payload. Only
 * called for `stamp.*` actions: `branch.create` / `branch.update` legitimately
 * carry a sede's latitude/longitude, which is company configuration, and "the
 * sede moved" is exactly what the Registro attività exists to show.
 */
export function stripStampGps<T>(payload: T): T {
  if (!isPlainObject(payload)) {
    return Array.isArray(payload) ? (payload.map((v) => stripStampGps(v)) as unknown as T) : payload;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if ((STAMP_GPS_KEYS as readonly string[]).includes(k)) continue;
    out[k] = stripStampGps(v);
  }
  return out as T;
}

/**
 * Only walk into things that have own enumerable keys worth walking.
 *
 * The payloads passed here are raw node-pg rows, and every timestamptz column
 * arrives as a `Date` — which is `typeof 'object'` but has no own enumerable
 * properties. Rebuilding one from `Object.entries` yields `{}`, so a naive
 * recursion silently replaced `occurred_at` with an empty object and erased the
 * time from every stamp entry of the Registro attività. Dates, Buffers and
 * anything else non-plain are passed through untouched so `JSON.stringify`
 * still sees them and serialises them as it did before.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}
