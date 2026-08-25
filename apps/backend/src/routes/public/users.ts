import { Router } from 'express';
import { z } from 'zod';
import { apiHandler } from '../../lib/route-helpers.js';
import { requireScope } from '../../middleware/api-key.js';
import { invalidateMembershipCache } from '../../middleware/auth.js';
import { ok } from '../../lib/api-response.js';
import { logAudit } from '../../lib/audit.js';
import type { PoolClient } from 'pg';
import { ConflictError, NotFoundError } from '../../errors/index.js';
import { fetchLimits, performInvite } from '../users.js';
import { sendTenantAccessEmail } from '../../lib/gotrue-admin.js';
import {
  PageQuery,
  okList,
  parseBody,
  parseQuery,
  takeTotal,
  uniqueIds,
  uuidParam,
  whereSql,
} from './helpers.js';

/**
 * Employees, as an integration sees them.
 *
 * The shape is the tenant-facing anagrafica plus the identifiers a payroll or
 * HR system joins on (`external_id`, `matricola`, `codice_fiscale`) — that is
 * the whole reason this resource is first in the list: a gestionale that
 * already owns the staff register wants to push it in, and everything else the
 * API exposes is keyed by the user ids it gets back from here.
 *
 * Deliberately NOT exposed: password state, push tokens, notification
 * preferences and anything under the Documentale capability. A key can create
 * an employee and describe them; it cannot become them.
 */
export const publicUsersRouter = Router();

const COLUMNS = `m.user_id AS id, m.role, m.active, m.created_at,
                 m.external_id, m.matricola, m.codice_fiscale, m.inail,
                 m.qualifica, m.qualifica2, m.stamp_modes,
                 au.email, au.first_name, au.last_name, au.display_name,
                 COALESCE(
                   (SELECT array_agg(bm.branch_id)
                      FROM branch_memberships bm
                     WHERE bm.user_id = m.user_id
                       AND bm.tenant_id = current_setting('app.current_tenant_id')::uuid),
                   ARRAY[]::uuid[]
                 ) AS branch_ids`;

const ListQuery = PageQuery.extend({
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  role: z.enum(['admin', 'user']).optional(),
  email: z.string().email().optional(),
  /** The customer's own identifier, which is what an external system has. */
  external_id: z.string().max(64).optional(),
  branch_id: z.string().uuid().optional(),
});

publicUsersRouter.get(
  '/',
  requireScope('users:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(ListQuery, req);
    const where = ['m.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (q.active !== undefined) {
      params.push(q.active);
      where.push(`m.active = $${params.length}`);
    }
    if (q.role) {
      params.push(q.role);
      where.push(`m.role = $${params.length}`);
    }
    if (q.email) {
      params.push(q.email);
      where.push(`au.email = $${params.length}`);
    }
    if (q.external_id) {
      params.push(q.external_id);
      where.push(`m.external_id = $${params.length}`);
    }
    if (q.branch_id) {
      params.push(q.branch_id);
      where.push(
        `EXISTS (SELECT 1 FROM branch_memberships bm2
                  WHERE bm2.user_id = m.user_id AND bm2.branch_id = $${params.length})`
      );
    }
    params.push(q.limit, q.offset);
    const r = await client.query(
      `SELECT ${COLUMNS}, COUNT(*) OVER() AS total
         FROM memberships m
         LEFT JOIN auth_users au ON au.id = m.user_id
        ${whereSql(where)}
        ORDER BY au.email NULLS LAST, m.created_at, m.user_id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows, total } = takeTotal(r.rows, q);
    okList(res, rows, q, total);
  })
);

publicUsersRouter.get(
  '/:id',
  requireScope('users:read'),
  apiHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT ${COLUMNS}
         FROM memberships m
         LEFT JOIN auth_users au ON au.id = m.user_id
        WHERE m.user_id = $1 AND m.deleted_at IS NULL`,
      [uuidParam(req, 'id')]
    );
    if (r.rowCount === 0) throw new NotFoundError('user');
    ok(res, r.rows[0]);
  })
);

