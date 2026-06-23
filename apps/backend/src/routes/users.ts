import { Router, raw } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';
import type { PoolClient } from 'pg';
import { authenticate, requireAdmin, invalidateMembershipCache } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/index.js';
import { createUserSilently, triggerRecovery } from '../lib/gotrue-admin.js';
import { env } from '../env.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('users');

export const usersRouter = Router();
usersRouter.use(authenticate);

function buildDisplayName(first?: string | null, last?: string | null): string | null {
  const v = [first, last].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
  return v || null;
}

interface TenantLimits {
  max_admins: number;
  max_users: number;
  max_documentali: number;
}

interface MembershipCounts {
  admins: number;
  documentali: number;
  total: number;
}

async function fetchLimits(
  client: PoolClient
): Promise<{ limits: TenantLimits; counts: MembershipCounts }> {
  const tenant = await client.query(
    `SELECT max_admins, max_users, max_documentali FROM tenants WHERE id = current_setting('app.current_tenant_id')::uuid`
  );
  const counts = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE role = 'admin' AND deleted_at IS NULL) AS admins,
       COUNT(*) FILTER (WHERE is_documentale AND deleted_at IS NULL) AS documentali,
       COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total
     FROM memberships
     WHERE tenant_id = current_setting('app.current_tenant_id')::uuid`
  );
  return {
    limits: tenant.rows[0],
    counts: {
      admins: Number(counts.rows[0].admins),
      documentali: Number(counts.rows[0].documentali),
      total: Number(counts.rows[0].total),
    },
  };
}

usersRouter.get(
  '/',
  requireAdmin,
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT m.id AS membership_id, m.user_id, m.role, m.active, m.created_at,
              m.stamp_modes, m.is_documentale,
              m.codice_fiscale, m.matricola, m.inail, m.qualifica, m.qualifica2,
              COALESCE(au.email, m.user_id::text) AS email,
              au.first_name, au.last_name, au.display_name,
              (SELECT MAX(occurred_at) FROM stamps s
                WHERE s.user_id = m.user_id AND s.deleted_at IS NULL) AS last_stamp_at,
              COALESCE(
                (SELECT array_agg(bm.branch_id)
                   FROM branch_memberships bm
                  WHERE bm.user_id = m.user_id
                    AND bm.tenant_id = current_setting('app.current_tenant_id')::uuid),
                ARRAY[]::uuid[]
              ) AS branch_ids
       FROM memberships m
       LEFT JOIN auth_users au ON au.id = m.user_id
       WHERE m.deleted_at IS NULL
       ORDER BY m.created_at DESC`
    );
    ok(res, r.rows);
  })
);

const NameField = z
  .string()
  .trim()
  .max(80)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable();

// Anagrafica field: trim, cap length, empty → null (so admins can clear it).
const AnagraficaField = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable();

// Matricola: up to 4 digits, empty → null.
const MatricolaField = z
  .string()
  .trim()
  .max(4)
  .regex(/^\d*$/, 'matricola: solo cifre')
  .transform((v) => (v.length === 0 ? null : v))
  .nullable();

// Centro Paghe payroll anagrafica columns stored on the membership row.
const MEMBERSHIP_ANAGRAFICA = [
  'codice_fiscale',
  'matricola',
  'inail',
  'qualifica',
  'qualifica2',
] as const;

// Shared anagrafica shape — settable at invite and patchable later.
const anagraficaShape = {
  codice_fiscale: AnagraficaField(16).optional(),
  matricola: MatricolaField.optional(),
  inail: AnagraficaField(1).optional(),
  qualifica: AnagraficaField(1).optional(),
  qualifica2: AnagraficaField(1).optional(),
};

const Invite = z.object({
  email: z.string().email(),
  first_name: NameField.optional(),
  last_name: NameField.optional(),
  role: z.enum(['admin', 'user']).default('user'),
  // Additive "Documentale" capability (independent of role): may upload + OTP-
  // view every employee's documents. Capped per tenant by max_documentali.
  is_documentale: z.boolean().default(false),
  // Language for the member's emails (reset password etc.). Omitted → tenant
  // locale (resolved in ensureAuthUser).
  language: z.enum(['it', 'en']).optional(),
  branch_ids: z.array(z.string().uuid()).optional(),
  // Send the GoTrue recovery ("set your password") email right after creating
  // the user, so the admin doesn't have to trigger it separately. Default on.
  send_reset_email: z.boolean().default(true),
  ...anagraficaShape,
});

interface InviteInput {
  email: string;
  role: 'admin' | 'user';
  is_documentale?: boolean;
  language?: 'it' | 'en';
  first_name?: string | null;
  last_name?: string | null;
  branch_ids?: string[];
  codice_fiscale?: string | null;
  matricola?: string | null;
  inail?: string | null;
  qualifica?: string | null;
  qualifica2?: string | null;
}

