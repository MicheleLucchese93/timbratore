import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { adminPool } from '../lib/admin-db.js';
import { ok } from '../lib/api-response.js';
import { asyncHandler } from '../lib/route-helpers.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/index.js';
import {
  authenticatePartner,
  requirePartnershipAdmin,
  requireSuperAdmin,
  isSuperAdmin,
} from '../middleware/partnership-auth.js';
import type { PartnerContext } from '../middleware/partnership-auth.js';
import { invalidateMembershipCache } from '../middleware/auth.js';
import { env } from '../env.js';
import { provisionTenant } from '../lib/provision-tenant.js';
import { ensureAuthUser } from '../lib/auth-users.js';
import { logPartnershipAudit } from '../lib/partnership-audit.js';
import { triggerRecovery, updateUserEmail, deleteUser, changePassword } from '../lib/gotrue-admin.js';
import { passwordSchema } from '../lib/password.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('partnership');

export const partnershipRouter = Router();

// Every route requires an active partnership member.
partnershipRouter.use(authenticatePartner);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function partner(req: Request): PartnerContext {
  if (!req.partner) throw new ForbiddenError('Not a partnership member', 'NOT_PARTNERSHIP_MEMBER');
  return req.partner;
}
function auditCtx(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

// Reject when a per-tenant limit exceeds the partner's cap. Admins (no caps) skip.
function enforceCap(name: string, value: number | null | undefined, cap: number | null): void {
  if (value == null || cap == null) return;
  if (value > cap) {
    throw new ConflictError(
      `${name} (${value}) exceeds your cap (${cap})`,
      'CAP_EXCEEDED',
      { field: name, value, cap }
    );
  }
}

const Limits = {
  max_users: z.coerce.number().int().min(1).max(100000),
  max_admins: z.coerce.number().int().min(1).max(1000),
  max_documentali: z.coerce.number().int().min(0).max(1000),
  max_branches: z.coerce.number().int().min(1).max(10000),
};

// ---- GET /me ---------------------------------------------------------------
partnershipRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const u = await adminPool.query(
      `SELECT email, first_name, last_name, display_name FROM auth_users WHERE id = $1`,
      [p.userId]
    );
    const row = u.rows[0] ?? {};
    ok(res, {
      user_id: p.userId,
      email: p.email ?? row.email ?? null,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      display_name: row.display_name ?? null,
      role: p.role,
      // Lets the console reveal the super-user-only "delete tenant" action
      // without hardcoding the email client-side (the gate stays server-side).
      is_super: isSuperAdmin(p.email ?? row.email ?? null),
      caps: {
        cap_tenants: p.capTenants,
        cap_users_per_tenant: p.capUsersPerTenant,
        cap_admins_per_tenant: p.capAdminsPerTenant,
        cap_documentali_per_tenant: p.capDocumentaliPerTenant,
        cap_branches_per_tenant: p.capBranchesPerTenant,
      },
    });
  })
);

// ---- PATCH /me — edit own display name -------------------------------------
const emptyToNull = (v: string) => (v.length === 0 ? null : v);
const ProfileName = z
  .object({
    first_name: z.string().trim().max(80).transform(emptyToNull).nullable().optional(),
    last_name: z.string().trim().max(80).transform(emptyToNull).nullable().optional(),
  })
  .refine((d) => 'first_name' in d || 'last_name' in d, { message: 'nothing to update' });

partnershipRouter.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const parse = ProfileName.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const cur = await adminPool.query(
      `SELECT first_name, last_name FROM auth_users WHERE id = $1`,
      [p.userId]
    );
    const first = ('first_name' in b ? b.first_name : cur.rows[0]?.first_name) ?? null;
    const last = ('last_name' in b ? b.last_name : cur.rows[0]?.last_name) ?? null;
    const display = [first, last].map((s) => s ?? '').join(' ').trim() || null;
    await adminPool.query(
      `UPDATE auth_users SET first_name = $2, last_name = $3, display_name = $4 WHERE id = $1`,
      [p.userId, first, last, display]
    );
    ok(res, { first_name: first, last_name: last, display_name: display });
  })
);

// ---- POST /change-password — change own console password -------------------
// Verifies the current password (re-auth) before setting the new one. Email is
// taken from the JWT, falling back to the auth_users mirror (mirrors GET /me).
const ChangePassword = z.object({
  current_password: z.string().min(1),
  new_password: passwordSchema,
});

partnershipRouter.post(
  '/change-password',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const parse = ChangePassword.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    let email = p.email;
    if (!email) {
      const u = await adminPool.query(`SELECT email FROM auth_users WHERE id = $1`, [p.userId]);
      email = (u.rows[0]?.email as string | null) ?? null;
    }
    if (!email) throw new ValidationError('account has no email on file');
    await changePassword(email, parse.data.current_password, parse.data.new_password);
    ok(res, { updated: true });
  })
);

