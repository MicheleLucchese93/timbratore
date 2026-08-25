import { Router } from 'express';
import { z } from 'zod';
import { apiHandler } from '../../lib/route-helpers.js';
import { requireScope } from '../../middleware/api-key.js';
import { ok } from '../../lib/api-response.js';
import { logAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError } from '../../errors/index.js';
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
 * Sedi — the company's places of work, and the geofence each one enforces.
 *
 * Coordinates ARE exposed here, unlike on a punch: a sede's position is company
 * configuration the admin typed in, not an observation of where an employee
 * was. (Migration 060 and lib/stamp-columns.ts draw that line for punches.)
 */
export const publicBranchesRouter = Router();

const COLUMNS = `id, name, address, latitude, longitude, radius_m,
                 enforce_radius, smart_working, timezone, active, ordering, created_at`;

const ListQuery = PageQuery.extend({
  active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

publicBranchesRouter.get(
  '/',
  requireScope('branches:read'),
  apiHandler(async (req, res, client) => {
    const q = parseQuery(ListQuery, req);
    const where = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    if (q.active !== undefined) {
      params.push(q.active);
      where.push(`active = $${params.length}`);
    }
    params.push(q.limit, q.offset);
    const r = await client.query(
      `SELECT ${COLUMNS}, COUNT(*) OVER() AS total
         FROM branches ${whereSql(where)}
        -- id as the final tiebreaker: two sedi with the same ordering+name
        -- would otherwise come back in an arbitrary order per query, and offset
        -- paging over an unstable sort silently skips and repeats rows.
        ORDER BY ordering, name, id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows, total } = takeTotal(r.rows, q);
    okList(res, rows, q, total);
  })
);

publicBranchesRouter.get(
  '/:id',
  requireScope('branches:read'),
  apiHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT ${COLUMNS} FROM branches WHERE id = $1 AND deleted_at IS NULL`,
      [uuidParam(req, 'id')]
    );
    if (r.rowCount === 0) throw new NotFoundError('branch');
    ok(res, r.rows[0]);
  })
);

/** The employees assigned to a sede. Ids only — join /users for the detail. */
publicBranchesRouter.get(
  '/:id/members',
  requireScope('branches:read'),
  apiHandler(async (req, res, client) => {
    const branchId = uuidParam(req, 'id');
    const exists = await client.query(
      `SELECT 1 FROM branches WHERE id = $1 AND deleted_at IS NULL`,
      [branchId]
    );
    if (exists.rowCount === 0) throw new NotFoundError('branch');
    const r = await client.query(
      `SELECT bm.user_id, COALESCE(au.email, bm.user_id::text) AS email
         FROM branch_memberships bm
         LEFT JOIN auth_users au ON au.id = bm.user_id
        WHERE bm.branch_id = $1
        ORDER BY email, bm.user_id`,
      [branchId]
    );
    ok(res, r.rows);
  })
);

// Bounds mirror the DB: `branches_radius_m_check` is 50..1500, and radius_m is
// NOT NULL with a default of 300. A wider zod range would turn a caller's
// mistake into a constraint violation the terminal handler can only report as
// an opaque 500, and a nullable radius would violate NOT NULL outright.
const BranchBody = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(240).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  radius_m: z.number().int().min(50).max(1500).optional(),
  enforce_radius: z.boolean().optional(),
  smart_working: z.boolean().optional(),
  active: z.boolean().optional(),
  ordering: z.number().int().optional(),
});

publicBranchesRouter.post(
  '/',
  requireScope('branches:write'),
  apiHandler(async (req, res, client) => {
    const b = parseBody(BranchBody, req);
    // max_branches is a contractual limit set from the partner console, so it
    // is enforced here rather than left to a constraint that does not exist.
    const lim = await client.query<{ used: string; max_branches: number }>(
      `SELECT (SELECT COUNT(*) FROM branches WHERE deleted_at IS NULL)::text AS used,
              (SELECT max_branches FROM tenants
                WHERE id = current_setting('app.current_tenant_id')::uuid) AS max_branches`
    );
    const used = Number(lim.rows[0]?.used ?? 0);
    const max = Number(lim.rows[0]?.max_branches ?? 0);
    if (max > 0 && used >= max) {
      throw new ConflictError(`Branch limit reached: ${used}/${max}`, 'LIMIT_REACHED', {
        kind: 'branches',
        current: used,
        limit: max,
      });
    }
    // DEFAULT where the caller said nothing, rather than a literal chosen here:
    // radius_m is NOT NULL DEFAULT 300 and enforce_radius is NOT NULL DEFAULT
    // TRUE, so passing NULL would have failed outright and passing FALSE would
    // have quietly created sedi that enforce no geofence — the opposite of what
    // the same omission produces in the web app.
    const r = await client.query(
      `INSERT INTO branches (tenant_id, name, address, latitude, longitude, radius_m,
                             enforce_radius, smart_working, active, ordering)
       VALUES (current_setting('app.current_tenant_id')::uuid,
               $1, $2, $3, $4,
               COALESCE($5, 300), COALESCE($6, TRUE), COALESCE($7, FALSE),
               COALESCE($8, TRUE), COALESCE($9, 0))
       RETURNING ${COLUMNS}`,
      [
        b.name, b.address ?? null, b.latitude ?? null, b.longitude ?? null,
        b.radius_m ?? null, b.enforce_radius ?? null, b.smart_working ?? null,
        b.active ?? null, b.ordering ?? null,
      ]
    );
    await logAudit(client, {
      action: 'branch.create',
      resourceType: 'branch',
      resourceId: r.rows[0].id,
      targetLabel: b.name,
      after: { ...r.rows[0], via: 'api' },
      req,
    });
    ok(res, r.rows[0], 201);
  })
);