interface InviteOutcome {
  user_id: string;
  email: string;
  membership: Record<string, unknown>;
  created_user: boolean;
  added_member: boolean;
  was_active_already: boolean;
}

async function ensureAuthUser(
  client: PoolClient,
  email: string,
  first_name?: string | null,
  last_name?: string | null,
  language?: 'it' | 'en'
): Promise<{ userId: string; created: boolean }> {
  const existing = await client.query(
    `SELECT id, first_name, last_name FROM auth_users WHERE email = $1`,
    [email]
  );
  if (existing.rowCount && existing.rows[0]) {
    const row = existing.rows[0];
    const userId = row.id as string;
    const nextFirst = first_name === undefined ? row.first_name : first_name;
    const nextLast = last_name === undefined ? row.last_name : last_name;
    const display = buildDisplayName(nextFirst, nextLast);
    if (first_name !== undefined || last_name !== undefined) {
      await client.query(
        `UPDATE auth_users
            SET first_name = $2,
                last_name = $3,
                display_name = $4
          WHERE id = $1`,
        [userId, nextFirst, nextLast, display]
      );
    }
    return { userId, created: false };
  }

  const display = buildDisplayName(first_name, last_name);
  let userId: string;
  if (env.NODE_ENV === 'production' || env.GOTRUE_URL.startsWith('http')) {
    try {
      // Create silently — no invite/welcome email. An admin sends the initial
      // access mail later via the reset-password (recovery) flow. Seed the
      // member's language so that recovery mail renders in the right language
      // (GoTrue reads it from user_metadata.language): use the explicit choice
      // from the invite form, else fall back to the tenant locale.
      let lang: 'it' | 'en' = language ?? 'it';
      if (!language) {
        const tenantLang = await client.query(
          `SELECT language FROM tenants WHERE id = current_setting('app.current_tenant_id')::uuid`
        );
        lang = tenantLang.rows[0]?.language === 'en' ? 'en' : 'it';
      }
      const created = await createUserSilently(email, lang);
      userId = created.id;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, email },
        'GoTrue create failed; falling back to mirror-only insert'
      );
      userId = uuidv4();
    }
  } else {
    userId = uuidv4();
  }
  await client.query(
    `INSERT INTO auth_users(id, email, first_name, last_name, display_name, created_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email,
           first_name = COALESCE(EXCLUDED.first_name, auth_users.first_name),
           last_name = COALESCE(EXCLUDED.last_name, auth_users.last_name),
           display_name = COALESCE(EXCLUDED.display_name, auth_users.display_name)`,
    [userId, email, first_name ?? null, last_name ?? null, display]
  );
  return { userId, created: true };
}

