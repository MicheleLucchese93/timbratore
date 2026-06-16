import { Platform } from 'react-native';
import { api } from './api';

interface QueuedStamp {
  idempotency_key: string;
  payload: Record<string, unknown>;
  enqueued_at: number;
}

let nativeDb: ReturnType<typeof openNativeDb> | null = null;

function openNativeDb() {
  // Lazy-require so web bundle doesn't pull SQLite.
  const SQLite = require('expo-sqlite') as typeof import('expo-sqlite');
  const db = SQLite.openDatabaseSync('sonoqui.db');
  db.execSync(`CREATE TABLE IF NOT EXISTS pending_stamps (
    idempotency_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    enqueued_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );`);
  return db;
}

function db() {
  if (!nativeDb) nativeDb = openNativeDb();
  return nativeDb!;
}

const WEB_KEY = 'sonoqui.pending_stamps';

function loadWeb(): QueuedStamp[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(WEB_KEY);
  return raw ? (JSON.parse(raw) as QueuedStamp[]) : [];
}

function saveWeb(items: QueuedStamp[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(WEB_KEY, JSON.stringify(items));
}

export function enqueueStamp(idempotencyKey: string, payload: Record<string, unknown>): void {
  if (Platform.OS === 'web') {
    const items = loadWeb().filter((i) => i.idempotency_key !== idempotencyKey);
    items.push({ idempotency_key: idempotencyKey, payload, enqueued_at: Date.now() });
    saveWeb(items);
    return;
  }
  db().runSync(
    `INSERT OR REPLACE INTO pending_stamps(idempotency_key, payload, enqueued_at) VALUES (?, ?, ?)`,
    [idempotencyKey, JSON.stringify(payload), Date.now()]
  );
}

export function listPending(): QueuedStamp[] {
  if (Platform.OS === 'web') return loadWeb();
  const rows = db().getAllSync<{ idempotency_key: string; payload: string; enqueued_at: number }>(
    `SELECT idempotency_key, payload, enqueued_at FROM pending_stamps ORDER BY enqueued_at`
  );
  return rows.map((r) => ({
    idempotency_key: r.idempotency_key,
    payload: JSON.parse(r.payload) as Record<string, unknown>,
    enqueued_at: r.enqueued_at,
  }));
}

export async function drainQueue(): Promise<{ sent: number; failed: number }> {
  const pending = listPending();
  let sent = 0;
  let failed = 0;
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
      removeKey(q.idempotency_key);
      sent += 1;
    } catch (err) {
      failed += 1;
      markFailure(q.idempotency_key, (err as Error).message);
    }
  }
  return { sent, failed };
}

function removeKey(key: string): void {
  if (Platform.OS === 'web') {
    saveWeb(loadWeb().filter((i) => i.idempotency_key !== key));
    return;
  }
  db().runSync(`DELETE FROM pending_stamps WHERE idempotency_key = ?`, [key]);
}

function markFailure(key: string, msg: string): void {
  if (Platform.OS === 'web') {
    const items = loadWeb();
    const idx = items.findIndex((i) => i.idempotency_key === key);
    if (idx >= 0 && items[idx]) {
      // mutate enqueued_at left alone; not bothering with attempts on web
    }
    saveWeb(items);
    return;
  }
  db().runSync(
    `UPDATE pending_stamps SET attempts = attempts + 1, last_error = ? WHERE idempotency_key = ?`,
    [msg.slice(0, 200), key]
  );
}