// ---- GET /tenants ----------------------------------------------------------
// admin → all tenants; partner → only the tenants they created. Each row carries
// current usage (members/admins/documentali/branches) alongside the limits.
partnershipRouter.get(
  '/tenants',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const params: unknown[] = [];
    let scope = '';
    if (p.role === 'partner') {
      params.push(p.userId);
      scope = 'AND t.created_by_partner = $1';
    }
    const r = await adminPool.query(
      `SELECT t.id, t.ragione_sociale, t.language,
              t.max_admins, t.max_users, t.max_documentali, t.max_branches,
              t.suspended_at, t.created_at, t.created_by_partner, t.partner_note AS note,
              pu.email AS owner_email, opm.partner_name AS owner_name,
              (SELECT au.email FROM memberships am JOIN auth_users au ON au.id = am.user_id
                 WHERE am.tenant_id = t.id AND am.role = 'admin'
                   AND am.active = TRUE AND am.deleted_at IS NULL
                 ORDER BY am.created_at ASC LIMIT 1) AS admin_email,
              (SELECT count(*)::int FROM memberships m
                 WHERE m.tenant_id = t.id AND m.deleted_at IS NULL) AS used_members,
              (SELECT count(*)::int FROM memberships m
                 WHERE m.tenant_id = t.id AND m.deleted_at IS NULL AND m.role = 'admin') AS used_admins,
              (SELECT count(*)::int FROM memberships m
                 WHERE m.tenant_id = t.id AND m.deleted_at IS NULL AND m.role = 'admin'
                   AND m.active = TRUE) AS admin_count,
              (SELECT count(*)::int FROM memberships m
                 WHERE m.tenant_id = t.id AND m.deleted_at IS NULL AND m.is_documentale) AS used_documentali,
              (SELECT count(*)::int FROM branches b
                 WHERE b.tenant_id = t.id AND b.deleted_at IS NULL) AS used_branches
         FROM tenants t
         LEFT JOIN auth_users pu ON pu.id = t.created_by_partner
         LEFT JOIN partnership_members opm ON opm.user_id = t.created_by_partner
        WHERE t.deleted_at IS NULL ${scope}
        ORDER BY t.created_at DESC`,
      params
    );
    ok(res, { tenants: r.rows });
  })
);

// ---- POST /tenants ---------------------------------------------------------
const CreateTenant = z.object({
  ragione_sociale: z.string().trim().min(1).max(200),
  admin_email: z.string().email(),
  admin_first_name: z.string().trim().max(80).optional(),
  admin_last_name: z.string().trim().max(80).optional(),
  language: z.enum(['it', 'en']).default('it'),
  max_users: Limits.max_users.optional(),
  max_admins: Limits.max_admins.optional(),
  max_documentali: Limits.max_documentali.optional(),
  max_branches: Limits.max_branches.optional(),
});

partnershipRouter.post(
  '/tenants',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const parse = CreateTenant.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;

    // Partner caps: tenant-count ceiling + per-tenant limit ceilings.
    if (p.role === 'partner') {
      if (p.capTenants != null) {
        const c = await adminPool.query(
          `SELECT count(*)::int AS n FROM tenants
            WHERE created_by_partner = $1 AND deleted_at IS NULL`,
          [p.userId]
        );
        if ((c.rows[0]?.n ?? 0) >= p.capTenants) {
          throw new ConflictError(
            `tenant cap reached (${p.capTenants})`,
            'CAP_TENANTS_REACHED',
            { cap: p.capTenants }
          );
        }
      }
      enforceCap('max_users', b.max_users, p.capUsersPerTenant);
      enforceCap('max_admins', b.max_admins, p.capAdminsPerTenant);
      enforceCap('max_documentali', b.max_documentali, p.capDocumentaliPerTenant);
      enforceCap('max_branches', b.max_branches, p.capBranchesPerTenant);
    }

    const result = await provisionTenant({
      ragioneSociale: b.ragione_sociale,
      adminEmail: b.admin_email,
      adminFirstName: b.admin_first_name ?? null,
      adminLastName: b.admin_last_name ?? null,
      language: b.language,
      maxUsers: b.max_users ?? null,
      maxAdmins: b.max_admins ?? null,
      maxDocumentali: b.max_documentali ?? null,
      maxBranches: b.max_branches ?? null,
      // Admin-created tenants are platform-owned (NULL); partner-created tenants
      // are owned by the partner so only they (and admins) see them.
      createdByPartner: p.role === 'partner' ? p.userId : null,
    });

    await logPartnershipAudit({
      actorUserId: p.userId,
      actorRole: p.role,
      action: 'tenant.create',
      targetType: 'tenant',
      targetId: result.tenantId,
      targetLabel: result.ragioneSociale,
      after: {
        admin_email: result.admin.email,
        invited: result.invited,
        limits: result.limits,
      },
      ...auditCtx(req),
    });

    ok(
      res,
      {
        tenant_id: result.tenantId,
        ragione_sociale: result.ragioneSociale,
        admin: {
          user_id: result.admin.userId,
          email: result.admin.email,
          role: result.admin.role,
          membership_id: result.admin.membershipId,
        },
        invited: result.invited,
        limits: {
          max_admins: result.limits.maxAdmins,
          max_users: result.limits.maxUsers,
          max_branches: result.limits.maxBranches,
          max_documentali: result.limits.maxDocumentali,
        },
      },
      201
    );
  })
);

