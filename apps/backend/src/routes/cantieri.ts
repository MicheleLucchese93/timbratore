import { Router } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import {
  authenticate,
  requireCantieri,
  requireCantieriAdmin,
} from '../middleware/auth.js';
import { asyncHandler, tenantHandler } from '../lib/route-helpers.js';
import { adminPool } from '../lib/admin-db.js';
import { ok } from '../lib/api-response.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.js';
import { logAudit, logAuditAs } from '../lib/audit.js';
import { buildCantiereReportPdf, type CantiereReportEntry } from '../lib/cantieri-pdf.js';
import { sendMail, buildCantiereReportMail } from '../lib/mailer.js';
import { sanitizeBulletinHtml } from '../lib/bulletin-sanitize.js';
import { createLogger } from '../lib/logger.js';
import {
  CANTIERE_NAME_MAX,
  CANTIERE_ADDRESS_MAX,
  CANTIERE_ACTIVITY_TEXT_MAX,
  MEZZO_NAME_MAX,
  CANTIERI_FIELD_LABEL_MAX,
  CANTIERI_FIELD_KEY_MAX,
  CANTIERI_FIELD_OPTION_MAX,
  CANTIERI_FIELD_OPTIONS_MAX,
  CANTIERI_FIELDS_PER_SCOPE_MAX,
  CANTIERE_REPORT_RECIPIENTS_MAX,
  CANTIERE_REPORT_NOTE_MAX,
  cantieriFieldKeyFromLabel,
  type CantieriCustomValues,
  type CantieriFieldScope,
  type CantieriFieldType,
} from '@sonoqui/shared';

const logger = createLogger('cantieri');

export const cantieriRouter = Router();
cantieriRouter.use(authenticate);

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Strict wall-clock 'HH:MM' — the DB time columns reject e.g. '25:00' with a
// raw pg error, so invalid values must die here as a 400 instead.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// [first day, first day of next month) — passed straight to date comparisons.
function monthRange(month: string): { start: string; end: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { start: `${month}-01`, end };
}

function requireMonth(raw: unknown): string {
  if (typeof raw !== 'string' || !MONTH_RE.test(raw)) {
    throw new ValidationError("month must be 'YYYY-MM'");
  }
  return raw;
}

function requireUuid(raw: unknown): string {
  const parsed = z.string().uuid().safeParse(raw);
  if (!parsed.success) throw new ValidationError('invalid id');
  return parsed.data;
}

/* ===================== Custom field validation ===================== */

interface FieldDefRow {
  id: string;
  scope: CantieriFieldScope;
  key: string;
  label: string;
  field_type: CantieriFieldType;
  options: string[] | null;
  required: boolean;
  position: number;
  // Entry-scope only; empty = applies to all cantieri. Always [] for 'mezzo'.
  cantiere_ids: string[];
}

// SELECT list for a field def joined with its per-cantiere association set. The
// LATERAL subquery correlates on field_def_id (itself tenant-scoped via the
// def's tenant_id filter / RLS), so no cross-tenant leak. Alias the def 'd'.
const FIELD_DEF_SELECT = `
  d.id, d.scope, d.key, d.label, d.field_type, d.options, d.required, d.position,
  COALESCE(fc.cantiere_ids, ARRAY[]::uuid[]) AS cantiere_ids`;
const FIELD_DEF_FROM = `
  cantieri_field_defs d
  LEFT JOIN LATERAL (
    SELECT array_agg(cantiere_id) AS cantiere_ids
      FROM cantiere_field_cantieri WHERE field_def_id = d.id
  ) fc ON true`;

// Active defs of one scope, in display order, each with its cantiere_ids. On the
// RLS client the tenant is implied by the select policy; adminPool callers pass
// tenantId explicitly.
async function loadFieldDefs(
  db: Pick<PoolClient, 'query'>,
  scope: CantieriFieldScope,
  tenantId?: string
): Promise<FieldDefRow[]> {
  const r = await db.query(
    `SELECT ${FIELD_DEF_SELECT}
       FROM ${FIELD_DEF_FROM}
      WHERE d.deleted_at IS NULL AND d.scope = $1
        ${tenantId ? 'AND d.tenant_id = $2' : ''}
      ORDER BY d.position, d.key`,
    tenantId ? [scope, tenantId] : [scope]
  );
  return r.rows;
}

// Entry defs shown for one cantiere: those with no association (all sites) plus
// those explicitly linked to this cantiere. This is the authoritative set used
// to validate an entry's custom_values and to pick report/drill-in columns.
function entryDefsForCantiere(defs: FieldDefRow[], cantiereId: string): FieldDefRow[] {
  return defs.filter((d) => d.cantiere_ids.length === 0 || d.cantiere_ids.includes(cantiereId));
}

// Current association set of a field, sorted for stable responses. Defaults to
// adminPool but takes a client so a caller inside a transaction reads its own
// uncommitted writes.
async function fieldCantiereIds(
  tenantId: string,
  fieldDefId: string,
  db: Pick<PoolClient, 'query'> = adminPool
): Promise<string[]> {
  const r = await db.query(
    `SELECT cantiere_id FROM cantiere_field_cantieri
      WHERE field_def_id = $1 AND tenant_id = $2 ORDER BY cantiere_id`,
    [fieldDefId, tenantId]
  );
  return r.rows.map((x) => x.cantiere_id as string);
}

// Full-replace a field's cantiere association set (entry scope only). Validates
// every id is a live site of the tenant. Runs on the given client so callers can
// share a transaction. Dedupes the input.
async function replaceFieldCantieri(
  client: Pick<PoolClient, 'query'>,
  tenantId: string,
  fieldDefId: string,
  cantiereIds: string[]
): Promise<string[]> {
  const ids = Array.from(new Set(cantiereIds));
  if (ids.length > 0) {
    const valid = await client.query(
      `SELECT id FROM cantieri
        WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND deleted_at IS NULL`,
      [ids, tenantId]
    );
    if (valid.rowCount !== ids.length) {
      throw new ValidationError('one or more cantiere_ids are not valid sites');
    }
  }
  await client.query(
    `DELETE FROM cantiere_field_cantieri WHERE field_def_id = $1 AND tenant_id = $2`,
    [fieldDefId, tenantId]
  );
  if (ids.length > 0) {
    await client.query(
      `INSERT INTO cantiere_field_cantieri(tenant_id, field_def_id, cantiere_id)
       SELECT $1, $2, x FROM unnest($3::uuid[]) AS x`,
      [tenantId, fieldDefId, ids]
    );
  }
  return ids;
}

