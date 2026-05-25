import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireAdmin, invalidateMembershipCache } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.js';
import { inviteUser } from '../lib/gotrue-admin.js';
import { env } from '../env.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('users');

export const usersRouter = Router();
usersRouter.use(authenticate);

usersRouter.get(
  '/',
  requireAdmin,
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT m.id AS membership_id, m.user_id, m.role, m.active, m.created_at,
              m.disable_desktop_clock_in,
              COALESCE(au.email, m.user_id::text) AS email,
              (SELECT MAX(occurred_at) FROM stamps s
                WHERE s.user_id = m.user_id AND s.deleted_at IS NULL) AS last_stamp_at
       FROM memberships m
       LEFT JOIN auth_users au ON au.id = m.user_id
       WHERE m.deleted_at IS NULL
       ORDER BY m.created_at DESC`
    );
    ok(res, r.rows);
  })
);

const Invite = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'user']).default('user'),
  branch_ids: z.array(z.string().uuid()).optional(),
});

usersRouter.post(
  '/invite',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = Invite.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const inv = parse.data;
    const tenant = await client.query(
      `SELECT max_admins, max_users FROM tenants WHERE id = current_setting('app.current_tenant_id')::uuid`
    );
    const counts = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE role = 'admin' AND active AND deleted_at IS NULL) AS admins,
         COUNT(*) FILTER (WHERE active AND deleted_at IS NULL) AS total
       FROM memberships
       WHERE tenant_id = current_setting('app.current_tenant_id')::uuid`
    );
    const tRow = tenant.rows[0];
    const cRow = counts.rows[0];
    const isAdminInvite = inv.role === 'admin';
    if (Number(cRow.total) >= tRow.max_users) {
      throw new ConflictError(
        `User limit reached: ${cRow.total}/${tRow.max_users}`,
        'LIMIT_REACHED',
        { kind: 'users', current: Number(cRow.total), limit: tRow.max_users }
      );
    }
    if (isAdminInvite && Number(cRow.admins) >= tRow.max_admins) {
      throw new ConflictError(
        `Admin limit reached: ${cRow.admins}/${tRow.max_admins}`,
        'LIMIT_REACHED',
        { kind: 'admins', current: Number(cRow.admins), limit: tRow.max_admins }
      );
    }
    let user = await client.query(`SELECT id, email FROM auth_users WHERE email = $1`, [inv.email]);
    let userId: string;
    if (user.rowCount === 0) {
      // Production: GoTrue's /invite creates auth.users + sends invite email.
      // Local dev (no GoTrue reachable): fall back to direct insert.
      if (env.NODE_ENV === 'production' || env.GOTRUE_URL.startsWith('http')) {
        try {
          const created = await inviteUser(inv.email, 'it');
          userId = created.id;
          await client.query(
            `INSERT INTO auth_users(id, email, created_at) VALUES ($1, $2, now())
             ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
            [userId, inv.email]
          );
        } catch (err) {
          logger.warn({ err: (err as Error).message, email: inv.email }, 'GoTrue invite failed; falling back to mirror-only insert');
          const newId = uuidv4();
          await client.query(
            `INSERT INTO auth_users(id, email, created_at) VALUES ($1, $2, now())`,
            [newId, inv.email]
          );
          userId = newId;
        }
      } else {
        const newId = uuidv4();
        await client.query(
          `INSERT INTO auth_users(id, email, created_at) VALUES ($1, $2, now())`,
          [newId, inv.email]
        );
        userId = newId;
      }
    } else {
      userId = user.rows[0].id;
    }
    const existing = await client.query(
      `SELECT id, active, deleted_at FROM memberships
       WHERE tenant_id = current_setting('app.current_tenant_id')::uuid AND user_id = $1`,
      [userId]
    );
    let membership;
    if (existing.rowCount && existing.rows[0]) {
      const ex = existing.rows[0];
      if (ex.active && !ex.deleted_at) {
        throw new ConflictError('User already a member of this tenant', 'CONFLICT');
      }
      const upd = await client.query(
        `UPDATE memberships
         SET role = $1, active = TRUE, deleted_at = NULL
         WHERE id = $2 RETURNING *`,
        [inv.role, ex.id]
      );
      membership = upd.rows[0];
    } else {
      const ins = await client.query(
        `INSERT INTO memberships(tenant_id, user_id, role)
         VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2)
         RETURNING *`,
        [userId, inv.role]
      );
      membership = ins.rows[0];
    }
    if (inv.branch_ids) {
      for (const bId of inv.branch_ids) {
        await client.query(
          `INSERT INTO branch_memberships(branch_id, user_id, tenant_id)
           VALUES ($1, $2, current_setting('app.current_tenant_id')::uuid)
           ON CONFLICT DO NOTHING`,
          [bId, userId]
        );
      }
    }
    await emitAudit(client, 'user.invite', userId, null, { email: inv.email, role: inv.role });
    invalidateMembershipCache(userId);
    ok(res, { user_id: userId, email: inv.email, membership }, 201);
  })
);

usersRouter.post(
  '/:id/deactivate',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    if (req.params.id === req.user!.id) {
      const stillAdmin = await client.query(
        `SELECT COUNT(*) AS n FROM memberships
         WHERE role='admin' AND active AND deleted_at IS NULL
           AND tenant_id = current_setting('app.current_tenant_id')::uuid
           AND user_id != $1`,
        [req.user!.id]
      );
      if (Number(stillAdmin.rows[0].n) === 0) {
        throw new ConflictError('Cannot demote last admin', 'LAST_ADMIN');
      }
    }
    const r = await client.query(
      `UPDATE memberships SET active = FALSE
       WHERE user_id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('user');
    await emitAudit(client, 'user.deactivate', String(req.params.id), null, null);
    invalidateMembershipCache(String(req.params.id));
    ok(res, { deactivated: true });
  })
);