// Load a tenant the actor is allowed to act on (admin: any; partner: own).
async function loadOwnedTenant(p: PartnerContext, tenantId: string) {
  if (!UUID_RE.test(tenantId)) throw new ValidationError('invalid tenant id');
  const r = await adminPool.query(
    `SELECT t.id, t.ragione_sociale, t.created_by_partner, t.suspended_at, t.partner_note,
            t.max_admins, t.max_users, t.max_documentali, t.max_branches,
            (SELECT am.user_id FROM memberships am
               WHERE am.tenant_id = t.id AND am.role = 'admin'
                 AND am.active = TRUE AND am.deleted_at IS NULL
               ORDER BY am.created_at ASC LIMIT 1) AS admin_user_id,
            (SELECT au.email FROM memberships am JOIN auth_users au ON au.id = am.user_id
               WHERE am.tenant_id = t.id AND am.role = 'admin'
                 AND am.active = TRUE AND am.deleted_at IS NULL
               ORDER BY am.created_at ASC LIMIT 1) AS admin_email,
            (SELECT count(*)::int FROM memberships m
               WHERE m.tenant_id = t.id AND m.deleted_at IS NULL) AS used_members,
            (SELECT count(*)::int FROM memberships m
               WHERE m.tenant_id = t.id AND m.deleted_at IS NULL AND m.role = 'admin') AS used_admins,
            (SELECT count(*)::int FROM memberships m
               WHERE m.tenant_id = t.id AND m.deleted_at IS NULL AND m.is_documentale) AS used_documentali,
            (SELECT count(*)::int FROM branches b
               WHERE b.tenant_id = t.id AND b.deleted_at IS NULL) AS used_branches
       FROM tenants t
      WHERE t.id = $1 AND t.deleted_at IS NULL`,
    [tenantId]
  );
  if (r.rowCount === 0) throw new NotFoundError('tenant not found');
  const t = r.rows[0];
  if (p.role === 'partner' && t.created_by_partner !== p.userId) {
    throw new ForbiddenError('not your tenant', 'TENANT_NOT_OWNED');
  }
  return t;
}

// ---- PATCH /tenants/:id/limits ---------------------------------------------
const UpdateLimits = z
  .object({
    max_users: Limits.max_users.optional(),
    max_admins: Limits.max_admins.optional(),
    max_documentali: Limits.max_documentali.optional(),
    max_branches: Limits.max_branches.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'no limits to update' });

partnershipRouter.patch(
  '/tenants/:id/limits',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const parse = UpdateLimits.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const t = await loadOwnedTenant(p, String(req.params.id));

    if (p.role === 'partner') {
      enforceCap('max_users', b.max_users, p.capUsersPerTenant);
      enforceCap('max_admins', b.max_admins, p.capAdminsPerTenant);
      enforceCap('max_documentali', b.max_documentali, p.capDocumentaliPerTenant);
      enforceCap('max_branches', b.max_branches, p.capBranchesPerTenant);
    }

    // Never let a limit drop below what the tenant is already using.
    const floor = (label: string, next: number | undefined, used: number): void => {
      if (next != null && next < used) {
        throw new ConflictError(
          `${label} (${next}) is below current usage (${used})`,
          'BELOW_USAGE',
          { field: label, value: next, used }
        );
      }
    };
    floor('max_users', b.max_users, t.used_members);
    floor('max_admins', b.max_admins, t.used_admins);
    floor('max_documentali', b.max_documentali, t.used_documentali);
    floor('max_branches', b.max_branches, t.used_branches);

    const before = {
      max_users: t.max_users,
      max_admins: t.max_admins,
      max_documentali: t.max_documentali,
      max_branches: t.max_branches,
    };
    const next = {
      max_users: b.max_users ?? t.max_users,
      max_admins: b.max_admins ?? t.max_admins,
      max_documentali: b.max_documentali ?? t.max_documentali,
      max_branches: b.max_branches ?? t.max_branches,
    };
    await adminPool.query(
      `UPDATE tenants
          SET max_users = $2, max_admins = $3, max_documentali = $4, max_branches = $5
        WHERE id = $1`,
      [t.id, next.max_users, next.max_admins, next.max_documentali, next.max_branches]
    );
    await logPartnershipAudit({
      actorUserId: p.userId,
      actorRole: p.role,
      action: 'tenant.update_limits',
      targetType: 'tenant',
      targetId: t.id,
      targetLabel: t.ragione_sociale,
      before,
      after: next,
      ...auditCtx(req),
    });
    ok(res, { tenant_id: t.id, limits: next });
  })
);

// ---- PATCH /tenants/:id/note — edit the partner-console note on a company ---
const UpdateNote = z.object({
  note: z.string().trim().max(2000).transform(emptyToNull).nullable(),
});
partnershipRouter.patch(
  '/tenants/:id/note',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const parse = UpdateNote.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const t = await loadOwnedTenant(p, String(req.params.id));
    await adminPool.query(`UPDATE tenants SET partner_note = $2 WHERE id = $1`, [t.id, parse.data.note]);
    await logPartnershipAudit({
      actorUserId: p.userId,
      actorRole: p.role,
      action: 'tenant.update_note',
      targetType: 'tenant',
      targetId: t.id,
      targetLabel: t.ragione_sociale,
      before: { note: t.partner_note },
      after: { note: parse.data.note },
      ...auditCtx(req),
    });
    ok(res, { tenant_id: t.id, note: parse.data.note });
  })
);