const CustomValuesInput = z.record(
  z.string().max(CANTIERI_FIELD_KEY_MAX),
  z.union([z.string(), z.number(), z.boolean(), z.null()])
);
type CustomValuesBody = z.infer<typeof CustomValuesInput>;

// Validate a submitted custom_values map against the active defs of one scope
// (shared by entries and mezzi). Unknown keys are rejected outright; required
// fields must carry a non-empty value; each value must match its def type.
// Returns the normalized map to persist (nulls kept only for known keys).
function validateCustomValues(
  defs: FieldDefRow[],
  values: CustomValuesBody | undefined
): CantieriCustomValues {
  const input = values ?? {};
  const known = new Set(defs.map((d) => d.key));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) throw new ValidationError(`unknown custom field: ${key}`);
  }
  const out: CantieriCustomValues = {};
  for (const def of defs) {
    const v = input[def.key];
    if (v === undefined || v === null || v === '') {
      if (def.required) throw new ValidationError(`custom field required: ${def.label}`);
      if (v !== undefined) out[def.key] = null;
      continue;
    }
    switch (def.field_type) {
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new ValidationError(`custom field must be a number: ${def.label}`);
        }
        break;
      case 'boolean':
        if (typeof v !== 'boolean') {
          throw new ValidationError(`custom field must be a boolean: ${def.label}`);
        }
        break;
      case 'select':
        if (typeof v !== 'string' || !(def.options ?? []).includes(v)) {
          throw new ValidationError(`custom field value not among options: ${def.label}`);
        }
        break;
      case 'date':
        if (typeof v !== 'string' || !DATE_RE.test(v)) {
          throw new ValidationError(`custom field must be 'YYYY-MM-DD': ${def.label}`);
        }
        break;
      case 'time':
        if (typeof v !== 'string' || !TIME_RE.test(v)) {
          throw new ValidationError(`custom field must be 'HH:MM': ${def.label}`);
        }
        break;
      default: // text
        if (typeof v !== 'string' || v.length > CANTIERE_ACTIVITY_TEXT_MAX) {
          throw new ValidationError(`custom field must be a string: ${def.label}`);
        }
    }
    out[def.key] = v;
  }
  return out;
}

/* ===================== Shared SQL fragments ===================== */

const SITE_COLS = `id, name, address, status, created_at, updated_at`;
const MEZZO_COLS = `id, name, custom_values, created_at, updated_at`;

// time/date columns are re-rendered through to_char so the API always speaks
// 'HH:MM' / 'YYYY-MM-DD' strings (pg would emit 'HH:MM:SS' and JS Dates).
const ENTRY_COLS = (prefix: string): string => `
  ${prefix}id, ${prefix}cantiere_id, ${prefix}user_id,
  to_char(${prefix}entry_date, 'YYYY-MM-DD') AS entry_date,
  to_char(${prefix}travel_start, 'HH24:MI') AS travel_start,
  to_char(${prefix}travel_end, 'HH24:MI') AS travel_end,
  to_char(${prefix}activity_start, 'HH24:MI') AS activity_start,
  to_char(${prefix}activity_end, 'HH24:MI') AS activity_end,
  ${prefix}activity_text, ${prefix}mezzo_id, ${prefix}custom_values,
  ${prefix}created_at, ${prefix}updated_at`;

const USER_NAME_SQL = `COALESCE(
  NULLIF(au.display_name, ''),
  NULLIF(TRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''),
  au.email,
  e.user_id::text
)`;

/* ===================== Member surface (requireCantieri, RLS) ===================== */

/* ----- GET /api/v1/cantieri/my/sites — my assigned OPEN sites ----- */
cantieriRouter.get(
  '/my/sites',
  requireCantieri,
  tenantHandler(async (_req, res, client) => {
    // RLS (cantieri_select) already restricts to assigned + non-deleted rows.
    const r = await client.query(
      `SELECT ${SITE_COLS} FROM cantieri
        WHERE status = 'open' AND deleted_at IS NULL
        ORDER BY name`
    );
    ok(res, { sites: r.rows });
  })
);