// ---- POST / — add an employee ---------------------------------------------
//
// Reuses performInvite from the web route rather than reimplementing it: user
// creation touches GoTrue, the auth_users mirror, the membership row and the
// branch assignments, and two implementations of that would diverge on the
// first change to any of them.
const CreateBody = z.object({
  email: z.string().email(),
  first_name: z.string().trim().max(80).nullable().optional(),
  last_name: z.string().trim().max(80).nullable().optional(),
  role: z.enum(['admin', 'user']).default('user'),
  language: z.enum(['it', 'en']).optional(),
  branch_ids: z.array(z.string().uuid()).optional(),
  external_id: z.string().trim().max(64).nullable().optional(),
  matricola: z.string().trim().max(4).nullable().optional(),
  codice_fiscale: z.string().trim().max(16).nullable().optional(),
  inail: z.string().trim().max(20).nullable().optional(),
  qualifica: z.string().trim().max(80).nullable().optional(),
  qualifica2: z.string().trim().max(80).nullable().optional(),
  /** Send the "set your password" / "you've been added" email now. Default ON:
   *  an account created by a nightly sync that nobody is ever told about is an
   *  account that generates a support call instead of a login. */
  send_invite: z.boolean().default(true),
});

publicUsersRouter.post(
  '/',
  requireScope('users:write'),
  apiHandler(async (req, res, client) => {
    const b = parseBody(CreateBody, req);
    const { limits, counts } = await fetchLimits(client);
    if (counts.total >= limits.max_users) {
      throw new ConflictError(
        `User limit reached: ${counts.total}/${limits.max_users}`,
        'LIMIT_REACHED',
        { kind: 'users', current: counts.total, limit: limits.max_users }
      );
    }
    if (b.role === 'admin' && counts.admins >= limits.max_admins) {
      throw new ConflictError(
        `Admin limit reached: ${counts.admins}/${limits.max_admins}`,
        'LIMIT_REACHED',
        { kind: 'admins', current: counts.admins, limit: limits.max_admins }
      );
    }
    const existing = await client.query(`SELECT id FROM auth_users WHERE email = $1`, [b.email]);
    if (existing.rowCount) {
      const m = await client.query(
        `SELECT active, deleted_at FROM memberships
          WHERE tenant_id = current_setting('app.current_tenant_id')::uuid AND user_id = $1`,
        [existing.rows[0].id]
      );
      if (m.rowCount && m.rows[0].active && !m.rows[0].deleted_at) {
        throw new ConflictError('User already a member of this company', 'CONFLICT');
      }
    }

    const outcome = await performInvite(client, b);
    await logAudit(client, {
      action: 'user.invite',
      resourceType: 'user',
      resourceId: outcome.user_id,
      targetUserId: outcome.user_id,
      targetLabel: b.email,
      after: { email: b.email, role: b.role, via: 'api' },
      req,
    });

    let emailSent = false;
    if (b.send_invite) {
      const tl = await client.query(
        `SELECT ragione_sociale, language FROM tenants
          WHERE id = current_setting('app.current_tenant_id')::uuid`
      );
      const type = await sendTenantAccessEmail({
        userId: outcome.user_id,
        email: b.email,
        companyName: (tl.rows[0]?.ragione_sociale as string | undefined) ?? '',
        role: b.role,
        language: b.language ?? (tl.rows[0]?.language === 'en' ? 'en' : 'it'),
      });
      emailSent = type !== 'none';
      await logAudit(client, {
        action: 'user.access_email',
        resourceType: 'user',
        resourceId: outcome.user_id,
        targetUserId: outcome.user_id,
        targetLabel: b.email,
        after: { email: b.email, type, via: 'api' },
        req,
      });
    }
    invalidateMembershipCache(outcome.user_id);
    ok(res, { id: outcome.user_id, email: b.email, invite_sent: emailSent }, 201);
  })
);

// ---- PATCH /:id — anagrafica, role, branches -------------------------------
const UpdateBody = z.object({
  first_name: z.string().trim().max(80).nullable().optional(),
  last_name: z.string().trim().max(80).nullable().optional(),
  role: z.enum(['admin', 'user']).optional(),
  external_id: z.string().trim().max(64).nullable().optional(),
  matricola: z.string().trim().max(4).nullable().optional(),
  codice_fiscale: z.string().trim().max(16).nullable().optional(),
  inail: z.string().trim().max(20).nullable().optional(),
  qualifica: z.string().trim().max(80).nullable().optional(),
  qualifica2: z.string().trim().max(80).nullable().optional(),
  branch_ids: z.array(z.string().uuid()).optional(),
});