async function performInvite(client: PoolClient, inv: InviteInput): Promise<InviteOutcome> {
  const { userId, created } = await ensureAuthUser(
    client,
    inv.email,
    inv.first_name,
    inv.last_name,
    inv.language
  );
  const existing = await client.query(
    `SELECT id, active, deleted_at FROM memberships
     WHERE tenant_id = current_setting('app.current_tenant_id')::uuid AND user_id = $1`,
    [userId]
  );
  let membership: Record<string, unknown>;
  let addedMember: boolean;
  let wasActiveAlready = false;
  if (existing.rowCount && existing.rows[0]) {
    const ex = existing.rows[0];
    if (ex.active && !ex.deleted_at) {
      const upd = await client.query(
        `UPDATE memberships SET role = $1, is_documentale = $3 WHERE id = $2 RETURNING *`,
        [inv.role, ex.id, inv.is_documentale ?? false]
      );
      membership = upd.rows[0];
      addedMember = false;
      wasActiveAlready = true;
    } else {
      // Reactivating a former member: only overwrite anagrafica the admin
      // re-supplied (COALESCE) — don't wipe what was there before.
      const upd = await client.query(
        `UPDATE memberships
         SET role = $1, active = TRUE, deleted_at = NULL,
             is_documentale = $8,
             codice_fiscale = COALESCE($3, codice_fiscale),
             matricola = COALESCE($4, matricola),
             inail = COALESCE($5, inail),
             qualifica = COALESCE($6, qualifica),
             qualifica2 = COALESCE($7, qualifica2)
         WHERE id = $2 RETURNING *`,
        [
          inv.role,
          ex.id,
          inv.codice_fiscale ?? null,
          inv.matricola ?? null,
          inv.inail ?? null,
          inv.qualifica ?? null,
          inv.qualifica2 ?? null,
          inv.is_documentale ?? false,
        ]
      );
      membership = upd.rows[0];
      addedMember = true;
    }
  } else {
    const ins = await client.query(
      `INSERT INTO memberships(tenant_id, user_id, role, is_documentale, codice_fiscale, matricola, inail, qualifica, qualifica2)
       VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        userId,
        inv.role,
        inv.is_documentale ?? false,
        inv.codice_fiscale ?? null,
        inv.matricola ?? null,
        inv.inail ?? null,
        inv.qualifica ?? null,
        inv.qualifica2 ?? null,
      ]
    );
    membership = ins.rows[0];
    addedMember = true;
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
  return {
    user_id: userId,
    email: inv.email,
    membership,
    created_user: created,
    added_member: addedMember,
    was_active_already: wasActiveAlready,
  };
}

usersRouter.post(
  '/invite',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = Invite.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const inv = parse.data;
    const { limits, counts } = await fetchLimits(client);
    if (counts.total >= limits.max_users) {
      throw new ConflictError(
        `User limit reached: ${counts.total}/${limits.max_users}`,
        'LIMIT_REACHED',
        { kind: 'users', current: counts.total, limit: limits.max_users }
      );
    }
    if (inv.role === 'admin' && counts.admins >= limits.max_admins) {
      throw new ConflictError(
        `Admin limit reached: ${counts.admins}/${limits.max_admins}`,
        'LIMIT_REACHED',
        { kind: 'admins', current: counts.admins, limit: limits.max_admins }
      );
    }
    if (inv.is_documentale && counts.documentali >= limits.max_documentali) {
      throw new ConflictError(
        `Documentale limit reached: ${counts.documentali}/${limits.max_documentali}`,
        'LIMIT_REACHED',
        { kind: 'documentali', current: counts.documentali, limit: limits.max_documentali }
      );
    }

    const existingUser = await client.query(`SELECT id FROM auth_users WHERE email = $1`, [
      inv.email,
    ]);
    if (existingUser.rowCount) {
      const m = await client.query(
        `SELECT active, deleted_at FROM memberships
         WHERE tenant_id = current_setting('app.current_tenant_id')::uuid AND user_id = $1`,
        [existingUser.rows[0].id]
      );
      if (m.rowCount && m.rows[0].active && !m.rows[0].deleted_at) {
        throw new ConflictError('User already a member of this tenant', 'CONFLICT');
      }
    }

    const outcome = await performInvite(client, inv);
    await emitAudit(client, 'user.invite', outcome.user_id, null, {
      email: inv.email,
      role: inv.role,
    });
    // Optionally give the new member their first access immediately by sending
    // the GoTrue recovery ("set your password") email. triggerRecovery swallows
    // its own network errors, so email_sent reflects the attempt — consistent
    // with the standalone reset-password endpoint.
    let emailSent = false;
    if (inv.send_reset_email) {
      await triggerRecovery(inv.email);
      await emitAudit(client, 'user.reset_password', outcome.user_id, null, {
        email: inv.email,
      });
      emailSent = true;
    }
    invalidateMembershipCache(outcome.user_id);
    ok(
      res,
      {
        user_id: outcome.user_id,
        email: inv.email,
        membership: outcome.membership,
        email_sent: emailSent,
      },
      201
    );
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

// Admin-triggered password reset: re-sends the GoTrue recovery email so a
// member who lost their invite / forgot their password can set a new one.
// Scoped to the caller's tenant — can only target an existing member.
usersRouter.post(
  '/:id/reset-password',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT au.email
         FROM memberships m
         JOIN auth_users au ON au.id = m.user_id
        WHERE m.user_id = $1
          AND m.tenant_id = current_setting('app.current_tenant_id')::uuid
          AND m.deleted_at IS NULL`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('user');
    const email = r.rows[0].email as string | null;
    if (!email) throw new ValidationError('user has no email on file');
    await triggerRecovery(email);
    await emitAudit(client, 'user.reset_password', String(req.params.id), null, { email });
    ok(res, { sent: true, email });
  })
);

const PatchUser = z.object({
  role: z.enum(['admin', 'user']).optional(),
  // Additive "Documentale" capability toggle (capped by max_documentali).
  is_documentale: z.boolean().optional(),
  // Allowed clock-in methods. Empty array = user cannot clock in.
  // 'wifi' is not yet implemented, so it is rejected here for now.
  stamp_modes: z.array(z.enum(['gps', 'remote'])).max(2).optional(),
  first_name: NameField.optional(),
  last_name: NameField.optional(),
  // Centro Paghe payroll anagrafica (stored on the membership).
  ...anagraficaShape,
});

