import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { adminPool } from '../lib/admin-db.js';
import { env } from '../env.js';
import { ForbiddenError, ValidationError } from '../errors/index.js';
import { ok } from '../lib/api-response.js';
import { createLogger } from '../lib/logger.js';
import { asyncHandler } from '../lib/route-helpers.js';
import { createUserWithPassword } from '../lib/gotrue-admin.js';

const logger = createLogger('internal-e2e');

// Hardcoded match pattern. Cannot be overridden by request input — the only
// rows this endpoint will ever touch are e2e fixtures whose email matches
// the suite's own seed format.
const E2E_EMAIL_PATTERN = 'e2e-%@e2e.local';
const E2E_EMAIL_REGEX = /^e2e-[a-zA-Z0-9._-]+@e2e\.local$/;

function bearerMatches(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const provided = header.slice('Bearer '.length).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const internalE2eRouter = Router();

internalE2eRouter.post(
  '/purge-fixtures',
  asyncHandler(async (req, res) => {
    const secret = env.E2E_PURGE_SECRET;
    if (!secret) throw new ForbiddenError('purge endpoint disabled');
    if (!bearerMatches(req.header('authorization'), secret)) {
      throw new ForbiddenError('invalid purge token');
    }

    const client = await adminPool.connect();
    // Subquery used by every child DELETE. Must run BEFORE the auth_users
    // DELETE below — once that fires the subquery returns empty.
    const inE2eUsers = `IN (SELECT id FROM auth_users WHERE email LIKE $1)`;
    const args = [E2E_EMAIL_PATTERN];
    try {
      await client.query('BEGIN');
      // Child tables keyed on user_id (no FK cascade from auth_users). Order
      // does not matter among these, but all must precede auth_users.
      // leave_audit_log cascades from leave_requests; leave_accruals cascades
      // from leave_quota_assignments — neither needs an explicit DELETE.
      const lr = await client.query(`DELETE FROM leave_requests WHERE user_id ${inE2eUsers}`, args);
      const lqa = await client.query(`DELETE FROM leave_quota_assignments WHERE user_id ${inE2eUsers}`, args);
      const lap = await client.query(
        `DELETE FROM leave_approvers WHERE user_id ${inE2eUsers} OR approver_user_id ${inE2eUsers}`,
        args
      );
      const cr = await client.query(`DELETE FROM correction_requests WHERE user_id ${inE2eUsers}`, args);
      const cap = await client.query(
        `DELETE FROM correction_approvers WHERE user_id ${inE2eUsers} OR approver_user_id ${inE2eUsers}`,
        args
      );
      const st = await client.query(`DELETE FROM stamps WHERE user_id ${inE2eUsers}`, args);
      const usa = await client.query(`DELETE FROM user_shift_assignments WHERE user_id ${inE2eUsers}`, args);
      const up = await client.query(`DELETE FROM user_preferences WHERE user_id ${inE2eUsers}`, args);
      const bm = await client.query(`DELETE FROM branch_memberships WHERE user_id ${inE2eUsers}`, args);
      const m = await client.query(`DELETE FROM memberships WHERE user_id ${inE2eUsers}`, args);
      const a = await client.query(`DELETE FROM auth_users WHERE email LIKE $1`, args);
      const g = await client.query(`DELETE FROM auth.users WHERE email LIKE $1`, args);

      // Belt-and-braces text-marker sweep: web mutating specs that act as the
      // persistent test3 QA user leave rows behind on that account (we can't
      // delete test3 because mobile-user specs assert its seeded data). The
      // suite tags every fixture row's free-text fields with an "e2e " or
      // "e2e-" prefix — wipe any orphan that matches even if the owning user
      // still exists.
      const lrm = await client.query(
        `DELETE FROM leave_requests
          WHERE user_note            ILIKE 'e2e %' OR user_note            ILIKE 'e2e-%'
             OR cancellation_reason  ILIKE 'e2e %' OR cancellation_reason  ILIKE 'e2e-%'
             OR rejection_reason     ILIKE 'e2e %' OR rejection_reason     ILIKE 'e2e-%'`
      );
      const crm = await client.query(
        `DELETE FROM correction_requests
          WHERE justification   ILIKE 'e2e %' OR justification   ILIKE 'e2e-%'
             OR resolution_note ILIKE 'e2e %' OR resolution_note ILIKE 'e2e-%'`
      );
      await client.query('COMMIT');
      const totalLeave = (lr.rowCount ?? 0) + (lrm.rowCount ?? 0);
      const totalCorr = (cr.rowCount ?? 0) + (crm.rowCount ?? 0);
      logger.info(
        {
          leave_requests: totalLeave,
          leave_quota_assignments: lqa.rowCount,
          leave_approvers: lap.rowCount,
          correction_requests: totalCorr,
          correction_approvers: cap.rowCount,
          stamps: st.rowCount,
          user_shift_assignments: usa.rowCount,
          user_preferences: up.rowCount,
          branch_memberships: bm.rowCount,
          memberships: m.rowCount,
          auth_users: a.rowCount,
          gotrue_users: g.rowCount,
          leave_requests_marker_sweep: lrm.rowCount,
          correction_requests_marker_sweep: crm.rowCount,
        },
        'e2e fixtures purged'
      );
      ok(res, {
        leave_requests_deleted: totalLeave,
        leave_quota_assignments_deleted: lqa.rowCount,
        leave_approvers_deleted: lap.rowCount,
        correction_requests_deleted: totalCorr,
        correction_approvers_deleted: cap.rowCount,
        stamps_deleted: st.rowCount,
        user_shift_assignments_deleted: usa.rowCount,
        user_preferences_deleted: up.rowCount,
        branch_memberships_deleted: bm.rowCount,
        memberships_deleted: m.rowCount,
        auth_users_deleted: a.rowCount,
        gotrue_users_deleted: g.rowCount,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

// Provisions a single e2e fixture user with a password set, enrolled in the
// requested tenant. Same bearer guard as /purge-fixtures. The email MUST
// match the e2e-*@e2e.local pattern so this endpoint can never create a
// real user. Idempotent on (email, tenant_id) — repeats return the existing
// row instead of erroring.
internalE2eRouter.post(
  '/create-fixture-user',
  asyncHandler(async (req, res) => {
    const secret = env.E2E_PURGE_SECRET;
    if (!secret) throw new ForbiddenError('endpoint disabled');
    if (!bearerMatches(req.header('authorization'), secret)) {
      throw new ForbiddenError('invalid token');
    }

    const body = req.body as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const tenantId = typeof body.tenant_id === 'string' ? body.tenant_id : '';
    const role = body.role === 'admin' ? 'admin' : 'user';
    const firstName = typeof body.first_name === 'string' ? body.first_name : 'E2E';
    const lastName = typeof body.last_name === 'string' ? body.last_name : 'Runner';

    if (!E2E_EMAIL_REGEX.test(email)) {
      throw new ValidationError('email must match e2e-*@e2e.local', { email });
    }
    if (password.length < 8) {
      throw new ValidationError('password must be at least 8 chars', {});
    }
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) {
      throw new ValidationError('tenant_id must be a uuid', { tenant_id: tenantId });
    }

    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT id FROM auth_users WHERE email = $1`,
        [email]
      );
      let userId: string;
      let createdGoTrue = false;
      if (existing.rowCount && existing.rows[0]) {
        userId = existing.rows[0].id;
      } else {
        const g = await createUserWithPassword(email, password);
        userId = g.id;
        createdGoTrue = true;
        await client.query(
          `INSERT INTO auth_users(id, email, first_name, last_name, display_name, created_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (id) DO NOTHING`,
          [userId, email, firstName, lastName, `${firstName} ${lastName}`]
        );
      }
      const mem = await client.query(
        `INSERT INTO memberships(tenant_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, user_id) DO UPDATE
           SET role = EXCLUDED.role, active = TRUE, deleted_at = NULL
         RETURNING id`,
        [tenantId, userId, role]
      );
      await client.query('COMMIT');
      logger.info(
        { email, user_id: userId, tenant_id: tenantId, role, created_gotrue: createdGoTrue },
        'e2e fixture user provisioned'
      );
      ok(
        res,
        {
          user_id: userId,
          email,
          tenant_id: tenantId,
          role,
          membership_id: mem.rows[0].id,
          created_gotrue: createdGoTrue,
        },
        201
      );
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);