/**
 * Refuse the write that would leave the company with no active administrator.
 *
 * A `users:write` key is company infrastructure with no judgement: a sync that
 * marks every leaver inactive, or one that demotes everyone whose upstream role
 * is not "manager", would otherwise lock the customer out of their own tenant —
 * and the only way back in is us. The web app has the same guard for the same
 * reason; there it also stops an admin removing their own last admin rights.
 */
async function assertNotLastAdmin(
  client: PoolClient,
  userId: string,
  action: 'deactivate' | 'demote'
): Promise<void> {
  const r = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM memberships
      WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
        AND role = 'admin' AND active = TRUE AND deleted_at IS NULL
        AND user_id <> $1`,
    [userId]
  );
  if (Number(r.rows[0]?.n ?? 0) === 0) {
    throw new ConflictError(
      `Refusing to ${action} the last active administrator`,
      'LAST_ADMIN'
    );
  }
}

const MEMBERSHIP_FIELDS = [
  'role',
  'external_id',
  'matricola',
  'codice_fiscale',
  'inail',
  'qualifica',
  'qualifica2',
] as const;

publicUsersRouter.patch(
  '/:id',
  requireScope('users:write'),
  apiHandler(async (req, res, client) => {
    const b = parseBody(UpdateBody, req);
    const id = uuidParam(req, 'id');
    const before = await client.query(
      `SELECT m.role, m.external_id, m.matricola, m.codice_fiscale, m.inail,
              m.qualifica, m.qualifica2, au.first_name, au.last_name
         FROM memberships m LEFT JOIN auth_users au ON au.id = m.user_id
        WHERE m.user_id = $1 AND m.deleted_at IS NULL`,
      [id]
    );
    if (before.rowCount === 0) throw new NotFoundError('user');

    // Demoting the last admin locks the company out of its own tenant.
    if (b.role === 'user' && before.rows[0].role === 'admin') {
      await assertNotLastAdmin(client, id, 'demote');
    }
    // Promoting to admin is the one field on this endpoint that can breach a
    // contractual limit, so it is checked here rather than left to the DB.
    if (b.role === 'admin' && before.rows[0].role !== 'admin') {
      const { limits, counts } = await fetchLimits(client);
      if (counts.admins >= limits.max_admins) {
        throw new ConflictError(
          `Admin limit reached: ${counts.admins}/${limits.max_admins}`,
          'LIMIT_REACHED',
          { kind: 'admins', current: counts.admins, limit: limits.max_admins }
        );
      }
    }

    const set: string[] = [];
    const params: unknown[] = [id];
    for (const f of MEMBERSHIP_FIELDS) {
      if (b[f] !== undefined) {
        params.push(b[f]);
        set.push(`${f} = $${params.length}`);
      }
    }
    if (set.length) {
      await client.query(
        `UPDATE memberships SET ${set.join(', ')} WHERE user_id = $1 AND deleted_at IS NULL`,
        params
      );
    }
    if (Object.hasOwn(b, 'first_name') || Object.hasOwn(b, 'last_name')) {
      // The booleans say whether the FIELD was present in the body. COALESCE
      // alone cannot tell "leave it alone" from "clear it", so an explicit
      // `"first_name": null` would have been a no-op — and clearing a name is
      // exactly what a sync does when the upstream record loses one.
      await client.query(
        `UPDATE auth_users
            SET first_name = CASE WHEN $2::boolean THEN $3::text ELSE first_name END,
                last_name  = CASE WHEN $4::boolean THEN $5::text ELSE last_name  END,
                display_name = NULLIF(TRIM(CONCAT(
                  CASE WHEN $2::boolean THEN $3::text ELSE first_name END, ' ',
                  CASE WHEN $4::boolean THEN $5::text ELSE last_name  END)), '')
          WHERE id = $1`,
        [
          id,
          Object.hasOwn(b, 'first_name'), b.first_name ?? null,
          Object.hasOwn(b, 'last_name'), b.last_name ?? null,
        ]
      );
    }
    if (b.branch_ids) {
      // Deduplicated (the same sede twice hits the primary key) and checked
      // against this company's sedi. RLS would already hide another tenant's
      // branch from a SELECT, but nothing stops an INSERT naming its id, and a
      // membership row pointing at a foreign sede is worse than an error.
      const branchIds = uniqueIds(b.branch_ids);
      if (branchIds.length) {
        const known = await client.query<{ id: string }>(
          `SELECT id FROM branches WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
          [branchIds]
        );
        const inTenant = new Set(known.rows.map((row) => row.id));
        const stranger = branchIds.find((x) => !inTenant.has(x));
        if (stranger) throw new NotFoundError(`branch not in company: ${stranger}`);
      }
      await client.query(
        `DELETE FROM branch_memberships
          WHERE user_id = $1 AND tenant_id = current_setting('app.current_tenant_id')::uuid`,
        [id]
      );
      if (branchIds.length) {
        await client.query(
          `INSERT INTO branch_memberships (tenant_id, branch_id, user_id)
           SELECT current_setting('app.current_tenant_id')::uuid, b, $1
             FROM unnest($2::uuid[]) AS b`,
          [id, branchIds]
        );
      }
    }

    const after = await client.query(
      `SELECT ${COLUMNS}
         FROM memberships m LEFT JOIN auth_users au ON au.id = m.user_id
        WHERE m.user_id = $1 AND m.deleted_at IS NULL`,
      [id]
    );
    // Only the fields this call actually touched, on BOTH sides. Logging the
    // whole previous row against a partial body made the Registro read as
    // though the integration had wiped every field it never mentioned.
    const touched = Object.keys(b) as Array<keyof typeof b>;
    const beforeRow = before.rows[0] as Record<string, unknown>;
    await logAudit(client, {
      action: 'user.update',
      resourceType: 'user',
      resourceId: id,
      targetUserId: id,
      before: Object.fromEntries(touched.map((k) => [k, beforeRow[k as string] ?? null])),
      after: Object.fromEntries(touched.map((k) => [k, b[k] ?? null])),
      req,
    });
    if (b.role !== undefined) invalidateMembershipCache(id);
    ok(res, after.rows[0]);
  })
);

