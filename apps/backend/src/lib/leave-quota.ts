import type { PoolClient } from 'pg';
import { ConflictError, ValidationError } from '../errors/index.js';
import { TENANT_TZ_SQL } from './tz.js';

export type LeaveType = 'ferie' | 'permessi' | 'malattia' | 'assenza';

/**
 * Every value leave_requests.type can actually hold. 'chiusura' (company
 * closure) is admin-only — POST /leaves cannot produce it, only POST
 * /leaves/bulk — so it is deliberately outside {@link LeaveType}, which types
 * the *submittable* kinds.
 */
export type StoredLeaveType = LeaveType | 'chiusura';

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
 * All types: the clipped (to_ts − from_ts) span per day, capped at the hours
 * the user is scheduled that day. An all-day request (00:00–23:59) collapses
 * to the shift length; a partial-day request (ferie/permessi "Orario
 * specifico") counts only the selected window; a non-working day counts 0.
 * Days without an assigned template default to 8h per weekday, 0 on weekends —
 * a conservative fallback so quota math never crashes.
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
 * All types: clipped (to − from) intersection within the day, capped at the
 * shift-template hours for that weekday — so an all-day request (00:00–23:59)
 * collapses to the scheduled day length, a partial-day window counts only its
 * overlap, and a non-working day counts 0. Uses the Mon–Fri 8h / weekend 0
 * fallback when no template is assigned. Powers both the total duration
 * computation and the per-day cap.
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

  const hoursByDow = await loadShiftHoursByDow(client, userId, days[0]!.iso);
  const scheduledHours = (dow: number): number =>
    hoursByDow.size > 0 ? hoursByDow.get(dow) ?? 0 : dow >= 1 && dow <= 5 ? 8 : 0;

  for (const d of days) {
    const dayStart = romeStartOfDayMs(d.iso);
    const dayEnd = romeStartOfDayMs(addOneDay(d.iso));
    const startMs = Math.max(from.getTime(), dayStart);
    const endMs = Math.min(to.getTime(), dayEnd);
    const clipped = Math.max(0, (endMs - startMs) / 3_600_000);
    const hours = Math.min(clipped, scheduledHours(d.dow));
    out.set(d.iso, Math.round(hours * 100) / 100);
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
 * ─── THE LOCK ORDER FOR EVERYTHING THAT WRITES leave_requests ──────────────
 *
 *   1. pg_advisory_xact_lock('leave:day-cap:<tenant>:<user>')  ← lockLeaveUser
 *   2. leave_requests row locks (SELECT … FOR UPDATE, UPDATE, INSERT)
 *
 * In that order, always, in every handler — never a row lock first.
 *
 * Why it has to be written down: the advisory lock shipped in 2db7304 and
 * created a cycle nobody saw, because the two sides take their locks in
 * opposite orders.
 *
 *   T1  POST /leaves (malattia)   assertPerDayCap → advisory lock K(user),
 *                                 then applyMalattiaOverlap UPDATEs the user's
 *                                 pending ferie row R   → waits for R
 *   T2  POST /leaves/:id/approve  SELECT … WHERE id = R FOR UPDATE (holds R),
 *                                 then assertPerDayCap → waits for K(user)
 *
 * T1 holds K and wants R; T2 holds R and wants K. Postgres notices after
 * deadlock_timeout and aborts one with SQLSTATE 40P01 — a 500 on either the
 * employee's sick note or the admin's approval. Before the advisory lock the
 * pair simply serialized on R and both completed, so this was a regression
 * introduced *by* the duplicate-ferie fix.
 *
 * Handlers that need the row before they know whose it is (every /leaves/:id/*
 * route) read user_id with a plain, unlocked SELECT, take the advisory lock,
 * and only then re-read FOR UPDATE — see lockRequestForUpdate() in
 * routes/leaves.ts. A transaction touching several employees (POST
 * /leaves/bulk) acquires their locks in a deterministic order — sorted user id
 * — so two concurrent bulks can never grab the same two users in opposite
 * orders.
 */

/**
 * How long a leave writer is willing to wait for a lock before giving up.
 *
 * Applied with SET LOCAL, so it covers the advisory lock below *and* every row
 * lock the rest of the transaction takes. Without it a blocked writer waits
 * indefinitely: the pool is 20 connections (lib/db.ts) and notifications used
 * to be sent while holding this lock, with nodemailer's default 10-minute
 * socket timeout at the other end — one stalled Brevo send could park every
 * subsequent write for that employee behind it and pin a connection each time.
 * Failing after a few seconds turns that into a retryable 409 instead of a
 * queue. 5s is comfortably above any healthy leave write (all of them are a
 * handful of small statements) and far below any human's patience.
 */
const LEAVE_LOCK_TIMEOUT_MS = 5_000;

function pgErrorCode(err: unknown): string | null {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/**
 * Step 1 of the lock order above: serialize every write touching this
 * employee's leave rows, for the rest of the transaction.
 *
 * Prod incident, Time System S.a.s, August 2026. A single day can raise TWO
 * anomalies for the same user — routes/shifts.ts pushes 'early_clock_out' and
 * 'short_hours' independently — and the web anomalies bulk bar applied the
 * chosen correction ONCE PER SELECTED ROW, in parallel via mapLimit(). Ticking
 * both rows of the same day and choosing "inserisci ferie" fired two POST
 * /api/v1/leaves/admin-create concurrently. Each transaction read the
 * pre-insert state, each saw 0h already booked on that day, both passed the
 * per-day cap, and the employee ended up with two 8h ferie rows on one date:
 * 16h of ferie in the payroll export and a ferie balance consumed twice. 14
 * duplicate (user, day) pairs were found in prod, the two rows of each pair
 * created ~125 microseconds apart by the same admin.
 *
 * The cap is a read-modify-write, so no amount of SQL in the check itself can
 * fix it — both readers legitimately saw a state in which their own insert fit.
 * The read and the insert have to be mutually exclusive instead.
 *
 * pg_advisory_xact_lock (rather than pg_advisory_lock + a try/finally unlock)
 * because every caller reaches us through tenantHandler → withTenantRLS, which
 * really does BEGIN / COMMIT / ROLLBACK: the lock is held past the INSERT that
 * follows and released by the transaction end, with no unlock bookkeeping that
 * a thrown ValidationError could skip. Callers run at READ COMMITTED (no
 * isolation level is set anywhere), which is what makes the second waiter take
 * a fresh snapshot and actually see the row the first one committed.
 *
 * The key is per (tenant, user), never global: two employees — or the same
 * person in two tenants — must not queue behind each other. The tenant comes
 * from the RLS session variable rather than a parameter, so the key can never
 * drift from the tenant whose rows the transaction is allowed to see. The
 * 'leave:day-cap:' prefix namespaces the hash, since advisory lock ids are a
 * single database-wide space.
 *
 * Re-entrant on purpose: handlers take it at the top and assertPerDayCap takes
 * it again. pg_advisory_xact_lock is reference-counted per transaction, so the
 * second call returns immediately, and being stateless here is deliberate —
 * remembering "this client already locked" would be wrong the moment the
 * pooled connection is handed to the next transaction.
 *
 * Both halves of the key go through ::uuid before ::text, and that cast is the
 * whole lock, not decoration. hashtextextended hashes BYTES, so
 * 'aaaaaaaa-…' and 'AAAAAAAA-…' are two different keys — while every guard the
 * lock protects compares `user_id = $1` against a uuid COLUMN, where Postgres
 * parses the parameter and matches the two spellings as the same person.
 * AdminCreateBody / BulkBody validate with zod's .uuid(), whose regex is
 * case-insensitive and which normalises nothing, so a client that upper-cases
 * the id it just read is not doing anything the API rejects. Without the cast,
 * two concurrent admin-creates for that one employee take two different
 * advisory locks, neither waits for the other, and both pass the read-modify-
 * write cap — the exact Time System race this lock exists to close, reachable
 * by changing letter case. uuid::text always renders canonical lowercase, so
 * every spelling collapses onto one key.
 *
 * The tenant half is cast for the same reason even though today it cannot
 * differ: req.user.tenantId is read back out of a uuid column by
 * fetchMembership, never taken from the X-Tenant-Id header the client sent. An
 * invariant that holds only because of what some other file happens to do is
 * not one to key a lock on. NULLIF guards the empty string a placeholder GUC
 * is left with once a SET LOCAL has been rolled back, which '' ::uuid would
 * turn into a 22P02 instead of the '-' fallback.
 */
export async function lockLeaveUser(client: PoolClient, userId: string): Promise<void> {
  await client.query(`SET LOCAL lock_timeout = ${LEAVE_LOCK_TIMEOUT_MS}`);
  try {
    await client.query(
      `SELECT pg_advisory_xact_lock(
                hashtextextended(
                  'leave:day-cap:'
                    || COALESCE(
                         NULLIF(current_setting('app.current_tenant_id', true), '')::uuid::text,
                         '-'
                       )
                    || ':' || $1::uuid::text,
                  0
                )
              )`,
      [userId]
    );
  } catch (err) {
    const code = pgErrorCode(err);
    // 55P03 lock_not_available = the lock_timeout above fired. 40P01 =
    // deadlock_detected, which the documented lock order is meant to make
    // impossible — if it ever shows up again it is a new inversion, and the
    // client should still see a retryable conflict instead of a raw 500.
    if (code === '55P03' || code === '40P01') {
      throw new ConflictError(
        "Un'altra operazione sulle assenze di questo dipendente è ancora in corso. Riprova tra qualche istante.",
        'LEAVE_LOCK_TIMEOUT'
      );
    }
    throw err;
  }
}

const OVERLAP_PHRASE_IT: Record<StoredLeaveType, string> = {
  ferie: 'giorni di ferie già registrati',
  permessi: 'un permesso già registrato',
  malattia: 'una malattia già registrata',
  assenza: "un'assenza già registrata",
  chiusura: 'una chiusura aziendale già registrata',
};

export interface LeaveOverlap {
  id: string;
  from_ts: string;
  to_ts: string;
  /**
   * The INPS certificate number, for malattia rows only — null on every other
   * type. It is what tells a re-submitted certificate (the same protocol filed
   * twice by a phone retrying over a flaky connection) apart from a genuine
   * "certificato di continuazione", which carries a NEW protocol and legally
   * starts on the last day the previous one covered. See
   * {@link resolveMalattiaWindow}.
   */
  inps_protocol: string | null;
}

async function queryOverlaps(
  client: PoolClient,
  userId: string,
  type: StoredLeaveType,
  fromTs: string,
  toTs: string,
  excludeRequestId: string | null,
  limit: number | null
): Promise<LeaveOverlap[]> {
  const params: unknown[] = [userId, type, fromTs, toTs];
  let exclude = '';
  if (excludeRequestId) {
    params.push(excludeRequestId);
    exclude = ` AND id <> $${params.length}`;
  }
  const r = await client.query(
    `SELECT id, from_ts, to_ts, inps_protocol
       FROM leave_requests
      WHERE user_id = $1
        AND type = $2
        AND status IN ('pending','approved','cancellation_pending')
        AND tstzrange(from_ts, to_ts, '[)')
            && tstzrange($3::timestamptz, $4::timestamptz, '[)')
        ${exclude}
      ORDER BY from_ts
      ${limit === null ? '' : `LIMIT ${limit}`}`,
    params
  );
  return r.rows.map((row) => ({
    id: row.id as string,
    from_ts: typeof row.from_ts === 'string' ? row.from_ts : new Date(row.from_ts).toISOString(),
    to_ts: typeof row.to_ts === 'string' ? row.to_ts : new Date(row.to_ts).toISOString(),
    inps_protocol: typeof row.inps_protocol === 'string' ? row.inps_protocol : null,
  }));
}

/**
 * The first *active* leave of the SAME type whose window overlaps [from, to),
 * or null. Half-open on both sides, so two permessi that merely touch
 * (09:00–10:00 and 10:00–11:00) do not count as overlapping.
 *
 * Same status set as the per-day cap — pending / approved /
 * cancellation_pending — so the two guards agree on what "already booked"
 * means.
 */
export async function findSameTypeOverlap(
  client: PoolClient,
  userId: string,
  type: StoredLeaveType,
  fromTs: string,
  toTs: string,
  excludeRequestId: string | null
): Promise<LeaveOverlap | null> {
  const rows = await queryOverlaps(client, userId, type, fromTs, toTs, excludeRequestId, 1);
  return rows[0] ?? null;
}

/**
 * Every active same-type leave overlapping [from, to), earliest first.
 *
 * The "is there one?" question ({@link findSameTypeOverlap}) is enough to
 * refuse a single request, but a company closure is not refused as a whole —
 * {@link splitClosureAroundOverlaps} has to know which DAYS of the window are
 * taken, and one LIMIT 1 row cannot answer that.
 */
export async function findSameTypeOverlaps(
  client: PoolClient,
  userId: string,
  type: StoredLeaveType,
  fromTs: string,
  toTs: string,
  excludeRequestId: string | null
): Promise<LeaveOverlap[]> {
  return queryOverlaps(client, userId, type, fromTs, toTs, excludeRequestId, null);
}

/** Italian one-liner naming the clashing window — reused as the bulk skip reason. */
export function describeOverlap(type: StoredLeaveType, hit: LeaveOverlap): string {
  return `Il periodo si sovrappone a ${OVERLAP_PHRASE_IT[type]} (${formatRomeWindow(hit.from_ts, hit.to_ts)}).`;
}

/** One leave_requests row's worth of a company closure: a run of free days. */
export interface ClosureSegment {
  fromTs: string;
  /**
   * The LAST INSTANT of the run's last free day (…T23:59 Rome), never the
   * midnight that opens the next one — see {@link DAY_CLOSING_GAP_MS}.
   */
  toTs: string;
}

export interface ClosureSplit {
  /** Runs of consecutive free days, in order. Empty = the employee is fully covered. */
  segments: ClosureSegment[];
  /** Europe/Rome days (YYYY-MM-DD) dropped, each with the row that already owns it. */
  blockedDays: Array<{ iso: string; clash: LeaveOverlap }>;
}

/**
 * Split a company closure around the same-type absences the employee already
 * has, day by day.
 *
 * Why this is not just findSameTypeOverlap: the duplicate guard answers "does
 * ANY day of this window collide?", and POST /leaves/bulk used that answer to
 * drop the employee from the whole closure. "Chiusura natalizia" 24/12 → 31/12
 * with deduct_ferie therefore vanished entirely for anyone holding a single
 * approved ferie day on, say, 27/12 — no row for the 24th, 25th, 26th, 28th,
 * 29th, 30th or 31st. The call still answered 201 because the other employees
 * succeeded, so the holes surfaced weeks later in the payroll export.
 *
 * A closure is per-day by nature, so the guard has to be too: a day already
 * carrying the same kind of absence is skipped, every other day is still
 * inserted. Consecutive free days are coalesced into one segment rather than
 * emitted one row per day, so the untouched case — nobody has anything, which
 * is almost every employee of almost every closure — produces exactly the
 * single row spanning the requested window that it always did, over the same
 * instants as the modal sent (00:00 → 23:59). Only an employee who really does
 * collide ends up with the closure as two or three rows.
 *
 * Every segment ends on the last instant of its last free day, never on the
 * midnight that opens the next one — including the untouched case, which
 * normalises a caller that did send a midnight end. See
 * {@link DAY_CLOSING_GAP_MS} for the day the export used to invent.
 *
 * Every segment carries the caller's batch_id, and POST
 * /leaves/bulk/:batchId/revoke cancels by batch_id alone, so N rows per
 * employee revoke exactly like 1.
 */
export async function splitClosureAroundOverlaps(
  client: PoolClient,
  userId: string,
  type: StoredLeaveType,
  fromTs: string,
  toTs: string
): Promise<ClosureSplit> {
  const hits = await findSameTypeOverlaps(client, userId, type, fromTs, toTs, null);
  return splitWindowAroundOverlaps(hits, fromTs, toTs);
}

/**
 * How far short of the next midnight a segment stops: one minute, which is
 * exactly the …T23:59 both clients already send for a full day (web
 * NewLeaveModal, mobile buildLeaveRange).
 *
 * Ending a trimmed segment at the next midnight instead is what defect D1 was.
 * Tenant on 8h Mon–Fri, "Chiusura ferragosto" 10 → 14 Aug 2026 sent as
 * 10/08 00:00 → 14/08 23:59; employee X already holds an approved same-type
 * absence on 12/08, so the split blocked that day and emitted segment 1 as
 * 2026-08-09T22:00Z → 2026-08-11T22:00Z with duration_hours 16 — a window whose
 * end instant IS 12/08 00:00. The export enumerates a leave's days inclusively,
 * saw 10, 11 AND 12 August, and spread 16h as 5,33h per day; 12/08 already
 * carried X's own 8h row, so the day printed 13,33h and took the wrong marker.
 *
 * The end has to name the last instant the segment actually covers, not the
 * first instant it does not. Every consumer of these rows is unchanged by the
 * missing minute because they all work in whole days or clip against the
 * employee's schedule: computeHoursPerDay caps the day at the shift length
 * (min(23.98h, 8h) is still 8h), the tstzrange probes are half-open and
 * day-aligned, splitWindowAroundOverlaps re-reads such a row as covering its
 * own last day and not the next one, and the calendars treat "00:00 → within a
 * minute of midnight" as all-day (packages/shared leaveDaySlice). One consumer
 * is actively FIXED by it: applyMalattiaOverlap called a closure row ending at
 * midnight only *partially* covered by a sick note ending at 23:59 and trimmed
 * it to a 1-minute leftover instead of superseding it.
 */
const DAY_CLOSING_GAP_MS = 60_000;

/**
 * ─── THE WHOLE-DAY CONVENTION, IN ONE PLACE ────────────────────────────────
 *
 * A stored leave window runs from 00:00 Europe/Rome of the FIRST day it covers
 * to 23:59 of the LAST ({@link DAY_CLOSING_GAP_MS} before the next midnight),
 * and an end instant sitting exactly ON midnight is the OPEN edge of the day it
 * lands in, not a moment inside it — the same reading
 * {@link eachZonedDateKeyInclusive} (lib/tz.ts) gives it, which is what the
 * payroll export buckets by.
 *
 * The three helpers below are the only place that convention is expressed.
 * Re-deriving it per branch is what defect D1 was: applyMalattiaOverlap resumed
 * a trimmed holiday at the sick note's END INSTANT — 12/08 23:59, a minute
 * inside a day the certificate fully covers — so the export enumerated 12, 13
 * and 14 August for a two-day remainder and spread 16h as 5,33h each. 12 August
 * already carried the sick note's own 8h, so Dettaglio giornaliero printed
 * 13,33h on an 8h day and the two real holiday days printed short.
 */

/** The first Europe/Rome day a window starting at `ms` covers. */
function firstCoveredDayIso(ms: number): string {
  return romeDateOnly(new Date(ms));
}

/**
 * The last Europe/Rome day a window ending at `ms` covers.
 *
 * Midnight is the open edge, exactly as {@link eachZonedDateKeyInclusive} reads
 * it: 10 Aug 00:00 → 12 Aug 00:00 covers two days, not three.
 */
function lastCoveredDayIso(ms: number): string {
  const iso = romeDateOnly(new Date(ms));
  return romeStartOfDayMs(iso) === ms ? romeDateOnly(new Date(ms - 1)) : iso;
}

/**
 * 23:59 Rome of the day BEFORE the one `ms` opens — where a leave interrupted
 * by something starting at `ms` has to stop.
 *
 * Whole days on purpose, even when `ms` is mid-morning: a sick note claims the
 * whole day's scheduled hours (computeHoursPerDay caps the clipped span at the
 * shift length, so a 09:00 → 23:59 certificate still counts 8h on an 8h day),
 * and leaving a slice of holiday on that same date would double-book it.
 */
function lastInstantBeforeDayOf(ms: number): number {
  return romeStartOfDayMs(firstCoveredDayIso(ms)) - DAY_CLOSING_GAP_MS;
}

/**
 * 00:00 Rome of the first day AFTER the last one `ms` covers — where a leave
 * interrupted until `ms` has to resume.
 */
function firstInstantAfterDayOf(ms: number): number {
  return romeStartOfDayMs(addOneDay(lastCoveredDayIso(ms)));
}

/** 23:59 Rome of the day `iso` — the last instant a window may be closed at. */
function romeLastInstantOfDayMs(iso: string): number {
  return romeStartOfDayMs(addOneDay(iso)) - DAY_CLOSING_GAP_MS;
}

/**
 * The day-by-day arithmetic of {@link splitClosureAroundOverlaps}, with the
 * colliding rows already in hand.
 *
 * Split out so {@link resolveMalattiaWindow} can reuse it after inspecting the
 * same rows for a duplicate INPS protocol — one query per employee, not two.
 */
export function splitWindowAroundOverlaps(
  overlaps: readonly LeaveOverlap[],
  fromTs: string,
  toTs: string
): ClosureSplit {
  const windowFrom = new Date(fromTs).getTime();
  const windowTo = new Date(toTs).getTime();
  const hits = overlaps.map((h) => ({
    hit: h,
    from: new Date(h.from_ts).getTime(),
    to: new Date(h.to_ts).getTime(),
  }));

  // Days the closure actually touches. A window ending at exactly midnight
  // (half-open) formally enumerates the following day too; it gets a zero-width
  // intersection and is dropped here, so the split never invents a day the
  // closure does not cover.
  //
  // `end` is the day's exclusive edge and stays that way — it is what the
  // half-open occupancy test below needs. `lastInstant` is what a segment may
  // be closed at: the same edge pulled back a minute, unless the requested
  // window already ends earlier inside this day.
  const days: Array<{ iso: string; start: number; end: number; lastInstant: number }> = [];
  for (const d of enumerateDays(new Date(fromTs), new Date(toTs))) {
    const dayEnd = romeStartOfDayMs(addOneDay(d.iso));
    const start = Math.max(windowFrom, romeStartOfDayMs(d.iso));
    const end = Math.min(windowTo, dayEnd);
    if (end > start) {
      days.push({ iso: d.iso, start, end, lastInstant: Math.min(end, romeLastInstantOfDayMs(d.iso)) });
    }
  }

  const segments: ClosureSegment[] = [];
  const blockedDays: Array<{ iso: string; clash: LeaveOverlap }> = [];
  let run: { start: number; end: number } | null = null;
  const closeRun = (): void => {
    if (!run) return;
    // A run can only collapse when the window's free time is entirely inside
    // the final minute of a day, and a row spanning less than a minute would
    // compute 0 hours anyway. Dropping it beats inserting from > to, which the
    // tstzrange guards and every clip below would then read as an empty range.
    if (run.end > run.start) {
      segments.push({
        fromTs: new Date(run.start).toISOString(),
        toTs: new Date(run.end).toISOString(),
      });
    }
    run = null;
  };

  for (const d of days) {
    // Half-open on both sides, same as the SQL predicate: an absence that ends
    // at 00:00 of this day does not occupy it.
    const owner = hits.find((h) => h.from < d.end && h.to > d.start);
    if (owner) {
      blockedDays.push({ iso: d.iso, clash: owner.hit });
      closeRun();
      continue;
    }
    if (run) run.end = d.lastInstant;
    else run = { start: d.start, end: d.lastInstant };
  }
  closeRun();

  return { segments, blockedDays };
}

/**
 * Reject a leave that duplicates an existing one of the same type.
 *
 * The per-day cap alone does not catch this. It compares *hours* against the
 * day's capacity, so two identical 2h permessi on an 8h day sum to 4h and both
 * pass — the August duplicate was only caught because a full-day ferie happens
 * to be exactly the capacity. That gap became reachable the moment "permesso in
 * blocco" shipped in the anomalies bulk bar, which fires one admin-create per
 * selected row.
 *
 * Same type only, on purpose: ferie in the morning and a permesso in the
 * afternoon of one day is legitimate, and a cross-type pair that really does
 * overbook the day is already the cap's job. Two non-overlapping permessi on
 * one day (09:00–10:00 and 15:00–16:00) stay legal.
 *
 * malattia DOES reach here, unlike the hours cap — but only as a backstop, and
 * only for a window {@link resolveMalattiaWindow} has already cleared. A sick
 * note is meant to overlap the rows underneath it; the ones it sweeps are
 * ferie/permessi ({@link applyMalattiaOverlap} selects `type IN
 * ('ferie','permessi')` and excludes the new row by id, so it never touches
 * another malattia), and this probe filters on `type = $2`, so for a malattia it
 * can only ever match a SECOND sick note on the same days.
 *
 * Treating every such match as a duplicate is what defect D2 was: a
 * "certificato di continuazione" is issued ON the last day the previous
 * certificate covers — that is the norm, not an edge case — so the second
 * protocol always overlaps the first by one day and POST /leaves answered 409
 * "modifica o annulla la richiesta esistente", advice the employee cannot act
 * on (request-cancellation refuses malattia, /cancel wants status 'pending' and
 * malattia is created 'approved'). resolveMalattiaWindow now settles that
 * question BEFORE the insert and hands this probe a window with no malattia day
 * left in it, so a hit here means a caller filed a sick note without resolving
 * it first.
 */
export async function assertNoSameTypeOverlap(
  client: PoolClient,
  userId: string,
  type: StoredLeaveType,
  fromTs: string,
  toTs: string,
  excludeRequestId: string | null
): Promise<void> {
  const hit = await findSameTypeOverlap(client, userId, type, fromTs, toTs, excludeRequestId);
  if (!hit) return;
  throw new ConflictError(
    `${describeOverlap(type, hit)} Modifica o annulla la richiesta esistente.`,
    'LEAVE_OVERLAP'
  );
}

/** The window a sick note may actually be filed over, once earlier certificates are accounted for. */
export interface MalattiaWindow {
  /** Start instant to store — the requested one unless an earlier certificate owns the first days. */
  fromTs: string;
  /**
   * End instant to store — the requested one, or (when the request had to be
   * clipped) the last instant of its last free day, never the next midnight.
   * See {@link DAY_CLOSING_GAP_MS}.
   */
  toTs: string;
  /** Europe/Rome days (YYYY-MM-DD) dropped because an earlier sick note already covers them. */
  alreadyCovered: string[];
}

/** Protocol numbers are compared as the registry issues them: trimmed, case-blind. */
function sameProtocol(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Decide what a new malattia may cover, given the ones the employee already
 * has, and refuse only what is genuinely unfileable.
 *
 * The rule this replaces treated ANY same-type overlap as a duplicate, which
 * blocked the most ordinary event in Italian sick leave. Employee files
 * malattia 10 → 14 September (protocol A) from the app; on the 14th the doctor
 * issues a "certificato di continuazione" dal 14 al 20 (protocol B), because a
 * continuation is issued on the last day the previous certificate covers. The
 * old probe matched A on 14/09 and answered 409 telling the employee to modify
 * or cancel A — which no employee can do: /request-cancellation refuses
 * malattia outright and /cancel requires status 'pending' while malattia is
 * created 'approved'. The sick period simply went unrecorded until an admin
 * noticed.
 *
 * The rule now distinguishes the two things that overlap looks like:
 *
 *   1. Same INPS protocol → the SAME certificate arriving twice. That is the
 *      flaky-phone double POST the guard was built for (and it no longer
 *      depends on the two submits carrying identical instants: a retry with a
 *      re-picked end date is still the same certificate). Refused.
 *   2. Every day already covered → nothing left to record, whatever the
 *      protocol says. Refused, and it catches the byte-identical retry too.
 *   3. Otherwise → a new certificate for days that are still free. Accepted,
 *      clipped to those days.
 *
 * Clipping the NEW row rather than trimming the old one is deliberate. The
 * earlier certificate is already approved and may already have been exported to
 * payroll; the day belongs to the protocol that first claimed it, and rewriting
 * a filed sick note to make room for a later one would change history the
 * employee never asked to change. The clip is day-granular
 * ({@link splitWindowAroundOverlaps}) and both clients send whole days for
 * malattia, so what the continuation loses is exactly the day it duplicated.
 *
 * Run BEFORE the INSERT, never after: the sweep in {@link applyMalattiaOverlap}
 * excludes the new row by id, but this probe has no id to exclude yet and would
 * match the row against itself the moment it exists. That ordering is also what
 * keeps the check inside the employee's advisory lock and ahead of any row
 * lock — see the lock order at the top of this file.
 *
 * A request that collides with nothing returns its own instants untouched: the
 * common case never reaches the split at all.
 */
export async function resolveMalattiaWindow(
  client: PoolClient,
  userId: string,
  fromTs: string,
  toTs: string,
  inpsProtocol: string,
  excludeRequestId: string | null
): Promise<MalattiaWindow> {
  // Re-entrant safety net, same contract as assertPerDayCap: the handler has
  // normally taken this already, and reading the day map without it would be
  // the read-modify-write race again — two continuations of the same episode
  // filed at once would each see the other's days as free.
  await lockLeaveUser(client, userId);

  const hits = await findSameTypeOverlaps(
    client,
    userId,
    'malattia',
    fromTs,
    toTs,
    excludeRequestId
  );
  if (hits.length === 0) return { fromTs, toTs, alreadyCovered: [] };

  const duplicate = hits.find(
    (h) => h.inps_protocol !== null && sameProtocol(h.inps_protocol, inpsProtocol)
  );
  if (duplicate) {
    throw new ConflictError(
      `Il certificato con protocollo INPS ${inpsProtocol.trim()} è già registrato ` +
        `(${formatRomeWindow(duplicate.from_ts, duplicate.to_ts)}). ` +
        `Per prolungare la malattia inserisci il nuovo certificato con il suo protocollo.`,
      'LEAVE_DUPLICATE_PROTOCOL'
    );
  }

  const split = splitWindowAroundOverlaps(hits, fromTs, toTs);
  // The row to name in a refusal. Every hit overlaps the requested window by
  // SQL, so the day walk always blocks at least one day — but a message that
  // reads `undefined` is a worse failure than the refusal it describes, and
  // hits[0] is a genuinely overlapping certificate either way.
  const clash = split.blockedDays[0]?.clash ?? hits[0]!;
  if (split.segments.length === 0) {
    throw new ConflictError(
      `${describeOverlap('malattia', clash)} ` +
        `Ogni giorno del periodo è già coperto da un certificato: chiedi all'amministratore di correggerlo.`,
      'LEAVE_OVERLAP'
    );
  }
  if (split.segments.length > 1) {
    // A period with an already-certified stretch in the MIDDLE of it — a
    // back-dated certificate, not a continuation. One leave_requests row cannot
    // hold two disjoint runs and POST /leaves answers with one row, so name the
    // free periods and let the employee file them: refusing with instructions
    // beats silently recording half of what was asked for.
    const periods = split.segments.map((s) => formatRomeDayRange(s.fromTs, s.toTs)).join(' e ');
    throw new ConflictError(
      `Il periodo è interrotto da una malattia già registrata ` +
        `(${formatRomeWindow(clash.from_ts, clash.to_ts)}). ` +
        `Inserisci separatamente i periodi ancora scoperti: ${periods}.`,
      'LEAVE_OVERLAP'
    );
  }

  const seg = split.segments[0]!;
  return {
    fromTs: seg.fromTs,
    toTs: seg.toTs,
    alreadyCovered: split.blockedDays.map((d) => d.iso),
  };
}

/**
 * Reject the request if any single Europe/Rome day inside [from, to) would
 * end up with more leave hours than the user's timesheet capacity for that
 * weekday, summing all the user's *active* requests (pending / approved /
 * cancellation_pending) plus the candidate request — and, on top of that,
 * reject one that simply duplicates an existing leave of the same type
 * ({@link assertNoSameTypeOverlap}).
 *
 * malattia is exempt from the HOURS half only. A sick note legitimately lands
 * on a day already full of ferie — that is the whole point, and
 * {@link applyMalattiaOverlap} then supersedes or trims what it covers, so
 * capping it would refuse exactly the events it exists to file. The duplicate
 * guard is a different question and is NOT waived, because a second sick note
 * over days already certified is something nothing else in the chain would
 * refuse. What the guard must not do is call every malattia overlap a
 * duplicate: a continuation certificate legitimately starts on the last day of
 * the previous one, so POST /leaves settles the malattia-vs-malattia question
 * with {@link resolveMalattiaWindow} first and only ever reaches here with a
 * window that has no certified day left in it.
 *
 * Serialized per employee — see {@link lockLeaveUser}.
 */
export async function assertPerDayCap(
  client: PoolClient,
  userId: string,
  type: LeaveType,
  fromTs: string,
  toTs: string,
  excludeRequestId: string | null
): Promise<void> {
  // Step 1 of the lock order. Taken before anything else on purpose: malattia
  // skips the hours cap below but must still not interleave with a concurrent
  // ferie insert between that insert's check and applyMalattiaOverlap's sweep.
  // Callers normally hold it already (they take it at the top of the handler);
  // this call is the re-entrant safety net for any future caller that forgets.
  await lockLeaveUser(client, userId);

  if (type !== 'malattia') {
    await assertHoursCap(client, userId, type, fromTs, toTs, excludeRequestId);
  }

  // Runs last so the capacity message — the one already shipped, and the more
  // informative of the two when a whole day is double-booked — keeps winning
  // for the full-day case. This guard exists for what capacity cannot see: two
  // identical part-day permessi that fit under the cap and still duplicate each
  // other, and (since the split above) a sick note filed twice.
  await assertNoSameTypeOverlap(client, userId, type, fromTs, toTs, excludeRequestId);
}

/**
 * The hours half of {@link assertPerDayCap}: no single Europe/Rome day may end
 * up booked past the employee's scheduled capacity for that weekday.
 */
async function assertHoursCap(
  client: PoolClient,
  userId: string,
  type: LeaveType,
  fromTs: string,
  toTs: string,
  excludeRequestId: string | null
): Promise<void> {
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
        AND to_ts   >  ($2::timestamp AT TIME ZONE ${TENANT_TZ_SQL})
        AND from_ts <  ($3::timestamp AT TIME ZONE ${TENANT_TZ_SQL})
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

/** "20/08/2026 09:00 → 20/08/2026 17:00", both ends in Europe/Rome wall clock. */
function formatRomeWindow(fromTs: string, toTs: string): string {
  const fmt = new Intl.DateTimeFormat('it-IT', {
    timeZone: ROME_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    // hourCycle rather than hour12:false — the latter resolves to h24 under
    // some ICU builds, which renders midnight as "24:00" and would make every
    // all-day leave read as ending the day before it starts.
    hourCycle: 'h23',
  });
  const at = (ts: string): string => fmt.format(new Date(ts)).replace(', ', ' ');
  return `${at(fromTs)} → ${at(toTs)}`;
}

/**
 * "15/09/2026 → 20/09/2026", or a bare "15/09/2026" for a single day. Dates
 * only: this names a period the employee has to re-enter in a date picker, and
 * the 23:59 an instant-level rendering would print is an implementation detail
 * of how a full day is stored.
 */
function formatRomeDayRange(fromTs: string, toTs: string): string {
  const first = formatItalianDate(romeDateOnly(new Date(fromTs)));
  const last = formatItalianDate(romeDateOnly(new Date(toTs)));
  return first === last ? first : `${first} → ${last}`;
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
 * Rewrite the ferie/permessi a sick note lands on top of: supersede what it
 * fully covers, and keep — as their own rows — the stretches it does not.
 *
 * Whole days throughout, per THE WHOLE-DAY CONVENTION above. The certificate's
 * reach is resolved once into two instants: the last one a surviving leave may
 * stop at before it, and the first one a surviving leave may resume at after
 * it. Everything below is then a clip against those two.
 *
 * Two things this used to get wrong, both of them silent:
 *
 *   D1 — the right-side trim resumed the holiday at the sick note's END
 *        INSTANT. Under the whole-day convention that is 23:59 of a day the
 *        certificate fully covers, so the export counted that day twice: 8h
 *        malattia plus a share of the holiday's hours, on an 8h day.
 *
 *   D2 — a sick note falling entirely INSIDE a holiday kept only the part
 *        before it and dropped the part after it. No row, no superseded
 *        marker, one audit line saying "trimmed". That is the canonical
 *        "malattia durante le ferie": ferie 10 → 20 August, ill from the 13th
 *        to the 15th, and the holiday for 17 → 20 August simply ceased to
 *        exist — while the employee, holding an approved request, stayed home.
 *        The export showed 0 ferie for those four days and computeAnomalies
 *        raised missing_clock_in / missing_clock_out for each of them.
 *
 * So a partial overlap can leave TWO surviving stretches, and both have to be
 * stored. The row the employee filed keeps the first one (its start date never
 * moves, which is what makes the history readable); the second is inserted as a
 * sibling that copies the original's type, approval, batch and title, so every
 * consumer that sums or lists leave rows — quota residuo, the payroll buckets,
 * the calendars, the batch revoke — sees the same absence it always did, in two
 * pieces. Its status is decided rather than copied, because one of the three
 * the sweep accepts is an open question that must not be cloned — see
 * {@link splitContinuationStatus}. {@link OverlapResult.splits} carries the
 * pairing so the audit trail can link them.
 *
 * A stretch that books no working hours (a weekend tail, an unscheduled day) is
 * not kept: a 0h row would show the employee a holiday they do not have and
 * would print an empty line in the payroll sheet. When nothing survives, the
 * row is superseded exactly as a fully covered one is.
 *
 * malattia rows are never swept (the filter is `type IN ('ferie','permessi')`)
 * and the new certificate excludes itself by id — malattia-vs-malattia is
 * {@link resolveMalattiaWindow}'s question, answered before the INSERT.
 *
 * Runs under the employee's advisory lock, taken by the handler — step 1 of the
 * lock order at the top of this file. The row locks it takes here are step 2.
 */

/** The statuses the sweep in {@link applyMalattiaOverlap} accepts. */
export type SweptLeaveStatus = 'pending' | 'approved' | 'cancellation_pending';

/**
 * What the SECOND half of a split absence is stored as.
 *
 * 'pending' and 'approved' describe the absence itself, so both halves carry
 * them unchanged: two pending halves are two decisions the approver has to make
 * anyway (each stretch is separately approvable, and both show up in the
 * pending inbox they actually work from — GET /leaves?scope=all&status=pending
 * — while the employee can still clear either one with /cancel), and two
 * approved halves are one approved absence in two pieces.
 *
 * 'cancellation_pending' is different in kind. It is not a property of the
 * absence but an open QUESTION about it: asked once by the employee, delivered
 * once by notifyCancellationRequested, answered once — by id — through POST
 * /leaves/:id/decide-cancellation. Copying it onto the continuation clones the
 * question into a second row nobody asked about and nobody was told about,
 * which goes on exporting as leave taken and sitting in used_pending until an
 * admin happens to spot it in the revocations inbox. It is also the only status
 * in this set with no employee-side exit at all — /cancel wants 'pending',
 * /request-cancellation wants 'approved' — so the stray copy is one the person
 * it belongs to cannot clear.
 *
 * So the question stays on the row it was asked about: the original keeps
 * 'cancellation_pending' and the approver's single decision applies to the days
 * that row now holds. The continuation is stored 'approved' — the state a
 * refused cancellation returns a row to, the state of an approved absence with
 * no question attached, and the one status from which the employee can ask
 * again for the days that are left. Nothing is decided on their behalf, no
 * notification is owed for a request they did not file twice, and no row is
 * parked where only an admin force-revoke could reach it.
 *
 * The quota follows correctly on its own: those hours move out of used_pending
 * (which counts pending + cancellation_pending) into used_approved, so
 * residual_strict debits days that no longer have an open question about them
 * — while residual_with_pending, which subtracts both buckets, does not move.
 */
export function splitContinuationStatus(parent: SweptLeaveStatus): 'pending' | 'approved' {
  return parent === 'cancellation_pending' ? 'approved' : parent;
}

/** One leave the sick note cut in half, and where each half ended up. */
export interface MalattiaSplit {
  /** The row the employee filed. It now holds only the stretch BEFORE the sick note. */
  originalId: string;
  /** The row inserted for the stretch AFTER it. */
  continuationId: string;
  /**
   * The status the continuation was stored as — present ONLY when it differs
   * from the parent's, which today means one case: a 'cancellation_pending'
   * parent whose continuation is 'approved' ({@link splitContinuationStatus}).
   * The route puts the whole pair into the 'malattia.overlap_applied' payload,
   * so this is what tells the trail, and the admin reading it, that the open
   * cancellation stayed on the row it was asked about and the resumed days are
   * plain approved leave again. Absent for an ordinary split, whose payload is
   * therefore unchanged.
   */
  continuationStatus?: 'pending' | 'approved';
}

export interface OverlapResult {
  supersededIds: string[];
  /**
   * Rows whose window was narrowed. The original id of every {@link splits}
   * pair is in here too: the first half genuinely was trimmed, and the existing
   * 'trimmed_by_malattia' audit line has to keep firing for it.
   */
  trimmedIds: string[];
  /** Rows the sick note fell inside of, each now stored as two. */
  splits: MalattiaSplit[];
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
  const splits: MalattiaSplit[] = [];

  // The certificate's reach in whole days, resolved once: it depends only on
  // the sick note, and each resolution costs a couple of Intl formats.
  const stopBefore = lastInstantBeforeDayOf(new Date(fromTs).getTime());
  const resumeAfter = firstInstantAfterDayOf(new Date(toTs).getTime());

  const supersede = async (id: string): Promise<void> => {
    await client.query(
      `UPDATE leave_requests
          SET status = 'superseded_by_malattia',
              superseded_by_request_id = $1
        WHERE id = $2`,
      [malattiaId, id]
    );
    supersededIds.push(id);
  };

  for (const row of overlapping.rows) {
    const type = row.type as LeaveType;
    // Constrained by the sweep's own WHERE, three lines up.
    const status = row.status as SweptLeaveStatus;
    const rFrom = new Date(row.from_ts).getTime();
    const rTo = new Date(row.to_ts).getTime();

    // The stretches the certificate leaves alone, in chronological order. Both
    // are computed the same way, so the three shapes the old code branched on
    // (overlap on the left, on the right, or in the middle) collapse into one
    // clip — and the fourth, "should not happen", stops needing a guess.
    const surviving: Array<{ fromTs: string; toTs: string; hours: number }> = [];
    for (const part of [
      { from: rFrom, to: Math.min(stopBefore, rTo) },
      { from: Math.max(resumeAfter, rFrom), to: rTo },
    ]) {
      if (part.to <= part.from) continue;
      const partFrom = new Date(part.from).toISOString();
      const partTo = new Date(part.to).toISOString();
      const hours = await computeDurationHours(client, userId, type, partFrom, partTo);
      // Real calendar days, zero scheduled hours — a weekend tail, a day the
      // employee is not rostered. Not a leave: it would show the employee a
      // holiday they do not have and print an empty payroll line.
      if (hours <= 0) continue;
      surviving.push({ fromTs: partFrom, toTs: partTo, hours });
    }

    if (surviving.length === 0) {
      await supersede(row.id);
      continue;
    }

    const first = surviving[0]!;
    await client.query(
      `UPDATE leave_requests SET from_ts = $1, to_ts = $2, duration_hours = $3 WHERE id = $4`,
      [first.fromTs, first.toTs, first.hours, row.id]
    );
    trimmedIds.push(row.id);

    const second = surviving[1];
    if (!second) continue;

    // Everything that identifies the absence is copied from the row being
    // split, so the second half is the same absence: same type, same approver
    // decision, same batch_id — POST /leaves/bulk/:batchId/revoke keys on
    // batch_id alone, so the extra row revokes with the rest — same title and
    // created_by_admin flag.
    //
    // status is the one thing DECIDED rather than copied: a pending or approved
    // half is the same absence in that state, but an open cancellation question
    // cannot be cloned — see {@link splitContinuationStatus}. The cancellation
    // columns travel with it: they are the text and the decision of the
    // question asked about the ORIGINAL row, so a continuation that is no
    // longer asking must not display a reason nobody will answer. When the
    // status is carried unchanged they are carried too — an approved row whose
    // earlier cancellation was refused keeps that refusal on both halves.
    //
    // Deliberately NOT copied: superseded_by_request_id (this row is what
    // survived, not what was replaced); rejection_reason and the assenza /
    // INPS columns, which cannot be set on an active ferie or permesso;
    // reminder_sent_at, because the resuming stretch starts on a later day and
    // has its own "domani sei in ferie" to send.
    const contStatus = splitContinuationStatus(status);
    const keepsCancellation = contStatus === status;
    const ins = await client.query(
      `INSERT INTO leave_requests(
         tenant_id, user_id, type, status,
         from_ts, to_ts, duration_hours,
         user_note, decided_by, decided_at,
         cancellation_reason, cancellation_decided_by, cancellation_decided_at,
         batch_id, title, created_by_admin
       )
       SELECT tenant_id, user_id, type, $5::text,
              $2::timestamptz, $3::timestamptz, $4::numeric,
              user_note, decided_by, decided_at,
              CASE WHEN $6::boolean THEN cancellation_reason END,
              CASE WHEN $6::boolean THEN cancellation_decided_by END,
              CASE WHEN $6::boolean THEN cancellation_decided_at END,
              batch_id, title, created_by_admin
         FROM leave_requests
        WHERE id = $1
       RETURNING id`,
      [row.id, second.fromTs, second.toTs, second.hours, contStatus, keepsCancellation]
    );
    splits.push({
      originalId: row.id,
      continuationId: ins.rows[0].id as string,
      ...(keepsCancellation ? {} : { continuationStatus: contStatus }),
    });
  }
  return { supersededIds, trimmedIds, splits };
}