// ---- POST /tenants/:id/suspend  &  /resume ---------------------------------
partnershipRouter.post(
  '/tenants/:id/suspend',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const t = await loadOwnedTenant(p, String(req.params.id));
    if (t.suspended_at) {
      return ok(res, { tenant_id: t.id, suspended: true });
    }
    await adminPool.query(
      `UPDATE tenants SET suspended_at = now(), suspended_by = $2 WHERE id = $1`,
      [t.id, p.userId]
    );
    // Evict every member's cached membership so the suspension takes effect on
    // their VERY NEXT request (otherwise the 60s auth cache would keep serving a
    // stale membership and delay the forced logout). The client treats the
    // resulting 403 NO_ACTIVE_TENANT as session-invalid → logs out.
    const members = await adminPool.query(
      `SELECT DISTINCT user_id FROM memberships WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [t.id]
    );
    for (const m of members.rows) invalidateMembershipCache(m.user_id as string);
    await logPartnershipAudit({
      actorUserId: p.userId,
      actorRole: p.role,
      action: 'tenant.suspend',
      targetType: 'tenant',
      targetId: t.id,
      targetLabel: t.ragione_sociale,
      ...auditCtx(req),
    });
    ok(res, { tenant_id: t.id, suspended: true });
  })
);

partnershipRouter.post(
  '/tenants/:id/resume',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const t = await loadOwnedTenant(p, String(req.params.id));
    if (!t.suspended_at) {
      return ok(res, { tenant_id: t.id, suspended: false });
    }
    await adminPool.query(
      `UPDATE tenants SET suspended_at = NULL, suspended_by = NULL WHERE id = $1`,
      [t.id]
    );
    await logPartnershipAudit({
      actorUserId: p.userId,
      actorRole: p.role,
      action: 'tenant.resume',
      targetType: 'tenant',
      targetId: t.id,
      targetLabel: t.ragione_sociale,
      ...auditCtx(req),
    });
    ok(res, { tenant_id: t.id, suspended: false });
  })
);

// ---- DELETE /tenants/:id  (super-user only) --------------------------------
// Permanently delete a tenant. SOFT-deletes the tenant row (it vanishes from
// the console and every member is force-logged-out) and DELETES the GoTrue login
// account of every member who belongs to NO other company and is not a partner
// ("orphans"). Members shared with another company keep their account and are
// only unlinked from this one. Irreversible — gated by requireSuperAdmin AND a
// typed-name confirmation that must match the company's ragione sociale.
const DeleteTenant = z.object({ confirm_name: z.string() });
partnershipRouter.delete(
  '/tenants/:id',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const parse = DeleteTenant.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const t = await loadOwnedTenant(p, String(req.params.id));

    // Defence-in-depth: the typed name must match exactly (the UI enforces this
    // too, but never trust the client for an irreversible action).
    if (parse.data.confirm_name.trim() !== t.ragione_sociale) {
      throw new ConflictError('confirmation name does not match', 'NAME_MISMATCH');
    }

    // Split this tenant's current members into orphans (delete their account) and
    // protected users (another active company OR a partner → keep the account).
    const split = await adminPool.query<{ user_id: string; orphan: boolean }>(
      `SELECT m.user_id,
              NOT (
                EXISTS (
                  SELECT 1 FROM memberships m2
                    JOIN tenants t2 ON t2.id = m2.tenant_id
                   WHERE m2.user_id = m.user_id AND m2.tenant_id <> $1
                     AND m2.deleted_at IS NULL AND t2.deleted_at IS NULL
                )
                OR EXISTS (SELECT 1 FROM partnership_members pm WHERE pm.user_id = m.user_id)
              ) AS orphan
         FROM (SELECT DISTINCT user_id FROM memberships
                WHERE tenant_id = $1 AND deleted_at IS NULL) m`,
      [t.id]
    );
    const allMembers = split.rows.map((r) => r.user_id);
    const orphans = split.rows.filter((r) => r.orphan).map((r) => r.user_id);

    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      // Unlink every member from this tenant.
      await client.query(
        `UPDATE memberships SET active = FALSE, deleted_at = now()
          WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [t.id]
      );
      // Soft-delete the tenant (auth middleware filters deleted_at → forced logout).
      await client.query(`UPDATE tenants SET deleted_at = now() WHERE id = $1`, [t.id]);
      // Remove the mirror row for orphaned accounts (frees the email, drops PII).
      // FK-safe: orphans are never partners and hold no other membership, so no
      // partnership_members / tenants.created_by_partner / audit FK points at them.
      if (orphans.length > 0) {
        await client.query(`DELETE FROM auth_users WHERE id = ANY($1::uuid[])`, [orphans]);
      }
      await logPartnershipAudit(
        {
          actorUserId: p.userId,
          actorRole: p.role,
          action: 'tenant.delete',
          targetType: 'tenant',
          targetId: t.id,
          targetLabel: t.ragione_sociale,
          after: { deleted_users: orphans.length, unlinked_users: allMembers.length - orphans.length },
          ...auditCtx(req),
        },
        client
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Force every member's next request to re-resolve membership → 403 → logout.
    for (const userId of allMembers) invalidateMembershipCache(userId);

    // Delete the orphans' GoTrue login accounts. Outside the PG transaction (the
    // admin API can't enlist in it). Best-effort: a failure here leaves a GoTrue
    // account whose mirror + memberships are already gone, so it can no longer
    // resolve a tenant and is effectively dead — its id is logged for cleanup.
    if (!env.DEV_AUTH_ENABLED) {
      for (const userId of orphans) {
        try {
          await deleteUser(userId);
        } catch (e) {
          logger.error(
            { user_id: userId, tenant_id: t.id, err: (e as Error).message },
            'GoTrue user delete failed after tenant delete — orphan login account left behind, clean up manually'
          );
        }
      }
    }

    logger.info(
      { tenant_id: t.id, deleted_users: orphans.length, unlinked_users: allMembers.length - orphans.length },
      'tenant deleted'
    );
    ok(res, {
      tenant_id: t.id,
      deleted_users: orphans.length,
      unlinked_users: allMembers.length - orphans.length,
    });
  })
);