usersRouter.patch(
  '/:id',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = PatchUser.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    // An admin must not be able to demote their own account: doing so would
    // strip their admin access with no way back in. Block self role changes
    // outright (stricter than the previous last-admin-only guard).
    if (parse.data.role === 'user' && req.params.id === req.user!.id) {
      throw new ForbiddenError('Admins cannot change their own role', 'SELF_ROLE_CHANGE');
    }
    if (parse.data.role === 'admin') {
      const cur = await client.query(
        `SELECT role FROM memberships WHERE user_id = $1 AND deleted_at IS NULL`,
        [req.params.id]
      );
      if (cur.rowCount && cur.rows[0].role !== 'admin') {
        const { limits, counts } = await fetchLimits(client);
        if (counts.admins >= limits.max_admins) {
          throw new ConflictError(
            `Admin limit reached: ${counts.admins}/${limits.max_admins}`,
            'LIMIT_REACHED',
            { kind: 'admins', current: counts.admins, limit: limits.max_admins }
          );
        }
      }
    }
    // Enforce the per-tenant Documentale cap only when ENABLING the capability on
    // a member that doesn't already have it (turning it off is always allowed).
    if (parse.data.is_documentale === true) {
      const cur = await client.query(
        `SELECT is_documentale FROM memberships WHERE user_id = $1 AND deleted_at IS NULL`,
        [req.params.id]
      );
      if (cur.rowCount && cur.rows[0].is_documentale !== true) {
        const { limits, counts } = await fetchLimits(client);
        if (counts.documentali >= limits.max_documentali) {
          throw new ConflictError(
            `Documentale limit reached: ${counts.documentali}/${limits.max_documentali}`,
            'LIMIT_REACHED',
            { kind: 'documentali', current: counts.documentali, limit: limits.max_documentali }
          );
        }
      }
    }
    const setClauses = [
      'role = COALESCE($2, role)',
      'stamp_modes = COALESCE($3::text[], stamp_modes)',
      'is_documentale = COALESCE($4, is_documentale)',
    ];
    const values: unknown[] = [
      req.params.id,
      parse.data.role ?? null,
      parse.data.stamp_modes ?? null,
      parse.data.is_documentale ?? null,
    ];
    let idx = 5;
    for (const col of MEMBERSHIP_ANAGRAFICA) {
      // undefined = leave unchanged; null/value = set (allows clearing).
      if (parse.data[col] !== undefined) {
        setClauses.push(`${col} = $${idx++}`);
        values.push(parse.data[col]);
      }
    }
    const r = await client.query(
      `UPDATE memberships
       SET ${setClauses.join(', ')}
       WHERE user_id = $1 AND deleted_at IS NULL
       RETURNING *`,
      values
    );
    if (r.rowCount === 0) throw new NotFoundError('user');

    if (parse.data.first_name !== undefined || parse.data.last_name !== undefined) {
      const cur = await client.query(
        `SELECT first_name, last_name FROM auth_users WHERE id = $1`,
        [req.params.id]
      );
      const curRow = cur.rows[0] ?? { first_name: null, last_name: null };
      const newFirst =
        parse.data.first_name !== undefined ? parse.data.first_name : curRow.first_name;
      const newLast =
        parse.data.last_name !== undefined ? parse.data.last_name : curRow.last_name;
      const display = buildDisplayName(newFirst, newLast);
      await client.query(
        `UPDATE auth_users SET first_name = $2, last_name = $3, display_name = $4 WHERE id = $1`,
        [req.params.id, newFirst, newLast, display]
      );
    }

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

const SetBranches = z.object({ branch_ids: z.array(z.string().uuid()) });

usersRouter.put(
  '/:id/branches',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = SetBranches.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const membership = await client.query(
      `SELECT 1 FROM memberships
        WHERE user_id = $1
          AND tenant_id = current_setting('app.current_tenant_id')::uuid
          AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (membership.rowCount === 0) throw new NotFoundError('user');
    if (parse.data.branch_ids.length > 0) {
      const valid = await client.query(
        `SELECT id FROM branches
          WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [parse.data.branch_ids]
      );
      if (valid.rowCount !== parse.data.branch_ids.length) {
        throw new ValidationError('one or more branch_ids invalid');
      }
    }
    await client.query(
      `DELETE FROM branch_memberships
        WHERE user_id = $1
          AND tenant_id = current_setting('app.current_tenant_id')::uuid`,
      [req.params.id]
    );
    for (const bId of parse.data.branch_ids) {
      await client.query(
        `INSERT INTO branch_memberships(branch_id, user_id, tenant_id)
         VALUES ($1, $2, current_setting('app.current_tenant_id')::uuid)`,
        [bId, req.params.id]
      );
    }
    await emitAudit(client, 'user.set_branches', String(req.params.id), null, {
      branch_ids: parse.data.branch_ids,
    });
    ok(res, { branch_ids: parse.data.branch_ids });
  })
);

const BulkBranches = z.object({
  user_ids: z.array(z.string().uuid()).min(1),
  branch_ids: z.array(z.string().uuid()).min(1),
  mode: z.enum(['add', 'remove']),
});