// ---- POST /:id/deactivate — the API's only "remove" ------------------------
//
// There is no DELETE. Deleting an employee takes their punch history with them,
// and a sync script that mistakes a leaver for a missing row would do that
// silently and irreversibly. Deactivation stops the login, keeps the history,
// and is reversible from the web app — which is what "removed from the
// gestionale" should mean here.
publicUsersRouter.post(
  '/:id/deactivate',
  requireScope('users:write'),
  apiHandler(async (req, res, client) => {
    const id = uuidParam(req, 'id');
    await assertNotLastAdmin(client, id, 'deactivate');
    const r = await client.query(
      `UPDATE memberships SET active = FALSE
        WHERE user_id = $1 AND deleted_at IS NULL AND active = TRUE
        RETURNING user_id`,
      [id]
    );
    if (r.rowCount === 0) {
      const exists = await client.query(
        `SELECT active FROM memberships WHERE user_id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (exists.rowCount === 0) throw new NotFoundError('user');
      throw new ConflictError('User already inactive', 'ALREADY_INACTIVE');
    }
    await logAudit(client, {
      action: 'user.deactivate',
      resourceType: 'user',
      resourceId: id,
      targetUserId: id,
      after: { active: false, via: 'api' },
      req,
    });
    invalidateMembershipCache(id);
    ok(res, { id, active: false });
  })
);

publicUsersRouter.post(
  '/:id/reactivate',
  requireScope('users:write'),
  apiHandler(async (req, res, client) => {
    const id = uuidParam(req, 'id');
    const { limits, counts } = await fetchLimits(client);
    if (counts.total >= limits.max_users) {
      throw new ConflictError(
        `User limit reached: ${counts.total}/${limits.max_users}`,
        'LIMIT_REACHED',
        { kind: 'users', current: counts.total, limit: limits.max_users }
      );
    }
    const r = await client.query(
      `UPDATE memberships SET active = TRUE
        WHERE user_id = $1 AND deleted_at IS NULL AND active = FALSE
        RETURNING user_id`,
      [id]
    );
    if (r.rowCount === 0) {
      const exists = await client.query(
        `SELECT active FROM memberships WHERE user_id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (exists.rowCount === 0) throw new NotFoundError('user');
      throw new ConflictError('User already active', 'ALREADY_ACTIVE');
    }
    await logAudit(client, {
      action: 'user.reactivate',
      resourceType: 'user',
      resourceId: id,
      targetUserId: id,
      after: { active: true, via: 'api' },
      req,
    });
    invalidateMembershipCache(id);
    ok(res, { id, active: true });
  })
);
