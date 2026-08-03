// Reading side of the stamp audit trail.
//
// stamps_history has recorded every INSERT/UPDATE/DELETE on stamps since 003,
// but as raw before/after row snapshots plus a free-text `app.change_reason`.
// That is the right storage shape and the wrong presentation shape: a dispute
// needs "who moved this punch from 08:47 to 09:03, when, and why", not two
// 20-key jsonb blobs. Everything here turns the former into the latter, and is
// shared by the history endpoint, the day dossier, the dossier PDF and the
// payroll export's Rettifiche sheet so all four tell the same story.
import type { PoolClient } from 'pg';

/** Fields whose change is meaningful to an employee reading their own trail. */
const TRACKED_FIELDS = [
  'event_type',
  'occurred_at',
  'branch_id',
  'notes',
  'source',
  'deleted_at',
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

export type StampChangeKind =
  | 'employee_stamp'
  | 'employee_undo'
  | 'employee_correction'
  | 'admin_create'
  | 'admin_edit'
  | 'admin_delete'
  | 'anomaly_fix'
  | 'bulk_apply'
  | 'auto_clockout'
  | 'unknown';

export interface StampFieldChange {
  field: TrackedField;
  before: string | null;
  after: string | null;
}

export interface StampHistoryEvent {
  id: string;
  stamp_id: string;
  user_id: string | null;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  recorded_at: string;
  kind: StampChangeKind;
  /** Free-text reason the admin typed, when the change carried one. */
  justification: string | null;
  /** Set when the change came from approving a correction request. */
  correction_request_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  changes: StampFieldChange[];
  /** Row as first recorded — only on the INSERT event. */
  snapshot: Record<string, string | null> | null;
}

/** Raw stamps_history row as selected by the queries below. */
export interface StampHistoryRow {
  id: string | number;
  stamp_id: string;
  user_id: string | null;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  recorded_at: Date | string;
  changed_by: string | null;
  change_reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor_name?: string | null;
}

// The `app.change_reason` GUC is set by every writer (see routes/stamps.ts,
// routes/admin-stamps.ts, routes/correction-requests.ts, jobs/auto-clockout.ts).
// Prefixed forms carry the admin's own justification after the colon.
const PREFIXED: Array<[string, StampChangeKind]> = [
  ['admin_manual:', 'admin_create'],
  ['admin_edit:', 'admin_edit'],
  ['admin_delete:', 'admin_delete'],
  ['anomaly_standard:', 'anomaly_fix'],
];

const EXACT: Record<string, StampChangeKind> = {
  employee_stamp: 'employee_stamp',
  user_undo_within_60s: 'employee_undo',
  bulk_apply_standard: 'bulk_apply',
  auto_clockout_15h: 'auto_clockout',
};

export function parseChangeReason(reason: string | null): {
  kind: StampChangeKind;
  justification: string | null;
  correctionRequestId: string | null;
} {
  if (!reason) return { kind: 'unknown', justification: null, correctionRequestId: null };
  const exact = EXACT[reason];
  if (exact) return { kind: exact, justification: null, correctionRequestId: null };
  if (reason.startsWith('correction_approved:')) {
    return {
      kind: 'employee_correction',
      justification: null,
      correctionRequestId: reason.slice('correction_approved:'.length) || null,
    };
  }
  for (const [prefix, kind] of PREFIXED) {
    if (reason.startsWith(prefix)) {
      const justification = reason.slice(prefix.length).trim();
      return { kind, justification: justification || null, correctionRequestId: null };
    }
  }
  // An unrecognised reason is still evidence: surface it verbatim rather than
  // dropping it, so a future writer that forgets to register its prefix here
  // degrades to "unknown + text" instead of to silence.
  return { kind: 'unknown', justification: reason, correctionRequestId: null };
}

function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

/** Turn a raw history row into the shape the UI, the PDF and the export read. */
export function describeHistoryRow(row: StampHistoryRow): StampHistoryEvent {
  const { kind, justification, correctionRequestId } = parseChangeReason(row.change_reason);
  const before = row.before ?? null;
  const after = row.after ?? null;

  const changes: StampFieldChange[] = [];
  if (row.operation === 'UPDATE' && before && after) {
    for (const field of TRACKED_FIELDS) {
      const b = asText(before[field]);
      const a = asText(after[field]);
      if (b !== a) changes.push({ field, before: b, after: a });
    }
  }

  let snapshot: Record<string, string | null> | null = null;
  const source = row.operation === 'DELETE' ? before : after;
  if (row.operation !== 'UPDATE' && source) {
    snapshot = {};
    for (const field of TRACKED_FIELDS) snapshot[field] = asText(source[field]);
  }

  return {
    id: String(row.id),
    stamp_id: row.stamp_id,
    user_id: row.user_id ?? asText(after?.user_id ?? before?.user_id),
    operation: row.operation,
    recorded_at:
      row.recorded_at instanceof Date ? row.recorded_at.toISOString() : String(row.recorded_at),
    kind,
    justification,
    correction_request_id: correctionRequestId,
    actor_user_id: row.changed_by,
    actor_name: row.actor_name ?? null,
    changes,
    snapshot,
  };
}

const HISTORY_SELECT = `
  SELECT h.id, h.stamp_id, h.user_id, h.operation, h.recorded_at, h.changed_by,
         h.change_reason, h.before, h.after,
         COALESCE(NULLIF(TRIM(CONCAT(au.first_name, ' ', au.last_name)), ''),
                  au.display_name, au.email) AS actor_name
    FROM stamps_history h
    LEFT JOIN auth_users au ON au.id = h.changed_by`;

/** Full trail of one stamp, oldest first. RLS scopes it to admin-or-owner. */
export async function loadStampHistory(
  client: Pick<PoolClient, 'query'>,
  stampId: string
): Promise<StampHistoryEvent[]> {
  const r = await client.query(
    `${HISTORY_SELECT} WHERE h.stamp_id = $1 ORDER BY h.recorded_at, h.id`,
    [stampId]
  );
  return (r.rows as StampHistoryRow[]).map(describeHistoryRow);
}

/**
 * Trails of several stamps in one round trip, keyed by stamp id — the dossier
 * shows every punch of a day with its own history and must not fan out into
 * one query per punch.
 */
export async function loadStampHistories(
  client: Pick<PoolClient, 'query'>,
  stampIds: string[]
): Promise<Map<string, StampHistoryEvent[]>> {
  const out = new Map<string, StampHistoryEvent[]>();
  if (stampIds.length === 0) return out;
  const r = await client.query(
    `${HISTORY_SELECT} WHERE h.stamp_id = ANY($1::uuid[]) ORDER BY h.recorded_at, h.id`,
    [stampIds]
  );
  for (const raw of r.rows as StampHistoryRow[]) {
    const ev = describeHistoryRow(raw);
    const arr = out.get(ev.stamp_id);
    if (arr) arr.push(ev);
    else out.set(ev.stamp_id, [ev]);
  }
  return out;
}