/* ----- GET /api/v1/cantieri/my/mezzi — my assigned vehicles ----- */
cantieriRouter.get(
  '/my/mezzi',
  requireCantieri,
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT ${MEZZO_COLS} FROM mezzi
        WHERE deleted_at IS NULL
        ORDER BY name`
    );
    ok(res, { mezzi: r.rows });
  })
);

/* ----- GET /api/v1/cantieri/fields?scope= — custom field defs (form rendering) ----- */
cantieriRouter.get(
  '/fields',
  requireCantieri,
  tenantHandler(async (req, res, client) => {
    const scope = z.enum(['entry', 'mezzo']).optional().safeParse(
      typeof req.query.scope === 'string' ? req.query.scope : undefined
    );
    if (!scope.success) throw new ValidationError("scope must be 'entry' or 'mezzo'");
    const r = await client.query(
      `SELECT ${FIELD_DEF_SELECT}
         FROM ${FIELD_DEF_FROM}
        WHERE d.deleted_at IS NULL
          ${scope.data ? 'AND d.scope = $1' : ''}
        ORDER BY d.position, d.key`,
      scope.data ? [scope.data] : []
    );
    ok(res, { fields: r.rows });
  })
);

/* ----- GET /api/v1/cantieri/my/entries?month= — my entries for a month ----- */
cantieriRouter.get(
  '/my/entries',
  requireCantieri,
  tenantHandler(async (req, res, client) => {
    const month = requireMonth(req.query.month);
    const { start, end } = monthRange(month);
    // Joined names go through the caller's own RLS visibility: a site/vehicle
    // the user was unassigned from since resolves to NULL, never an error.
    const r = await client.query(
      `SELECT ${ENTRY_COLS('e.')},
              c.name AS cantiere_name,
              m.name AS mezzo_name
         FROM cantiere_entries e
         LEFT JOIN cantieri c ON c.id = e.cantiere_id
         LEFT JOIN mezzi m ON m.id = e.mezzo_id
        WHERE e.deleted_at IS NULL
          AND e.entry_date >= $1 AND e.entry_date < $2
        ORDER BY e.entry_date DESC, e.created_at DESC`,
      [start, end]
    );
    ok(res, { entries: r.rows });
  })
);

const TimeField = z.string().regex(TIME_RE, "time must be 'HH:MM'").nullable().optional();

// Regex + roundtrip so an impossible date (2026-02-31) dies here as a 400
// instead of a raw pg error on the date column.
const DateField = z
  .string()
  .regex(DATE_RE, "entry_date must be 'YYYY-MM-DD'")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'invalid date');

const CreateEntry = z.object({
  cantiere_id: z.string().uuid(),
  entry_date: DateField,
  travel_start: TimeField,
  travel_end: TimeField,
  activity_start: TimeField,
  activity_end: TimeField,
  activity_text: z.string().trim().max(CANTIERE_ACTIVITY_TEXT_MAX).nullable().optional(),
  mezzo_id: z.string().uuid().nullable().optional(),
  custom_values: CustomValuesInput.optional(),
});

// cantiere_id is immutable after creation (an entry never moves between sites).
const PatchEntry = CreateEntry.omit({ cantiere_id: true }).partial();

// Friendly pre-check: the vehicle must be visible to the caller (assigned +
// not deleted, both enforced by RLS on the member client).
async function assertMezzoVisible(client: PoolClient, mezzoId: string): Promise<void> {
  const r = await client.query(`SELECT 1 FROM mezzi WHERE id = $1 AND deleted_at IS NULL`, [
    mezzoId,
  ]);
  if (r.rowCount === 0) throw new NotFoundError('mezzo');
}

/* ----- POST /api/v1/cantieri/entries — log an activity entry ----- */
cantieriRouter.post(
  '/entries',
  requireCantieri,
  tenantHandler(async (req, res, client) => {
    const parsed = CreateEntry.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body', parsed.error.flatten());
    const d = parsed.data;

    // Friendly pre-checks — the entry INSERT policy re-checks assignment +
    // open status in the DB, so these only exist to return typed 4xx errors.
    const site = await client.query(
      `SELECT name, status FROM cantieri WHERE id = $1 AND deleted_at IS NULL`,
      [d.cantiere_id]
    );
    if (site.rowCount === 0) throw new NotFoundError('cantiere');
    if (site.rows[0].status !== 'open') {
      throw new ConflictError('cantiere is closed', 'CANTIERE_CLOSED');
    }
    if (d.mezzo_id) await assertMezzoVisible(client, d.mezzo_id);

    // Only the fields shown for THIS cantiere are accepted (a value for a field
    // not applicable to the site is rejected as an unknown key by the validator).
    const defs = entryDefsForCantiere(await loadFieldDefs(client, 'entry'), d.cantiere_id);
    const customValues = validateCustomValues(defs, d.custom_values);

    const r = await client.query(
      `INSERT INTO cantiere_entries(
         tenant_id, cantiere_id, user_id, entry_date,
         travel_start, travel_end, activity_start, activity_end,
         activity_text, mezzo_id, custom_values
       )
       VALUES (current_setting('app.current_tenant_id')::uuid, $1,
               current_setting('app.current_user_id')::uuid, $2,
               $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING ${ENTRY_COLS('')}`,
      [
        d.cantiere_id,
        d.entry_date,
        d.travel_start ?? null,
        d.travel_end ?? null,
        d.activity_start ?? null,
        d.activity_end ?? null,
        d.activity_text ?? null,
        d.mezzo_id ?? null,
        JSON.stringify(customValues),
      ]
    );
    const entry = r.rows[0];
    await logAudit(client, {
      action: 'cantiere_entry.create',
      resourceType: 'cantiere_entry',
      resourceId: entry.id,
      targetUserId: req.user!.id,
      targetLabel: site.rows[0].name,
      after: { cantiere_id: d.cantiere_id, entry_date: d.entry_date },
      req,
    });
    ok(res, entry, 201);
  })
);

/* ----- PATCH /api/v1/cantieri/entries/:id — edit my entry ----- */
cantieriRouter.patch(
  '/entries/:id',
  requireCantieri,
  tenantHandler(async (req, res, client) => {
    const id = requireUuid(req.params.id);
    const parsed = PatchEntry.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body', parsed.error.flatten());
    const d = parsed.data;

    // RLS (own rows only) makes this the ownership check too.
    const before = await client.query(
      `SELECT ${ENTRY_COLS('')} FROM cantiere_entries WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (before.rowCount === 0) throw new NotFoundError('entry');

    if (d.mezzo_id) await assertMezzoVisible(client, d.mezzo_id);
    let customValues: CantieriCustomValues | undefined;
    if (d.custom_values !== undefined) {
      // cantiere_id is immutable, so the applicable field set is that of the
      // existing entry's site.
      const defs = entryDefsForCantiere(
        await loadFieldDefs(client, 'entry'),
        before.rows[0].cantiere_id
      );
      customValues = validateCustomValues(defs, d.custom_values);
    }

    // undefined = leave unchanged; null/value = set (allows clearing).
    const updates: string[] = [];
    const values: unknown[] = [id];
    const changedBefore: Record<string, unknown> = {};
    let i = 2;
    const PATCHABLE = [
      'entry_date',
      'travel_start',
      'travel_end',
      'activity_start',
      'activity_end',
      'activity_text',
      'mezzo_id',
    ] as const;
    for (const col of PATCHABLE) {
      if (d[col] === undefined) continue;
      updates.push(`${col} = $${i++}`);
      values.push(d[col]);
      changedBefore[col] = before.rows[0][col];
    }
    if (customValues !== undefined) {
      updates.push(`custom_values = $${i++}::jsonb`);
      values.push(JSON.stringify(customValues));
      changedBefore.custom_values = before.rows[0].custom_values;
    }
    if (updates.length === 0) return ok(res, before.rows[0]);

    const r = await client.query(
      `UPDATE cantiere_entries
          SET ${updates.join(', ')}, updated_at = now()
        WHERE id = $1
        RETURNING ${ENTRY_COLS('')}`,
      values
    );
    await logAudit(client, {
      action: 'cantiere_entry.update',
      resourceType: 'cantiere_entry',
      resourceId: id,
      targetUserId: req.user!.id,
      before: changedBefore,
      after: d,
      req,
    });
    ok(res, r.rows[0]);
  })
);

