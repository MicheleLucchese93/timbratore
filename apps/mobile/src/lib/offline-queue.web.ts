import { api } from './api';
import {
  asQueuedStamp,
  partitionQueue,
  type QueueOwner,
  type QueuedStamp,
} from './offline-queue-policy';

const WEB_KEY = 'sonoqui.pending_stamps';

function load(): QueuedStamp[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(WEB_KEY);
  if (!raw) return [];
  return (JSON.parse(raw) as Parameters<typeof asQueuedStamp>[0][]).map(asQueuedStamp);
}
function save(items: QueuedStamp[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(WEB_KEY, JSON.stringify(items));
}

export function enqueueStamp(
  idempotencyKey: string,
  payload: Record<string, unknown>,
  owner: QueueOwner
): void {
  const items = load().filter((i) => i.idempotency_key !== idempotencyKey);
  items.push({
    idempotency_key: idempotencyKey,
    payload,
    enqueued_at: Date.now(),
    user_id: owner.userId,
    tenant_id: owner.tenantId,
  });
  save(items);
}

export function listPending(): QueuedStamp[] {
  return load();
}

/** See offline-queue.native.ts — same rules, localStorage instead of SQLite. */
export async function drainQueue(
  owner: QueueOwner | null
): Promise<{ sent: number; failed: number; dropped: number }> {
  const { send, keep, drop } = partitionQueue(load(), owner, Date.now());
  let sent = 0;
  let failed = 0;
  const remaining: QueuedStamp[] = [...keep];
  for (const q of send) {
    const queuedHours = (Date.now() - q.enqueued_at) / 3600_000;
    try {
      await api(`/api/v1/stamps`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': q.idempotency_key,
          ...(queuedHours > 24 ? { 'X-Queued-Hours': String(queuedHours.toFixed(1)) } : {}),
        },
        json: q.payload,
      });
      sent += 1;
    } catch {
      failed += 1;
      remaining.push(q);
    }
  }
  save(remaining);
  return { sent, failed, dropped: drop.length };
}
