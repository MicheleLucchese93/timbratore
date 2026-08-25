import { z } from 'zod';
import type { Request, Response } from 'express';
import { API_PAGE_SIZE_DEFAULT, API_PAGE_SIZE_MAX } from '@sonoqui/shared';
import { NotFoundError, ValidationError } from '../../errors/index.js';
import { TENANT_TZ_SQL } from '../../lib/tz.js';

/**
 * Shared shapes for the public API (/api/public/v1).
 *
 * The contract here is deliberately narrower and more stable than the internal
 * routes': an integration written today must keep working after we rename a
 * column, so every handler lists its output fields rather than returning rows
 * verbatim. That is the difference between an internal endpoint and a public
 * one, and the reason this surface is written out instead of being the same
 * routers mounted twice.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read a uuid path parameter, or 404.
 *
 * Without this, `GET /stamps/hello` reaches Postgres as `WHERE id = 'hello'`
 * and comes back as SQLSTATE 22P02 — which the terminal handler correctly
 * refuses to explain, so the caller gets an opaque 500 for what is really a
 * typo. A malformed id cannot name a row, so 404 is both true and useful.
 */
export function uuidParam(req: Request, name: string): string {
  const raw = String(req.params[name] ?? '');
  if (!UUID_RE.test(raw)) throw new NotFoundError(`${name} not found`);
  return raw;
}

/**
 * De-duplicate and sort a list of ids from a caller.
 *
 * Sorted because several endpoints insert one row per id and two concurrent
 * calls holding overlapping sets in different orders can deadlock on each
 * other; de-duplicated because the same id twice hits a primary key and turns a
 * caller's harmless sloppiness into a 500.
 */
export function uniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).sort();
}

/** Tenant-local calendar day, `YYYY-MM-DD`. */
export const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** Page window. Offset paging, not cursors: every list here is filtered to a
 *  date window first, so the page-drift a cursor protects against does not
 *  arise, and `?offset=` is what a gestionale's HTTP connector can express. */
export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(API_PAGE_SIZE_MAX).default(API_PAGE_SIZE_DEFAULT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Page = z.infer<typeof PageQuery>;

export function parseQuery<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('invalid query', parsed.error.flatten());
  return parsed.data;
}

export function parseBody<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('invalid body', parsed.error.flatten());
  return parsed.data;
}

/**
 * The one list envelope for the whole public API.
 *
 * `total` comes from a COUNT(*) OVER() on the same query, so it is the count of
 * the FILTERED set, not of the table — which is what a caller paging through
 * "March's punches" actually needs. It is null when the caller paged past the
 * end (there is no row to carry the window count) and 0 on an empty first page.
 */
export function okList<T>(
  res: Response,
  rows: T[],
  page: Page,
  total: number | null
): Response {
  return res.status(200).json({
    ok: true,
    data: rows,
    page: { limit: page.limit, offset: page.offset, total },
  });
}

/** Split `COUNT(*) OVER() AS total` back off the rows it rode in on. */
export function takeTotal<T extends { total?: unknown }>(
  rows: T[],
  page: Page
): { rows: Omit<T, 'total'>[]; total: number | null } {
  const total = rows.length > 0 ? Number(rows[0]!.total) : page.offset > 0 ? null : 0;
  return {
    rows: rows.map(({ total: _t, ...rest }) => rest),
    total,
  };
}

/**
 * Tenant-local day bounds as SQL.
 *
 * A calendar day is a wall-clock notion in the company's zone and a punch is a
 * UTC instant; converting on the PARAMETER rather than on the column is what
 * keeps the occurred_at index usable (and is the same construction the internal
 * routes use — see lib/tz.ts and the UTC-date-bucketing notes).
 */
export function dayStartSql(paramIndex: number): string {
  return `($${paramIndex}::timestamp AT TIME ZONE ${TENANT_TZ_SQL})`;
}

export function dayEndExclusiveSql(paramIndex: number): string {
  return `(($${paramIndex}::date + 1)::timestamp AT TIME ZONE ${TENANT_TZ_SQL})`;
}

/** Build `WHERE` from a list of predicates, or nothing when there are none. */
export function whereSql(predicates: string[]): string {
  return predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
}
