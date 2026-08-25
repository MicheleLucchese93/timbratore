import { Router } from 'express';
import { z } from 'zod';
import {
  API_KEYS_PER_TENANT_MAX,
  API_KEY_NAME_MAX,
  API_KEY_RATE_LIMIT_DEFAULT,
  API_KEY_RATE_LIMIT_MAX,
  API_KEY_RATE_LIMIT_MIN,
  API_SCOPES,
  isApiScope,
} from '@sonoqui/shared';
import { authenticate, requireApiModule } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { logAudit } from '../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.js';
import { invalidateApiKeyCache, mintKey } from '../lib/api-keys.js';
import { uuidParam } from './public/helpers.js';

/**
 * Managing the company's API keys, from Impostazioni → API.
 *
 * Runs on the RLS pool (tenantHandler → the `app` role) rather than the service
 * role, and that is the point: migration 064 grants `app` INSERT but not SELECT
 * on api_keys.secret_hash, so nothing in this file — including a future
 * `SELECT *` — can put a stored secret on the wire. The service role is used in
 * exactly one place, lib/api-keys.ts, where a presented token must be checked.
 */
export const apiKeysRouter = Router();
apiKeysRouter.use(authenticate);
apiKeysRouter.use(requireApiModule);

// Every column the client is allowed to see. Listed explicitly, not `*`: the
// one column missing from this list is the one that must never be selected.
const KEY_COLUMNS = `id, name, key_id, last_four, scopes, rate_limit_per_min,
                     expires_at, created_at, created_by_label,
                     last_used_at, last_used_ip, revoked_at`;

const ScopesSchema = z
  .array(z.string())
  .min(1)
  .max(API_SCOPES.length)
  .refine((arr) => arr.every(isApiScope), { message: 'unknown scope' })
  // Duplicates in the array would be stored verbatim and then rendered twice.
  .transform((arr) => Array.from(new Set(arr)).sort());

const CreateBody = z.object({
  name: z.string().trim().min(1).max(API_KEY_NAME_MAX),
  scopes: ScopesSchema,
  rate_limit_per_min: z
    .number()
    .int()
    .min(API_KEY_RATE_LIMIT_MIN)
    .max(API_KEY_RATE_LIMIT_MAX)
    .default(API_KEY_RATE_LIMIT_DEFAULT),
  // ISO date-time. A key with an expiry stops working on its own, which is the
  // right default for a one-off migration script and the wrong one for a
  // permanent integration — so it is optional and never defaulted.
  expires_at: z.string().datetime().nullable().optional(),
});

const UpdateBody = z.object({
  name: z.string().trim().min(1).max(API_KEY_NAME_MAX).optional(),
  scopes: ScopesSchema.optional(),
  rate_limit_per_min: z
    .number()
    .int()
    .min(API_KEY_RATE_LIMIT_MIN)
    .max(API_KEY_RATE_LIMIT_MAX)
    .optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

// ---- GET / — the company's keys, newest first ------------------------------
apiKeysRouter.get(
  '/',
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT ${KEY_COLUMNS} FROM api_keys ORDER BY revoked_at IS NOT NULL, created_at DESC`
    );
    ok(res, { keys: r.rows, scopes: API_SCOPES });
  })
);

// ---- POST / — mint a key ---------------------------------------------------
//
// The ONLY response in the whole system that carries a usable token. It is not
// stored, not logged, not re-derivable: the client shows it once and the
// customer copies it, or they create another.
apiKeysRouter.post(
  '/',
  tenantHandler(async (req, res, client) => {
    const parse = CreateBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;

    const live = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM api_keys WHERE revoked_at IS NULL`
    );
    if (Number(live.rows[0]?.n ?? 0) >= API_KEYS_PER_TENANT_MAX) {
      throw new ConflictError(
        `Maximum ${API_KEYS_PER_TENANT_MAX} active keys reached`,
        'API_KEYS_LIMIT'
      );
    }

    // The creator's name, frozen now. Resolving it live would show whatever
    // they are called today — or nothing at all once they leave the company,
    // which is exactly when somebody asks who created this key.
    const who = await client.query<{ label: string | null }>(
      `SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''), display_name, email) AS label
         FROM auth_users WHERE id = $1`,
      [req.user!.id]
    );

    const minted = mintKey();
    const r = await client.query(
      `INSERT INTO api_keys (tenant_id, name, key_id, secret_hash, last_four, scopes,
                             rate_limit_per_min, expires_at, created_by, created_by_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${KEY_COLUMNS}`,
      [
        req.user!.tenantId,
        b.name,
        minted.keyId,
        minted.secretHash,
        minted.lastFour,
        b.scopes,
        b.rate_limit_per_min,
        b.expires_at ?? null,
        req.user!.id,
        who.rows[0]?.label ?? null,
      ]
    );
    const row = r.rows[0];

    await logAudit(client, {
      action: 'api_key.create',
      resourceType: 'api_key',
      resourceId: row.id,
      targetLabel: b.name,
      // The key_id is the public half and is what a later "which key did this?"
      // question is answered with. The token is not here, and must never be.
      after: { name: b.name, key_id: minted.keyId, scopes: b.scopes, expires_at: b.expires_at ?? null },
      req,
    });

    ok(res, { key: { ...row, token: minted.token } }, 201);
  })
);

