import type { PoolClient } from 'pg';
import { ValidationError } from '../errors/index.js';

export type LeaveType = 'ferie' | 'permessi' | 'malattia' | 'assenza';

export interface QuotaSummary {
  type: 'ferie' | 'permessi';
  assignment_id: string | null;
  template_id: string | null;
  template_name: string | null;
  initial_balance: number;
  accrued_total: number;
  used_approved: number;
  used_pending: number;
  /** balance = initial + accrued − approved. Can be negative. */
  residual_strict: number;
  /** Includes pending+cancellation_pending requests. Can be negative. */
  residual_with_pending: number;
  last_accrual_on: string | null;
  accrual_amount: number;
  accrual_frequency: 'monthly' | 'yearly';
  accrual_day_of_month: number;
  accrual_month: number | null;
}

/**
 * Returns one summary row per active assignment (one per type at most) for the
 * user. Balance is intentionally allowed to go negative — the API never blocks
 * submissions; companies decide policy informally.
 */
export async function getQuotaSummary(
  client: PoolClient,
  userId: string
): Promise<QuotaSummary[]> {
  const r = await client.query(
    `SELECT a.id AS assignment_id,
            a.type,
            a.template_id,
            t.name AS template_name,
            t.accrual_amount::float8 AS accrual_amount,
            t.accrual_frequency,
            t.accrual_day_of_month,
            t.accrual_month,
            a.initial_balance::float8 AS initial_balance,
            a.last_accrual_on,
            COALESCE(
              (SELECT SUM(ac.hours)::float8 FROM leave_accruals ac
                WHERE ac.assignment_id = a.id),
              0
            ) AS accrued_total,
            COALESCE(
              (SELECT SUM(lr.duration_hours)::float8
                 FROM leave_requests lr
                WHERE lr.user_id = a.user_id
                  AND lr.type = a.type
                  AND lr.status = 'approved'),
              0
            ) AS used_approved,
            COALESCE(
              (SELECT SUM(lr.duration_hours)::float8
                 FROM leave_requests lr
                WHERE lr.user_id = a.user_id
                  AND lr.type = a.type
                  AND lr.status IN ('pending','cancellation_pending')),
              0
            ) AS used_pending
       FROM leave_quota_assignments a
       JOIN leave_quota_templates t ON t.id = a.template_id
      WHERE a.user_id = $1
        AND a.ended_on IS NULL`,
    [userId]
  );
  return r.rows.map((row): QuotaSummary => {
    const initial = Number(row.initial_balance);
    const accrued = Number(row.accrued_total);
    const used_approved = Number(row.used_approved);
    const used_pending = Number(row.used_pending);
    const residual_strict = initial + accrued - used_approved;
    return {
      type: row.type,
      assignment_id: row.assignment_id,
      template_id: row.template_id,
      template_name: row.template_name,
      initial_balance: initial,
      accrued_total: accrued,
      used_approved,
      used_pending,
      residual_strict,
      residual_with_pending: residual_strict - used_pending,
      last_accrual_on: row.last_accrual_on,
      accrual_amount: Number(row.accrual_amount),
      accrual_frequency: row.accrual_frequency,
      accrual_day_of_month: row.accrual_day_of_month,
      accrual_month: row.accrual_month,
    };
  });
}

/**
 * Compute duration in hours for a leave request.
 *
 * - permessi: simply (to_ts - from_ts) in hours, expecting 15-min multiples.
 * - ferie / malattia / assenza: sum of expected work hours from the user's
 *   shift template over the day range. Days without an assigned template
 *   default to 8h per weekday, 0 on weekends — a conservative fallback so
 *   quota math never crashes.
 */
export async function computeDurationHours(
  client: PoolClient,
  userId: string,
  type: LeaveType,
  fromTs: string,
  toTs: string
): Promise<number> {
  const perDay = await computeHoursPerDay(client, userId, type, fromTs, toTs);
  let total = 0;
  for (const h of perDay.values()) total += h;
  return Math.round(total * 100) / 100;
}

/**
 * For each Europe/Rome calendar day touched by [from_ts, to_ts), return the
 * hours that a leave request of the given type would claim on that day.
 *
 * - permessi: clipped (to − from) intersection within the day, in hours.
 * - ferie / malattia / assenza: shift-template hours for that weekday
 *   (Mon–Fri 8h fallback when no template is assigned).
 *
 * Powers both the total duration computation and the per-day cap check.
 */
export async function computeHoursPerDay(
  client: PoolClient,
  userId: string,
  type: LeaveType,
  fromTs: string,
  toTs: string
): Promise<Map<string, number>> {
  const from = new Date(fromTs);
  const to = new Date(toTs);
  const days = enumerateDays(from, to);
  const out = new Map<string, number>();
  if (days.length === 0) return out;

  if (type === 'permessi') {
    for (const d of days) {
      const dayStart = romeStartOfDayMs(d.iso);
      const dayEnd = romeStartOfDayMs(addOneDay(d.iso));
      const startMs = Math.max(from.getTime(), dayStart);
      const endMs = Math.min(to.getTime(), dayEnd);
      const hours = Math.max(0, (endMs - startMs) / 3_600_000);
      out.set(d.iso, Math.round(hours * 100) / 100);
    }
    return out;
  }

  const hoursByDow = await loadShiftHoursByDow(client, userId, days[0]!.iso);
  for (const d of days) {
    const h =
      hoursByDow.size > 0
        ? hoursByDow.get(d.dow) ?? 0
        : d.dow >= 1 && d.dow <= 5
        ? 8
        : 0;
    out.set(d.iso, h);
  }
  return out;
}