/* ----- DELETE /api/v1/cantieri/entries/:id — soft-delete my entry ----- */
cantieriRouter.delete(
  '/entries/:id',
  requireCantieri,
  tenantHandler(async (req, res, client) => {
    const id = requireUuid(req.params.id);
    const r = await client.query(
      `UPDATE cantiere_entries SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id, cantiere_id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date`,
      [id]
    );
    if (r.rowCount === 0) throw new NotFoundError('entry');
    await logAudit(client, {
      action: 'cantiere_entry.delete',
      resourceType: 'cantiere_entry',
      resourceId: id,
      targetUserId: req.user!.id,
      before: { cantiere_id: r.rows[0].cantiere_id, entry_date: r.rows[0].entry_date },
      req,
    });
    ok(res, { deleted: true });
  })
);

/* ===================== Admin management (requireCantieriAdmin, service role) ===================== */
/* Every query is HARD-SCOPED to req.user.tenantId — adminPool bypasses RLS.   */

/* ----- GET /api/v1/cantieri/members — assignment picker ----- */
/* The generic /api/v1/users list is tenant-admin only; a base-role member
   holding cantieri_role='admin' still needs the tenant roster to assign
   sites/vehicles, so the module exposes its own minimal listing. */
cantieriRouter.get(
  '/members',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const r = await adminPool.query(
      `SELECT m.user_id, au.email, au.display_name, au.first_name, au.last_name
         FROM memberships m
         JOIN auth_users au ON au.id = m.user_id
        WHERE m.tenant_id = $1 AND m.active = TRUE AND m.deleted_at IS NULL
        ORDER BY COALESCE(
          NULLIF(au.display_name, ''),
          NULLIF(TRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''),
          au.email
        )`,
      [req.user!.tenantId]
    );
    ok(res, { members: r.rows });
  })
);

/* ----- GET /api/v1/cantieri/sites?status=&search= ----- */
cantieriRouter.get(
  '/sites',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = req.user!.tenantId;
    const status = z.enum(['open', 'closed']).optional().safeParse(
      typeof req.query.status === 'string' ? req.query.status : undefined
    );
    if (!status.success) throw new ValidationError("status must be 'open' or 'closed'");
    const search =
      typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : '';

    const params: unknown[] = [tenantId];
    let filters = '';
    if (status.data) {
      params.push(status.data);
      filters += ` AND c.status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      filters += ` AND (c.name ILIKE $${params.length} OR c.address ILIKE $${params.length})`;
    }
    const r = await adminPool.query(
      `SELECT c.id, c.name, c.address, c.status, c.created_at, c.updated_at,
              COALESCE(a.user_ids, ARRAY[]::uuid[]) AS assigned_user_ids,
              COALESCE(e.n, 0)::int AS entries_count
         FROM cantieri c
         LEFT JOIN (
           SELECT cantiere_id, array_agg(user_id) AS user_ids
             FROM cantiere_assignments WHERE tenant_id = $1 GROUP BY cantiere_id
         ) a ON a.cantiere_id = c.id
         LEFT JOIN (
           SELECT cantiere_id, COUNT(*) AS n
             FROM cantiere_entries WHERE tenant_id = $1 AND deleted_at IS NULL
            GROUP BY cantiere_id
         ) e ON e.cantiere_id = c.id
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL${filters}
        ORDER BY c.name`,
      params
    );
    ok(res, { sites: r.rows });
  })
);

const CreateSite = z.object({
  name: z.string().trim().min(1).max(CANTIERE_NAME_MAX),
  address: z.string().trim().max(CANTIERE_ADDRESS_MAX).nullable().optional(),
  status: z.enum(['open', 'closed']).default('open'),
});
const PatchSite = CreateSite.partial();

/* ----- POST /api/v1/cantieri/sites ----- */
cantieriRouter.post(
  '/sites',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const parsed = CreateSite.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body', parsed.error.flatten());
    const d = parsed.data;
    const r = await adminPool.query(
      `INSERT INTO cantieri(tenant_id, name, address, status)
       VALUES ($1, $2, $3, $4)
       RETURNING ${SITE_COLS}`,
      [req.user!.tenantId, d.name, d.address ?? null, d.status]
    );
    await logAuditAs(adminPool, req.user!.tenantId, req.user!.id, {
      action: 'cantiere.create',
      resourceType: 'cantiere',
      resourceId: r.rows[0].id,
      targetLabel: d.name,
      after: { name: d.name, address: d.address ?? null, status: d.status },
      req,
    });
    ok(res, r.rows[0], 201);
  })
);

/* ----- PATCH /api/v1/cantieri/sites/:id ----- */
cantieriRouter.patch(
  '/sites/:id',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id);
    const parsed = PatchSite.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body', parsed.error.flatten());
    const tenantId = req.user!.tenantId;

    const before = await adminPool.query(
      `SELECT ${SITE_COLS} FROM cantieri
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );
    if (before.rowCount === 0) throw new NotFoundError('cantiere');

    const updates: string[] = [];
    const values: unknown[] = [id, tenantId];
    const changedBefore: Record<string, unknown> = {};
    let i = 3;
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v === undefined) continue;
      updates.push(`${k} = $${i++}`);
      values.push(v);
      changedBefore[k] = before.rows[0][k];
    }
    if (updates.length === 0) return ok(res, before.rows[0]);
    const r = await adminPool.query(
      `UPDATE cantieri SET ${updates.join(', ')}, updated_at = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING ${SITE_COLS}`,
      values
    );
    await logAuditAs(adminPool, tenantId, req.user!.id, {
      action: 'cantiere.update',
      resourceType: 'cantiere',
      resourceId: id,
      targetLabel: r.rows[0].name,
      before: changedBefore,
      after: parsed.data,
      req,
    });
    ok(res, r.rows[0]);
  })
);