// ---- POST /tenants/:id/admin-reinvite --------------------------------------
// Resend the set-password email to the tenant's first (oldest) active admin.
partnershipRouter.post(
  '/tenants/:id/admin-reinvite',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const t = await loadOwnedTenant(p, String(req.params.id));
    const r = await adminPool.query(
      `SELECT au.email
         FROM memberships m JOIN auth_users au ON au.id = m.user_id
        WHERE m.tenant_id = $1 AND m.role = 'admin'
          AND m.active = TRUE AND m.deleted_at IS NULL
        ORDER BY m.created_at ASC
        LIMIT 1`,
      [t.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('tenant has no active admin');
    const email = r.rows[0].email as string;
    await triggerRecovery(email);
    await logPartnershipAudit({
      actorUserId: p.userId,
      actorRole: p.role,
      action: 'tenant.admin_reinvite',
      targetType: 'tenant',
      targetId: t.id,
      targetLabel: t.ragione_sociale,
      after: { email },
      ...auditCtx(req),
    });
    ok(res, { tenant_id: t.id, email });
  })
);

// ===== Multi-admin management (up to tenant.max_admins) =====================

// GET the tenant's active admins.
partnershipRouter.get(
  '/tenants/:id/admins',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const t = await loadOwnedTenant(p, String(req.params.id));
    const r = await adminPool.query(
      `SELECT au.id AS user_id, au.email, m.created_at
         FROM memberships m JOIN auth_users au ON au.id = m.user_id
        WHERE m.tenant_id = $1 AND m.role = 'admin' AND m.active = TRUE AND m.deleted_at IS NULL
        ORDER BY m.created_at ASC`,
      [t.id]
    );
    ok(res, { admins: r.rows, max_admins: t.max_admins, count: r.rowCount ?? 0 });
  })
);

// Add an admin (invites a brand-new email), bounded by tenant.max_admins.
const AddAdmin = z.object({
  email: z.string().email(),
  first_name: z.string().trim().max(80).optional(),
  last_name: z.string().trim().max(80).optional(),
});
partnershipRouter.post(
  '/tenants/:id/admins',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const parse = AddAdmin.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const email = b.email.trim().toLowerCase();
    const t = await loadOwnedTenant(p, String(req.params.id));

    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const cnt = await client.query(
        `SELECT count(*)::int AS n FROM memberships
          WHERE tenant_id = $1 AND role = 'admin' AND active = TRUE AND deleted_at IS NULL`,
        [t.id]
      );
      // Adding someone who is ALREADY an active admin is idempotent (no bump).
      const already = await client.query(
        `SELECT 1 FROM memberships m JOIN auth_users au ON au.id = m.user_id
          WHERE m.tenant_id = $1 AND au.email = $2 AND m.role = 'admin'
            AND m.active = TRUE AND m.deleted_at IS NULL`,
        [t.id, email]
      );
      if (!already.rowCount && (cnt.rows[0]?.n ?? 0) >= t.max_admins) {
        throw new ConflictError(`admin limit reached (${t.max_admins})`, 'ADMIN_LIMIT', { max: t.max_admins });
      }
      const u = await ensureAuthUser(client, {
        email,
        firstName: b.first_name ?? null,
        lastName: b.last_name ?? null,
        language: 'it',
      });
      await client.query(
        `INSERT INTO memberships (tenant_id, user_id, role)
         VALUES ($1, $2, 'admin')
         ON CONFLICT (tenant_id, user_id) DO UPDATE
           SET role = 'admin', active = TRUE, deleted_at = NULL`,
        [t.id, u.userId]
      );
      await logPartnershipAudit(
        {
          actorUserId: p.userId,
          actorRole: p.role,
          action: 'tenant.add_admin',
          targetType: 'tenant',
          targetId: t.id,
          targetLabel: t.ragione_sociale,
          after: { email, invited: u.invited },
          ...auditCtx(req),
        },
        client
      );
      await client.query('COMMIT');
      invalidateMembershipCache(u.userId);
      ok(res, { user_id: u.userId, email, invited: u.invited }, 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

// Remove an admin (soft-delete their membership). Never the last one.
partnershipRouter.delete(
  '/tenants/:id/admins/:userId',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const userId = String(req.params.userId);
    if (!UUID_RE.test(userId)) throw new ValidationError('invalid user id');
    const t = await loadOwnedTenant(p, String(req.params.id));
    const admins = await adminPool.query(
      `SELECT m.user_id, au.email FROM memberships m JOIN auth_users au ON au.id = m.user_id
        WHERE m.tenant_id = $1 AND m.role = 'admin' AND m.active = TRUE AND m.deleted_at IS NULL`,
      [t.id]
    );
    const target = admins.rows.find((r) => r.user_id === userId);
    if (!target) throw new NotFoundError('not an admin of this tenant');
    if ((admins.rowCount ?? 0) <= 1) throw new ConflictError('cannot remove the last admin', 'LAST_ADMIN');
    await adminPool.query(
      `UPDATE memberships SET active = FALSE, deleted_at = now() WHERE tenant_id = $1 AND user_id = $2`,
      [t.id, userId]
    );
    invalidateMembershipCache(userId);
    await logPartnershipAudit({
      actorUserId: p.userId,
      actorRole: p.role,
      action: 'tenant.remove_admin',
      targetType: 'tenant',
      targetId: t.id,
      targetLabel: t.ragione_sociale,
      after: { email: target.email },
      ...auditCtx(req),
    });
    ok(res, { user_id: userId, removed: true });
  })
);

// Reinvite a SPECIFIC admin (set-password / recovery email).
partnershipRouter.post(
  '/tenants/:id/admins/:userId/reinvite',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const userId = String(req.params.userId);
    if (!UUID_RE.test(userId)) throw new ValidationError('invalid user id');
    const t = await loadOwnedTenant(p, String(req.params.id));
    const r = await adminPool.query(
      `SELECT au.email FROM memberships m JOIN auth_users au ON au.id = m.user_id
        WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.role = 'admin'
          AND m.active = TRUE AND m.deleted_at IS NULL`,
      [t.id, userId]
    );
    if (r.rowCount === 0) throw new NotFoundError('not an admin of this tenant');
    const email = r.rows[0].email as string;
    await triggerRecovery(email);
    await logPartnershipAudit({
      actorUserId: p.userId,
      actorRole: p.role,
      action: 'tenant.admin_reinvite',
      targetType: 'tenant',
      targetId: t.id,
      targetLabel: t.ragione_sociale,
      after: { email },
      ...auditCtx(req),
    });
    ok(res, { user_id: userId, email });
  })
);

