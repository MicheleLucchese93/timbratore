import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { ValidationError } from '../errors/index.js';

export const settingsRouter = Router();
settingsRouter.use(authenticate);
settingsRouter.use(requireAdmin);

// ragione_sociale, retention_years and mock_location_action are provisioned at
// tenant creation and are not editable from the app. partita_iva is admin-editable
// (the whole router is requireAdmin).
const TenantSettings = z.object({
  timezone: z.string().optional(),
  language: z.enum(['it', 'en']).optional(),
  // Italian VAT: 11 digits. Allow clearing to null.
  partita_iva: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'partita_iva must be 11 digits')
    .nullable()
    .optional(),
  ccnl: z.string().nullable().optional(),
  // Centro Paghe export configuration.
  codice_ditta: z.string().trim().max(7).nullable().optional(),
  cp_code_len: z.union([z.literal(2), z.literal(4)]).optional(),
  cp_donazione_cf: z.string().trim().max(11).nullable().optional(),
  // internal leave-kind key → Centro Paghe 2-char INP code (merged over defaults).
  cp_giustificativo_map: z.record(z.string(), z.string()).optional(),
});

settingsRouter.get(
  '/',
  tenantHandler(async (req, res, client) => {
    const r = await client.query(`SELECT * FROM tenants WHERE id = $1`, [req.user!.tenantId]);
    ok(res, r.rows[0]);
  })
);

settingsRouter.patch(
  '/',
  tenantHandler(async (req, res, client) => {
    const parse = TenantSettings.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const set: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(parse.data)) {
      if (v === undefined) continue;
      set.push(`${k} = $${i++}`);
      values.push(v);
    }
    if (set.length === 0) {
      const r = await client.query(`SELECT * FROM tenants WHERE id = $1`, [req.user!.tenantId]);
      return ok(res, r.rows[0]);
    }
    values.push(req.user!.tenantId);
    const r = await client.query(
      `UPDATE tenants SET ${set.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    await client.query(
      `INSERT INTO audit_log(tenant_id, actor_user_id, action, resource_type, resource_id, before, after)
       VALUES (current_setting('app.current_tenant_id')::uuid, current_setting('app.current_user_id')::uuid,
               'tenant.update', 'tenant', $1::text, NULL, $2)`,
      [req.user!.tenantId, parse.data]
    );
    ok(res, r.rows[0]);
  })
);

settingsRouter.get(
  '/usage',
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM memberships
            WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
              AND deleted_at IS NULL) AS active_users,
         (SELECT COUNT(*) FROM memberships
            WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
              AND role='admin' AND deleted_at IS NULL) AS active_admins,
         (SELECT max_users FROM tenants WHERE id = current_setting('app.current_tenant_id')::uuid) AS max_users,
         (SELECT max_admins FROM tenants WHERE id = current_setting('app.current_tenant_id')::uuid) AS max_admins,
         (SELECT max_branches FROM tenants WHERE id = current_setting('app.current_tenant_id')::uuid) AS max_branches,
         (SELECT COUNT(*) FROM branches
            WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
              AND deleted_at IS NULL) AS branches_count`
    );
    ok(res, r.rows[0]);
  })
);

const RecipientBody = z.object({ email: z.string().email(), label: z.string().min(1).max(120) });

settingsRouter.get(
  '/export-recipients',
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT id, email, label, active, created_at FROM tenant_export_recipients ORDER BY created_at DESC`
    );
    ok(res, r.rows);
  })
);

settingsRouter.post(
  '/export-recipients',
  tenantHandler(async (req, res, client) => {
    const parse = RecipientBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const r = await client.query(
      `INSERT INTO tenant_export_recipients(tenant_id, email, label)
       VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2)
       RETURNING *`,
      [parse.data.email, parse.data.label]
    );
    ok(res, r.rows[0], 201);
  })
);

settingsRouter.delete(
  '/export-recipients/:id',
  tenantHandler(async (req, res, client) => {
    await client.query(`DELETE FROM tenant_export_recipients WHERE id = $1`, [req.params.id]);
    ok(res, { deleted: true });
  })
);