// ---- PATCH /:id — rename, re-scope, retune, set an expiry -------------------
apiKeysRouter.patch(
  '/:id',
  tenantHandler(async (req, res, client, afterCommit) => {
    const parse = UpdateBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    if (Object.keys(b).length === 0) throw new ValidationError('nothing to update');

    const keyRowId = uuidParam(req, 'id');
    const cur = await client.query(
      `SELECT ${KEY_COLUMNS} FROM api_keys WHERE id = $1`,
      [keyRowId]
    );
    const before = cur.rows[0];
    if (!before) throw new NotFoundError('API key not found');
    // Editing a revoked key would produce a row that reads as configured and
    // can never authenticate. Create a new one instead.
    if (before.revoked_at) throw new ConflictError('Key is revoked', 'API_KEY_REVOKED');

    const r = await client.query(
      `UPDATE api_keys
          SET name               = COALESCE($2, name),
              scopes             = COALESCE($3, scopes),
              rate_limit_per_min = COALESCE($4, rate_limit_per_min),
              expires_at         = CASE WHEN $5::boolean THEN $6::timestamptz ELSE expires_at END
        WHERE id = $1
      RETURNING ${KEY_COLUMNS}`,
      [
        keyRowId,
        b.name ?? null,
        b.scopes ?? null,
        b.rate_limit_per_min ?? null,
        // expires_at is nullable, so COALESCE cannot tell "clear it" from "leave
        // it": the boolean says whether the field was present in the body at all.
        Object.hasOwn(b, 'expires_at'),
        b.expires_at ?? null,
      ]
    );
    const after = r.rows[0];

    await logAudit(client, {
      action: 'api_key.update',
      resourceType: 'api_key',
      resourceId: after.id,
      targetLabel: after.name,
      before: {
        name: before.name,
        scopes: before.scopes,
        rate_limit_per_min: before.rate_limit_per_min,
        expires_at: before.expires_at,
      },
      after: {
        name: after.name,
        scopes: after.scopes,
        rate_limit_per_min: after.rate_limit_per_min,
        expires_at: after.expires_at,
      },
      req,
    });

    // Scopes and the rate ceiling are read through a 60s cache on the API side.
    // Without this, a scope somebody just removed would keep working for a
    // minute — which is the wrong direction for a revocation-shaped action.
    //
    // AFTER commit, not here: evicting inside the transaction opens a window in
    // which a concurrent API request re-reads the OLD, still-uncommitted row and
    // caches it again for another minute. The eviction has to be the last thing
    // that happens, not the first.
    afterCommit(async () => invalidateApiKeyCache(after.key_id));
    ok(res, { key: after });
  })
);

// ---- POST /:id/revoke — kill a key -----------------------------------------
//
// A tombstone, not a DELETE: the Registro entry naming the key has to keep
// resolving, and "this key was revoked on the 4th" is the answer to the
// question somebody will actually ask.
apiKeysRouter.post(
  '/:id/revoke',
  tenantHandler(async (req, res, client, afterCommit) => {
    const r = await client.query(
      `UPDATE api_keys
          SET revoked_at = now(), revoked_by = $2
        WHERE id = $1 AND revoked_at IS NULL
      RETURNING ${KEY_COLUMNS}`,
      [uuidParam(req, 'id'), req.user!.id]
    );
    const row = r.rows[0];
    if (!row) {
      // Either it never existed in this tenant (RLS made it invisible) or it was
      // already revoked. Both are "there is nothing here to revoke".
      const exists = await client.query(`SELECT 1 FROM api_keys WHERE id = $1`, [
        uuidParam(req, 'id'),
      ]);
      if (exists.rowCount === 0) throw new NotFoundError('API key not found');
      throw new ConflictError('Key already revoked', 'API_KEY_REVOKED');
    }

    await logAudit(client, {
      action: 'api_key.revoke',
      resourceType: 'api_key',
      resourceId: row.id,
      targetLabel: row.name,
      before: { revoked_at: null },
      after: { revoked_at: row.revoked_at, key_id: row.key_id },
      req,
    });

    // Immediate, not within-the-minute: a revoke is usually a response to a
    // leak, and "it keeps working for another 60 seconds" is not an acceptable
    // answer to that. Registered as after-commit for the same reason as above —
    // evicting before COMMIT lets a concurrent request re-cache the live row.
    afterCommit(async () => invalidateApiKeyCache(row.key_id));
    ok(res, { key: row });
  })
);