/* ----- DELETE /api/v1/cantieri/sites/:id — soft-delete ----- */
cantieriRouter.delete(
  '/sites/:id',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id);
    const r = await adminPool.query(
      `UPDATE cantieri SET deleted_at = now()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        RETURNING id, name`,
      [id, req.user!.tenantId]
    );
    if (r.rowCount === 0) throw new NotFoundError('cantiere');
    await logAuditAs(adminPool, req.user!.tenantId, req.user!.id, {
      action: 'cantiere.delete',
      resourceType: 'cantiere',
      resourceId: id,
      targetLabel: r.rows[0].name,
      before: { id, name: r.rows[0].name },
      req,
    });
    ok(res, { deleted: true });
  })
);

const SetAssignments = z.object({ user_ids: z.array(z.string().uuid()) });

// Full-replace assignment set for a site or vehicle. Validates the target
// belongs to the tenant and every id is an active tenant membership, then
// swaps the rows atomically. Shared by the two PUT endpoints below.
async function replaceAssignments(opts: {
  kind: 'cantiere' | 'mezzo';
  targetId: string;
  tenantId: string;
  actorId: string;
  userIds: string[];
  req: import('express').Request;
}): Promise<string[]> {
  const { kind, targetId, tenantId, actorId } = opts;
  const table = kind === 'cantiere' ? 'cantiere_assignments' : 'mezzo_assignments';
  const parentTable = kind === 'cantiere' ? 'cantieri' : 'mezzi';
  const fkCol = kind === 'cantiere' ? 'cantiere_id' : 'mezzo_id';
  const userIds = Array.from(new Set(opts.userIds));

  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query(
      `SELECT name FROM ${parentTable} WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [targetId, tenantId]
    );
    if (target.rowCount === 0) throw new NotFoundError(kind);
    if (userIds.length > 0) {
      const valid = await client.query(
        `SELECT user_id FROM memberships
          WHERE user_id = ANY($1::uuid[]) AND tenant_id = $2
            AND active = TRUE AND deleted_at IS NULL`,
        [userIds, tenantId]
      );
      if (valid.rowCount !== userIds.length) {
        throw new ValidationError('one or more user_ids are not active tenant members');
      }
    }
    await client.query(`DELETE FROM ${table} WHERE ${fkCol} = $1 AND tenant_id = $2`, [
      targetId,
      tenantId,
    ]);
    if (userIds.length > 0) {
      await client.query(
        `INSERT INTO ${table}(tenant_id, ${fkCol}, user_id)
         SELECT $1, $2, x FROM unnest($3::uuid[]) AS x`,
        [tenantId, targetId, userIds]
      );
    }
    await logAuditAs(client, tenantId, actorId, {
      action: kind === 'cantiere' ? 'cantiere.assign' : 'mezzo.assign',
      resourceType: kind,
      resourceId: targetId,
      targetLabel: target.rows[0].name,
      after: { user_ids: userIds },
      req: opts.req,
    });
    await client.query('COMMIT');
    return userIds;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/* ----- PUT /api/v1/cantieri/sites/:id/assignments ----- */
cantieriRouter.put(
  '/sites/:id/assignments',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id);
    const parsed = SetAssignments.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body', parsed.error.flatten());
    const userIds = await replaceAssignments({
      kind: 'cantiere',
      targetId: id,
      tenantId: req.user!.tenantId,
      actorId: req.user!.id,
      userIds: parsed.data.user_ids,
      req,
    });
    ok(res, { user_ids: userIds });
  })
);

/* ----- GET /api/v1/cantieri/mezzi — admin vehicle registry ----- */
cantieriRouter.get(
  '/mezzi',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const r = await adminPool.query(
      `SELECT m.id, m.name, m.custom_values, m.created_at, m.updated_at,
              COALESCE(a.user_ids, ARRAY[]::uuid[]) AS assigned_user_ids
         FROM mezzi m
         LEFT JOIN (
           SELECT mezzo_id, array_agg(user_id) AS user_ids
             FROM mezzo_assignments WHERE tenant_id = $1 GROUP BY mezzo_id
         ) a ON a.mezzo_id = m.id
        WHERE m.tenant_id = $1 AND m.deleted_at IS NULL
        ORDER BY m.name`,
      [req.user!.tenantId]
    );
    ok(res, { mezzi: r.rows });
  })
);

const CreateMezzo = z.object({
  name: z.string().trim().min(1).max(MEZZO_NAME_MAX),
  custom_values: CustomValuesInput.optional(),
});
const PatchMezzo = CreateMezzo.partial();

/* ----- POST /api/v1/cantieri/mezzi ----- */
cantieriRouter.post(
  '/mezzi',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const parsed = CreateMezzo.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body', parsed.error.flatten());
    const tenantId = req.user!.tenantId;
    const defs = await loadFieldDefs(adminPool, 'mezzo', tenantId);
    const customValues = validateCustomValues(defs, parsed.data.custom_values);
    const r = await adminPool.query(
      `INSERT INTO mezzi(tenant_id, name, custom_values)
       VALUES ($1, $2, $3::jsonb)
       RETURNING ${MEZZO_COLS}`,
      [tenantId, parsed.data.name, JSON.stringify(customValues)]
    );
    await logAuditAs(adminPool, tenantId, req.user!.id, {
      action: 'mezzo.create',
      resourceType: 'mezzo',
      resourceId: r.rows[0].id,
      targetLabel: parsed.data.name,
      after: { name: parsed.data.name, custom_values: customValues },
      req,
    });
    ok(res, r.rows[0], 201);
  })
);

/* ----- PATCH /api/v1/cantieri/mezzi/:id ----- */
cantieriRouter.patch(
  '/mezzi/:id',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id);
    const parsed = PatchMezzo.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body', parsed.error.flatten());
    const tenantId = req.user!.tenantId;

    const before = await adminPool.query(
      `SELECT ${MEZZO_COLS} FROM mezzi
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );
    if (before.rowCount === 0) throw new NotFoundError('mezzo');

    const updates: string[] = [];
    const values: unknown[] = [id, tenantId];
    const changedBefore: Record<string, unknown> = {};
    let i = 3;
    if (parsed.data.name !== undefined) {
      updates.push(`name = $${i++}`);
      values.push(parsed.data.name);
      changedBefore.name = before.rows[0].name;
    }
    if (parsed.data.custom_values !== undefined) {
      const defs = await loadFieldDefs(adminPool, 'mezzo', tenantId);
      const customValues = validateCustomValues(defs, parsed.data.custom_values);
      updates.push(`custom_values = $${i++}::jsonb`);
      values.push(JSON.stringify(customValues));
      changedBefore.custom_values = before.rows[0].custom_values;
    }
    if (updates.length === 0) return ok(res, before.rows[0]);
    const r = await adminPool.query(
      `UPDATE mezzi SET ${updates.join(', ')}, updated_at = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING ${MEZZO_COLS}`,
      values
    );
    await logAuditAs(adminPool, tenantId, req.user!.id, {
      action: 'mezzo.update',
      resourceType: 'mezzo',
      resourceId: id,
      targetLabel: r.rows[0].name,
      before: changedBefore,
      after: parsed.data,
      req,
    });
    ok(res, r.rows[0]);
  })
);

