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
// auth_users rows this endpoint deletes are e2e fixtures whose email matches
// the suite's own seed format.
const E2E_EMAIL_PATTERN = 'e2e-%@e2e.local';
const E2E_EMAIL_REGEX = /^e2e-[a-zA-Z0-9._-]+@e2e\.local$/;

// Server-side tenant pin (never request input). adminPool bypasses RLS, so
// WITHOUT this every DELETE here would span all tenants — including real
// customers that share the production database. Pinning every query to the
// configured demo tenant is what makes running e2e against prod safe. The
// router only mounts when this is set (see app.ts).
const TEST_TENANT_ID = env.E2E_TEST_TENANT_ID;

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
    if (!TEST_TENANT_ID) throw new ForbiddenError('purge endpoint not configured (E2E_TEST_TENANT_ID unset)');
    if (!bearerMatches(req.header('authorization'), secret)) {
      throw new ForbiddenError('invalid purge token');
    }

    const client = await adminPool.connect();
    // Subquery used by every child DELETE. Must run BEFORE the auth_users
    // DELETE below — once that fires the subquery returns empty.
    const inE2eUsers = `IN (SELECT id FROM auth_users WHERE email LIKE $1)`;
    // $1 = e2e email pattern, $2 = pinned tenant. Tenant-scoped deletes use
    // both; the global-namespace deletes (auth users) use only $1.
    const argsT = [E2E_EMAIL_PATTERN, TEST_TENANT_ID];
    const argsU = [E2E_EMAIL_PATTERN];
    try {
      await client.query('BEGIN');
      // Child tables keyed on user_id (no FK cascade from auth_users). Order
      // does not matter among these, but all must precede auth_users.
      // leave_audit_log cascades from leave_requests; leave_accruals cascades
      // from leave_quota_assignments — neither needs an explicit DELETE.
      // Every table that has a tenant_id column is additionally pinned to the
      // configured test tenant (AND tenant_id = $2).
      const lr = await client.query(
        `DELETE FROM leave_requests WHERE user_id ${inE2eUsers} AND tenant_id = $2`,
        argsT
      );
      const lqa = await client.query(
        `DELETE FROM leave_quota_assignments WHERE user_id ${inE2eUsers} AND tenant_id = $2`,
        argsT
      );
      const lap = await client.query(
        `DELETE FROM leave_approvers
          WHERE (user_id ${inE2eUsers} OR approver_user_id ${inE2eUsers}) AND tenant_id = $2`,
        argsT
      );
      const cr = await client.query(
        `DELETE FROM correction_requests WHERE user_id ${inE2eUsers} AND tenant_id = $2`,
        argsT
      );
      const cap = await client.query(
        `DELETE FROM correction_approvers
          WHERE (user_id ${inE2eUsers} OR approver_user_id ${inE2eUsers}) AND tenant_id = $2`,
        argsT
      );
      const st = await client.query(
        `DELETE FROM stamps WHERE user_id ${inE2eUsers} AND tenant_id = $2`,
        argsT
      );
      const usa = await client.query(
        `DELETE FROM user_shift_assignments WHERE user_id ${inE2eUsers} AND tenant_id = $2`,
        argsT
      );
      // Shift templates + their assignments are created against the persistent
      // test3 QA user (NOT an e2e-*@e2e.local fixture), so the user-scoped
      // delete above misses them and residue accumulates across runs —
      // overlapping/inverted assignment rows then corrupt the per-day
      // resolution in /anomalies and the payroll export. Sweep the pinned test
      // tenant for spec-created templates (name 'e2e%' or already soft-deleted)
      // plus any inverted/orphan assignment rows. Assignments first, then the
      // template children (slots, day_lunch), then the templates (FK order).
      const e2eTpl = `SELECT id FROM shift_templates
                        WHERE tenant_id = $1 AND (name ILIKE 'e2e%' OR deleted_at IS NOT NULL)`;
      const usaSweep = await client.query(
        `DELETE FROM user_shift_assignments
          WHERE tenant_id = $1
            AND ( valid_to < valid_from OR shift_template_id IN (${e2eTpl}) )`,
        [TEST_TENANT_ID]
      );
      await client.query(
        `DELETE FROM shift_template_slots WHERE shift_template_id IN (${e2eTpl})`,
        [TEST_TENANT_ID]
      );
      await client.query(
        `DELETE FROM shift_template_day_lunch WHERE shift_template_id IN (${e2eTpl})`,
        [TEST_TENANT_ID]
      );
      const stpl = await client.query(
        `DELETE FROM shift_templates
          WHERE tenant_id = $1 AND (name ILIKE 'e2e%' OR deleted_at IS NOT NULL)`,
        [TEST_TENANT_ID]
      );
      // user_preferences has no tenant_id — scoped purely to the e2e user set.
      const up = await client.query(`DELETE FROM user_preferences WHERE user_id ${inE2eUsers}`, argsU);
      const bm = await client.query(
        `DELETE FROM branch_memberships WHERE user_id ${inE2eUsers} AND tenant_id = $2`,
        argsT
      );
      const m = await client.query(
        `DELETE FROM memberships WHERE user_id ${inE2eUsers} AND tenant_id = $2`,
        argsT
      );
      // auth_users / GoTrue users are global (no tenant_id). Confined by the
      // dedicated e2e-*@e2e.local namespace, which can never be a real user.
      const a = await client.query(`DELETE FROM auth_users WHERE email LIKE $1`, argsU);
      const g = await client.query(`DELETE FROM auth.users WHERE email LIKE $1`, argsU);

      // Belt-and-braces text-marker sweep: web mutating specs that act as the
      // persistent test3 QA user leave rows behind on that account (we can't
      // delete test3 because mobile-user specs assert its seeded data). The
      // suite tags every fixture row's free-text fields with an "e2e " or
      // "e2e-" prefix — wipe any orphan that matches. SCOPED to the test
      // tenant ($1) so it can never reach another tenant's rows.
      const lrm = await client.query(
        `DELETE FROM leave_requests
          WHERE tenant_id = $1
            AND ( user_note            ILIKE 'e2e %' OR user_note            ILIKE 'e2e-%'
               OR cancellation_reason  ILIKE 'e2e %' OR cancellation_reason  ILIKE 'e2e-%'
               OR rejection_reason     ILIKE 'e2e %' OR rejection_reason     ILIKE 'e2e-%' )`,
        [TEST_TENANT_ID]
      );
      const crm = await client.query(
        `DELETE FROM correction_requests
          WHERE tenant_id = $1
            AND ( justification   ILIKE 'e2e %' OR justification   ILIKE 'e2e-%'
               OR resolution_note ILIKE 'e2e %' OR resolution_note ILIKE 'e2e-%' )`,
        [TEST_TENANT_ID]
      );
      const ajm = await client.query(
        `DELETE FROM anomaly_justifications
          WHERE tenant_id = $1
            AND ( note ILIKE 'e2e %' OR note ILIKE 'e2e-%' )`,
        [TEST_TENANT_ID]
      );
      // Stamps seeded by the anomaly specs go through POST /admin/stamps, which
      // sets source='admin_manual' (the 'e2e ' marker lands in the audit log,
      // not on the row). If a spec crashes before its afterEach delete they
      // linger on the persistent test3 user and pollute later anomaly-day
      // computations (the day's stamps merge into a bogus effective span).
      // Sweep admin-seeded stamps in the test tenant — real employee stamps use
      // source 'web'/'mobile'/'gps', never 'admin_manual'. Scoped to the tenant.
      const stm = await client.query(
        `DELETE FROM stamps WHERE tenant_id = $1 AND source = 'admin_manual'`,
        [TEST_TENANT_ID]
      );
      await client.query('COMMIT');
      const totalLeave = (lr.rowCount ?? 0) + (lrm.rowCount ?? 0);
      const totalCorr = (cr.rowCount ?? 0) + (crm.rowCount ?? 0);
      logger.info(
        {
          tenant_id: TEST_TENANT_ID,
          leave_requests: totalLeave,
          leave_quota_assignments: lqa.rowCount,
          leave_approvers: lap.rowCount,
          correction_requests: totalCorr,
          correction_approvers: cap.rowCount,
          stamps: (st.rowCount ?? 0) + (stm.rowCount ?? 0),
          user_shift_assignments: (usa.rowCount ?? 0) + (usaSweep.rowCount ?? 0),
          shift_templates: stpl.rowCount,
          user_preferences: up.rowCount,
          branch_memberships: bm.rowCount,
          memberships: m.rowCount,
          auth_users: a.rowCount,
          gotrue_users: g.rowCount,
          leave_requests_marker_sweep: lrm.rowCount,
          correction_requests_marker_sweep: crm.rowCount,
          anomaly_justifications_marker_sweep: ajm.rowCount,
        },
        'e2e fixtures purged'
      );
      ok(res, {
        leave_requests_deleted: totalLeave,
        leave_quota_assignments_deleted: lqa.rowCount,
        leave_approvers_deleted: lap.rowCount,
        correction_requests_deleted: totalCorr,
        correction_approvers_deleted: cap.rowCount,
        anomaly_justifications_deleted: ajm.rowCount,
        stamps_deleted: (st.rowCount ?? 0) + (stm.rowCount ?? 0),
        user_shift_assignments_deleted: (usa.rowCount ?? 0) + (usaSweep.rowCount ?? 0),
        shift_templates_deleted: stpl.rowCount,
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
// pinned test tenant. Same bearer guard as /purge-fixtures. The email MUST
// match the e2e-*@e2e.local pattern so this endpoint can never create a
// real user, and the membership is always written to E2E_TEST_TENANT_ID so it
// can never enroll a user into a real customer tenant. Idempotent on
// (email, tenant_id) — repeats return the existing row instead of erroring.
internalE2eRouter.post(
  '/create-fixture-user',
  asyncHandler(async (req, res) => {
    const secret = env.E2E_PURGE_SECRET;
    if (!secret) throw new ForbiddenError('endpoint disabled');
    if (!TEST_TENANT_ID) throw new ForbiddenError('endpoint not configured (E2E_TEST_TENANT_ID unset)');
    if (!bearerMatches(req.header('authorization'), secret)) {
      throw new ForbiddenError('invalid token');
    }

    const body = req.body as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const role = body.role === 'admin' ? 'admin' : 'user';
    const firstName = typeof body.first_name === 'string' ? body.first_name : 'E2E';
    const lastName = typeof body.last_name === 'string' ? body.last_name : 'Runner';

    if (!E2E_EMAIL_REGEX.test(email)) {
      throw new ValidationError('email must match e2e-*@e2e.local', { email });
    }
    if (password.length < 8) {
      throw new ValidationError('password must be at least 8 chars', {});
    }
    // tenant_id is server-pinned; a request that asks for a different tenant
    // is rejected rather than silently honored.
    const bodyTenant = typeof body.tenant_id === 'string' ? body.tenant_id : '';
    if (bodyTenant && bodyTenant !== TEST_TENANT_ID) {
      throw new ValidationError('tenant_id must be the configured E2E test tenant', {
        tenant_id: bodyTenant,
      });
    }
    const tenantId = TEST_TENANT_ID;

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
