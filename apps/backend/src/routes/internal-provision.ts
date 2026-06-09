import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { adminPool } from '../lib/admin-db.js';
import { env } from '../env.js';
import { ForbiddenError, ValidationError } from '../errors/index.js';
import { ok } from '../lib/api-response.js';
import { createLogger } from '../lib/logger.js';
import { asyncHandler } from '../lib/route-helpers.js';
import { inviteUser } from '../lib/gotrue-admin.js';

const logger = createLogger('internal-provision');

// Constant-time bearer comparison — same guard the internal-e2e router uses.
function bearerMatches(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const provided = header.slice('Bearer '.length).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const NameField = z
  .string()
  .trim()
  .max(80)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

const ProvisionTenant = z.object({
  // Company legal name → tenants.ragione_sociale. The only required field;
  // every other tenant column (country IT, tz Europe/Rome, …) defaults.
  ragione_sociale: z.string().trim().min(1).max(200),
  admin_email: z.string().email(),
  admin_first_name: NameField,
  admin_last_name: NameField,
  // Drives both the tenant locale and the invite email language.
  language: z.enum(['it', 'en']).default('it'),
  // Optional plan-limit overrides; omitted → tenants table defaults
  // (2 admins / 20 users / 3 branches).
  max_admins: z.coerce.number().int().min(1).max(1000).optional(),
  max_users: z.coerce.number().int().min(1).max(100000).optional(),
  max_branches: z.coerce.number().int().min(1).max(10000).optional(),
});

export const internalProvisionRouter = Router();

// Provision a brand-new tenant and invite its first admin.
//
// Flow: INSERT tenants → GoTrue /invite (sends the invite email) → mirror the
// user into auth_users → INSERT an admin membership. The invited admin clicks
// the email link (confirm-email.html → reset-password.html), sets a password,
// and can then sign in and land in the new tenant as admin.
//
// Runs on adminPool (bypasses RLS) because there is no tenant context yet — the
// tenant is being created here. Guarded solely by PROVISION_SECRET; there is no
// user session. Unlike the e2e router this is NOT pinned to a single tenant, so
// it is deliberately gated behind a long bearer secret and mounts only when set.
internalProvisionRouter.post(
  '/tenant',
  asyncHandler(async (req, res) => {
    const secret = env.PROVISION_SECRET;
    if (!secret) throw new ForbiddenError('provisioning endpoint disabled');
    if (!bearerMatches(req.header('authorization'), secret)) {
      throw new ForbiddenError('invalid provisioning token');
    }

    const parse = ProvisionTenant.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const body = parse.data;
    const email = body.admin_email.trim().toLowerCase();
    const firstName = body.admin_first_name ?? null;
    const lastName = body.admin_last_name ?? null;
    const display = [firstName, lastName].map((s) => s ?? '').join(' ').trim() || null;

    const client = await adminPool.connect();
    // GoTrue user creation is not part of the PG transaction. If /invite
    // succeeds but a later INSERT fails, the rollback drops the tenant while the
    // GoTrue user lingers — log its id so it can be cleaned up by hand.
    let orphanGoTrueUserId: string | null = null;
    try {
      await client.query('BEGIN');

      const t = await client.query(
        `INSERT INTO tenants (ragione_sociale, language, max_admins, max_users, max_branches)
         VALUES ($1, $2, COALESCE($3, 2), COALESCE($4, 20), COALESCE($5, 3))
         RETURNING id, max_admins, max_users, max_branches`,
        [
          body.ragione_sociale,
          body.language,
          body.max_admins ?? null,
          body.max_users ?? null,
          body.max_branches ?? null,
        ]
      );
      const tenantId = t.rows[0].id as string;

      // Reuse an existing account if the email is already a GoTrue user
      // (idempotent re-runs, or adding an existing person as a new tenant's
      // admin) — GoTrue /invite would reject a duplicate. A reused account
      // already has credentials, so no invite email is sent.
      const existing = await client.query(`SELECT id FROM auth_users WHERE email = $1`, [email]);
      let userId: string;
      let invited = false;
      if (existing.rowCount && existing.rows[0]) {
        userId = existing.rows[0].id as string;
      } else {
        const g = await inviteUser(email, body.language);
        userId = g.id;
        orphanGoTrueUserId = g.id;
        invited = true;
        await client.query(
          `INSERT INTO auth_users (id, email, first_name, last_name, display_name, created_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (id) DO NOTHING`,
          [userId, email, firstName, lastName, display]
        );
      }

      const mem = await client.query(
        `INSERT INTO memberships (tenant_id, user_id, role)
         VALUES ($1, $2, 'admin')
         ON CONFLICT (tenant_id, user_id) DO UPDATE
           SET role = 'admin', active = TRUE, deleted_at = NULL
         RETURNING id`,
        [tenantId, userId]
      );

      await client.query('COMMIT');
      logger.info(
        { tenant_id: tenantId, user_id: userId, email, invited },
        'tenant provisioned'
      );
      ok(
        res,
        {
          tenant_id: tenantId,
          ragione_sociale: body.ragione_sociale,
          admin: { user_id: userId, email, role: 'admin', membership_id: mem.rows[0].id },
          // true → invite email sent; false → admin already had an account.
          invited,
          limits: {
            max_admins: t.rows[0].max_admins,
            max_users: t.rows[0].max_users,
            max_branches: t.rows[0].max_branches,
          },
        },
        201
      );
    } catch (err) {
      await client.query('ROLLBACK');
      if (orphanGoTrueUserId) {
        logger.error(
          { orphan_gotrue_user_id: orphanGoTrueUserId, email },
          'provisioning failed after GoTrue /invite — orphan auth user left behind, clean up manually'
        );
      }
      throw err;
    } finally {
      client.release();
    }
  })
);