/* ----- DELETE /api/v1/cantieri/mezzi/:id — soft-delete ----- */
cantieriRouter.delete(
  '/mezzi/:id',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id);
    const r = await adminPool.query(
      `UPDATE mezzi SET deleted_at = now()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        RETURNING id, name`,
      [id, req.user!.tenantId]
    );
    if (r.rowCount === 0) throw new NotFoundError('mezzo');
    await logAuditAs(adminPool, req.user!.tenantId, req.user!.id, {
      action: 'mezzo.delete',
      resourceType: 'mezzo',
      resourceId: id,
      targetLabel: r.rows[0].name,
      before: { id, name: r.rows[0].name },
      req,
    });
    ok(res, { deleted: true });
  })
);

/* ----- PUT /api/v1/cantieri/mezzi/:id/assignments ----- */
cantieriRouter.put(
  '/mezzi/:id/assignments',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id);
    const parsed = SetAssignments.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body', parsed.error.flatten());
    const userIds = await replaceAssignments({
      kind: 'mezzo',
      targetId: id,
      tenantId: req.user!.tenantId,
      actorId: req.user!.id,
      userIds: parsed.data.user_ids,
      req,
    });
    ok(res, { user_ids: userIds });
  })
);

/* ----- Custom field definitions ----- */

// Empty/omitted cantiere_ids = the field applies to ALL cantieri. Only honored
// for scope='entry' (mezzo fields are never tied to a site).
const CantiereIds = z.array(z.string().uuid()).max(500);

const CreateField = z
  .object({
    scope: z.enum(['entry', 'mezzo']),
    label: z.string().trim().min(1).max(CANTIERI_FIELD_LABEL_MAX),
    field_type: z.enum(['text', 'number', 'date', 'time', 'boolean', 'select']),
    options: z
      .array(z.string().trim().min(1).max(CANTIERI_FIELD_OPTION_MAX))
      .min(1)
      .max(CANTIERI_FIELD_OPTIONS_MAX)
      .optional(),
    required: z.boolean().default(false),
    position: z.number().int().gte(0).optional(),
    cantiere_ids: CantiereIds.optional(),
  })
  .refine((d) => d.field_type !== 'select' || (d.options && d.options.length > 0), {
    message: 'options are required for select fields',
    path: ['options'],
  });

const PatchField = z.object({
  label: z.string().trim().min(1).max(CANTIERI_FIELD_LABEL_MAX).optional(),
  options: z
    .array(z.string().trim().min(1).max(CANTIERI_FIELD_OPTION_MAX))
    .min(1)
    .max(CANTIERI_FIELD_OPTIONS_MAX)
    .optional(),
  required: z.boolean().optional(),
  position: z.number().int().gte(0).optional(),
  cantiere_ids: CantiereIds.optional(),
});

const FIELD_COLS = `id, scope, key, label, field_type, options, required, position`;

/* ----- POST /api/v1/cantieri/fields ----- */
cantieriRouter.post(
  '/fields',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const parsed = CreateField.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body', parsed.error.flatten());
    const d = parsed.data;
    const tenantId = req.user!.tenantId;

    const existing = await adminPool.query(
      `SELECT key, position FROM cantieri_field_defs
        WHERE tenant_id = $1 AND scope = $2 AND deleted_at IS NULL`,
      [tenantId, d.scope]
    );
    if ((existing.rowCount ?? 0) >= CANTIERI_FIELDS_PER_SCOPE_MAX) {
      throw new ConflictError(
        `Field limit reached: ${existing.rowCount}/${CANTIERI_FIELDS_PER_SCOPE_MAX}`,
        'LIMIT_REACHED',
        {
          kind: 'cantieri_fields',
          current: existing.rowCount,
          limit: CANTIERI_FIELDS_PER_SCOPE_MAX,
        }
      );
    }

    // Stable slug from the label; on collision append _2/_3… keeping the key
    // within CANTIERI_FIELD_KEY_MAX (the DB unique index is the backstop).
    const taken = new Set(existing.rows.map((row) => row.key as string));
    const base = cantieriFieldKeyFromLabel(d.label);
    let key = base;
    for (let n = 2; taken.has(key); n += 1) {
      const suffix = `_${n}`;
      key = base.slice(0, CANTIERI_FIELD_KEY_MAX - suffix.length) + suffix;
    }
    // Default position: append after the current last field of the scope.
    const position =
      d.position ?? existing.rows.reduce((max, row) => Math.max(max, row.position + 1), 0);
    const options = d.field_type === 'select' ? d.options : null;

    // The def INSERT + its cantiere association + audit must be atomic: on
    // adminPool (autocommit) an invalid cantiere_ids would otherwise leave an
    // orphaned def that — having zero associations — applies to ALL cantieri
    // while the caller sees a 400. Mirror replaceAssignments' transaction.
    const client = await adminPool.connect();
    let field: Record<string, unknown>;
    let cantiere_ids: string[] = [];
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `INSERT INTO cantieri_field_defs(tenant_id, scope, key, label, field_type, options, required, position)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         RETURNING ${FIELD_COLS}`,
        [
          tenantId,
          d.scope,
          key,
          d.label,
          d.field_type,
          options ? JSON.stringify(options) : null,
          d.required,
          position,
        ]
      );
      field = r.rows[0];
      // Cantiere association is entry-scope only; mezzo fields ignore it.
      if (d.scope === 'entry' && d.cantiere_ids) {
        cantiere_ids = await replaceFieldCantieri(client, tenantId, field.id as string, d.cantiere_ids);
      }
      await logAuditAs(client, tenantId, req.user!.id, {
        action: 'cantieri_field.create',
        resourceType: 'cantieri_field',
        resourceId: field.id as string,
        targetLabel: d.label,
        after: {
          scope: d.scope,
          key,
          label: d.label,
          field_type: d.field_type,
          required: d.required,
          cantiere_ids,
        },
        req,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    ok(res, { ...field, cantiere_ids }, 201);
  })
);