usersRouter.post(
  '/branches/bulk',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = BulkBranches.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const { user_ids, branch_ids, mode } = parse.data;

    const validUsers = await client.query(
      `SELECT user_id FROM memberships
        WHERE user_id = ANY($1::uuid[])
          AND tenant_id = current_setting('app.current_tenant_id')::uuid
          AND deleted_at IS NULL`,
      [user_ids]
    );
    if (validUsers.rowCount !== user_ids.length) {
      throw new ValidationError('one or more user_ids invalid');
    }

    const validBranches = await client.query(
      `SELECT id FROM branches
        WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [branch_ids]
    );
    if (validBranches.rowCount !== branch_ids.length) {
      throw new ValidationError('one or more branch_ids invalid');
    }

    if (mode === 'add') {
      await client.query(
        `INSERT INTO branch_memberships(branch_id, user_id, tenant_id)
         SELECT b.id, u.id, current_setting('app.current_tenant_id')::uuid
           FROM UNNEST($1::uuid[]) AS u(id)
           CROSS JOIN UNNEST($2::uuid[]) AS b(id)
         ON CONFLICT DO NOTHING`,
        [user_ids, branch_ids]
      );
    } else {
      await client.query(
        `DELETE FROM branch_memberships
          WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
            AND user_id = ANY($1::uuid[])
            AND branch_id = ANY($2::uuid[])`,
        [user_ids, branch_ids]
      );
    }

    for (const uid of user_ids) {
      await emitAudit(client, `user.branches.bulk_${mode}`, uid, null, { branch_ids });
      invalidateMembershipCache(uid);
    }
    ok(res, { user_ids, branch_ids, mode });
  })
);

usersRouter.delete(
  '/:id',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    if (req.params.id === req.user!.id) {
      throw new ConflictError('Cannot delete your own account', 'SELF_DELETE');
    }
    const target = await client.query(
      `SELECT role FROM memberships
        WHERE user_id = $1
          AND tenant_id = current_setting('app.current_tenant_id')::uuid
          AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (target.rowCount === 0) throw new NotFoundError('user');
    if (target.rows[0].role === 'admin') {
      const others = await client.query(
        `SELECT COUNT(*) AS n FROM memberships
          WHERE role = 'admin'
            AND deleted_at IS NULL
            AND tenant_id = current_setting('app.current_tenant_id')::uuid
            AND user_id != $1`,
        [req.params.id]
      );
      if (Number(others.rows[0].n) === 0) {
        throw new ConflictError('Cannot delete last admin', 'LAST_ADMIN');
      }
    }
    await client.query(
      `DELETE FROM branch_memberships
        WHERE user_id = $1
          AND tenant_id = current_setting('app.current_tenant_id')::uuid`,
      [req.params.id]
    );
    const r = await client.query(
      `UPDATE memberships
          SET deleted_at = now(), active = FALSE
        WHERE user_id = $1
          AND tenant_id = current_setting('app.current_tenant_id')::uuid
          AND deleted_at IS NULL
        RETURNING *`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('user');
    // Cascade approver links: a deleted member must not stay wired as anyone's
    // approver (orphans pending requests) nor keep their own approver rows.
    await client.query(
      `DELETE FROM leave_approvers
        WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
          AND (user_id = $1 OR approver_user_id = $1)`,
      [req.params.id]
    );
    await client.query(
      `DELETE FROM correction_approvers
        WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
          AND (user_id = $1 OR approver_user_id = $1)`,
      [req.params.id]
    );
    await emitAudit(client, 'user.delete', String(req.params.id), null, null);
    invalidateMembershipCache(String(req.params.id));
    ok(res, { deleted: true });
  })
);

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXPORT_COLUMNS: Array<{ header: string; key: string; width: number }> = [
  { header: 'Email', key: 'email', width: 32 },
  { header: 'Nome', key: 'first_name', width: 18 },
  { header: 'Cognome', key: 'last_name', width: 22 },
  { header: 'Ruolo', key: 'role', width: 12 },
  { header: 'Stato', key: 'stato', width: 14 },
  { header: 'Metodi timbratura', key: 'stamp_modes', width: 22 },
  { header: 'Ultima timbratura', key: 'last_stamp_at', width: 22 },
];

// Round-trippable with parseStampModes: export labels are re-parsed on import.
function formatStampModes(modes: string[] | null | undefined): string {
  const m = modes ?? [];
  if (m.length === 0) return 'Nessuno';
  return m.map((x) => (x === 'gps' ? 'GPS' : x === 'remote' ? 'Da remoto' : x)).join(', ');
}

