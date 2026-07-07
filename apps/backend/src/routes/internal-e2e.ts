import { Router } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { adminPool } from '../lib/admin-db.js';
import { env } from '../env.js';
import { ForbiddenError, ValidationError } from '../errors/index.js';
import { ok } from '../lib/api-response.js';
import { createLogger } from '../lib/logger.js';
import { asyncHandler } from '../lib/route-helpers.js';
import { createUserWithPassword } from '../lib/gotrue-admin.js';
import { storageDelete } from '../lib/storage.js';

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

      // --- Partnership / reseller fixtures (migration 044) ---
      // The partner e2e specs create REAL child tenants (ragione_sociale 'e2e-…')
      // owned by a fixture partner, plus partnership_members rows and audit
      // entries. Clean them BEFORE the auth_users delete below — FKs from
      // partnership_members.user_id/created_by, partnership_audit_log.actor_user_id
      // and tenants.created_by_partner/suspended_by all reference auth_users. The
      // pinned demo tenant is excluded by id (and can never be named 'e2e-…').
      const e2eTenantMemberships = await client.query(
        `DELETE FROM memberships
          WHERE tenant_id IN (SELECT id FROM tenants WHERE ragione_sociale LIKE 'e2e-%' AND id <> $1)`,
        [TEST_TENANT_ID]
      );
      const palog = await client.query(
        `DELETE FROM partnership_audit_log
          WHERE actor_user_id ${inE2eUsers}
             OR (target_type = 'tenant'
                 AND target_id IN (SELECT id FROM tenants WHERE ragione_sociale LIKE 'e2e-%' AND id <> $2))`,
        argsT
      );
      const pmembers = await client.query(
        `DELETE FROM partnership_members WHERE user_id ${inE2eUsers}`,
        argsU
      );
      const e2eTenantsDeleted = await client.query(
        `DELETE FROM tenants WHERE ragione_sociale LIKE 'e2e-%' AND id <> $1`,
        [TEST_TENANT_ID]
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
      // Wipe every stamp, regardless of source, for the tenant's EMPLOYEE
      // (role='user') QA accounts — i.e. test3. The anomaly specs seed via POST
      // /admin/stamps (source='admin_manual'), but restricting the sweep to that
      // source left NON-admin residue behind on test3: a leftover open clock-in
      // that the nightly auto-clockout cron later closes (source 'auto'), plus
      // the gps/web/mobile stamps sibling specs create. Those bracket a seeded
      // anomaly day with a bogus effective span (e.g. 07:30–00:55 around a
      // 09:00–13:00 seed), breaking the Correggi/Giustifica UI in
      // mutating-anomalies-correction. No read-only spec asserts baseline stamps
      // on the employee account (the test3 views are render-only), so a full
      // wipe there is safe.
      //
      // Scope to role='user' so the persistent ADMIN accounts (test1/test2) keep
      // their intentional baseline timbrature — the mobile Storico spec
      // (e2e/mobile/storico.spec.ts) renders the logged-in admin's day cards and
      // breaks if that history is wiped. Residue only accumulates on the employee
      // account anyway (specs seed stamps on the `user` handle, never the admin).
      //
      // The single FK into stamps is correction_requests.original_stamp_id
      // (nullable, ON DELETE RESTRICT — see 004_correction_requests.sql). The
      // e2e-user + marker correction sweeps above (cr, crm) already cleared the
      // correction rows we own, but a non-e2e correction left on the account can
      // still pin its stamp and would trip the FK. Skip any stamp a correction
      // still references — those belong to a correction flow the correction
      // sweeps clean separately, and the anomaly residue is never referenced.
      const stm = await client.query(
        `DELETE FROM stamps s
          WHERE s.tenant_id = $1
            AND s.user_id IN (
              SELECT user_id FROM memberships
               WHERE tenant_id = $1 AND role = 'user' AND deleted_at IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM correction_requests cr WHERE cr.original_stamp_id = s.id
            )`,
        [TEST_TENANT_ID]
      );
      // Documents + their views (FK cascade). Scoped to the pinned test tenant.
      // We delete fixture rows whose title starts with 'e2e-' so the R2 object
      // store doesn't accumulate orphaned PDFs across runs. Capture the r2_keys
      // BEFORE deleting the rows; the actual object deletes run after COMMIT (R2
      // is not transactional).
      const dq = await client.query(
        `DELETE FROM documents
          WHERE tenant_id = $1 AND title LIKE 'e2e-%'
          RETURNING r2_key`,
        [TEST_TENANT_ID]
      );
      const docKeys: string[] = dq.rows.map((row) => row.r2_key).filter(Boolean);

      // In-app notifications (migration 043). The server pipeline inserts one row
      // per recipient for every notify* event (correction_submitted/decided,
      // leave_*, document, ...), so a mutating run leaves rows on both the e2e
      // fixture users and the persistent test3 QA account. They never cascade
      // from the source rows deleted above, so wipe the whole pinned test tenant
      // ($1) — hard-scoped, same as the marker sweeps; can never reach another
      // tenant.
      const nq = await client.query(
        `DELETE FROM notifications WHERE tenant_id = $1`,
        [TEST_TENANT_ID]
      );

      // Registro attività rows: append-only in production, but every mutating
      // spec writes them on the pinned test tenant, so residue would grow
      // unbounded across runs. Whole-tenant wipe, same scoping as notifications.
      const alog = await client.query(
        `DELETE FROM audit_log WHERE tenant_id = $1`,
        [TEST_TENANT_ID]
      );

      // Cantieri module fixtures (migration 054). Entries + assignment links
      // are wiped for the whole pinned tenant (specs only ever create them on
      // QA accounts); sites/vehicles/field defs are fixture-named ('e2e-…') so
      // any hand-seeded demo registry survives. Children first: cantiere_entries
      // references cantieri and mezzi without a cascade.
      const cent = await client.query(
        `DELETE FROM cantiere_entries WHERE tenant_id = $1`,
        [TEST_TENANT_ID]
      );
      const cas = await client.query(
        `DELETE FROM cantiere_assignments WHERE tenant_id = $1`,
        [TEST_TENANT_ID]
      );
      const mas = await client.query(
        `DELETE FROM mezzo_assignments WHERE tenant_id = $1`,
        [TEST_TENANT_ID]
      );
      const cant = await client.query(
        `DELETE FROM cantieri WHERE tenant_id = $1 AND name LIKE 'e2e-%'`,
        [TEST_TENANT_ID]
      );
      const mez = await client.query(
        `DELETE FROM mezzi WHERE tenant_id = $1 AND name LIKE 'e2e-%'`,
        [TEST_TENANT_ID]
      );
      const cfd = await client.query(
        `DELETE FROM cantieri_field_defs WHERE tenant_id = $1 AND label LIKE 'e2e-%'`,
        [TEST_TENANT_ID]
      );

      await client.query('COMMIT');

      // Best-effort R2 object cleanup for the purged fixture documents. A
      // failure here must not fail the purge (the DB rows are already gone).
      let docObjectsDeleted = 0;
      for (const key of docKeys) {
        try {
          await storageDelete(key);
          docObjectsDeleted += 1;
        } catch (err) {
          logger.error({ err, r2_key: key }, 'e2e document object delete failed');
        }
      }
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
          documents: dq.rowCount,
          document_objects_deleted: docObjectsDeleted,
          notifications: nq.rowCount,
          audit_log: alog.rowCount,
          cantiere_entries: cent.rowCount,
          cantiere_assignments: cas.rowCount,
          mezzo_assignments: mas.rowCount,
          cantieri: cant.rowCount,
          mezzi: mez.rowCount,
          cantieri_field_defs: cfd.rowCount,
          partnership_members: pmembers.rowCount,
          partnership_audit_log: palog.rowCount,
          partnership_tenants: e2eTenantsDeleted.rowCount,
          partnership_tenant_memberships: e2eTenantMemberships.rowCount,
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
        documents_deleted: dq.rowCount,
        document_objects_deleted: docObjectsDeleted,
        notifications_deleted: nq.rowCount,
        audit_log_deleted: alog.rowCount,
        cantiere_entries_deleted: cent.rowCount,
        cantiere_assignments_deleted: cas.rowCount,
        mezzo_assignments_deleted: mas.rowCount,
        cantieri_deleted: cant.rowCount,
        mezzi_deleted: mez.rowCount,
        cantieri_field_defs_deleted: cfd.rowCount,
        partnership_members_deleted: pmembers.rowCount,
        partnership_audit_log_deleted: palog.rowCount,
        partnership_tenants_deleted: e2eTenantsDeleted.rowCount,
        partnership_tenant_memberships_deleted: e2eTenantMemberships.rowCount,
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
        // Local dev has no GoTrue: mint a mirror-only account (dev-token resolves
        // logins by auth_users.email). Prod creates the real GoTrue user.
        if (env.DEV_AUTH_ENABLED) {
          userId = randomUUID();
        } else {
          const g = await createUserWithPassword(email, password);
          userId = g.id;
          createdGoTrue = true;
        }
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

// Seed a partnership member (platform admin or partner) for the partner-app e2e
// suite. Same bearer guard as the other e2e endpoints. The email MUST match the
// e2e-*@e2e.local pattern so this can never grant partnership powers to a real
// user. Ensures the auth_users row first (mirror-only in dev, GoTrue with a set
// password in prod), then upserts partnership_members. Idempotent on user_id.
internalE2eRouter.post(
  '/grant-partnership',
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
    const role = body.role === 'admin' ? 'admin' : 'partner';
    if (!E2E_EMAIL_REGEX.test(email)) {
      throw new ValidationError('email must match e2e-*@e2e.local', { email });
    }
    if (!env.DEV_AUTH_ENABLED && password.length < 8) {
      throw new ValidationError('password must be at least 8 chars', {});
    }
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;
    const caps = {
      cap_tenants: num(body.cap_tenants),
      cap_users_per_tenant: num(body.cap_users_per_tenant),
      cap_admins_per_tenant: num(body.cap_admins_per_tenant),
      cap_documentali_per_tenant: num(body.cap_documentali_per_tenant),
      cap_branches_per_tenant: num(body.cap_branches_per_tenant),
    };

    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(`SELECT id FROM auth_users WHERE email = $1`, [email]);
      let userId: string;
      if (existing.rowCount && existing.rows[0]) {
        userId = existing.rows[0].id;
      } else if (env.DEV_AUTH_ENABLED) {
        // No GoTrue locally; the dev-token shim resolves logins by email.
        userId = randomUUID();
        await client.query(
          `INSERT INTO auth_users(id, email, first_name, last_name, display_name, created_at)
           VALUES ($1, $2, 'E2E', 'Partner', 'E2E Partner', now())
           ON CONFLICT (id) DO NOTHING`,
          [userId, email]
        );
      } else {
        const gu = await createUserWithPassword(email, password);
        userId = gu.id;
        await client.query(
          `INSERT INTO auth_users(id, email, first_name, last_name, display_name, created_at)
           VALUES ($1, $2, 'E2E', 'Partner', 'E2E Partner', now())
           ON CONFLICT (id) DO NOTHING`,
          [userId, email]
        );
      }
      await client.query(
        `INSERT INTO partnership_members
           (user_id, role, active, cap_tenants, cap_users_per_tenant, cap_admins_per_tenant,
            cap_documentali_per_tenant, cap_branches_per_tenant, updated_at)
         VALUES ($1, $2, TRUE, $3, $4, $5, $6, $7, now())
         ON CONFLICT (user_id) DO UPDATE
           SET role = EXCLUDED.role, active = TRUE,
               cap_tenants = EXCLUDED.cap_tenants,
               cap_users_per_tenant = EXCLUDED.cap_users_per_tenant,
               cap_admins_per_tenant = EXCLUDED.cap_admins_per_tenant,
               cap_documentali_per_tenant = EXCLUDED.cap_documentali_per_tenant,
               cap_branches_per_tenant = EXCLUDED.cap_branches_per_tenant,
               updated_at = now()`,
        [
          userId,
          role,
          caps.cap_tenants,
          caps.cap_users_per_tenant,
          caps.cap_admins_per_tenant,
          caps.cap_documentali_per_tenant,
          caps.cap_branches_per_tenant,
        ]
      );
      await client.query('COMMIT');
      logger.info({ email, user_id: userId, role }, 'e2e partnership member granted');
      ok(res, { user_id: userId, email, role, caps }, 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);