/* ----- PATCH /api/v1/cantieri/fields/:id — scope/key/field_type immutable ----- */
cantieriRouter.patch(
  '/fields/:id',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id);
    const parsed = PatchField.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body', parsed.error.flatten());
    const d = parsed.data;
    const tenantId = req.user!.tenantId;

    const before = await adminPool.query(
      `SELECT ${FIELD_COLS} FROM cantieri_field_defs
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );
    if (before.rowCount === 0) throw new NotFoundError('field');
    if (d.options !== undefined && before.rows[0].field_type !== 'select') {
      throw new ValidationError('options are only valid for select fields');
    }

    const updates: string[] = [];
    const values: unknown[] = [id, tenantId];
    const changedBefore: Record<string, unknown> = {};
    let i = 3;
    for (const col of ['label', 'required', 'position'] as const) {
      if (d[col] === undefined) continue;
      updates.push(`${col} = $${i++}`);
      values.push(d[col]);
      changedBefore[col] = before.rows[0][col];
    }
    if (d.options !== undefined) {
      updates.push(`options = $${i++}::jsonb`);
      values.push(JSON.stringify(d.options));
      changedBefore.options = before.rows[0].options;
    }

    // Association changes are entry-scope only and independent of column updates
    // (an admin may re-scope a field without touching its other attributes).
    const changesAssoc = d.cantiere_ids !== undefined && before.rows[0].scope === 'entry';
    if (updates.length === 0 && !changesAssoc) {
      return ok(res, { ...before.rows[0], cantiere_ids: await fieldCantiereIds(tenantId, id) });
    }

    // Column update + association replace + audit must be atomic: on adminPool
    // an invalid cantiere_ids would commit the column change yet return 400 with
    // the association untouched (a partial update). Wrap it all in one tx.
    const client = await adminPool.connect();
    let row = before.rows[0];
    let cantiere_ids: string[];
    try {
      await client.query('BEGIN');
      if (updates.length > 0) {
        const r = await client.query(
          `UPDATE cantieri_field_defs SET ${updates.join(', ')}
            WHERE id = $1 AND tenant_id = $2
            RETURNING ${FIELD_COLS}`,
          values
        );
        row = r.rows[0];
      }
      if (changesAssoc) {
        changedBefore.cantiere_ids = await fieldCantiereIds(tenantId, id, client);
        await replaceFieldCantieri(client, tenantId, id, d.cantiere_ids!);
      }
      cantiere_ids = await fieldCantiereIds(tenantId, id, client);
      await logAuditAs(client, tenantId, req.user!.id, {
        action: 'cantieri_field.update',
        resourceType: 'cantieri_field',
        resourceId: id,
        targetLabel: row.label,
        before: changedBefore,
        after: d,
        req,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    ok(res, { ...row, cantiere_ids });
  })
);

/* ----- DELETE /api/v1/cantieri/fields/:id — soft-delete ----- */
cantieriRouter.delete(
  '/fields/:id',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id);
    const r = await adminPool.query(
      `UPDATE cantieri_field_defs SET deleted_at = now()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        RETURNING id, scope, key, label`,
      [id, req.user!.tenantId]
    );
    if (r.rowCount === 0) throw new NotFoundError('field');
    await logAuditAs(adminPool, req.user!.tenantId, req.user!.id, {
      action: 'cantieri_field.delete',
      resourceType: 'cantieri_field',
      resourceId: id,
      targetLabel: r.rows[0].label,
      before: { scope: r.rows[0].scope, key: r.rows[0].key, label: r.rows[0].label },
      req,
    });
    ok(res, { deleted: true });
  })
);

/* ----- GET /api/v1/cantieri/dashboard?month= — per-site month aggregates ----- */
cantieriRouter.get(
  '/dashboard',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const month = requireMonth(req.query.month);
    const { start, end } = monthRange(month);
    // Minutes are summed in SQL from the same null/inverted-range rule as
    // cantieriIntervalMinutes (missing or inverted bounds contribute 0).
    const minutesSql = (col: string): string =>
      `SUM(CASE WHEN ${col}_start IS NOT NULL AND ${col}_end IS NOT NULL AND ${col}_end >= ${col}_start
                THEN EXTRACT(EPOCH FROM (${col}_end - ${col}_start)) / 60 ELSE 0 END)`;
    const r = await adminPool.query(
      `SELECT c.id, c.name, c.address, c.status,
              COALESCE(s.entries_count, 0)::int AS entries_count,
              COALESCE(s.users_count, 0)::int AS users_count,
              COALESCE(s.travel_minutes, 0)::int AS travel_minutes,
              COALESCE(s.activity_minutes, 0)::int AS activity_minutes,
              to_char(s.last_entry_date, 'YYYY-MM-DD') AS last_entry_date
         FROM cantieri c
         LEFT JOIN (
           SELECT cantiere_id,
                  COUNT(*) AS entries_count,
                  COUNT(DISTINCT user_id) AS users_count,
                  ${minutesSql('travel')} AS travel_minutes,
                  ${minutesSql('activity')} AS activity_minutes,
                  MAX(entry_date) AS last_entry_date
             FROM cantiere_entries
            WHERE tenant_id = $1 AND deleted_at IS NULL
              AND entry_date >= $2 AND entry_date < $3
            GROUP BY cantiere_id
         ) s ON s.cantiere_id = c.id
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
        ORDER BY c.name`,
      [req.user!.tenantId, start, end]
    );
    ok(res, { month, sites: r.rows });
  })
);

/* ----- Monthly per-site drill-in + PDF report ----- */

interface SiteMonthData {
  site: Record<string, unknown>;
  fields: FieldDefRow[];
  entries: Array<CantiereReportEntry & Record<string, unknown>>;
}

// Data shared by the drill-in list, the PDF download and the report email:
// the site row, the entry-scope defs and the month's entries (chronological,
// with author display name + vehicle name resolved).
async function loadSiteMonth(
  tenantId: string,
  siteId: string,
  month: string
): Promise<SiteMonthData> {
  const site = await adminPool.query(
    `SELECT ${SITE_COLS} FROM cantieri
      WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [siteId, tenantId]
  );
  if (site.rowCount === 0) throw new NotFoundError('cantiere');
  // Columns are the entry fields shown for THIS site (global + site-specific).
  const fields = entryDefsForCantiere(await loadFieldDefs(adminPool, 'entry', tenantId), siteId);
  const { start, end } = monthRange(month);
  const entries = await adminPool.query(
    `SELECT ${ENTRY_COLS('e.')},
            ${USER_NAME_SQL} AS user_name,
            m.name AS mezzo_name
       FROM cantiere_entries e
       LEFT JOIN auth_users au ON au.id = e.user_id
       LEFT JOIN mezzi m ON m.id = e.mezzo_id
      WHERE e.tenant_id = $1 AND e.cantiere_id = $2 AND e.deleted_at IS NULL
        AND e.entry_date >= $3 AND e.entry_date < $4
      ORDER BY e.entry_date ASC, e.created_at ASC`,
    [tenantId, siteId, start, end]
  );
  return { site: site.rows[0], fields, entries: entries.rows };
}

