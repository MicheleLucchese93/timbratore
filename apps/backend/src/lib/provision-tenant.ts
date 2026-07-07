import { adminPool } from './admin-db.js';
import { env } from '../env.js';
import { createLogger } from './logger.js';
import { ensureAuthUser } from './auth-users.js';

const logger = createLogger('provision-tenant');

export interface ProvisionTenantParams {
  ragioneSociale: string;
  adminEmail: string;
  adminFirstName?: string | null;
  adminLastName?: string | null;
  language?: 'it' | 'en';
  maxAdmins?: number | null;
  maxUsers?: number | null;
  maxBranches?: number | null;
  maxDocumentali?: number | null;
  // Enable the Cantieri module at birth (default false). Permission (partner
  // may_enable_cantieri cap) is enforced by the caller, not here.
  cantieriEnabled?: boolean;
  // Partner who provisioned this tenant (null = created by a platform admin / the
  // old internal route). Drives the partner's "see only my own tenants" scope.
  createdByPartner?: string | null;
}

export interface ProvisionTenantResult {
  tenantId: string;
  ragioneSociale: string;
  admin: { userId: string; email: string; role: 'admin'; membershipId: string };
  // true → a brand-new GoTrue account was created for the admin; false → the
  // admin's email already had an account that was reused. Sending the access
  // email (invite vs reset) is the caller's job via sendAccessEmail.
  adminCreated: boolean;
  limits: { maxAdmins: number; maxUsers: number; maxBranches: number; maxDocumentali: number };
}

// Create a brand-new tenant and seed its first admin. Shared by the internal
// provisioning route (PROVISION_SECRET) and the partnership API.
//
// Flow: INSERT tenants → ensure the admin's GoTrue/mirror user → INSERT an admin
// membership. Runs on adminPool (bypasses RLS — there is no tenant context yet).
// GoTrue user creation is NOT part of the PG transaction (it can't be): if the
// invite succeeds but a later INSERT fails, the rollback drops the tenant while
// the GoTrue user lingers — its id is logged for manual cleanup.
export async function provisionTenant(p: ProvisionTenantParams): Promise<ProvisionTenantResult> {
  const email = p.adminEmail.trim().toLowerCase();
  const language = p.language ?? 'it';
  const client = await adminPool.connect();
  let orphanGoTrueUserId: string | null = null;
  try {
    await client.query('BEGIN');

    const t = await client.query(
      `INSERT INTO tenants
         (ragione_sociale, language, max_admins, max_users, max_branches, max_documentali,
          cantieri_enabled, created_by_partner)
       VALUES ($1, $2, COALESCE($3, 2), COALESCE($4, 20), COALESCE($5, 3), COALESCE($6, 1), $7, $8)
       RETURNING id, max_admins, max_users, max_branches, max_documentali`,
      [
        p.ragioneSociale,
        language,
        p.maxAdmins ?? null,
        p.maxUsers ?? null,
        p.maxBranches ?? null,
        p.maxDocumentali ?? null,
        p.cantieriEnabled ?? false,
        p.createdByPartner ?? null,
      ]
    );
    const tenantId = t.rows[0].id as string;

    const u = await ensureAuthUser(client, {
      email,
      firstName: p.adminFirstName ?? null,
      lastName: p.adminLastName ?? null,
      language,
    });
    // A brand-new account in PROD means a GoTrue user now exists outside this PG
    // transaction — track it so a later rollback can flag it for cleanup.
    if (u.created && !env.DEV_AUTH_ENABLED) orphanGoTrueUserId = u.userId;

    const mem = await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (tenant_id, user_id) DO UPDATE
         SET role = 'admin', active = TRUE, deleted_at = NULL
       RETURNING id`,
      [tenantId, u.userId]
    );

    await client.query('COMMIT');
    logger.info(
      {
        tenant_id: tenantId,
        user_id: u.userId,
        email,
        admin_created: u.created,
        created_by_partner: p.createdByPartner ?? null,
      },
      'tenant provisioned'
    );
    return {
      tenantId,
      ragioneSociale: p.ragioneSociale,
      admin: { userId: u.userId, email, role: 'admin', membershipId: mem.rows[0].id },
      adminCreated: u.created,
      limits: {
        maxAdmins: t.rows[0].max_admins,
        maxUsers: t.rows[0].max_users,
        maxBranches: t.rows[0].max_branches,
        maxDocumentali: t.rows[0].max_documentali,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    if (orphanGoTrueUserId) {
      logger.error(
        { orphan_gotrue_user_id: orphanGoTrueUserId, email },
        'provisioning failed after GoTrue user create — orphan auth user left behind, clean up manually'
      );
    }
    throw err;
  } finally {
    client.release();
  }
}
