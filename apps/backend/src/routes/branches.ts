import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { NotFoundError, ValidationError } from '../errors/index.js';
import { forwardGeocode } from '../services/geocoding-service.js';

export const branchesRouter = Router();
branchesRouter.use(authenticate);

const CreateBranch = z.object({
  name: z.string().min(1).max(120),
  address: z.string().min(1).max(500).optional(),
  latitude: z.number().gte(-90).lte(90).optional(),
  longitude: z.number().gte(-180).lte(180).optional(),
  radius_m: z.number().int().gte(50).lte(1500).default(300),
  enforce_radius: z.boolean().default(true),
  smart_working: z.boolean().default(false),
  geofence_policy: z.enum(['lenient', 'strict']).default('lenient'),
  gps_accuracy_ceiling_m: z.number().int().gte(10).lte(2000).default(100),
  timezone: z.string().optional(),
  ordering: z.number().int().default(0),
});

branchesRouter.get(
  '/',
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT id, name, address, address_components, latitude, longitude, radius_m,
              enforce_radius, smart_working, geofence_policy, gps_accuracy_ceiling_m,
              timezone, active, ordering, created_at
       FROM branches
       WHERE deleted_at IS NULL
       ORDER BY ordering, name`
    );
    ok(res, r.rows);
  })
);

branchesRouter.get(
  '/:id',
  tenantHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT * FROM branches WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('branch');
    ok(res, r.rows[0]);
  })
);

branchesRouter.post(
  '/',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = CreateBranch.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    let lat = b.latitude ?? null;
    let lng = b.longitude ?? null;
    let components: Record<string, unknown> | null = null;
    if ((lat === null || lng === null) && b.address && !b.smart_working) {
      try {
        const geo = await forwardGeocode(b.address);
        lat = geo.lat;
        lng = geo.lng;
        components = geo.components;
      } catch {
        // Allow create without coords; admin can edit later.
      }
    }
    const r = await client.query(
      `INSERT INTO branches(tenant_id, name, address, address_components, latitude, longitude,
                            radius_m, enforce_radius, smart_working, geofence_policy, gps_accuracy_ceiling_m,
                            timezone, ordering)
       VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [b.name, b.address ?? null, components, lat, lng, b.radius_m, b.enforce_radius,
       b.smart_working, b.geofence_policy, b.gps_accuracy_ceiling_m, b.timezone ?? null, b.ordering]
    );
    await emitAudit(client, 'branch.create', r.rows[0].id, null, r.rows[0]);
    ok(res, r.rows[0], 201);
  })
);

const PatchBranch = CreateBranch.partial().extend({ active: z.boolean().optional() });

branchesRouter.patch(
  '/:id',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = PatchBranch.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const before = await client.query(`SELECT * FROM branches WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (before.rowCount === 0) throw new NotFoundError('branch');
    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(parse.data)) {
      if (v === undefined) continue;
      updates.push(`${k} = $${i++}`);
      values.push(v);
    }
    if (updates.length === 0) return ok(res, before.rows[0]);
    values.push(req.params.id);
    const r = await client.query(
      `UPDATE branches SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    await emitAudit(client, 'branch.update', String(req.params.id), before.rows[0], r.rows[0]);
    ok(res, r.rows[0]);
  })
);

branchesRouter.delete(
  '/:id',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const r = await client.query(
      `UPDATE branches SET deleted_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('branch');
    await emitAudit(client, 'branch.delete', String(req.params.id), r.rows[0], null);
    ok(res, { deleted: true });
  })
);

branchesRouter.get(
  '/:id/members',
  tenantHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT bm.user_id, COALESCE(au.email, bm.user_id::text) AS email
       FROM branch_memberships bm
       LEFT JOIN auth_users au ON au.id = bm.user_id
       WHERE bm.branch_id = $1`,
      [req.params.id]
    );
    ok(res, r.rows);
  })
);

const AddMember = z.object({ user_id: z.string().uuid() });

branchesRouter.post(
  '/:id/members',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = AddMember.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    await client.query(
      `INSERT INTO branch_memberships(branch_id, user_id, tenant_id)
       VALUES ($1, $2, current_setting('app.current_tenant_id')::uuid)
       ON CONFLICT DO NOTHING`,
      [req.params.id, parse.data.user_id]
    );
    ok(res, { added: true }, 201);
  })
);

branchesRouter.delete(
  '/:id/members/:userId',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    await client.query(
      `DELETE FROM branch_memberships WHERE branch_id = $1 AND user_id = $2`,
      [req.params.id, req.params.userId]
    );
    ok(res, { removed: true });
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
             $1, 'branch', $2, $3, $4)`,
    [action, resourceId, before, after]
  );
}