/* ----- GET /api/v1/cantieri/sites/:id/entries?month= ----- */
cantieriRouter.get(
  '/sites/:id/entries',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id);
    const month = requireMonth(req.query.month);
    const { site, fields, entries } = await loadSiteMonth(req.user!.tenantId, id, month);
    ok(res, { site, fields, entries });
  })
);

// The report's labels + cover mail follow the REQUESTING admin's language
// (same source as notifications.ts: user_preferences, default 'it').
async function requesterLanguage(userId: string): Promise<'it' | 'en'> {
  const r = await adminPool.query(
    `SELECT language FROM user_preferences WHERE user_id = $1`,
    [userId]
  );
  return r.rows[0]?.language === 'en' ? 'en' : 'it';
}

function monthLabel(month: string, language: 'it' | 'en'): string {
  const d = new Date(`${month}-01T00:00:00`);
  return d.toLocaleDateString(language === 'it' ? 'it-IT' : 'en-GB', {
    month: 'long',
    year: 'numeric',
  });
}

// 'Cantiere Nord (Milano)' -> 'cantiere-nord-milano' for the download filename.
function safeFileName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cantiere'
  );
}

async function buildSiteReport(
  tenantId: string,
  siteId: string,
  month: string,
  language: 'it' | 'en'
): Promise<{ pdf: Buffer; siteName: string; tenantName: string; label: string }> {
  const { site, fields, entries } = await loadSiteMonth(tenantId, siteId, month);
  const tenant = await adminPool.query(`SELECT ragione_sociale FROM tenants WHERE id = $1`, [
    tenantId,
  ]);
  const tenantName = (tenant.rows[0]?.ragione_sociale as string | undefined) ?? '';
  const label = monthLabel(month, language);
  const pdf = await buildCantiereReportPdf({
    tenantName,
    site: { name: site.name as string, address: (site.address as string | null) ?? null },
    monthLabel: label,
    month,
    entries,
    fields,
    language,
  });
  return { pdf, siteName: site.name as string, tenantName, label };
}

/* ----- GET /api/v1/cantieri/sites/:id/report?month= — PDF download ----- */
cantieriRouter.get(
  '/sites/:id/report',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id);
    const month = requireMonth(req.query.month);
    const language = await requesterLanguage(req.user!.id);
    const { pdf, siteName } = await buildSiteReport(req.user!.tenantId, id, month, language);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cantiere-${safeFileName(siteName)}-${month}.pdf"`
    );
    res.send(pdf);
  })
);

const EmailList = z.array(z.string().email()).max(CANTIERE_REPORT_RECIPIENTS_MAX);
const ReportEmail = z.object({
  month: z.string().regex(MONTH_RE, "month must be 'YYYY-MM'"),
  to: z.array(z.string().email()).min(1).max(CANTIERE_REPORT_RECIPIENTS_MAX),
  cc: EmailList.optional(),
  bcc: EmailList.optional(),
  // Optional admin note (rich text); re-sanitized here against the allowlist.
  note: z.string().max(CANTIERE_REPORT_NOTE_MAX).optional(),
});

/* ----- POST /api/v1/cantieri/sites/:id/report/email — send the PDF to free-form addresses ----- */
cantieriRouter.post(
  '/sites/:id/report/email',
  requireCantieriAdmin,
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id);
    const parsed = ReportEmail.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body', parsed.error.flatten());
    const { month } = parsed.data;
    const recipients = Array.from(new Set(parsed.data.to));
    const cc = Array.from(new Set(parsed.data.cc ?? []));
    const bcc = Array.from(new Set(parsed.data.bcc ?? []));
    const noteHtml = parsed.data.note?.trim() ? sanitizeBulletinHtml(parsed.data.note) : undefined;
    const tenantId = req.user!.tenantId;

    const language = await requesterLanguage(req.user!.id);
    const { pdf, siteName, tenantName, label } = await buildSiteReport(
      tenantId,
      id,
      month,
      language
    );
    const mail = buildCantiereReportMail({
      tenantName,
      siteName,
      monthLabel: label,
      noteHtml,
      language,
    });
    const attachment = {
      filename: `cantiere-${safeFileName(siteName)}-${month}.pdf`,
      content: pdf,
      contentType: 'application/pdf',
    };
    // One combined mail: To = recipients, plus CC / BCC. sendMail swallows +
    // logs SMTP failures and returns false rather than throwing.
    const sent = await sendMail({ ...mail, to: recipients, cc, bcc, attachments: [attachment] });
    logger.info(
      { cantiere_id: id, month, to: recipients.length, cc: cc.length, bcc: bcc.length, sent },
      'cantiere report emailed'
    );

    await logAuditAs(adminPool, tenantId, req.user!.id, {
      action: 'cantiere.report_email',
      resourceType: 'cantiere',
      resourceId: id,
      targetLabel: siteName,
      after: { month, to: recipients, cc, bcc, has_note: !!noteHtml, sent },
      req,
    });
    ok(res, { sent });
  })
);
