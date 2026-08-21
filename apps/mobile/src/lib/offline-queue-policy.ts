// Who a queued punch belongs to, and when it stops being worth keeping.
//
// Deliberately free of react-native / expo imports: the two storage backends
// (SQLite on device, localStorage on Expo Web) differ, the rules must not, and
// the rules are the part that can be tested in plain node.
//
// The bug this exists to prevent: the queue held nothing but the payload, so
// drainQueue() posted whatever it found under whichever session happened to be
// authenticated. On a shared device — a tablet at the entrance, a phone handed
// over between shifts — employee A could punch offline, log out, and have their
// punch (and, before this change, their coordinates) inserted as employee B's.
// A multi-tenant admin could equally drain a punch into the wrong company.

export interface QueuedStamp {
  idempotency_key: string;
  payload: Record<string, unknown>;
  enqueued_at: number;
  /** Whose punch this is. `null` on rows enqueued before ownership existed. */
  user_id: string | null;
  /** Which company it was stamped for — X-Tenant-Id must match on delivery. */
  tenant_id: string | null;
}

export interface QueueOwner {
  userId: string;
  tenantId: string;
}

/**
 * How long an undelivered punch is worth keeping.
 *
 * Long enough that a worker who spent weeks on a site with no signal still gets
 * paid for it — the backend already flags anything over 24h with
 * `X-Queued-Hours` rather than rejecting it. Past this the correction-request
 * flow is the right route, and the row is only a copy of someone's punch (with
 * the position that produced it) sitting on a device.
 */
export const QUEUE_TTL_MS = 30 * 24 * 3600_000;

export interface QueuePartition {
  /** Ours and still fresh — deliver these. */
  send: QueuedStamp[];
  /** Someone else's, still fresh — hold until they log back in. */
  keep: QueuedStamp[];
  /** Expired, or unattributable — discard. */
  drop: QueuedStamp[];
}

/**
 * Split the queue into what to deliver, hold and discard.
 *
 * `owner` is null when nobody is fully authenticated yet (no session, or no
 * company chosen): nothing is delivered, but nothing fresh is thrown away
 * either — the drain simply runs again once the session settles.
 *
 * Rows with no recorded owner are dropped rather than sent. They predate this
 * change, so their real owner is unknowable, and delivering one under the
 * current session is exactly the misattribution being fixed. A one-off loss on
 * upgrade beats filing one employee's punch against another's name.
 */
export function partitionQueue(
  items: QueuedStamp[],
  owner: QueueOwner | null,
  now: number
): QueuePartition {
  const out: QueuePartition = { send: [], keep: [], drop: [] };
  for (const item of items) {
    if (now - item.enqueued_at > QUEUE_TTL_MS) {
      out.drop.push(item);
    } else if (item.user_id === null || item.tenant_id === null) {
      out.drop.push(item);
    } else if (owner === null) {
      out.keep.push(item);
    } else if (item.user_id === owner.userId && item.tenant_id === owner.tenantId) {
      out.send.push(item);
    } else {
      out.keep.push(item);
    }
  }
  return out;
}

/** Normalises a stored row, tolerating the shape written before ownership. */
export function asQueuedStamp(raw: {
  idempotency_key: string;
  payload: Record<string, unknown>;
  enqueued_at: number;
  user_id?: string | null;
  tenant_id?: string | null;
}): QueuedStamp {
  return {
    idempotency_key: raw.idempotency_key,
    payload: raw.payload,
    enqueued_at: raw.enqueued_at,
    user_id: raw.user_id ?? null,
    tenant_id: raw.tenant_id ?? null,
  };
}