// ---- PATCH /tenants/:id/admin — change the tenant's admin email ------------
// Renames the first (oldest) admin's account email (GoTrue + mirror). Rejected
// if the new email already belongs to a different account.
const ChangeAdmin = z.object({ admin_email: z.string().email() });

partnershipRouter.patch(
  '/tenants/:id/admin',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const parse = ChangeAdmin.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const newEmail = parse.data.admin_email.trim().toLowerCase();
    const t = await loadOwnedTenant(p, String(req.params.id));
    if (!t.admin_user_id) throw new NotFoundError('tenant has no active admin');
    if ((t.admin_email ?? '').toLowerCase() === newEmail) {
      return ok(res, { tenant_id: t.id, admin_email: newEmail });
    }
    const ex = await adminPool.query(`SELECT id FROM auth_users WHERE email = $1`, [newEmail]);
    if (ex.rowCount && ex.rows[0].id !== t.admin_user_id) {
      throw new ConflictError('email already used by another account', 'EMAIL_IN_USE');
    }
    if (!env.DEV_AUTH_ENABLED) {
      await updateUserEmail(t.admin_user_id, newEmail);
    }
    await adminPool.query(`UPDATE auth_users SET email = $2 WHERE id = $1`, [t.admin_user_id, newEmail]);
    await logPartnershipAudit({
      actorUserId: p.userId,
      actorRole: p.role,
      action: 'tenant.change_admin',
      targetType: 'tenant',
      targetId: t.id,
      targetLabel: t.ragione_sociale,
      before: { admin_email: t.admin_email },
      after: { admin_email: newEmail },
      ...auditCtx(req),
    });
    ok(res, { tenant_id: t.id, admin_email: newEmail });
  })
);

// ---- PATCH /tenants/:id/owner — assign the tenant to a partner (admin) ------
// partner_user_id = a partner's user id (that partner then sees/manages it), or
// null = platform-owned (visible only to admins).
const AssignOwner = z.object({ partner_user_id: z.string().uuid().nullable() });
partnershipRouter.patch(
  '/tenants/:id/owner',
  requirePartnershipAdmin,
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const parse = AssignOwner.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const ownerId = parse.data.partner_user_id;
    const t = await loadOwnedTenant(p, String(req.params.id)); // admin → any tenant
    if (ownerId) {
      const pm = await adminPool.query(
        `SELECT 1 FROM partnership_members WHERE user_id = $1 AND role = 'partner' AND active = TRUE`,
        [ownerId]
      );
      if (pm.rowCount === 0) throw new ConflictError('not an active partner', 'INVALID_PARTNER');
    }
    await adminPool.query(`UPDATE tenants SET created_by_partner = $2 WHERE id = $1`, [t.id, ownerId]);
    let label = 'Piattaforma';
    if (ownerId) {
      const e = await adminPool.query(`SELECT email FROM auth_users WHERE id = $1`, [ownerId]);
      label = e.rows[0]?.email ?? ownerId;
    }
    await logPartnershipAudit({
      actorUserId: p.userId,
      actorRole: p.role,
      action: 'tenant.assign_partner',
      targetType: 'tenant',
      targetId: t.id,
      targetLabel: t.ragione_sociale,
      before: { created_by_partner: t.created_by_partner },
      after: { created_by_partner: ownerId, partner: label },
      ...auditCtx(req),
    });
    ok(res, { tenant_id: t.id, created_by_partner: ownerId });
  })
);

// ===== Partner management (platform admin only) =============================

const CapsSchema = {
  cap_tenants: z.coerce.number().int().min(0).max(100000).nullable().optional(),
  cap_users_per_tenant: z.coerce.number().int().min(1).max(100000).nullable().optional(),
  cap_admins_per_tenant: z.coerce.number().int().min(1).max(1000).nullable().optional(),
  cap_documentali_per_tenant: z.coerce.number().int().min(0).max(1000).nullable().optional(),
  cap_branches_per_tenant: z.coerce.number().int().min(1).max(10000).nullable().optional(),
};

// ---- GET /partners ---------------------------------------------------------
partnershipRouter.get(
  '/partners',
  requirePartnershipAdmin,
  asyncHandler(async (req, res) => {
    const r = await adminPool.query(
      `SELECT pm.user_id, au.email, pm.active, pm.partner_name, pm.note,
              pm.cap_tenants, pm.cap_users_per_tenant, pm.cap_admins_per_tenant,
              pm.cap_documentali_per_tenant, pm.cap_branches_per_tenant, pm.created_at,
              (SELECT count(*)::int FROM tenants t
                 WHERE t.created_by_partner = pm.user_id AND t.deleted_at IS NULL) AS tenant_count
         FROM partnership_members pm
         JOIN auth_users au ON au.id = pm.user_id
        WHERE pm.role = 'partner'
        ORDER BY pm.created_at DESC`
    );
    ok(res, { partners: r.rows });
  })
);