usersRouter.get(
  '/export.xlsx',
  requireAdmin,
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT m.role, m.active, m.stamp_modes,
              COALESCE(au.email, m.user_id::text) AS email,
              au.first_name, au.last_name,
              (SELECT MAX(occurred_at) FROM stamps s
                WHERE s.user_id = m.user_id AND s.deleted_at IS NULL) AS last_stamp_at
         FROM memberships m
         LEFT JOIN auth_users au ON au.id = m.user_id
        WHERE m.deleted_at IS NULL
        ORDER BY au.last_name NULLS LAST, au.first_name NULLS LAST, au.email`
    );
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Utenti');
    ws.columns = EXPORT_COLUMNS;
    ws.getRow(1).font = { bold: true };
    for (const row of r.rows) {
      ws.addRow({
        email: row.email,
        first_name: row.first_name ?? '',
        last_name: row.last_name ?? '',
        role: row.role === 'admin' ? 'admin' : 'utente',
        stato: row.active ? 'attivo' : 'disattivato',
        stamp_modes: formatStampModes(row.stamp_modes),
        last_stamp_at: row.last_stamp_at
          ? new Date(row.last_stamp_at).toISOString()
          : '',
      });
    }
    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="utenti_${today}.xlsx"`);
    res.send(Buffer.from(buf));
  })
);

interface ImportRow {
  rowNumber: number;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role: 'admin' | 'user';
  // undefined = column absent or blank → leave membership.stamp_modes unchanged.
  stamp_modes?: Array<'gps' | 'remote'>;
}

function normalizeRole(raw: unknown): 'admin' | 'user' | null {
  if (raw === null || raw === undefined) return 'user';
  const v = String(raw).trim().toLowerCase();
  if (v === '') return 'user';
  if (v === 'admin' || v === 'amministratore') return 'admin';
  if (v === 'user' || v === 'utente') return 'user';
  return null;
}

// Parse the "Metodi timbratura" cell. '' → undefined (leave unchanged);
// 'nessuno'/'none'/'-' → [] (cannot stamp); else a list of gps/remote.
// Returns 'invalid' on an unrecognised token.
function parseStampModes(raw: string): Array<'gps' | 'remote'> | undefined | 'invalid' {
  const s = raw.trim().toLowerCase();
  if (s === '') return undefined;
  if (s === 'nessuno' || s === 'none' || s === '-') return [];
  const out = new Set<'gps' | 'remote'>();
  for (const tk of s.split(/[,;/]+/).map((t) => t.trim()).filter(Boolean)) {
    if (tk === 'gps') out.add('gps');
    else if (tk === 'remote' || tk === 'remoto' || tk === 'da remoto') out.add('remote');
    else return 'invalid';
  }
  return [...out];
}

function cellString(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('text' in o) return String(o.text ?? '').trim();
    if ('richText' in o) {
      const parts = o.richText as Array<{ text: string }>;
      return parts.map((p) => p.text).join('').trim();
    }
  }
  return String(v).trim();
}

async function parseSheet(buf: Buffer): Promise<ImportRow[]> {
  const wb = new ExcelJS.Workbook();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buf as any);
  } catch (e) {
    throw new ValidationError(
      `Impossibile leggere il file Excel: ${(e as Error).message}`
    );
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ValidationError('Foglio Excel vuoto');

  const header = ws.getRow(1);
  const idx: Record<string, number> = {};
  header.eachCell((cell, col) => {
    const key = cellString(cell).toLowerCase();
    if (key) idx[key] = col;
  });
  const colEmail = idx['email'];
  if (!colEmail) {
    throw new ValidationError('Colonna "email" mancante nella prima riga');
  }
  const colNome = idx['nome'];
  const colCognome = idx['cognome'];
  const colRuolo = idx['ruolo'];
  const colModes = idx['metodi timbratura'] ?? idx['metodi'];

  const rows: ImportRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  const seen = new Set<string>();
  const lastRow = ws.actualRowCount;
  for (let i = 2; i <= lastRow; i += 1) {
    const r = ws.getRow(i);
    const email = cellString(r.getCell(colEmail)).toLowerCase();
    if (!email) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ row: i, message: `Email non valida: "${email}"` });
      continue;
    }
    if (seen.has(email)) {
      errors.push({ row: i, message: `Email duplicata nel foglio: ${email}` });
      continue;
    }
    seen.add(email);
    const ruoloRaw = colRuolo ? cellString(r.getCell(colRuolo)) : '';
    const role = normalizeRole(ruoloRaw);
    if (role === null) {
      errors.push({ row: i, message: `Ruolo non riconosciuto: "${ruoloRaw}"` });
      continue;
    }
    const first = colNome ? cellString(r.getCell(colNome)) : '';
    const last = colCognome ? cellString(r.getCell(colCognome)) : '';
    let stampModes: Array<'gps' | 'remote'> | undefined;
    if (colModes) {
      const rawModes = cellString(r.getCell(colModes));
      const parsed = parseStampModes(rawModes);
      if (parsed === 'invalid') {
        errors.push({ row: i, message: `Metodi timbratura non validi: "${rawModes}"` });
        continue;
      }
      stampModes = parsed;
    }
    rows.push({
      rowNumber: i,
      email,
      first_name: first || null,
      last_name: last || null,
      role,
      stamp_modes: stampModes,
    });
  }
  if (errors.length > 0) {
    throw new ValidationError('Errori nel file Excel', { errors });
  }
  return rows;
}