publicBranchesRouter.patch(
  '/:id',
  requireScope('branches:write'),
  apiHandler(async (req, res, client) => {
    const b = parseBody(BranchBody.partial(), req);
    const id = uuidParam(req, 'id');
    const before = await client.query(
      `SELECT ${COLUMNS} FROM branches WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (before.rowCount === 0) throw new NotFoundError('branch');
    const set: string[] = [];
    const params: unknown[] = [id];
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined) continue;
      params.push(v);
      set.push(`${k} = $${params.length}`);
    }
    if (set.length === 0) return ok(res, before.rows[0]);
    const r = await client.query(
      `UPDATE branches SET ${set.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`,
      params
    );
    await logAudit(client, {
      action: 'branch.update',
      resourceType: 'branch',
      resourceId: id,
      targetLabel: r.rows[0].name,
      before: before.rows[0],
      after: { ...r.rows[0], via: 'api' },
      req,
    });
    ok(res, r.rows[0]);
  })
);

/** Soft delete, like the web app's: punches reference the sede they happened
 *  at, so a hard delete would orphan history. */
publicBranchesRouter.delete(
  '/:id',
  requireScope('branches:write'),
  apiHandler(async (req, res, client) => {
    const id = uuidParam(req, 'id');
    const r = await client.query(
      `UPDATE branches SET deleted_at = now(), active = FALSE
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id, name`,
      [id]
    );
    if (r.rowCount === 0) throw new NotFoundError('branch');
    await logAudit(client, {
      action: 'branch.delete',
      resourceType: 'branch',
      resourceId: id,
      targetLabel: r.rows[0].name,
      after: { deleted: true, via: 'api' },
      req,
    });
    ok(res, { id, deleted: true });
  })
);

const MembersBody = z.object({ user_ids: z.array(z.string().uuid()) });

/** Replace the sede's roster wholesale. PUT, not PATCH: a sync job knows the
 *  full membership it wants and "add these, remove those" is a diff the caller
 *  should not have to compute. */
publicBranchesRouter.put(
  '/:id/members',
  requireScope('branches:write'),
  apiHandler(async (req, res, client) => {
    const body = parseBody(MembersBody, req);
    // The same id twice would hit branch_memberships' primary key; sorted so two
    // concurrent roster writes cannot deadlock on overlapping sets.
    const userIds = uniqueIds(body.user_ids);
    const id = uuidParam(req, 'id');
    const exists = await client.query(
      `SELECT name FROM branches WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (exists.rowCount === 0) throw new NotFoundError('branch');

    // Named, not silently dropped: a sync script that sent an id from the wrong
    // system must hear about it, otherwise the roster ends up quietly short and
    // nobody knows which employee is missing.
    if (userIds.length) {
      const known = await client.query<{ user_id: string }>(
        `SELECT user_id FROM memberships
          WHERE user_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [userIds]
      );
      const inTenant = new Set(known.rows.map((row) => row.user_id));
      const stranger = userIds.find((u) => !inTenant.has(u));
      if (stranger) throw new NotFoundError(`user not in company: ${stranger}`);
    }

    await client.query(`DELETE FROM branch_memberships WHERE branch_id = $1`, [id]);
    if (userIds.length) {
      await client.query(
        `INSERT INTO branch_memberships (tenant_id, branch_id, user_id)
         SELECT current_setting('app.current_tenant_id')::uuid, $1, u
           FROM unnest($2::uuid[]) AS u`,
        [id, userIds]
      );
    }
    const after = await client.query(
      `SELECT user_id FROM branch_memberships WHERE branch_id = $1`,
      [id]
    );
    await logAudit(client, {
      action: 'branch.member_add',
      resourceType: 'branch',
      resourceId: id,
      targetLabel: exists.rows[0].name,
      after: { user_ids: after.rows.map((x) => x.user_id), via: 'api' },
      req,
    });
    ok(res, { branch_id: id, user_ids: after.rows.map((x) => x.user_id) });
  })
);