// ---- POST /partners --------------------------------------------------------
const CreatePartner = z.object({
  email: z.string().email(),
  first_name: z.string().trim().max(80).optional(),
  last_name: z.string().trim().max(80).optional(),
  partner_name: z.string().trim().max(200).transform(emptyToNull).nullable().optional(),
  note: z.string().trim().max(2000).transform(emptyToNull).nullable().optional(),
  ...CapsSchema,
});

partnershipRouter.post(
  '/partners',
  requirePartnershipAdmin,
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const parse = CreatePartner.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const email = b.email.trim().toLowerCase();

    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const u = await ensureAuthUser(client, {
        email,
        firstName: b.first_name ?? null,
        lastName: b.last_name ?? null,
        language: 'it',
      });
      // Refuse to convert an existing platform admin into a partner.
      const existing = await client.query(
        `SELECT role FROM partnership_members WHERE user_id = $1`,
        [u.userId]
      );
      if (existing.rowCount && existing.rows[0].role === 'admin') {
        throw new ConflictError('user is already a platform admin', 'ALREADY_ADMIN');
      }
      const caps = [
        b.cap_tenants ?? null,
        b.cap_users_per_tenant ?? null,
        b.cap_admins_per_tenant ?? null,
        b.cap_documentali_per_tenant ?? null,
        b.cap_branches_per_tenant ?? null,
      ];
      await client.query(
        `INSERT INTO partnership_members
           (user_id, role, active, cap_tenants, cap_users_per_tenant, cap_admins_per_tenant,
            cap_documentali_per_tenant, cap_branches_per_tenant, partner_name, note, created_by, updated_at)
         VALUES ($1, 'partner', TRUE, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (user_id) DO UPDATE
           SET role = 'partner', active = TRUE,
               cap_tenants = EXCLUDED.cap_tenants,
               cap_users_per_tenant = EXCLUDED.cap_users_per_tenant,
               cap_admins_per_tenant = EXCLUDED.cap_admins_per_tenant,
               cap_documentali_per_tenant = EXCLUDED.cap_documentali_per_tenant,
               cap_branches_per_tenant = EXCLUDED.cap_branches_per_tenant,
               partner_name = EXCLUDED.partner_name,
               note = EXCLUDED.note,
               updated_at = now()`,
        [u.userId, ...caps, b.partner_name ?? null, b.note ?? null, p.userId]
      );
      await logPartnershipAudit(
        {
          actorUserId: p.userId,
          actorRole: p.role,
          action: 'partner.create',
          targetType: 'partner',
          targetId: u.userId,
          targetLabel: email,
          after: {
            invited: u.invited,
            partner_name: b.partner_name ?? null,
            note: b.note ?? null,
            caps: {
              cap_tenants: caps[0],
              cap_users_per_tenant: caps[1],
              cap_admins_per_tenant: caps[2],
              cap_documentali_per_tenant: caps[3],
              cap_branches_per_tenant: caps[4],
            },
          },
          ...auditCtx(req),
        },
        client
      );
      await client.query('COMMIT');
      logger.info({ partner_user_id: u.userId, email, invited: u.invited }, 'partner created');
      ok(res, { user_id: u.userId, email, invited: u.invited, role: 'partner' }, 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

// ---- PATCH /partners/:userId/caps ------------------------------------------
const UpdateCaps = z
  .object({ ...CapsSchema })
  .refine((d) => Object.keys(d).length > 0, { message: 'no caps to update' });

partnershipRouter.patch(
  '/partners/:userId/caps',
  requirePartnershipAdmin,
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const userId = String(req.params.userId);
    if (!UUID_RE.test(userId)) throw new ValidationError('invalid user id');
    const parse = UpdateCaps.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;

    const cur = await adminPool.query(
      `SELECT au.email, pm.role, pm.cap_tenants, pm.cap_users_per_tenant, pm.cap_admins_per_tenant,
              pm.cap_documentali_per_tenant, pm.cap_branches_per_tenant
         FROM partnership_members pm JOIN auth_users au ON au.id = pm.user_id
        WHERE pm.user_id = $1`,
      [userId]
    );
    if (cur.rowCount === 0) throw new NotFoundError('partner not found');
    if (cur.rows[0].role !== 'partner') throw new ConflictError('not a partner', 'NOT_A_PARTNER');
    const before = {
      cap_tenants: cur.rows[0].cap_tenants,
      cap_users_per_tenant: cur.rows[0].cap_users_per_tenant,
      cap_admins_per_tenant: cur.rows[0].cap_admins_per_tenant,
      cap_documentali_per_tenant: cur.rows[0].cap_documentali_per_tenant,
      cap_branches_per_tenant: cur.rows[0].cap_branches_per_tenant,
    };
    const pick = <K extends keyof typeof before>(k: K): number | null =>
      k in b ? ((b as Record<string, number | null | undefined>)[k] ?? null) : before[k];
    const next = {
      cap_tenants: pick('cap_tenants'),
      cap_users_per_tenant: pick('cap_users_per_tenant'),
      cap_admins_per_tenant: pick('cap_admins_per_tenant'),
      cap_documentali_per_tenant: pick('cap_documentali_per_tenant'),
      cap_branches_per_tenant: pick('cap_branches_per_tenant'),
    };
    await adminPool.query(
      `UPDATE partnership_members
          SET cap_tenants = $2, cap_users_per_tenant = $3, cap_admins_per_tenant = $4,
              cap_documentali_per_tenant = $5, cap_branches_per_tenant = $6, updated_at = now()
        WHERE user_id = $1`,
      [
        userId,
        next.cap_tenants,
        next.cap_users_per_tenant,
        next.cap_admins_per_tenant,
        next.cap_documentali_per_tenant,
        next.cap_branches_per_tenant,
      ]
    );
    await logPartnershipAudit({
      actorUserId: p.userId,
      actorRole: p.role,
      action: 'partner.update_caps',
      targetType: 'partner',
      targetId: userId,
      targetLabel: cur.rows[0].email,
      before,
      after: next,
      ...auditCtx(req),
    });
    ok(res, { user_id: userId, caps: next });
  })
);