async function loadShiftHoursByDow(
  client: PoolClient,
  userId: string,
  anchorIso: string
): Promise<Map<number, number>> {
  const tplRow = await client.query(
    `SELECT a.shift_template_id
       FROM user_shift_assignments a
      WHERE a.user_id = $1
        AND a.valid_from <= $2::date
        AND (a.valid_to IS NULL OR a.valid_to >= $2::date)
      ORDER BY a.valid_from DESC LIMIT 1`,
    [userId, anchorIso]
  );
  const hoursByDow = new Map<number, number>();
  if ((tplRow.rowCount ?? 0) === 0) return hoursByDow;
  const sl = await client.query(
    `SELECT day_of_week,
            EXTRACT(EPOCH FROM (end_time - start_time))/3600.0 AS hours
       FROM shift_template_slots
      WHERE shift_template_id = $1`,
    [tplRow.rows[0].shift_template_id]
  );
  for (const r of sl.rows) {
    const dow = Number(r.day_of_week);
    hoursByDow.set(dow, (hoursByDow.get(dow) ?? 0) + Number(r.hours));
  }
  return hoursByDow;
}

/**
 * Reject the request if any single Europe/Rome day inside [from, to) would
 * end up with more leave hours than the user's timesheet capacity for that
 * weekday, summing all the user's *active* requests (pending / approved /
 * cancellation_pending) plus the candidate request.
 *
 * malattia is exempt: it intentionally overrides overlapping ferie/permessi
 * via {@link applyMalattiaOverlap}, so the cap would block legitimate
 * sick-leave events whose purpose is exactly to supersede existing rows.
 */
export async function assertPerDayCap(
  client: PoolClient,
  userId: string,
  type: LeaveType,
  fromTs: string,
  toTs: string,
  excludeRequestId: string | null
): Promise<void> {
  if (type === 'malattia') return;
  const newPerDay = await computeHoursPerDay(client, userId, type, fromTs, toTs);
  if (newPerDay.size === 0) return;

  const isoDays = Array.from(newPerDay.keys()).sort();
  const firstIso = isoDays[0]!;
  const lastIsoInclusive = isoDays[isoDays.length - 1]!;
  const lastIsoExclusive = addOneDay(lastIsoInclusive);
  const hoursByDow = await loadShiftHoursByDow(client, userId, firstIso);
  const capacityOf = (iso: string): number => {
    const dow = isoDowFromIso(iso);
    if (hoursByDow.size > 0) return hoursByDow.get(dow) ?? 0;
    return dow >= 1 && dow <= 5 ? 8 : 0;
  };

  const params: unknown[] = [userId, firstIso, lastIsoExclusive];
  let exclude = '';
  if (excludeRequestId) {
    params.push(excludeRequestId);
    exclude = ` AND id <> $${params.length}`;
  }
  const r = await client.query(
    `SELECT id, type, from_ts, to_ts
       FROM leave_requests
      WHERE user_id = $1
        AND status IN ('pending','approved','cancellation_pending')
        AND to_ts > $2::date::timestamptz
        AND from_ts < $3::date::timestamptz
        ${exclude}`,
    params
  );

  const existingPerDay = new Map<string, number>();
  for (const row of r.rows) {
    const map = await computeHoursPerDay(
      client,
      userId,
      row.type as LeaveType,
      typeof row.from_ts === 'string' ? row.from_ts : new Date(row.from_ts).toISOString(),
      typeof row.to_ts === 'string' ? row.to_ts : new Date(row.to_ts).toISOString()
    );
    for (const [iso, h] of map) {
      if (newPerDay.has(iso)) {
        existingPerDay.set(iso, (existingPerDay.get(iso) ?? 0) + h);
      }
    }
  }

  for (const [iso, h] of newPerDay) {
    const total = (existingPerDay.get(iso) ?? 0) + h;
    const cap = capacityOf(iso);
    if (total > cap + 1e-6) {
      throw new ValidationError(
        `Il giorno ${formatItalianDate(iso)} eccede l'orario di lavoro: ${total.toFixed(2)}h richieste su ${cap.toFixed(2)}h disponibili.`
      );
    }
  }
}

function formatItalianDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

interface DayCell {
  iso: string;          // YYYY-MM-DD in Europe/Rome
  dow: number;          // ISO weekday 1..7
}

const ROME_TZ = 'Europe/Rome';

