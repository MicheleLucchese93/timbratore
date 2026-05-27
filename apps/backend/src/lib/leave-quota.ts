import type { PoolClient } from 'pg';

export type LeaveType = 'ferie' | 'permessi' | 'malattia';

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
 * - ferie / malattia: sum of expected work hours from the user's shift template
 *   over the day range. Days without an assigned template default to 8h per
 *   weekday, 0 on weekends — a conservative fallback so quota math never crashes.
 */
export async function computeDurationHours(
  client: PoolClient,
  userId: string,
  type: LeaveType,
  fromTs: string,
  toTs: string
): Promise<number> {
  const from = new Date(fromTs);
  const to = new Date(toTs);
  if (type === 'permessi') {
    const ms = to.getTime() - from.getTime();
    return Math.round((ms / 3_600_000) * 100) / 100;
  }

  // Walk each calendar day in Europe/Rome between from and to inclusive.
  const days = enumerateDays(from, to);
  if (days.length === 0) return 0;

  // Load active shift template + slots for this user.
  const tplRow = await client.query(
    `SELECT a.shift_template_id
       FROM user_shift_assignments a
      WHERE a.user_id = $1
        AND a.valid_from <= $2::date
        AND (a.valid_to IS NULL OR a.valid_to >= $2::date)
      ORDER BY a.valid_from DESC LIMIT 1`,
    [userId, days[0]!.iso]
  );
  let slots: Array<{ day_of_week: number; hours: number }> = [];
  if ((tplRow.rowCount ?? 0) > 0) {
    const sl = await client.query(
      `SELECT day_of_week,
              EXTRACT(EPOCH FROM (end_time - start_time))/3600.0 AS hours
         FROM shift_template_slots
        WHERE shift_template_id = $1`,
      [tplRow.rows[0].shift_template_id]
    );
    slots = sl.rows.map((r) => ({
      day_of_week: Number(r.day_of_week),
      hours: Number(r.hours),
    }));
  }
  const hoursByDow = new Map<number, number>();
  for (const s of slots) {
    hoursByDow.set(s.day_of_week, (hoursByDow.get(s.day_of_week) ?? 0) + s.hours);
  }

  let total = 0;
  for (const d of days) {
    if (hoursByDow.size > 0) {
      total += hoursByDow.get(d.dow) ?? 0;
    } else {
      // Fallback: Mon–Fri = 8h.
      total += d.dow >= 1 && d.dow <= 5 ? 8 : 0;
    }
  }
  return Math.round(total * 100) / 100;
}

interface DayCell {
  iso: string;          // YYYY-MM-DD in Europe/Rome
  dow: number;          // ISO weekday 1..7
}

function enumerateDays(from: Date, to: Date): DayCell[] {
  const out: DayCell[] = [];
  const cur = new Date(from);
  cur.setUTCHours(12, 0, 0, 0); // mid-day anchor avoids DST edge issues
  const end = new Date(to);
  end.setUTCHours(12, 0, 0, 0);
  while (cur.getTime() <= end.getTime()) {
    out.push({ iso: cur.toISOString().slice(0, 10), dow: isoDow(cur) });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function isoDow(d: Date): number {
  const dow = d.getUTCDay();
  return dow === 0 ? 7 : dow;
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