usersRouter.post(
  '/import',
  requireAdmin,
  raw({ type: '*/*', limit: '5mb' }),
  tenantHandler(async (req, res, client) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new ValidationError('File Excel mancante');
    }
    const rows = await parseSheet(body);
    if (rows.length === 0) {
      ok(res, { processed: 0, created: 0, updated: 0, reactivated: 0 });
      return;
    }

    let created = 0;
    let updated = 0;
    let reactivated = 0;
    for (const row of rows) {
      const outcome = await performInvite(client, {
        email: row.email,
        role: row.role,
        first_name: row.first_name === null ? undefined : row.first_name,
        last_name: row.last_name === null ? undefined : row.last_name,
      });
      if (outcome.was_active_already) updated += 1;
      else if (outcome.created_user) created += 1;
      else reactivated += 1;
      if (row.stamp_modes !== undefined) {
        await client.query(
          `UPDATE memberships SET stamp_modes = $2::text[]
            WHERE user_id = $1 AND deleted_at IS NULL`,
          [outcome.user_id, row.stamp_modes]
        );
      }
      await emitAudit(client, 'user.import', outcome.user_id, null, {
        email: row.email,
        role: row.role,
        row: row.rowNumber,
      });
      invalidateMembershipCache(outcome.user_id);
    }

    const { limits, counts } = await fetchLimits(client);
    if (counts.total > limits.max_users) {
      throw new ConflictError(
        `User limit reached: ${counts.total}/${limits.max_users}`,
        'LIMIT_REACHED',
        { kind: 'users', current: counts.total, limit: limits.max_users }
      );
    }
    if (counts.admins > limits.max_admins) {
      throw new ConflictError(
        `Admin limit reached: ${counts.admins}/${limits.max_admins}`,
        'LIMIT_REACHED',
        { kind: 'admins', current: counts.admins, limit: limits.max_admins }
      );
    }

    ok(res, { processed: rows.length, created, updated, reactivated });
  })
);

/* ----------------------- Approvers (leaves + corrections) ----------------------- */

const SetApprovers = z.object({ approver_user_ids: z.array(z.string().uuid()) });

const APPROVER_KINDS = {
  leave: { table: 'leave_approvers', auditAction: 'user.set_approvers' },
  correction: { table: 'correction_approvers', auditAction: 'user.set_correction_approvers' },
} as const;

async function getApprovers(
  client: PoolClient,
  kind: keyof typeof APPROVER_KINDS,
  userId: string
): Promise<unknown[]> {
  const { table } = APPROVER_KINDS[kind];
  const r = await client.query(
    `SELECT a.approver_user_id AS user_id,
            COALESCE(au.email, a.approver_user_id::text) AS email,
            au.display_name, m.role
       FROM ${table} a
       LEFT JOIN auth_users au ON au.id = a.approver_user_id
       LEFT JOIN memberships m
         ON m.user_id = a.approver_user_id
        AND m.tenant_id = current_setting('app.current_tenant_id')::uuid
        AND m.deleted_at IS NULL
      WHERE a.user_id = $1
      ORDER BY au.display_name NULLS LAST, au.email`,
    [userId]
  );
  return r.rows;
}

async function setApprovers(
  client: PoolClient,
  kind: keyof typeof APPROVER_KINDS,
  userId: string,
  ids: string[]
): Promise<void> {
  const { table, auditAction } = APPROVER_KINDS[kind];
  const member = await client.query(
    `SELECT 1 FROM memberships
      WHERE user_id = $1
        AND tenant_id = current_setting('app.current_tenant_id')::uuid
        AND deleted_at IS NULL`,
    [userId]
  );
  if (member.rowCount === 0) throw new NotFoundError('user');

  if (ids.length > 0) {
    const valid = await client.query(
      `SELECT user_id FROM memberships
        WHERE user_id = ANY($1::uuid[])
          AND tenant_id = current_setting('app.current_tenant_id')::uuid
          AND active = TRUE
          AND deleted_at IS NULL`,
      [ids]
    );
    if (valid.rowCount !== ids.length) {
      throw new ValidationError('uno o più approver non sono membri attivi del tenant');
    }
  }

  await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
  for (const aid of ids) {
    await client.query(
      `INSERT INTO ${table}(tenant_id, user_id, approver_user_id)
       VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2)`,
      [userId, aid]
    );
  }
  await emitAudit(client, auditAction, userId, null, { approver_user_ids: ids });
}

usersRouter.get(
  '/:id/approvers',
  tenantHandler(async (req, res, client) => {
    const userId = String(req.params.id);
    if (req.user!.role !== 'admin' && userId !== req.user!.id) {
      throw new ConflictError('forbidden', 'FORBIDDEN');
    }
    ok(res, await getApprovers(client, 'leave', userId));
  })
);

