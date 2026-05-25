import { api } from './api';

interface QueuedStamp {
  idempotency_key: string;
  payload: Record<string, unknown>;
  enqueued_at: number;
}

const WEB_KEY = 'sonoqui.pending_stamps';

function load(): QueuedStamp[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(WEB_KEY);
  return raw ? (JSON.parse(raw) as QueuedStamp[]) : [];
}
function save(items: QueuedStamp[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(WEB_KEY, JSON.stringify(items));
}

export function enqueueStamp(idempotencyKey: string, payload: Record<string, unknown>): void {
  const items = load().filter((i) => i.idempotency_key !== idempotencyKey);
  items.push({ idempotency_key: idempotencyKey, payload, enqueued_at: Date.now() });
  save(items);
}

export function listPending(): QueuedStamp[] {
  return load();
}

export async function drainQueue(): Promise<{ sent: number; failed: number }> {
  const pending = load();
  let sent = 0;
  let failed = 0;
  const remaining: QueuedStamp[] = [];
  for (const q of pending) {
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
  return { sent, failed };
}
