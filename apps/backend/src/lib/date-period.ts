// Period filter for date-column listings (Cantieri activity entries): a single
// calendar DAY, a whole MONTH, or ALL TIME (no bound at all).
//
// The two bounded forms are mutually exclusive — a request carrying both
// `month` and `date` is a caller bug, not a silent precedence rule, so it dies
// as a 400. Both forms compare against a plain `date` column, so no timezone
// resolution is involved (entry_date is already a tenant-local calendar day,
// unlike the timestamptz stamps handled in tz.ts).

import { ValidationError } from '../errors/index.js';

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DatePeriod {
  month: string | null; // 'YYYY-MM'
  date: string | null; // 'YYYY-MM-DD'
}

export const ALL_TIME: DatePeriod = { month: null, date: null };

// 'YYYY-MM-DD' that also exists on the calendar: the regex alone accepts
// '2026-02-31', which would otherwise surface as a raw pg error on the column.
export function isCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function requireMonth(raw: unknown): string {
  if (typeof raw !== 'string' || !MONTH_RE.test(raw)) {
    throw new ValidationError("month must be 'YYYY-MM'");
  }
  return raw;
}

export function requireDate(raw: unknown): string {
  if (!isCalendarDate(raw)) throw new ValidationError("date must be 'YYYY-MM-DD'");
  return raw;
}

// undefined/'' means "not requested" (an empty query param from a cleared UI
// control must not 400).
function optional<T>(raw: unknown, parse: (v: unknown) => T): T | null {
  if (raw === undefined || raw === '') return null;
  return parse(raw);
}

/** Read `?month=` / `?date=` off a query object. Neither = all time. */
export function parseDatePeriod(query: { month?: unknown; date?: unknown }): DatePeriod {
  const month = optional(query.month, requireMonth);
  const date = optional(query.date, requireDate);
  if (month && date) {
    throw new ValidationError('month and date are mutually exclusive');
  }
  return { month, date };
}

/** Does the period bound the query at all? (false = "all time", needs a LIMIT.) */
export function isBounded(period: DatePeriod): boolean {
  return period.month !== null || period.date !== null;
}

// [first day, first day of next month) — passed straight to date comparisons.
export function monthRange(month: string): { start: string; end: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { start: `${month}-01`, end };
}

/**
 * SQL predicate restricting `col` to the period, appending its bind values to
 * `params`. Returns '' for all time (no predicate). The caller decides how to
 * join it (`AND ${p}` or pushing onto a filter list), so nothing is prefixed.
 */
export function periodPredicate(
  period: DatePeriod,
  col: string,
  params: unknown[]
): string {
  if (period.date) {
    params.push(period.date);
    return `${col} = $${params.length}`;
  }
  if (period.month) {
    const { start, end } = monthRange(period.month);
    params.push(start, end);
    return `${col} >= $${params.length - 1} AND ${col} < $${params.length}`;
  }
  return '';
}