function enumerateDays(from: Date, to: Date): DayCell[] {
  const out: DayCell[] = [];
  let curIso = romeDateOnly(from);
  const endIso = romeDateOnly(to);
  while (curIso <= endIso) {
    out.push({ iso: curIso, dow: isoDowFromIso(curIso) });
    curIso = addOneDay(curIso);
  }
  return out;
}

function romeDateOnly(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ROME_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function addOneDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return dt.toISOString().slice(0, 10);
}

function isoDowFromIso(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/**
 * 00:00 Europe/Rome of the given ISO date, returned as UTC ms. CET (+1) or
 * CEST (+2) depending on DST — picked by re-formatting the candidate back
 * into Rome local and verifying the date round-trips.
 */
function romeStartOfDayMs(iso: string): number {
  const cestGuess = new Date(`${iso}T00:00:00+02:00`).getTime();
  const back = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROME_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(cestGuess));
  if (back === iso) return cestGuess;
  return new Date(`${iso}T00:00:00+01:00`).getTime();
}

/**
 * Find ferie/permessi requests that overlap a malattia range and either
 * trim them (if partial overlap) or supersede them (if fully covered).
 *
 * Returns the affected request IDs for audit logging.
 */
export interface OverlapResult {
  supersededIds: string[];
  trimmedIds: string[];
}

export async function applyMalattiaOverlap(
  client: PoolClient,
  userId: string,
  malattiaId: string,
  fromTs: string,
  toTs: string
): Promise<OverlapResult> {
  const overlapping = await client.query(
    `SELECT id, type, from_ts, to_ts, duration_hours, status
       FROM leave_requests
      WHERE user_id = $1
        AND id <> $2
        AND type IN ('ferie','permessi')
        AND status IN ('pending','approved','cancellation_pending')
        AND tstzrange(from_ts, to_ts, '[)') && tstzrange($3::timestamptz, $4::timestamptz, '[)')`,
    [userId, malattiaId, fromTs, toTs]
  );

  const supersededIds: string[] = [];
  const trimmedIds: string[] = [];
  const mFrom = new Date(fromTs).getTime();
  const mTo = new Date(toTs).getTime();

  for (const row of overlapping.rows) {
    const rFrom = new Date(row.from_ts).getTime();
    const rTo = new Date(row.to_ts).getTime();
    const fullyCovered = mFrom <= rFrom && mTo >= rTo;

    if (fullyCovered) {
      await client.query(
        `UPDATE leave_requests
            SET status = 'superseded_by_malattia',
                superseded_by_request_id = $1
          WHERE id = $2`,
        [malattiaId, row.id]
      );
      supersededIds.push(row.id);
      continue;
    }

    // Partial overlap: split — clip the leave to the portion outside the malattia.
    const leftKeeps = rFrom < mFrom;
    const rightKeeps = rTo > mTo;

    if (leftKeeps && !rightKeeps) {
      const newTo = new Date(mFrom).toISOString();
      const newDuration = await computeDurationHours(
        client,
        userId,
        row.type,
        new Date(rFrom).toISOString(),
        newTo
      );
      if (newDuration <= 0) {
        await client.query(
          `UPDATE leave_requests
              SET status = 'superseded_by_malattia', superseded_by_request_id = $1
            WHERE id = $2`,
          [malattiaId, row.id]
        );
        supersededIds.push(row.id);
      } else {
        await client.query(
          `UPDATE leave_requests SET to_ts = $1, duration_hours = $2 WHERE id = $3`,
          [newTo, newDuration, row.id]
        );
        trimmedIds.push(row.id);
      }
    } else if (rightKeeps && !leftKeeps) {
      const newFrom = new Date(mTo).toISOString();
      const newDuration = await computeDurationHours(
        client,
        userId,
        row.type,
        newFrom,
        new Date(rTo).toISOString()
      );
      if (newDuration <= 0) {
        await client.query(
          `UPDATE leave_requests
              SET status = 'superseded_by_malattia', superseded_by_request_id = $1
            WHERE id = $2`,
          [malattiaId, row.id]
        );
        supersededIds.push(row.id);
      } else {
        await client.query(
          `UPDATE leave_requests SET from_ts = $1, duration_hours = $2 WHERE id = $3`,
          [newFrom, newDuration, row.id]
        );
        trimmedIds.push(row.id);
      }
    } else if (leftKeeps && rightKeeps) {
      // Malattia is entirely inside the leave — keep the left half, supersede the right.
      const newTo = new Date(mFrom).toISOString();
      const newDuration = await computeDurationHours(
        client,
        userId,
        row.type,
        new Date(rFrom).toISOString(),
        newTo
      );
      await client.query(
        `UPDATE leave_requests SET to_ts = $1, duration_hours = $2 WHERE id = $3`,
        [newTo, Math.max(newDuration, 0), row.id]
      );
      trimmedIds.push(row.id);
    } else {
      // Should not happen given overlap predicate, but be safe.
      await client.query(
        `UPDATE leave_requests
            SET status = 'superseded_by_malattia', superseded_by_request_id = $1
          WHERE id = $2`,
        [malattiaId, row.id]
      );
      supersededIds.push(row.id);
    }
  }
  return { supersededIds, trimmedIds };
}
