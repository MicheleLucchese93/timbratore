import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { adminPool } from './admin-db.js';
import {
  API_KEY_ID_LENGTH,
  API_KEY_PREFIX,
  API_KEY_SECRET_BYTES,
  API_KEY_TOKEN_RE,
  type ApiScope,
} from '@sonoqui/shared';

/**
 * Minting, storing and checking the credentials of the API module.
 *
 * The token is `sq_live_<key_id>_<secret>`. Only `key_id` and sha256(secret)
 * reach the database (migration 064 also refuses the `app` role read access to
 * the hash column), so there is no way back from a stored row to a working
 * token — losing one means creating another, and that is the intended answer.
 */

export interface MintedKey {
  keyId: string;
  /** The full token. Returned to the caller ONCE and never persisted. */
  token: string;
  secretHash: string;
  lastFour: string;
}

export function mintKey(): MintedKey {
  const keyId = randomBytes(API_KEY_ID_LENGTH / 2).toString('hex');
  const secret = randomBytes(API_KEY_SECRET_BYTES).toString('base64url');
  return {
    keyId,
    token: `${API_KEY_PREFIX}${keyId}_${secret}`,
    secretHash: hashSecret(secret),
    lastFour: secret.slice(-4),
  };
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Constant-time hash comparison. Both sides are fixed-length hex digests, so
 *  a length mismatch can only mean a corrupted row — treat it as a miss rather
 *  than letting timingSafeEqual throw on the request path. */
function hashEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface ResolvedApiKey {
  id: string;
  tenantId: string;
  name: string;
  scopes: ApiScope[];
  rateLimitPerMin: number;
  /** Cantieri is the one module whose API resources depend on a second flag. */
  cantieriEnabled: boolean;
}

/**
 * Why a token was refused. Deliberately collapsed to three outcomes at the HTTP
 * layer (see middleware/api-key.ts): telling a caller apart "no such key" from
 * "wrong secret" hands an attacker an enumeration oracle over key_ids.
 */
export type ApiKeyFailure =
  | 'malformed'
  | 'unknown'
  | 'revoked'
  | 'expired'
  | 'module_disabled'
  | 'tenant_unavailable';

export type ApiKeyResolution =
  | { ok: true; key: ResolvedApiKey }
  | { ok: false; reason: ApiKeyFailure };

interface KeyRow {
  id: string;
  tenant_id: string;
  name: string;
  secret_hash: string;
  scopes: string[];
  rate_limit_per_min: number;
  expires_at: Date | null;
  revoked_at: Date | null;
  api_enabled: boolean;
  cantieri_enabled: boolean;
  tenant_deleted_at: Date | null;
  tenant_suspended_at: Date | null;
}

interface CachedRow {
  row: KeyRow;
  fetchedAt: number;
}

// Same 60s TTL as the membership cache in middleware/auth.ts, for the same
// reason: one lookup per request per key would make the auth query the busiest
// statement in the database on a polling integration. The cost is that a
// revoke, a scope change or a module switch-off lands within a minute rather
// than instantly — so every write path that changes any of them calls
// invalidateApiKeyCache().
const cache = new Map<string, CachedRow>();
const CACHE_TTL_MS = 60_000;

/**
 * Drop every cached key of one tenant.
 *
 * Anything that changes what a tenant's keys may do has to call this, not just
 * the API toggle: suspending a company, deleting it, or switching Cantieri off
 * all change the answer resolveApiKey() gives, and the resolution is cached for
 * a minute. Without it, "we suspended them" and "their integration stopped" are
 * up to 60 seconds apart — and for a suspension that gap is the whole point of
 * the action.
 */
export async function invalidateTenantApiKeys(tenantId: string): Promise<void> {
  const r = await adminPool.query<{ key_id: string }>(
    `SELECT key_id FROM api_keys WHERE tenant_id = $1`,
    [tenantId]
  );
  for (const row of r.rows) cache.delete(row.key_id);
}

export function invalidateApiKeyCache(keyId?: string): void {
  if (!keyId) {
    cache.clear();
    return;
  }
  cache.delete(keyId);
}

async function loadKeyRow(keyId: string): Promise<KeyRow | null> {
  const hit = cache.get(keyId);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.row;
  const r = await adminPool.query<KeyRow>(
    `SELECT k.id, k.tenant_id, k.name, k.secret_hash, k.scopes, k.rate_limit_per_min,
            k.expires_at, k.revoked_at,
            t.api_enabled, t.cantieri_enabled,
            t.deleted_at   AS tenant_deleted_at,
            t.suspended_at AS tenant_suspended_at
       FROM api_keys k
       JOIN tenants t ON t.id = k.tenant_id
      WHERE k.key_id = $1`,
    [keyId]
  );
  const row = r.rows[0];
  if (!row) return null;
  cache.set(keyId, { row, fetchedAt: Date.now() });
  return row;
}

/**
 * Resolve a presented token to the key it names, or say why not.
 *
 * Order matters: the secret is checked BEFORE the row's state, so a caller
 * holding a wrong secret learns nothing about whether the key exists, is
 * revoked, or belongs to a suspended company.
 */
export async function resolveApiKey(token: string): Promise<ApiKeyResolution> {
  const m = API_KEY_TOKEN_RE.exec(token.trim());
  if (!m) return { ok: false, reason: 'malformed' };
  const keyId = m[1] as string;
  const secret = m[2] as string;

  const row = await loadKeyRow(keyId);
  if (!row) return { ok: false, reason: 'unknown' };
  if (!hashEquals(row.secret_hash, hashSecret(secret))) return { ok: false, reason: 'unknown' };

  if (row.revoked_at) return { ok: false, reason: 'revoked' };
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  // The module flag is re-read on every resolution (through the same 60s cache)
  // rather than frozen into the key: a partner switching the module off must
  // stop the integration, not merely hide the Settings section.
  if (!row.api_enabled) return { ok: false, reason: 'module_disabled' };
  if (row.tenant_deleted_at || row.tenant_suspended_at) {
    return { ok: false, reason: 'tenant_unavailable' };
  }

  return {
    ok: true,
    key: {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      scopes: row.scopes as ApiScope[],
      rateLimitPerMin: row.rate_limit_per_min,
      cantieriEnabled: row.cantieri_enabled === true,
    },
  };
}

// ── last_used_at ───────────────────────────────────────────────────────────
//
// "Is this key still in use, and from where" is worth knowing — an admin
// deciding whether a two-year-old credential can be revoked has no other way to
// answer it. One UPDATE per API call is not worth it, so the write is throttled
// to once a minute per key and is fire-and-forget: a failed bookkeeping write
// must never turn a successful API request into a 500.
const lastTouch = new Map<string, number>();
const TOUCH_INTERVAL_MS = 60_000;

export function touchApiKey(id: string, ip: string | null): void {
  const now = Date.now();
  const prev = lastTouch.get(id) ?? 0;
  if (now - prev < TOUCH_INTERVAL_MS) return;
  lastTouch.set(id, now);
  void adminPool
    .query(`UPDATE api_keys SET last_used_at = now(), last_used_ip = $2 WHERE id = $1`, [id, ip])
    .catch(() => {
      // Losing one usage stamp is not worth a log line per occurrence; the next
      // request a minute later writes it.
      lastTouch.delete(id);
    });
}

/** Test seam: the caches are process-local and would otherwise leak between
 *  cases in the same run. */
export function resetApiKeyCaches(): void {
  cache.clear();
  lastTouch.clear();
}