// ---- PATCH /partners/:userId — edit reseller name + note (admin) -----------
const PartnerProfile = z
  .object({
    partner_name: z.string().trim().max(200).transform(emptyToNull).nullable().optional(),
    note: z.string().trim().max(2000).transform(emptyToNull).nullable().optional(),
  })
  .refine((d) => 'partner_name' in d || 'note' in d, { message: 'nothing to update' });

partnershipRouter.patch(
  '/partners/:userId',
  requirePartnershipAdmin,
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const userId = String(req.params.userId);
    if (!UUID_RE.test(userId)) throw new ValidationError('invalid user id');
    const parse = PartnerProfile.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;

    const cur = await adminPool.query(
      `SELECT au.email, pm.role, pm.partner_name, pm.note
         FROM partnership_members pm JOIN auth_users au ON au.id = pm.user_id
        WHERE pm.user_id = $1`,
      [userId]
    );
    if (cur.rowCount === 0) throw new NotFoundError('partner not found');
    if (cur.rows[0].role !== 'partner') throw new ConflictError('not a partner', 'NOT_A_PARTNER');
    const before = { partner_name: cur.rows[0].partner_name, note: cur.rows[0].note };
    const next = {
      partner_name: 'partner_name' in b ? (b.partner_name ?? null) : before.partner_name,
      note: 'note' in b ? (b.note ?? null) : before.note,
    };
    await adminPool.query(
      `UPDATE partnership_members SET partner_name = $2, note = $3, updated_at = now() WHERE user_id = $1`,
      [userId, next.partner_name, next.note]
    );
    await logPartnershipAudit({
      actorUserId: p.userId,
      actorRole: p.role,
      action: 'partner.update_profile',
      targetType: 'partner',
      targetId: userId,
      targetLabel: cur.rows[0].email,
      before,
      after: next,
      ...auditCtx(req),
    });
    ok(res, { user_id: userId, partner_name: next.partner_name, note: next.note });
  })
);

// ---- POST /partners/:userId/{activate,deactivate} --------------------------
function partnerToggle(action: 'partner.activate' | 'partner.deactivate', active: boolean) {
  return asyncHandler(async (req: Request, res) => {
    const p = partner(req);
    const userId = String(req.params.userId);
    if (!UUID_RE.test(userId)) throw new ValidationError('invalid user id');
    const cur = await adminPool.query(
      `SELECT au.email, pm.role FROM partnership_members pm
         JOIN auth_users au ON au.id = pm.user_id WHERE pm.user_id = $1`,
      [userId]
    );
    if (cur.rowCount === 0) throw new NotFoundError('partner not found');
    if (cur.rows[0].role !== 'partner') throw new ConflictError('not a partner', 'NOT_A_PARTNER');
    await adminPool.query(
      `UPDATE partnership_members SET active = $2, updated_at = now() WHERE user_id = $1`,
      [userId, active]
    );
    await logPartnershipAudit({
      actorUserId: p.userId,
      actorRole: p.role,
      action,
      targetType: 'partner',
      targetId: userId,
      targetLabel: cur.rows[0].email,
      after: { active },
      ...auditCtx(req),
    });
    ok(res, { user_id: userId, active });
  });
}
partnershipRouter.post('/partners/:userId/deactivate', requirePartnershipAdmin, partnerToggle('partner.deactivate', false));
partnershipRouter.post('/partners/:userId/activate', requirePartnershipAdmin, partnerToggle('partner.activate', true));

// ---- POST /partners/:userId/resend — resend the invite/set-password email ---
partnershipRouter.post(
  '/partners/:userId/resend',
  requirePartnershipAdmin,
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const userId = String(req.params.userId);
    if (!UUID_RE.test(userId)) throw new ValidationError('invalid user id');
    const cur = await adminPool.query(
      `SELECT au.email, pm.role FROM partnership_members pm
         JOIN auth_users au ON au.id = pm.user_id WHERE pm.user_id = $1`,
      [userId]
    );
    if (cur.rowCount === 0) throw new NotFoundError('partner not found');
    if (cur.rows[0].role !== 'partner') throw new ConflictError('not a partner', 'NOT_A_PARTNER');
    const email = cur.rows[0].email as string;
    await triggerRecovery(email);
    await logPartnershipAudit({
      actorUserId: p.userId,
      actorRole: p.role,
      action: 'partner.resend',
      targetType: 'partner',
      targetId: userId,
      targetLabel: email,
      after: { email },
      ...auditCtx(req),
    });
    ok(res, { user_id: userId, email });
  })
);

// ---- GET /audit ------------------------------------------------------------
// admin → all entries; partner → only their own actions.
partnershipRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const params: unknown[] = [];
    let scope = '';
    if (p.role === 'partner') {
      params.push(p.userId);
      scope = 'WHERE al.actor_user_id = $1';
    }
    params.push(limit, offset);
    const r = await adminPool.query(
      `SELECT al.id, al.actor_user_id, au.email AS actor_email, al.actor_role, al.action,
              al.target_type, al.target_id, al.target_label, al.before, al.after,
              al.ip, al.created_at
         FROM partnership_audit_log al
         LEFT JOIN auth_users au ON au.id = al.actor_user_id
         ${scope}
        ORDER BY al.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    ok(res, { entries: r.rows });
  })
);
