import { Platform } from 'react-native';
import { api } from './api';
import {
  asQueuedStamp,
  partitionQueue,
  type QueueOwner,
  type QueuedStamp,
} from './offline-queue-policy';

let nativeDb: ReturnType<typeof openNativeDb> | null = null;

/** Bump with every schema change; tracked in `PRAGMA user_version`. */
const DATABASE_VERSION = 1;

function openNativeDb() {
  // Lazy-require so web bundle doesn't pull SQLite.
  const SQLite = require('expo-sqlite') as typeof import('expo-sqlite');
  const db = SQLite.openDatabaseSync('sonoqui.db');
  db.execSync(`CREATE TABLE IF NOT EXISTS pending_stamps (
    idempotency_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    enqueued_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    user_id TEXT,
    tenant_id TEXT
  );`);
  // user_id/tenant_id were added after the table shipped, so an install that
  // already has it needs the ALTER. Nullable rather than backfilled: a punch
  // whose owner is unknown is discarded, never guessed at
  // (see offline-queue-policy.ts). PRAGMA user_version is the migration pattern
  // the Expo SDK 56 docs prescribe; the table_info check makes the step
  // idempotent even on an install whose version marker was never written.
  const version = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  if ((version?.user_version ?? 0) < DATABASE_VERSION) {
    const columns = db
      .getAllSync<{ name: string }>('PRAGMA table_info(pending_stamps)')
      .map((c) => c.name);
    if (!columns.includes('user_id')) {
      db.execSync('ALTER TABLE pending_stamps ADD COLUMN user_id TEXT');
    }
    if (!columns.includes('tenant_id')) {
      db.execSync('ALTER TABLE pending_stamps ADD COLUMN tenant_id TEXT');
    }
    db.execSync(`PRAGMA user_version = ${DATABASE_VERSION}`);
  }
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
  if (!raw) return [];
  return (JSON.parse(raw) as Parameters<typeof asQueuedStamp>[0][]).map(asQueuedStamp);
}

function saveWeb(items: QueuedStamp[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(WEB_KEY, JSON.stringify(items));
}

export function enqueueStamp(
  idempotencyKey: string,
  payload: Record<string, unknown>,
  owner: QueueOwner
): void {
  if (Platform.OS === 'web') {
    const items = loadWeb().filter((i) => i.idempotency_key !== idempotencyKey);
    items.push({
      idempotency_key: idempotencyKey,
      payload,
      enqueued_at: Date.now(),
      user_id: owner.userId,
      tenant_id: owner.tenantId,
    });
    saveWeb(items);
    return;
  }
  db().runSync(
    `INSERT OR REPLACE INTO pending_stamps(idempotency_key, payload, enqueued_at, user_id, tenant_id)
     VALUES (?, ?, ?, ?, ?)`,
    [idempotencyKey, JSON.stringify(payload), Date.now(), owner.userId, owner.tenantId]
  );
}

export function listPending(): QueuedStamp[] {
  if (Platform.OS === 'web') return loadWeb();
  const rows = db().getAllSync<{
    idempotency_key: string;
    payload: string;
    enqueued_at: number;
    user_id: string | null;
    tenant_id: string | null;
  }>(
    `SELECT idempotency_key, payload, enqueued_at, user_id, tenant_id
       FROM pending_stamps ORDER BY enqueued_at`
  );
  return rows.map((r) =>
    asQueuedStamp({
      idempotency_key: r.idempotency_key,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
      enqueued_at: r.enqueued_at,
      user_id: r.user_id,
      tenant_id: r.tenant_id,
    })
  );
}

/**
 * Deliver the punches that belong to the signed-in user, in the company they
 * are signed into. Anyone else's stay put until they log back in; expired and
 * unattributable rows are discarded. Passing no owner (session still settling)
 * delivers nothing and discards nothing fresh.
 */
export async function drainQueue(
  owner: QueueOwner | null
): Promise<{ sent: number; failed: number; dropped: number }> {
  const { send, drop } = partitionQueue(listPending(), owner, Date.now());
  for (const q of drop) removeKey(q.idempotency_key);

  let sent = 0;
  let failed = 0;
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
      removeKey(q.idempotency_key);
      sent += 1;
    } catch (err) {
      failed += 1;
      markFailure(q.idempotency_key, (err as Error).message);
    }
  }
  return { sent, failed, dropped: drop.length };
}

function removeKey(key: string): void {
  if (Platform.OS === 'web') {
    saveWeb(loadWeb().filter((i) => i.idempotency_key !== key));
    return;
  }
  db().runSync(`DELETE FROM pending_stamps WHERE idempotency_key = ?`, [key]);
}

function markFailure(key: string, msg: string): void {
  if (Platform.OS === 'web') return; // no attempts column in the localStorage shape
  db().runSync(
    `UPDATE pending_stamps SET attempts = attempts + 1, last_error = ? WHERE idempotency_key = ?`,
    [msg.slice(0, 200), key]
  );
}