usersRouter.put(
  '/:id/approvers',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = SetApprovers.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const userId = String(req.params.id);
    const ids = Array.from(new Set(parse.data.approver_user_ids)).filter((x) => x !== userId);
    await setApprovers(client, 'leave', userId, ids);
    ok(res, { approver_user_ids: ids });
  })
);

usersRouter.get(
  '/:id/correction-approvers',
  tenantHandler(async (req, res, client) => {
    const userId = String(req.params.id);
    if (req.user!.role !== 'admin' && userId !== req.user!.id) {
      throw new ConflictError('forbidden', 'FORBIDDEN');
    }
    ok(res, await getApprovers(client, 'correction', userId));
  })
);

usersRouter.put(
  '/:id/correction-approvers',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = SetApprovers.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const userId = String(req.params.id);
    const ids = Array.from(new Set(parse.data.approver_user_ids)).filter((x) => x !== userId);
    await setApprovers(client, 'correction', userId, ids);
    ok(res, { approver_user_ids: ids });
  })
);

/* ----------------------- Bulk operations ----------------------- */

// Verify every id is a live member of the caller's tenant. Throws otherwise.
async function assertTenantMembers(client: PoolClient, userIds: string[]): Promise<void> {
  const valid = await client.query(
    `SELECT user_id FROM memberships
      WHERE user_id = ANY($1::uuid[])
        AND tenant_id = current_setting('app.current_tenant_id')::uuid
        AND deleted_at IS NULL`,
    [userIds]
  );
  if (valid.rowCount !== userIds.length) {
    throw new ValidationError('one or more user_ids invalid');
  }
}

const BulkResetPassword = z.object({
  user_ids: z.array(z.string().uuid()).min(1),
});

// Re-send the recovery (set-password) email to many members at once. This is
// the bulk counterpart of POST /:id/reset-password and the intended way to
// hand freshly-created users their initial access link.
usersRouter.post(
  '/reset-password/bulk',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = BulkResetPassword.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const r = await client.query(
      `SELECT m.user_id, au.email
         FROM memberships m
         JOIN auth_users au ON au.id = m.user_id
        WHERE m.user_id = ANY($1::uuid[])
          AND m.tenant_id = current_setting('app.current_tenant_id')::uuid
          AND m.deleted_at IS NULL`,
      [parse.data.user_ids]
    );
    let sent = 0;
    for (const row of r.rows) {
      if (!row.email) continue;
      // Sequential: GoTrue rate-limits /recover. triggerRecovery swallows
      // network errors so one bad address can't abort the batch.
      await triggerRecovery(row.email as string);
      await emitAudit(client, 'user.reset_password', String(row.user_id), null, {
        email: row.email,
        bulk: true,
      });
      sent += 1;
    }
    ok(res, { sent });
  })
);

const BulkModes = z.object({
  user_ids: z.array(z.string().uuid()).min(1),
  // Empty array = those users cannot clock in. Mirrors PATCH /:id.
  stamp_modes: z.array(z.enum(['gps', 'remote'])).max(2),
});

// Overwrite the allowed clock-in methods on many members at once.
usersRouter.post(
  '/stamp-modes/bulk',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = BulkModes.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const { user_ids, stamp_modes } = parse.data;
    const r = await client.query(
      `UPDATE memberships SET stamp_modes = $2::text[]
        WHERE user_id = ANY($1::uuid[])
          AND tenant_id = current_setting('app.current_tenant_id')::uuid
          AND deleted_at IS NULL
        RETURNING user_id`,
      [user_ids, stamp_modes]
    );
    for (const row of r.rows) {
      await emitAudit(client, 'user.update', String(row.user_id), null, { stamp_modes, bulk: true });
      invalidateMembershipCache(String(row.user_id));
    }
    ok(res, { updated: r.rowCount, stamp_modes });
  })
);

const BulkApprovers = z.object({
  user_ids: z.array(z.string().uuid()).min(1),
  kind: z.enum(['leave', 'correction']),
  approver_user_ids: z.array(z.string().uuid()),
});

// Overwrite the leave/correction approver list on many members at once. Each
// target's own id is filtered out (nobody approves their own requests).
usersRouter.post(
  '/approvers/bulk',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = BulkApprovers.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const { user_ids, kind, approver_user_ids } = parse.data;
    await assertTenantMembers(client, user_ids);
    for (const uid of user_ids) {
      const ids = Array.from(new Set(approver_user_ids)).filter((x) => x !== uid);
      // setApprovers validates that each approver is an active member + audits.
      await setApprovers(client, kind, uid, ids);
    }
    ok(res, { user_ids, kind, approver_user_ids });
  })
);

async function emitAudit(
  client: PoolClient,
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