usersRouter.post(
  '/:id/reactivate',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const r = await client.query(
      `UPDATE memberships SET active = TRUE
       WHERE user_id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('user');
    await emitAudit(client, 'user.reactivate', String(req.params.id), null, null);
    invalidateMembershipCache(String(req.params.id));
    ok(res, { reactivated: true });
  })
);

const PatchUser = z.object({
  role: z.enum(['admin', 'user']).optional(),
  disable_desktop_clock_in: z.boolean().optional(),
});

usersRouter.patch(
  '/:id',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = PatchUser.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    if (parse.data.role === 'user' && req.params.id === req.user!.id) {
      const stillAdmin = await client.query(
        `SELECT COUNT(*) AS n FROM memberships
         WHERE role='admin' AND active AND deleted_at IS NULL
           AND tenant_id = current_setting('app.current_tenant_id')::uuid
           AND user_id != $1`,
        [req.user!.id]
      );
      if (Number(stillAdmin.rows[0].n) === 0) {
        throw new ConflictError('Cannot demote last admin', 'LAST_ADMIN');
      }
    }
    const r = await client.query(
      `UPDATE memberships
       SET role = COALESCE($2, role),
           disable_desktop_clock_in = COALESCE($3, disable_desktop_clock_in)
       WHERE user_id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [
        req.params.id,
        parse.data.role ?? null,
        parse.data.disable_desktop_clock_in ?? null,
      ]
    );
    if (r.rowCount === 0) throw new NotFoundError('user');
    await emitAudit(client, 'user.update', String(req.params.id), null, parse.data);
    invalidateMembershipCache(String(req.params.id));
    ok(res, r.rows[0]);
  })
);

usersRouter.get(
  '/:id/branches',
  tenantHandler(async (req, res, client) => {
    if (req.user!.role !== 'admin' && req.params.id !== req.user!.id) {
      throw new ConflictError('forbidden', 'FORBIDDEN');
    }
    const r = await client.query(
      `SELECT b.id, b.name FROM branch_memberships bm
       JOIN branches b ON b.id = bm.branch_id AND b.deleted_at IS NULL
       WHERE bm.user_id = $1`,
      [req.params.id]
    );
    ok(res, r.rows);
  })
);

async function emitAudit(
  client: import('pg').PoolClient,
  action: string,
  resourceId: string,
  before: unknown,
  after: unknown
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log(tenant_id, actor_user_id, action, resource_type, resource_id, before, after)
     VALUES (current_setting('app.current_tenant_id')::uuid,
             current_setting('app.current_user_id')::uuid,
             $1, 'user', $2, $3, $4)`,
    [action, resourceId, before, after]
  );
}
