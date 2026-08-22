import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { putObject, getObject, deleteObject } from '../lib/storage.js';
import {
  DEFAULT_TZ,
  zonedWallClock,
  zonedDateKey,
  eachZonedDateKeyInclusive,
  startOfZonedDayUtcMs,
  nextIsoDate,
} from '../lib/tz.js';
import { effectiveCentroPagheMap, centroPagheKeyForLeave, uncoveredSlotIntervals } from '@sonoqui/shared';
import { env } from '../env.js';
import {
  describeHistoryRow,
  type StampChangeKind,
  type TrackedField,
} from '../lib/stamp-history.js';
import {
  buildCentroPagheFile,
  type CentroPagheEmployee,
  type CentroPagheDay,
  type CentroPaghePunch,
  type CentroPagheInpsEvent,
} from './centro-paghe.js';

export interface ExportJobRow {
  id: string;
  tenant_id: string;
  format: 'xlsx' | 'json' | 'centro';
  period_from: string;
  period_to: string;
  filters: Record<string, unknown>;
  requested_by: string;
}

export interface ExportResult {
  storageKey: string;
  signedUrlExpiresAt: Date;
}

import { adminPool } from '../lib/admin-db.js';

interface DayAgg {
  day: string;
  worked_minutes: number;
  paid_break_minutes: number;
  unpaid_break_minutes: number;
  /**
   * Contractual ("ore ordinarie") minutes for that weekday: Σ of the shift
   * template slots MINUS the auto-lunch deduction — i.e. the theoretical
   * figure, NOT `worked − overtime`.
   *
   * The customer reads the payslip line "8 ordinarie + 0:30 straordinarie", so
   * a full-time weekday has to print 8 whether the person worked 8:30 or 6:40:
   * the surplus is already in Ore straordinarie and the shortfall belongs to
   * the anomalies, neither may move this column. A day with no template (rest
   * day, or a user with no shift assigned) stays 0 — that is the default set
   * when the day bucket is created, and the per-day loop below `continue`s
   * before touching it.
   *
   * Resolved from the assignment in force ON THAT DAY, never from a single
   * assignment picked for the whole period — see configForDay().
   */
  ordinary_minutes: number;
  overtime_minutes: number;
  ferie_minutes: number;
  permessi_minutes: number;
  malattia_minutes: number;
  /**
   * Justified absences that are neither ferie/permesso nor malattia: the
   * `assenza` rows (lutto, Legge 104, congedo parentale, visita medica,
   * permesso non retribuito…), each with its own subtype.
   */
  assenza_minutes: number;
  /** Employer-imposed company closure (`chiusura`), the kind that does NOT
   *  consume ferie — POST /leaves/bulk with deduct_ferie:false. A closure
   *  charged to ferie is stored as type 'ferie' and lands in ferie_minutes. */
  chiusura_minutes: number;
  /** Marker: 'M' malattia, 'C' chiusura aziendale, 'F' full-day ferie,
   *  'A' assenza giustificata, 'P' partial permesso. Null otherwise. */
  leave_marker: 'F' | 'P' | 'M' | 'A' | 'C' | null;
}

interface UserAgg {
  user_id: string;
  email: string;
  days: DayAgg[];
  worked_minutes_total: number;
  paid_break_minutes_total: number;
  unpaid_break_minutes_total: number;
  /** Σ of the days' ordinary_minutes: contracted hours of the period, not worked ones. */
  ordinary_minutes_total: number;
  overtime_minutes_total: number;
  worked_days: number;
  ferie_minutes_total: number;
  permessi_minutes_total: number;
  malattia_minutes_total: number;
  assenza_minutes_total: number;
  chiusura_minutes_total: number;
}

export interface ShiftConfig {
  tolerance_in_min: number;
  tolerance_out_min: number;
  expected_break_max_min: number;
  extraordinary_threshold_min: number;
  count_extraordinary: boolean;
  tolerance_in_breach_deduct_min: number;
  tolerance_out_breach_deduct_min: number;
  tolerance_break_breach_deduct_min: number;
  // Orario flessibile: flextime moves overtime/shortfall to a worked-duration
  // basis and widens the late/early anchors by these windows.
  flexible_enabled: boolean;
  flex_in_after_min: number;
  flex_out_before_min: number;
  /** day_of_week (1=Mon..7=Sun) → [{ start_time, end_time }] sorted ascending */
  slotsByDow: Map<number, Array<{ start: string; end: string }>>;
  /** Feature B auto-deduct lunch minutes per weekday (absent = none). */
  lunchByDow: Map<number, number>;
}

/** One shift assignment with its validity window. The dates are tenant-local
 *  YYYY-MM-DD strings on purpose, so they compare lexicographically against a
 *  day key without ever becoming a Date (which would flatten to UTC midnight
 *  and shift the boundary by a day for half the year). */
export interface ShiftAssignment {
  validFrom: string;
  validTo: string | null;
  cfg: ShiftConfig;
}

/**
 * The assignment in force on `day`, or undefined when none covers it.
 *
 * `assigns` is ordered by valid_from ASC, so scanning backwards returns the
 * latest window that still contains the day. This replaces a
 * `DISTINCT ON (a.user_id) … ORDER BY a.valid_from DESC` that collapsed the
 * whole export period onto ONE assignment: an employee moved from 'Part-time
 * 4h' to 'Full-time 8h' on 16 September got 8,00 "Ore ordinarie" printed for
 * 1–15 September as well (11 working days overstated by 4h each), because the
 * later row won for every day of the month. The Anomalie page has always
 * joined per day (routes/shifts.ts: `a.valid_from <= r.d AND (a.valid_to IS
 * NULL OR a.valid_to >= r.d)`), so the screen and the payroll file disagreed.
 *
 * Everything shift-driven in the day loop reads through here — tolerances,
 * breach deductions, auto-lunch, overtime flag and slots — not just the
 * ordinary-hours figure: they came from the same stale `cfg` and were skewed
 * the same way (the old part-time tolerances and 4h anchor were applied to
 * full-time days, and vice versa).
 */
export function configForDay(
  assigns: ShiftAssignment[] | undefined,
  day: string
): ShiftConfig | undefined {
  if (!assigns) return undefined;
  for (let i = assigns.length - 1; i >= 0; i--) {
    const a = assigns[i]!;
    if (a.validFrom <= day && (a.validTo === null || a.validTo >= day)) return a.cfg;
  }
  return undefined;
}

export async function generateExportFile(job: ExportJobRow): Promise<ExportResult> {
  const data = await aggregateForExport(job);
  if (job.format === 'json') {
    return await writeJson(job, data);
  }
  if (job.format === 'centro') {
    return await writeCentroPaghe(job, data);
  }
  return await writeXlsx(job, data);
}

// Paid-break cutoff: breaks at/under this duration count as paid, above as unpaid.
const PAID_BREAK_THRESHOLD_MIN = 30;

// The export period as true UTC instants: [00:00 of period_from, 00:00 of the day
// after period_to) in the tenant's zone.
//
// The old `$2::date` / `$3::date + INTERVAL '1 day'` bounds resolved against the
// server clock, which is UTC in production — so the window ran 00:00Z..00:00Z
// while the business days it was meant to describe run 22:00Z..22:00Z (summer).
// Every day key below is now tenant-local, and the window has to agree with them
// or the first day loses its 00:00–02:00 punches and the day after period_to
// leaks in as a phantom.
export async function loadTenantTimeZone(tenantId: string): Promise<string> {
  const tzRow = await adminPool.query<{ timezone: string }>(
    `SELECT timezone FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return tzRow.rows[0]?.timezone || DEFAULT_TZ;
}

function periodWindow(job: ExportJobRow, timeZone: string): { start: Date; end: Date } {
  return {
    start: new Date(startOfZonedDayUtcMs(job.period_from, timeZone)),
    end: new Date(startOfZonedDayUtcMs(nextIsoDate(job.period_to), timeZone)),
  };
}

/**
 * Whether an employee belongs in this period's export at all.
 *
 * One definition for both writers on purpose. The xlsx aggregate used to select
 * its people implicitly — whoever had a stamp or an approved leave — while the
 * Centro Paghe writer selected them explicitly from the membership list, so the
 * two files for the same month disagreed about who works here. Active members
 * always export (a month with nothing in it is itself the payroll signal);
 * inactive ones only if they were still around for part of the period.
 *
 * Deliberately blind to memberships.deleted_at: a member removed from the app
 * still worked the hours the period records, and both files have to report them.
 * Removal bounds the CONTRACT (contractedDaysUntil), not the reporting.
 */
export function exportsEmployee(active: boolean, hadActivity: boolean): boolean {
  return active || hadActivity;
}

/** What both writers need to know about one person's employment to decide how
 *  far into the period they may still be charged contracted hours. */
export interface EmploymentWindow {
  /** memberships.active, as it stands the moment the export runs. Present tense
   *  and undated: it says the person is gone NOW, never when they went. */
  active: boolean;
  /** Tenant-local day of memberships.deleted_at, null when still a member. */
  deletedDay: string | null;
  /** Last day of the period with a real punch or an approved leave, null when
   *  the person has neither. NOT derived from seeded days — that would let the
   *  bound justify itself. */
  lastActivityDay: string | null;
}

/**
 * Last day of the period on which a contracted day ("Ore ordinarie" in the
 * xlsx, ore teoriche in the LUL) may still be asserted for this person.
 * Returns null when none may be.
 *
 * Two independent ceilings, both of which the scheduled-day seeding was missing.
 *
 * 1. THE PERSON LEFT — when, and only when, the departure can be placed INSIDE
 *    the period. Nothing in the product ever closes a shift assignment when an
 *    employee goes: POST /users/:id/deactivate (routes/users.ts) sets
 *    memberships.active = FALSE, DELETE /users/:id sets deleted_at + active =
 *    FALSE, and routes/shifts.ts only closes valid_to when a NEW assignment is
 *    created. So the open (valid_to IS NULL) assignment of a full-timer
 *    deactivated on 15 September still resolves for 16–30 September, and the
 *    period-wide seeding invented 11 working days × 480 min: Riepilogo printed
 *    176,00 "Ore ordinarie" against ~88,00 worked, plus 11 Dettaglio rows dated
 *    after the person's last day.
 *
 *    memberships CARRIES NO TERMINATION DATE. `deleted_at` is the one dated
 *    departure the schema has, and only the removal path sets it; `active` is a
 *    bare boolean with no timestamp at all.
 *
 *    That distinction decides the rule, because a bound read off undated
 *    present-tense state makes the SAME closed month export differently
 *    depending on the day somebody happens to run it. Employee M, full-time
 *    Mon–Fri, last punch Friday 25 September, 28–30 September an unpaid absence
 *    settled off-system: exported on 1 October while M was still active the file
 *    carried all 22 September weekdays (176,00). HR deactivated M on 5 October —
 *    an event that says nothing whatever about September — and the identical
 *    export silently lost three days. A payroll file re-issued for a period that
 *    has already been filed must not disagree with the copy the commercialista
 *    already holds, so:
 *
 *      • `deleted_at` bounds the period whenever it falls on or before its last
 *        day. It is a real date, it never moves, and a removal recorded in
 *        December cannot shorten a September that was fully worked.
 *      • `active = FALSE` bounds the period only while the period is still
 *        RUNNING. There "gone by today" does place the departure inside the
 *        window, and the last day the person showed up — a punch or an approved
 *        leave — is then the safest bound available.
 *      • Once the period has fully elapsed, `active` no longer moves anything.
 *
 *    RESIDUAL LIMITATION, deliberate and not a gap to close here: an employee
 *    merely DEACTIVATED (no deleted_at) partway through a month that has since
 *    closed keeps contracted days to the end of that month. Nothing recorded
 *    anywhere distinguishes that departure from one that happened after the
 *    period, and between the two possible errors this picks the visible one — a
 *    Dettaglio row reading 0,00 worked against 8,00 ordinarie is a line payroll
 *    looks at and questions, whereas a day that simply vanishes from a file
 *    already delivered is a difference nobody sees. Removing the member (which
 *    dates the departure) or exporting the period before it closes both make the
 *    ceiling bite. The Metadati glossary tells the commercialista exactly this;
 *    the two texts must not drift apart.
 *
 * 2. THE DAY HAS NOT HAPPENED YET. Exporting the current month on 5 August used
 *    to seed the whole month, so a full-timer read 176,00 ordinarie against
 *    ~24,00 worked with ~17 future dates listed as untimbrated days. Contracted
 *    hours describe an elapsed period; a Tuesday three weeks out owes nothing.
 *    For the ordinary case — a closed month exported after it ends — `today` is
 *    past `periodTo` and this ceiling does nothing at all.
 */
export function contractedDaysUntil(
  periodTo: string,
  today: string,
  employment: EmploymentWindow | undefined
): string | null {
  // Zero-padded YYYY-MM-DD compares lexicographically in chronological order.
  const bound = today < periodTo ? today : periodTo;
  // No membership row at all for a user the stamps surfaced: there is no
  // employment to read a contract off, which is a different thing from a
  // departure — so nothing is contracted rather than everything.
  if (employment === undefined) return null;

  const { active, deletedDay, lastActivityDay } = employment;

  // A dated departure is a property of the PERIOD, so the answer survives a
  // re-run. Compared against `bound` (≤ periodTo) on purpose: a removal
  // recorded after the period ended does not shorten a month fully worked.
  if (deletedDay !== null) return deletedDay < bound ? deletedDay : bound;

  if (!active) {
    // Not one punch, not one approved leave. exportsEmployee() already keeps
    // these people out of both files; this is the belt that stops the bound
    // from inventing a month for somebody whose only record is that they left.
    if (lastActivityDay === null) return null;
    // `active` is undated, so it may only bound a period that is still running:
    // there, and only there, does "gone by today" place the departure inside the
    // window. For an elapsed period it is deliberately inert — see above.
    if (today <= periodTo && lastActivityDay < bound) return lastActivityDay;
  }
  return bound;
}

/**
 * Whether `day` is inside the ceiling contractedDaysUntil() returned.
 *
 * Trivial, and a named function anyway, because the ceiling has to gate EVERY
 * place a contracted figure is written and it originally gated only the place
 * that computed it. The xlsx seeding walk stopped at the bound while the per-day
 * loop that assigns ordinary_minutes did not, so any day that entered the
 * aggregate some other route — approved leave is merged in before the seeding
 * even runs — was still charged a full contracted day: ferie 24–28 August in a
 * month exported on the 21st printed 40 hours the Centro Paghe file had gated to
 * 00000 on the same dates. Three call sites now, one rule.
 */
export function contractsDay(contractedUntil: string | null, day: string): boolean {
  return contractedUntil !== null && day <= contractedUntil;
}

/** DayAgg while it is still being built: the two open-punch anchors live here
 *  and are dropped before the day leaves the aggregator. */
type DayAccumulator = DayAgg & { firstIn: Date | null; lastOut: Date | null };

/** Empty per-day accumulator.
 *
 *  One factory instead of an object literal repeated at every place a day can
 *  first appear (stamps, leaves, and now the scheduled-day seeding). The
 *  duplicated literals are how a new bucket gets forgotten in one branch and
 *  reads `undefined` at the other end. */
function newDayAccumulator(day: string): DayAccumulator {
  return {
    day,
    worked_minutes: 0,
    paid_break_minutes: 0,
    unpaid_break_minutes: 0,
    ordinary_minutes: 0,
    overtime_minutes: 0,
    ferie_minutes: 0,
    permessi_minutes: 0,
    malattia_minutes: 0,
    assenza_minutes: 0,
    chiusura_minutes: 0,
    leave_marker: null,
    firstIn: null,
    lastOut: null,
  };
}

async function aggregateForExport(job: ExportJobRow): Promise<UserAgg[]> {
  // Tenant timezone drives both the period window and every business-day key, so
  // it has to be resolved before the first query. Also used to resolve schedule
  // wall-clock times against stamps in the late/early breach deductions below.
  const timeZone = await loadTenantTimeZone(job.tenant_id);
  const { start: periodStart, end: periodEnd } = periodWindow(job, timeZone);

  const rows = await adminPool.query(
    `SELECT s.user_id, s.event_type, s.occurred_at, s.deleted_at,
            COALESCE(au.email, s.user_id::text) AS email
     FROM stamps s
     LEFT JOIN auth_users au ON au.id = s.user_id
     WHERE s.tenant_id = $1
       AND s.occurred_at >= $2::timestamptz
       AND s.occurred_at <  $3::timestamptz
       AND s.deleted_at IS NULL
     ORDER BY s.user_id, s.occurred_at`,
    [job.tenant_id, periodStart.toISOString(), periodEnd.toISOString()]
  );

  const shiftByUser = await loadShiftAssignments(job);
  const leavesByUserDay = await loadLeavesPerDay(job, timeZone);
  // Every calendar day of the period, computed once: the scheduled-day seeding
  // below walks it per user.
  const periodDates = eachDateInclusive(job.period_from, job.period_to);
  // Today in the TENANT's zone, not the server's: the seeding stops here for a
  // period that is still running (see contractedDaysUntil). Read once so every
  // user of one export file agrees on where "not yet" begins, even across a
  // midnight that falls while the job is generating.
  const todayKey = zonedDateKey(new Date(), timeZone);
  // Raw approved-leave intervals (windowed), used to waive late-in / early-out
  // breach deductions when an approved ferie/permesso covers the stretch —
  // mirroring the presence-anomaly logic in routes/shifts.ts (leaveOverlapMin).
  const leaveIntervalsByUser = await loadLeaveIntervals(job, timeZone);

  type UserBucket = { email: string; stamps: Array<{ event: string; at: Date }> };
  const byUser = new Map<string, UserBucket>();
  for (const r of rows.rows) {
    const u: UserBucket = byUser.get(r.user_id) ?? { email: r.email, stamps: [] };
    u.stamps.push({ event: r.event_type, at: new Date(r.occurred_at) });
    byUser.set(r.user_id, u);
  }
  // Everyone the stamp query did not surface but who still belongs in the
  // export, collected first so their emails cost one round trip instead of one
  // query per user.
  const extraUserIds = new Set<string>();

  // Ensure users that only have leave (no stamps) still appear in the export.
  // Keyed off the leave map rather than the membership list on purpose: an
  // approved leave belonging to a member since removed still has to export.
  for (const userId of leavesByUserDay.keys()) {
    if (!byUser.has(userId)) extraUserIds.add(userId);
  }

  // Same employee set as the Centro Paghe writer, read from the same source.
  //
  // byUser only holds people with at least one stamp or one approved leave in
  // the period, so an employee with a shift assignment and neither produced no
  // UserAgg row at all — the scheduled-day seeding below can only add days to a
  // user who already made it into this map. The xlsx then showed them with no
  // line (0,00 "Ore ordinarie") while writeCentroPaghe, which iterates
  // loadAnagrafica, wrote a full month of theoretical hours for the same month:
  // 176:00 against nothing. That divergence is what the seeding exists to close,
  // so the selection has to come from the same place with the same filter — see
  // writeCentroPaghe's `exportsEmployee(ana.active, hadActivity)`. Reaching the
  // body below means no stamp and no leave, i.e. hadActivity === false, so only
  // active members survive: a long-gone employee stays out of both exports.
  // Someone who left mid-period is exported for the hours they worked; how far
  // their CONTRACT runs is a separate question, answered per date by
  // configForDay (the assignment window) and contractedDaysUntil (the
  // employment), never by dropping them from the file.
  const anagrafica = await loadAnagrafica(job);
  for (const [userId, ana] of anagrafica) {
    // No special case for a removed member: DELETE /users/:id sets active =
    // FALSE alongside deleted_at, so exportsEmployee() already refuses to ADD
    // one who has no activity, and one who DOES have activity is carried in by
    // their own stamps or leave above. Removal decides how far their contract
    // runs (contractedDaysUntil reads deleted_at as the dated departure), never
    // whether the hours they worked get reported — see writeCentroPaghe.
    const hadActivity = byUser.has(userId) || extraUserIds.has(userId);
    if (hadActivity) continue; // already in, through a stamp or an approved leave
    if (!exportsEmployee(ana.active, hadActivity)) continue;
    extraUserIds.add(userId);
  }

  if (extraUserIds.size > 0) {
    const meta = await adminPool.query<{ id: string; email: string | null }>(
      // $1::uuid[] pins the param type. The old per-user
      // `COALESCE(au.email, $1::text)` forced $1 to text, so `au.id = $1` became
      // uuid=text and threw "operator does not exist: uuid = text" for any user
      // with approved leave but no stamps in the period. The `?? userId` below
      // is the email fallback the COALESCE used to provide.
      `SELECT id, email FROM auth_users WHERE id = ANY($1::uuid[])`,
      [[...extraUserIds]]
    );
    const emailById = new Map(meta.rows.map((r) => [r.id, r.email]));
    for (const userId of extraUserIds) {
      byUser.set(userId, { email: emailById.get(userId) ?? userId, stamps: [] });
    }
  }

  const out: UserAgg[] = [];
  for (const [userId, u] of byUser) {
    const assigns = shiftByUser.get(userId);
    const days = new Map<string, DayAccumulator>();
    let openClockIn: Date | null = null;
    let openBreak: Date | null = null;
    let openLunch: Date | null = null;

    for (const s of u.stamps) {
      const dayKey = zonedDateKey(s.at, timeZone);
      const day = days.get(dayKey) ?? newDayAccumulator(dayKey);

      if (s.event === 'clock_in') {
        openClockIn = s.at;
        if (!day.firstIn) day.firstIn = s.at;
      } else if (s.event === 'break_start' && openClockIn) {
        day.worked_minutes += diffMin(openClockIn, s.at);
        openBreak = s.at;
      } else if (s.event === 'break_end' && openBreak) {
        const minutes = diffMin(openBreak, s.at);
        if (minutes <= PAID_BREAK_THRESHOLD_MIN) day.paid_break_minutes += minutes;
        else day.unpaid_break_minutes += minutes;
        openClockIn = s.at;
        openBreak = null;
      } else if (s.event === 'lunch_start' && openClockIn) {
        day.worked_minutes += diffMin(openClockIn, s.at);
        openLunch = s.at;
      } else if (s.event === 'lunch_end' && openLunch) {
        const minutes = diffMin(openLunch, s.at);
        if (minutes <= PAID_BREAK_THRESHOLD_MIN) day.paid_break_minutes += minutes;
        else day.unpaid_break_minutes += minutes;
        openClockIn = s.at;
        openLunch = null;
      } else if (s.event === 'clock_out' && openClockIn) {
        day.worked_minutes += diffMin(openClockIn, s.at);
        day.lastOut = s.at;
        openClockIn = null;
      }
      days.set(dayKey, day);
    }

    // Merge leave hours per day for this user.
    const userLeaves = leavesByUserDay.get(userId);
    if (userLeaves) {
      for (const [dayKey, leave] of userLeaves) {
        const day = days.get(dayKey) ?? newDayAccumulator(dayKey);
        day.ferie_minutes += leave.ferie;
        day.permessi_minutes += leave.permessi;
        day.malattia_minutes += leave.malattia;
        day.assenza_minutes += leave.assenza;
        day.chiusura_minutes += leave.chiusura;
        days.set(dayKey, day);
      }
    }

    // Seed every day the schedule plans for, even with neither a punch nor an
    // approved leave.
    //
    // Days only ever entered the aggregate through a stamp or a leave, so an
    // employee who simply forgot to badge contributed nothing: a full-timer
    // (8h × 22 days) who missed 3 days had the Riepilogo print 152,00 "Ore
    // ordinarie" instead of 176,00 — while the Centro Paghe file for the SAME
    // month wrote 8h of theoretical hours on each of those dates, because that
    // builder enumerates the whole month. Ore ordinarie is the CONTRACT, so it
    // must not depend on whether the person remembered to badge. Seeding also
    // makes the missed day visible in Dettaglio giornaliero as a row with
    // 0,00 worked against 8,00 ordinarie, which is exactly the day payroll
    // needs to look at.
    //
    // Scoped by the per-day assignment, so a period that starts before the
    // hire (or continues past a closed assignment) still seeds nothing — and
    // bounded above by contractedDaysUntil(), because the assignment alone is
    // NOT enough: nothing in the product closes valid_to when an employee
    // leaves, so a leaver's open assignment would otherwise seed every
    // remaining working day of the month.
    //
    // `days` at this point holds exactly the days with a punch or an approved
    // leave — nothing seeded yet — which is what makes it a usable last-day
    // signal for a member the schema gives no termination date for.
    let lastActivityDay: string | null = null;
    for (const dayKey of days.keys()) {
      if (lastActivityDay === null || dayKey > lastActivityDay) lastActivityDay = dayKey;
    }
    const ana = anagrafica.get(userId);
    const contractedUntil = contractedDaysUntil(job.period_to, todayKey, {
      active: ana?.active ?? false,
      deletedDay: ana?.deletedAt ? zonedDateKey(ana.deletedAt, timeZone) : null,
      lastActivityDay,
    });
    // contractsDay() gates the seeding walk below AND the per-day loop that
    // assigns ordinary_minutes. Two loops, one ceiling: `days` already holds
    // every date a punch or an approved leave put there, and those never pass
    // through this walk at all.
    for (const dayKey of periodDates) {
      // periodDates is chronological, so the first date past the ceiling ends
      // the walk.
      if (!contractsDay(contractedUntil, dayKey)) break;
      if (days.has(dayKey)) continue;
      const dayCfg = configForDay(assigns, dayKey);
      if (!dayCfg) continue;
      const slots = dayCfg.slotsByDow.get(isoDowUtc(dayKey));
      if (!slots || slots.length === 0) continue;
      days.set(dayKey, newDayAccumulator(dayKey));
    }

    // Apply shift-driven breach deductions + overtime calc per day.
    for (const day of days.values()) {
      // Per-DAY assignment: tolerances, anchors, auto-lunch and the ordinary
      // figure all belong to the shift in force on THIS date, not to whichever
      // assignment happened to be the latest in the period.
      const cfg = configForDay(assigns, day.day);
      if (!cfg) continue;
      const dowSlots = cfg.slotsByDow.get(isoDowUtc(day.day));
      if (!dowSlots || dowSlots.length === 0) continue;
      const expectedStart = combineDateTime(day.day, dowSlots[0]!.start, timeZone);
      const expectedEnd = combineDateTime(day.day, dowSlots[dowSlots.length - 1]!.end, timeZone);
      const expectedDurationMin = dowSlots.reduce(
        (acc, s) =>
          acc +
          diffMin(combineDateTime(day.day, s.start, timeZone), combineDateTime(day.day, s.end, timeZone)),
        0
      );
      const userLeaves = leaveIntervalsByUser.get(userId);
      // Late/early anchors with approved leave carved out per-slot (gap-aware):
      // a half-day ferie/permesso drops its slot so working the complementary
      // half raises no breach deduction, and the inter-slot lunch gap is never
      // billed as early/late. Mirrors computeAnomalies in routes/shifts.ts.
      const uncovered = uncoveredSlotIntervals(
        dowSlots.map((s) => ({
          start: combineDateTime(day.day, s.start, timeZone).getTime(),
          end: combineDateTime(day.day, s.end, timeZone).getTime(),
        })),
        (userLeaves ?? []).map((l) => ({ from: l.from, to: l.to }))
      );
      const fullyCoveredByLeave = uncovered.length === 0;
      const workStart = new Date(uncovered[0]?.start ?? expectedStart.getTime());
      const workEnd = new Date(uncovered[uncovered.length - 1]?.end ?? expectedEnd.getTime());

      // Feature B auto-lunch: replace stamped break/lunch accounting with a flat
      // deduction. worked = presence − L; the deducted L shows as unpaid break.
      const autoLunch = cfg.lunchByDow.get(isoDowUtc(day.day)) ?? 0;
      if (autoLunch > 0) {
        const gross = day.worked_minutes + day.paid_break_minutes + day.unpaid_break_minutes;
        const deducted = Math.min(autoLunch, gross);
        day.worked_minutes = Math.max(0, gross - deducted);
        day.paid_break_minutes = 0;
        day.unpaid_break_minutes = deducted;
      }

      // Ore ordinarie = contracted duration of the weekday NET of the auto-lunch.
      //
      // Same figure the flextime overtime branch below uses as its target worked
      // time (`expectedDurationMin - autoLunch`), and the same one the Centro
      // Paghe builder writes as `theoreticalMin`. It has to be net: on a tenant
      // with Feature B the lunch break is unpaid and already removed from
      // worked_minutes, so counting it as ordinary work would make a 09:00–18:00
      // template print 9 ordinarie against 8 worked every single day, and the
      // overtime column would start at −60 minutes' worth of slack.
      //
      // Gated by contractsDay(), the same ceiling the seeding walk uses: a day
      // that reached `days` through an approved leave or a punch past the
      // person's ceiling keeps its leave hours and its punches — an approved
      // leave stays an approved leave — but owes no contract, which is exactly
      // what writeCentroPaghe writes for those dates (00000 theoretical, 00000
      // contract, blank tipo giorno). Only the contract figure is gated; the
      // overtime threshold below still reads the schedule, mirroring the LUL,
      // which gates the theoretical minutes but never the giustificativi.
      day.ordinary_minutes = contractsDay(contractedUntil, day.day)
        ? Math.max(0, expectedDurationMin - autoLunch)
        : 0;

      // Flextime widens the late/early anchors before the breach deduction.
      const flexInAfterMin = cfg.flexible_enabled ? cfg.flex_in_after_min : 0;
      const flexOutBeforeMin = cfg.flexible_enabled ? cfg.flex_out_before_min : 0;

      // late clock-in beyond tolerance (past the flexed entry anchor) → deduct.
      // workStart is the first uncovered slot start, so an approved permesso/ferie
      // over the earlier stretch justifies the lateness (same rule as the
      // late_clock_in anomaly). A fully-covered day raises no breach at all.
      if (day.firstIn && !fullyCoveredByLeave) {
        const lateMin = diffMin(workStart, day.firstIn) - flexInAfterMin;
        if (lateMin > cfg.tolerance_in_min) {
          day.worked_minutes = Math.max(0, day.worked_minutes - cfg.tolerance_in_breach_deduct_min);
        }
      }
      // early clock-out beyond tolerance (before the flexed exit anchor) → deduct.
      // workEnd is the last uncovered slot end, so an afternoon ferie on a
      // lunch-gap day (the Aurora Gastaldelli case) waives the false anticipo.
      if (day.lastOut && !fullyCoveredByLeave) {
        const earlyMin = diffMin(day.lastOut, workEnd) - flexOutBeforeMin;
        if (earlyMin > cfg.tolerance_out_min) {
          day.worked_minutes = Math.max(0, day.worked_minutes - cfg.tolerance_out_breach_deduct_min);
        }
      }
      // break duration over expected max → deduct (skip on auto-lunch days,
      // where breaks aren't tracked separately).
      if (autoLunch === 0) {
        const breakTotal = day.paid_break_minutes + day.unpaid_break_minutes;
        if (breakTotal > cfg.expected_break_max_min) {
          day.worked_minutes = Math.max(0, day.worked_minutes - cfg.tolerance_break_breach_deduct_min);
        }
      }
      // overtime, counted in whole blocks of extraordinary_threshold_min (a
      // partial block is not counted), only if the flag is on. Flextime:
      // surplus of WORKED time past the contracted duration. Fixed schedule:
      // surplus of the clock-out past expected_end.
      if (cfg.count_extraordinary) {
        const block = cfg.extraordinary_threshold_min;
        let overMin = 0;
        if (cfg.flexible_enabled) {
          // Target worked = Σ fasce − auto-lunch (worked already had L removed).
          overMin = Math.max(0, day.worked_minutes - (expectedDurationMin - autoLunch));
        } else if (day.lastOut) {
          overMin = diffMin(expectedEnd, day.lastOut);
        }
        day.overtime_minutes = Math.floor(overMin / block) * block;
      }
    }

    // "Ore conteggiate" rounds worked time down to 15-minute blocks: anything
    // below 15 min counts as 0. Overtime is already block-aligned by the
    // extraordinary_threshold_min step above, so no extra rounding here.
    // This file holds the authoritative day-level rules; the mobile + web
    // clients mirror them live from packages/shared/src/stamps/counted-day.ts
    // (+ day-totals.ts). Keep the two in sync.
    for (const day of days.values()) {
      day.worked_minutes = Math.floor(Math.max(0, day.worked_minutes) / 15) * 15;
    }

    const dayList = [...days.values()]
      .map((d): DayAgg => {
        const ferie = d.ferie_minutes;
        const permessi = d.permessi_minutes;
        const malattia = d.malattia_minutes;
        const assenza = d.assenza_minutes;
        const chiusura = d.chiusura_minutes;
        // Most-consequential-first. 'C' and 'A' were added with their columns:
        // a company closure used to print 'M' on every one of its days because
        // its hours had been filed as malattia.
        let marker: DayAgg['leave_marker'] = null;
        if (malattia > 0) marker = 'M';
        else if (chiusura > 0) marker = 'C';
        else if (ferie > 0 && d.worked_minutes === 0) marker = 'F';
        else if (assenza > 0) marker = 'A';
        else if (permessi > 0) marker = 'P';
        return {
          day: d.day,
          worked_minutes: d.worked_minutes,
          paid_break_minutes: d.paid_break_minutes,
          unpaid_break_minutes: d.unpaid_break_minutes,
          // Never rounded to 15-minute blocks like worked_minutes: this is the
          // contract, not a measurement, so a 7h30 template must stay 7.50.
          ordinary_minutes: d.ordinary_minutes,
          overtime_minutes: d.overtime_minutes,
          ferie_minutes: ferie,
          permessi_minutes: permessi,
          malattia_minutes: malattia,
          assenza_minutes: assenza,
          chiusura_minutes: chiusura,
          leave_marker: marker,
        };
      })
      .sort((a, b) => a.day.localeCompare(b.day));

    out.push({
      user_id: userId,
      email: u.email,
      days: dayList,
      worked_minutes_total: sum(dayList.map((d) => d.worked_minutes)),
      paid_break_minutes_total: sum(dayList.map((d) => d.paid_break_minutes)),
      unpaid_break_minutes_total: sum(dayList.map((d) => d.unpaid_break_minutes)),
      // Over every day the schedule plans for in the period — including the
      // ones with no punch and no leave, which the seeding above adds. This is
      // the full contracted monte ore, the same one the Centro Paghe file sums
      // as theoretical hours; it used to stop at the days that had a stamp or a
      // leave and silently under-reported every forgotten badge.
      ordinary_minutes_total: sum(dayList.map((d) => d.ordinary_minutes)),
      overtime_minutes_total: sum(dayList.map((d) => d.overtime_minutes)),
      ferie_minutes_total: sum(dayList.map((d) => d.ferie_minutes)),
      permessi_minutes_total: sum(dayList.map((d) => d.permessi_minutes)),
      malattia_minutes_total: sum(dayList.map((d) => d.malattia_minutes)),
      assenza_minutes_total: sum(dayList.map((d) => d.assenza_minutes)),
      chiusura_minutes_total: sum(dayList.map((d) => d.chiusura_minutes)),
      worked_days: dayList.filter((d) => d.worked_minutes > 0).length,
    });
  }
  return out;
}

interface DayLeaveBucket {
  ferie: number;
  permessi: number;
  malattia: number;
  assenza: number;
  chiusura: number;
}

export type LeaveBucketKey = keyof DayLeaveBucket;

/**
 * Which per-day bucket a leave row's hours belong to — the xlsx counterpart of
 * centroPagheKeyForLeave(). Same source column (leave_requests.type), same five
 * kinds, so the two exports of one month can no longer contradict each other.
 *
 * It exists because loadLeavesPerDay used to be a two-way branch — 'ferie',
 * ELSE malattia — with no type filter on the query. An August shutdown filed
 * through POST /leaves/bulk with deduct_ferie:false inserts type 'chiusura',
 * status 'approved'; it fell into the else, so the Riepilogo printed "Ore
 * malattia 40,00" for every employee and Dettaglio giornaliero stamped 'M' on
 * all five days — while the Centro Paghe export of the SAME month mapped it
 * through centroPagheKeyForLeave() to the closure giustificativo. Every
 * 'assenza' row (lutto, Legge 104, congedo parentale…) was misfiled the same
 * way.
 */
export function leaveBucketKey(type: string): LeaveBucketKey {
  switch (type) {
    case 'ferie':
      return 'ferie';
    case 'permessi':
      return 'permessi';
    case 'malattia':
      return 'malattia';
    case 'chiusura':
      return 'chiusura';
    // 'assenza' — and anything a later migration adds to leave_requests.type.
    // A generic justified absence is the honest default for an unknown kind;
    // malattia never is, because sick hours carry INPS and payroll
    // consequences that a fallback must not invent.
    default:
      return 'assenza';
  }
}

function emptyLeaveBucket(): DayLeaveBucket {
  return { ferie: 0, permessi: 0, malattia: 0, assenza: 0, chiusura: 0 };
}

/** One approved leave row overlapping the export period.
 *
 *  `from`/`to` are the row's REAL window, deliberately NOT clipped to the
 *  period: clipping before the per-day arithmetic is exactly the defect
 *  leaveDayShares() documents. */
export interface LeaveRow {
  userId: string;
  type: string;
  /** leave_requests.assenza_subtype — only the Centro Paghe projection uses it. */
  subtype: string | null;
  from: Date;
  to: Date;
  durationHours: number;
}

/**
 * Approved leave overlapping the export period, loaded once for both per-day
 * projections.
 *
 * loadLeavesPerDay (xlsx) and loadLeavesPerDayDetailed (Centro Paghe) each ran
 * this same SELECT and then repeated the same distribution arithmetic by hand.
 * That is how one rounding defect ended up in two places and had to be found
 * twice: the two now share leaveDayShares() and can only be wrong together.
 */
async function loadLeaveRows(job: ExportJobRow, timeZone: string): Promise<LeaveRow[]> {
  const { start: periodFrom, end: periodEnd } = periodWindow(job, timeZone);
  // approved + cancellation_pending count as "user is out" for export purposes.
  const r = await adminPool.query(
    `SELECT lr.user_id, lr.type, lr.assenza_subtype, lr.from_ts, lr.to_ts, lr.duration_hours
       FROM leave_requests lr
      WHERE lr.tenant_id = $1
        AND lr.status IN ('approved','cancellation_pending')
        AND lr.to_ts   >  $2::timestamptz
        AND lr.from_ts <  $3::timestamptz`,
    [job.tenant_id, periodFrom.toISOString(), periodEnd.toISOString()]
  );
  return r.rows.map(
    (row): LeaveRow => ({
      userId: row.user_id,
      type: row.type,
      subtype: row.assenza_subtype ?? null,
      from: new Date(row.from_ts),
      to: new Date(row.to_ts),
      durationHours: Number(row.duration_hours),
    })
  );
}

/** One day a leave covers inside the export period, and the minutes it claims. */
export interface LeaveDayShare {
  day: string;
  minutes: number;
}

/**
 * The days of `row` that fall inside the export period, each with its share of
 * the row's duration_hours.
 *
 * DISTRIBUTE OVER THE ROW'S OWN SPAN, THEN CLIP — never the other way round.
 * Both callers used to clip the row to the period first and divide
 * duration_hours by the number of days that SURVIVED the clip, so a leave
 * straddling a period boundary reported its whole duration in BOTH periods. A
 * Christmas closure filed through POST /leaves/bulk as one row 24/12/2026 →
 * 06/01/2027 with duration_hours 48 (6 working days × 8h) printed
 * 8 days × round(48×60/8) = 8 × 360 min = 48,00h of "Ore chiusura aziendale"
 * in the December file, and 6 days × 480 min = 48,00h again in January: 96
 * hours billed for a 48-hour shutdown, in two files that each looked
 * self-consistent. Dividing by the row's own day count makes the two periods
 * split one total instead of each claiming all of it.
 *
 * The share is a flat average over the calendar days of the span, NOT a
 * weighting by each day's scheduled hours, so a span that crosses a weekend
 * still puts hours on the Saturday. Weighting by configForDay() would be the
 * better daily figure — it is the exact inverse of computeHoursPerDay(), the
 * function that produced duration_hours in the first place — but it cannot be
 * applied here alone: the xlsx and the Centro Paghe file would then report
 * different hours for the SAME leave in the same month, which is the class of
 * divergence this whole export pass exists to close. Applying it to both moves
 * the fixed-width payroll bytes for every leave that spans a non-working day,
 * which is a deliberate, announced change and not a side effect of a rounding
 * fix. Left for that change; keep the two projections on one rule until then.
 */
export function leaveDayShares(
  row: LeaveRow,
  timeZone: string,
  periodFromDay: string,
  periodToDay: string
): LeaveDayShare[] {
  // 'permessi' is a window INSIDE one day: its minutes are the window itself,
  // never a share of duration_hours, so there is nothing to distribute and
  // clipping the instants is the whole job.
  if (row.type === 'permessi') {
    const periodFrom = new Date(startOfZonedDayUtcMs(periodFromDay, timeZone));
    // Last instant still inside the period.
    const periodTo = new Date(startOfZonedDayUtcMs(nextIsoDate(periodToDay), timeZone) - 1);
    const clipFrom = row.from < periodFrom ? periodFrom : row.from;
    const clipTo = row.to > periodTo ? periodTo : row.to;
    const minutes = Math.max(0, Math.round((clipTo.getTime() - clipFrom.getTime()) / 60000));
    if (minutes <= 0) return [];
    return [{ day: zonedDateKey(clipFrom, timeZone), minutes }];
  }

  // ferie / malattia / assenza / chiusura: span whole days.
  const span = eachZonedDateKeyInclusive(row.from, row.to, timeZone);
  if (span.length === 0) return [];
  const perDayMin = Math.round((row.durationHours * 60) / span.length);
  if (perDayMin <= 0) return [];
  // Zero-padded YYYY-MM-DD compares lexicographically in chronological order,
  // and both sides are tenant-local day keys, so this is the clip.
  return span
    .filter((day) => day >= periodFromDay && day <= periodToDay)
    .map((day) => ({ day, minutes: perDayMin }));
}

async function loadLeavesPerDay(
  job: ExportJobRow,
  timeZone: string
): Promise<Map<string, Map<string, DayLeaveBucket>>> {
  const rows = await loadLeaveRows(job, timeZone);
  const result = new Map<string, Map<string, DayLeaveBucket>>();
  for (const row of rows) {
    const shares = leaveDayShares(row, timeZone, job.period_from, job.period_to);
    if (shares.length === 0) continue;
    const userMap = result.get(row.userId) ?? new Map<string, DayLeaveBucket>();
    // Bucket by the row's REAL type — see leaveBucketKey().
    const key = leaveBucketKey(row.type);
    for (const s of shares) {
      const bucket = userMap.get(s.day) ?? emptyLeaveBucket();
      bucket[key] += s.minutes;
      userMap.set(s.day, bucket);
    }
    result.set(row.userId, userMap);
  }
  return result;
}

interface LeaveInterval {
  from: number;
  to: number;
}

async function loadLeaveIntervals(
  job: ExportJobRow,
  timeZone: string
): Promise<Map<string, LeaveInterval[]>> {
  const { start: periodFrom, end: periodEnd } = periodWindow(job, timeZone);
  // Raw approved-leave windows per user overlapping the period. Mirrors the
  // leaves subquery feeding computeAnomalies in routes/shifts.ts (status =
  // 'approved', any type), so breach deductions and presence anomalies agree
  // on what counts as "covered by leave".
  const r = await adminPool.query(
    `SELECT lr.user_id, lr.from_ts, lr.to_ts
       FROM leave_requests lr
      WHERE lr.tenant_id = $1
        AND lr.status = 'approved'
        AND lr.to_ts   >  $2::timestamptz
        AND lr.from_ts <  $3::timestamptz`,
    [job.tenant_id, periodFrom.toISOString(), periodEnd.toISOString()]
  );
  const result = new Map<string, LeaveInterval[]>();
  for (const row of r.rows) {
    const list = result.get(row.user_id) ?? [];
    list.push({ from: new Date(row.from_ts).getTime(), to: new Date(row.to_ts).getTime() });
    result.set(row.user_id, list);
  }
  return result;
}

async function loadShiftAssignments(job: ExportJobRow): Promise<Map<string, ShiftAssignment[]>> {
  // EVERY assignment overlapping the export period, with its window — not one
  // row per user. The old `DISTINCT ON (a.user_id) … ORDER BY a.valid_from
  // DESC` kept only the last one and applied it to the whole month, so a shift
  // change mid-period rewrote history (see configForDay). valid_from/valid_to
  // come out as text: a `date` parsed into a Date would be flattened to UTC
  // midnight and could compare one day off against a tenant-local day key.
  const assigns = await adminPool.query(
    `SELECT a.user_id, a.shift_template_id,
            to_char(a.valid_from, 'YYYY-MM-DD') AS valid_from,
            to_char(a.valid_to,   'YYYY-MM-DD') AS valid_to,
            st.tolerance_in_min, st.tolerance_out_min,
            st.expected_break_max_min,
            st.extraordinary_threshold_min, st.count_extraordinary,
            st.tolerance_in_breach_deduct_min, st.tolerance_out_breach_deduct_min,
            st.tolerance_break_breach_deduct_min,
            st.flexible_enabled, st.flex_in_after_min, st.flex_out_before_min
       FROM user_shift_assignments a
       JOIN shift_templates st ON st.id = a.shift_template_id
      WHERE a.tenant_id = $1
        AND a.valid_from <= $3::date
        AND (a.valid_to IS NULL OR a.valid_to >= $2::date)
      ORDER BY a.user_id, a.valid_from`,
    [job.tenant_id, job.period_from, job.period_to]
  );
  if (assigns.rowCount === 0) return new Map();

  const tplIds = [...new Set(assigns.rows.map((r) => r.shift_template_id))];
  const slots = await adminPool.query(
    `SELECT shift_template_id, day_of_week,
            to_char(start_time, 'HH24:MI') AS start_time,
            to_char(end_time, 'HH24:MI') AS end_time
       FROM shift_template_slots
      WHERE shift_template_id = ANY($1::uuid[])
      ORDER BY day_of_week, start_time`,
    [tplIds]
  );

  const slotsByTpl = new Map<string, Map<number, Array<{ start: string; end: string }>>>();
  for (const r of slots.rows) {
    const byDow = slotsByTpl.get(r.shift_template_id) ?? new Map();
    const arr = byDow.get(r.day_of_week) ?? [];
    arr.push({ start: r.start_time, end: r.end_time });
    byDow.set(r.day_of_week, arr);
    slotsByTpl.set(r.shift_template_id, byDow);
  }

  const lunch = await adminPool.query(
    `SELECT shift_template_id, day_of_week, lunch_min
       FROM shift_template_day_lunch
      WHERE shift_template_id = ANY($1::uuid[])`,
    [tplIds]
  );
  const lunchByTpl = new Map<string, Map<number, number>>();
  for (const r of lunch.rows) {
    const byDow = lunchByTpl.get(r.shift_template_id) ?? new Map<number, number>();
    byDow.set(r.day_of_week, r.lunch_min);
    lunchByTpl.set(r.shift_template_id, byDow);
  }

  const out = new Map<string, ShiftAssignment[]>();
  for (const r of assigns.rows) {
    const cfg: ShiftConfig = {
      tolerance_in_min: r.tolerance_in_min,
      tolerance_out_min: r.tolerance_out_min,
      expected_break_max_min: r.expected_break_max_min,
      extraordinary_threshold_min: r.extraordinary_threshold_min,
      count_extraordinary: r.count_extraordinary,
      tolerance_in_breach_deduct_min: r.tolerance_in_breach_deduct_min,
      tolerance_out_breach_deduct_min: r.tolerance_out_breach_deduct_min,
      tolerance_break_breach_deduct_min: r.tolerance_break_breach_deduct_min,
      flexible_enabled: r.flexible_enabled,
      flex_in_after_min: r.flex_in_after_min,
      flex_out_before_min: r.flex_out_before_min,
      slotsByDow: slotsByTpl.get(r.shift_template_id) ?? new Map(),
      lunchByDow: lunchByTpl.get(r.shift_template_id) ?? new Map(),
    };
    const list = out.get(r.user_id) ?? [];
    // The query orders by valid_from ASC, which is what configForDay's
    // backwards scan relies on.
    list.push({ validFrom: r.valid_from, validTo: r.valid_to ?? null, cfg });
    out.set(r.user_id, list);
  }
  return out;
}

function diffMin(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

// Schedule wall-clock (slot time) on `dateStr` → UTC instant in `timeZone`, so
// it lines up with stamps (timestamptz / true UTC). DST-aware — see lib/tz.ts.
// Scheduled-duration sums (end−start) are timezone-invariant; the timezone
// matters for late-in / early-out breach comparisons against real stamps.
function combineDateTime(dateStr: string, hhmm: string, timeZone: string = DEFAULT_TZ): Date {
  return zonedWallClock(dateStr, hhmm, timeZone);
}

function isoDowUtc(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay();
  return dow === 0 ? 7 : dow;
}

function sum(a: number[]): number {
  return a.reduce((acc, v) => acc + v, 0);
}

/* ─────────────────────── Payroll detail: labels + loaders ─────────────────────── */

const EVENT_LABEL: Record<string, string> = {
  clock_in: 'Entrata',
  clock_out: 'Uscita',
  break_start: 'Inizio pausa',
  break_end: 'Fine pausa',
  lunch_start: 'Inizio pranzo',
  lunch_end: 'Fine pranzo',
};
const SOURCE_LABEL: Record<string, string> = {
  employee_app: 'App dipendente',
  employee_correction: 'Correzione',
  admin_manual: 'Manuale (admin)',
  system_auto: 'Automatica (sistema)',
};
const LEAVE_TYPE_LABEL: Record<string, string> = {
  ferie: 'Ferie',
  permessi: 'Permessi',
  malattia: 'Malattia',
  assenza: 'Assenza',
  chiusura: 'Chiusura aziendale',
};
const LEAVE_STATUS_LABEL: Record<string, string> = {
  pending: 'In attesa',
  approved: 'Approvata',
  rejected: 'Rifiutata',
  cancelled: 'Annullata',
  cancellation_pending: 'Annullamento in attesa',
  cancelled_post_approval: 'Annullata (post-approvazione)',
  superseded_by_malattia: 'Sostituita da malattia',
};
const CORRECTION_STATUS_LABEL: Record<string, string> = {
  pending: 'In attesa',
  approved: 'Approvata',
  rejected: 'Rifiutata',
  superseded: 'Sostituita',
};
const ANOMALY_KIND_LABEL: Record<string, string> = {
  missing_clock_in: 'Entrata mancante',
  missing_clock_out: 'Uscita mancante',
  late_clock_in: 'Entrata in ritardo',
  early_clock_out: 'Uscita anticipata',
  short_hours: 'Ore giornaliere insufficienti',
  worked_on_rest_day: 'Lavoro in giorno di riposo',
  break_too_short: 'Pausa troppo breve',
  break_too_long: 'Pausa troppo lunga',
  lunch_too_short: 'Pausa pranzo troppo breve',
  lunch_too_long: 'Pausa pranzo troppo lunga',
  lunch_outside_window: 'Pausa pranzo fuori finestra',
  clock_out_out_of_area: 'Uscita fuori area',
};

const ROME_TZ = 'Europe/Rome';

// Labels for the Rettifiche sheet. The kinds come from parseChangeReason, so
// this map must cover StampChangeKind exhaustively.
const RETTIFICA_KIND_LABEL: Record<StampChangeKind, string> = {
  employee_stamp: 'Timbratura del dipendente',
  employee_undo: 'Annullata dal dipendente (entro 60s)',
  employee_correction: 'Richiesta di correzione approvata',
  admin_create: 'Inserita da un amministratore',
  admin_edit: 'Modificata da un amministratore',
  admin_delete: 'Eliminata da un amministratore',
  anomaly_fix: 'Correzione anomalia (orario standard)',
  bulk_apply: 'Applicazione massiva orario standard',
  auto_clockout: 'Uscita automatica dopo 15 ore',
  unknown: 'Modifica',
};

const RETTIFICA_FIELD_LABEL: Record<TrackedField, string> = {
  event_type: 'Evento',
  occurred_at: 'Data e ora',
  branch_id: 'Sede',
  notes: 'Note',
  source: 'Origine',
  deleted_at: 'Eliminazione',
};

/** Render a raw before/after jsonb value the way the rest of the workbook does. */
function fmtRettificaValue(
  field: TrackedField,
  raw: string | null,
  branchMeta: Map<string, string>
): string {
  if (raw === null) return '';
  switch (field) {
    case 'occurred_at':
    case 'deleted_at':
      return fmtRome(raw);
    case 'event_type':
      return EVENT_LABEL[raw] ?? raw;
    case 'source':
      return SOURCE_LABEL[raw] ?? raw;
    case 'branch_id':
      return branchMeta.get(raw) ?? raw;
    default:
      return raw;
  }
}

/* ── Metadati column dictionary ────────────────────────────────────────────
 * What each sheet and each column means, rendered into the Metadati sheet so
 * the workbook explains itself to a commercialista who has never seen the app.
 * The dictionary is walked against the REAL worksheet columns, so a column
 * missing from here is printed as "(descrizione mancante)" rather than silently
 * omitted — add the entry when you add the column. */
const SHEET_DESCRIPTIONS: Record<string, string> = {
  Riepilogo: 'Una riga per dipendente con i totali del periodo e i saldi residui.',
  'Dettaglio giornaliero':
    'Il dettaglio giorno per giorno di TUTTI i dipendenti in un unico foglio: una riga per dipendente e per giorno. Le colonne Nome, Cognome e Codice fiscale identificano la persona, così il foglio si può filtrare, ordinare o usare come sorgente di una tabella pivot. Compare una riga per ogni giornata prevista dall’orario di lavoro, anche se non è stata timbrata e non risulta alcuna assenza approvata: in quel caso le ore lavorate sono 0,00 e le ore ordinarie restano quelle contrattuali. Non compaiono invece le giornate successive a oggi (esportando il mese in corso) né quelle successive alla rimozione di un dipendente eliminato entro la fine del periodo. Le giornate coperte da un’assenza approvata compaiono sempre, ma se cadono oltre uno di questi limiti riportano 0,00 ore ordinarie: l’assenza resta, le ore contrattuali no.',
  Timbrature:
    'Registro grezzo di ogni timbratura del periodo, incluse quelle eliminate (marcate nella colonna Stato). È il foglio di riferimento in caso di contestazione.',
  Rettifiche:
    'Storico in sola aggiunta di ogni intervento fatto su una timbratura del periodo: chi, quando, cosa e perché. Nessuna riga può essere modificata o rimossa a posteriori.',
  Correzioni: 'Richieste di correzione timbratura inviate dai dipendenti, con esito.',
  'Ferie e Permessi': 'Ferie, permessi, malattia e assenze del periodo, con ore ed esito.',
  'Giustifiche anomalie':
    'Anomalie di orario risolte con una nota anziché correggendo le timbrature.',
  'Eventi aziendali': 'Chiusure e altri eventi imposti dall’azienda a più dipendenti.',
  'Ferie residue': 'Saldo ferie e permessi per dipendente, alla data di generazione.',
};

const ORE_LAVORATE_DESC =
  'Ore effettivamente conteggiate, calcolate sulle timbrature ATTUALI (già corrette) ed escludendo quelle eliminate. È il valore che fa fede per la busta paga.';
// Same text on both sheets, with the period/day wording swapped in: the warning
// is the important half and must not drift between the two glossary blocks.
const oreOrdinarieDesc = (scope: 'periodo' | 'giornata'): string =>
  `Ore contrattuali previste dall’orario di lavoro assegnato ${scope === 'periodo' ? 'nel periodo' : 'in quella giornata'}, al netto della pausa pranzo dedotta automaticamente: è il monte ore TEORICO (es. 8,00 su una giornata full-time), non le ore realmente svolte. ATTENZIONE: proprio perché è un valore teorico NON quadra necessariamente con "Ore lavorate" — nei giorni di assenza (ferie, permesso, malattia), di uscita anticipata o comunque di orario incompleto resta 8,00 anche se le ore lavorate sono meno, e l’eventuale eccedenza è riportata a parte in "Ore straordinarie". ${
    scope === 'periodo'
      ? 'Comprende TUTTI i giorni previsti dall’orario, compresi quelli senza alcuna timbratura e senza assenza approvata (che nel Dettaglio giornaliero compaiono con 0,00 ore lavorate): il totale non si ferma ai giorni timbrati. Si ferma però a OGGI se il periodo non è ancora concluso — esportando il mese in corso le giornate future non contano ore contrattuali — e al giorno di rimozione per un dipendente eliminato dall’azienda entro la fine del periodo. ATTENZIONE: per un dipendente soltanto DISATTIVATO l’archivio non registra la data di cessazione, quindi su un periodo già concluso le ore contrattuali arrivano comunque a fine periodo, anche se la persona se n’era andata prima; le giornate successive alla sua ultima presenza si riconoscono nel Dettaglio giornaliero perché riportano 0,00 ore lavorate. La cosa si evita esportando il periodo prima che si chiuda, oppure eliminando il dipendente anziché disattivarlo soltanto (l’eliminazione registra la data). Un dipendente disattivato o eliminato resta comunque nel file con le ore che ha effettivamente lavorato. '
      : ''
  }Se l’orario assegnato cambia in corso di periodo, ogni giornata usa l’orario in vigore in quella data. Vale 0 nei giorni non previsti dall’orario (riposo settimanale, giornate senza fasce) e per i dipendenti senza orario assegnato; le festività nazionali invece NON sono riconosciute, quindi una festività che cade in un giorno previsto dall’orario conta comunque le sue ore contrattuali.`;

const ORE_ORIGINALI_DESC =
  'Ore risultanti dalle timbrature PRIMA di ogni rettifica: orari e tipi evento originali (quelli con cui la timbratura è stata registrata la prima volta) e timbrature eliminate ancora incluse. Confrontala con "Ore lavorate": se coincidono la giornata non è stata rettificata, altrimenti la differenza è esattamente l\'effetto delle modifiche di orario e delle eliminazioni. Le timbrature inserite da un amministratore rientrano in entrambe le colonne, quindi non generano differenza: per sapere CHI ha registrato una timbratura usa la colonna Origine del foglio Timbrature.';

const COLUMN_DESCRIPTIONS: Record<string, Record<string, string>> = {
  Riepilogo: {
    Dipendente: 'Nome e cognome (o email se l’anagrafica non è compilata).',
    Email: 'Email dell’account del dipendente.',
    'Ore lavorate': ORE_LAVORATE_DESC,
    'Ore originali': ORE_ORIGINALI_DESC,
    'Ore ordinarie': oreOrdinarieDesc('periodo'),
    'Ore straordinarie':
      'Quota di straordinario già compresa nelle ore lavorate: non va sommata, è un di cui.',
    'Pausa retribuita': 'Totale pause entro la soglia di retribuzione.',
    'Pausa non retribuita': 'Totale pause oltre la soglia, non retribuite.',
    'Ore ferie': 'Ore di ferie approvate ricadenti nel periodo.',
    'Ore permessi': 'Ore di permesso approvate ricadenti nel periodo.',
    'Ore malattia': 'Ore di malattia registrate nel periodo.',
    'Ore assenze':
      'Ore di assenza giustificata diverse da ferie, permessi e malattia: lutto, Legge 104, congedo parentale, permesso di studio o elettorale, matrimonio, allattamento, assemblea sindacale, visita medica, permesso non retribuito. Il dettaglio riga per riga, con il sottotipo di ciascuna, è nel foglio "Ferie e Permessi".',
    'Ore chiusura aziendale':
      'Ore di chiusura imposta dall’azienda che NON consuma ferie (ferie collettive e chiusure addebitate a ferie sono già conteggiate in "Ore ferie"). L’elenco degli eventi è nel foglio "Eventi aziendali".',
    'Giorni lavorati': 'Numero di giornate con almeno una timbratura utile.',
    'Residuo ferie (h)': 'Saldo ferie residuo alla data di generazione del file.',
    'Residuo permessi (h)': 'Saldo permessi residuo alla data di generazione del file.',
  },
  'Dettaglio giornaliero': {
    Dipendente: 'Nome e cognome (o email se l’anagrafica non è compilata).',
    Nome: 'Nome del dipendente da anagrafica (vuoto se l’account ha solo un nome visualizzato).',
    Cognome: 'Cognome del dipendente da anagrafica.',
    'Codice fiscale':
      'Codice fiscale registrato nell’anagrafica aziendale del dipendente. È la chiave da usare per riconciliare le righe con il gestionale paghe; vuoto se non è stato compilato.',
    Giorno: 'Data della giornata (fuso orario aziendale).',
    Marker:
      'M = malattia, C = chiusura aziendale, F = ferie intera giornata, A = assenza giustificata, P = permesso parziale. Vuoto se la giornata non ha assenze approvate; se ne coincidono più di una vale la prima di questo elenco.',
    'Ore lavorate': ORE_LAVORATE_DESC,
    'Ore originali': ORE_ORIGINALI_DESC,
    'Ore ordinarie': oreOrdinarieDesc('giornata'),
    'Ore straordinarie': 'Quota di straordinario compresa nelle ore lavorate del giorno.',
    'Ore ferie': 'Ore di ferie approvate nella giornata.',
    'Ore permessi': 'Ore di permesso approvate nella giornata.',
    'Ore malattia': 'Ore di malattia nella giornata.',
    'Ore assenze':
      'Ore di assenza giustificata nella giornata, diverse da ferie, permessi e malattia (lutto, Legge 104, congedo parentale, visita medica, permesso non retribuito…).',
    'Ore chiusura aziendale':
      'Ore di chiusura imposta dall’azienda nella giornata, nella forma che non consuma ferie.',
    'Pausa retribuita (min)': 'Minuti di pausa retribuita nella giornata.',
    'Pausa non retribuita (min)': 'Minuti di pausa non retribuita nella giornata.',
  },
  Timbrature: {
    Dipendente: 'Dipendente a cui appartiene la timbratura.',
    'Data e ora': 'Valore ATTUALE della timbratura (se rettificata, il valore corretto).',
    Evento: 'Entrata, Uscita, Inizio/Fine pausa, Inizio/Fine pranzo.',
    Origine:
      'App dipendente, Correzione (richiesta approvata), Manuale (admin) o Automatica (sistema, es. chiusura oltre 15h).',
    Sede: 'Sede registrata al momento della timbratura.',
    Dispositivo: 'Piattaforma del dispositivo (ios / android / web).',
    'Versione app': 'Versione dell’app usata per timbrare.',
    'Pos. sospetta': '"Sì" se il dispositivo segnalava una posizione simulata (mock location).',
    'Fuori area': '"Sì" se la timbratura è avvenuta fuori dal raggio della sede.',
    Stato: 'Attiva oppure Eliminata. Le eliminate non entrano nel conteggio ore.',
    Modificata:
      '"Sì (n)" se un amministratore ha cambiato orario o tipo evento, con il numero di modifiche.',
    'Ora originale': 'Orario timbrato dal dipendente, prima della prima rettifica.',
    'Evento originale': 'Tipo evento timbrato dal dipendente, prima della prima rettifica.',
    'Modificata da': 'Amministratore che ha effettuato l’ultima modifica.',
    'Modificata il': 'Data e ora dell’ultima modifica.',
    'Eliminata da': 'Amministratore che ha eliminato la timbratura.',
    'Motivo eliminazione': 'Motivazione obbligatoria indicata all’eliminazione.',
    Note: 'Annotazioni sulla timbratura.',
  },
  Rettifiche: {
    Dipendente: 'Dipendente a cui appartiene la timbratura rettificata.',
    'Timbratura (giorno)': 'Giornata della timbratura interessata.',
    'Tipo intervento':
      'Natura dell’intervento: modifica admin, eliminazione, correzione approvata, orario standard, uscita automatica…',
    Campo: 'Campo toccato (Data e ora, Evento, Sede, Note, Origine, Eliminazione).',
    'Valore precedente': 'Valore prima dell’intervento.',
    'Nuovo valore': 'Valore dopo l’intervento.',
    Motivazione: 'Motivazione indicata da chi è intervenuto.',
    Operatore: 'Chi ha effettuato l’intervento.',
    'Data intervento': 'Quando l’intervento è stato registrato.',
  },
  Correzioni: {
    Dipendente: 'Dipendente che ha inviato la richiesta.',
    'Evento richiesto': 'Tipo di timbratura richiesta.',
    'Data/ora richiesta': 'Data e ora richieste dal dipendente.',
    Sede: 'Sede indicata nella richiesta.',
    Giustificazione: 'Motivazione scritta dal dipendente.',
    Stato: 'In attesa, Approvata o Respinta.',
    'Risolta da': 'Amministratore che ha deciso.',
    'Risolta il': 'Data della decisione.',
    'Nota risoluzione': 'Nota lasciata dall’amministratore.',
    'Inviata il': 'Data di invio della richiesta.',
  },
  'Ferie e Permessi': {
    Dipendente: 'Dipendente interessato.',
    Tipo: 'Ferie, Permessi, Malattia, Assenza o Chiusura aziendale.',
    Stato: 'Stato della richiesta.',
    Dal: 'Inizio del periodo.',
    Al: 'Fine del periodo.',
    Ore: 'Ore complessive imputate.',
    Retribuito: 'Solo per le assenze: se è retribuita.',
    'Sottotipo assenza': 'Dettaglio del tipo di assenza.',
    'Protocollo INPS': 'Numero di protocollo del certificato, per la malattia.',
    'Nota dipendente': 'Nota inserita dal dipendente.',
    Origine: 'Inserito da admin oppure Richiesta dipendente.',
    'Deciso da': 'Chi ha approvato o rifiutato.',
    'Deciso il': 'Data della decisione.',
    'Motivo rifiuto': 'Motivazione in caso di rifiuto.',
  },
  'Giustifiche anomalie': {
    Dipendente: 'Dipendente a cui si riferisce l’anomalia.',
    Data: 'Giornata dell’anomalia.',
    'Tipo anomalia': 'Entrata mancante, uscita anticipata, pausa troppo lunga…',
    Nota: 'Spiegazione inserita dall’amministratore.',
    'Inserita da': 'Amministratore che ha giustificato l’anomalia.',
    'Inserita il': 'Data di inserimento della giustificazione.',
  },
  'Eventi aziendali': {
    Titolo: 'Titolo dell’evento.',
    Tipo: 'Tipo di evento (chiusura, ferie collettive…).',
    Dal: 'Inizio dell’evento.',
    Al: 'Fine dell’evento.',
    'Dipendenti coinvolti': 'Quanti dipendenti sono interessati.',
    'Ore totali': 'Somma delle ore imputate a tutti i dipendenti.',
  },
  'Ferie residue': {
    Dipendente: 'Dipendente interessato.',
    Tipo: 'Ferie o permessi.',
    'Saldo iniziale (h)': 'Saldo di partenza assegnato.',
    'Maturato (h)': 'Ore maturate finora.',
    'Usato approvato (h)': 'Ore già usate e approvate.',
    'Residuo (h)': 'Saldo disponibile: iniziale + maturato − usato.',
  },
};

function fmtRome(d: Date | string | null | undefined, withTime = true): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: ROME_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

// A plain calendar date ('YYYY-MM-DD', e.g. a `date` column) as dd/MM/yyyy.
// It carries no instant, so it must not be round-tripped through `new Date()`:
// that parse resolves against the server clock and re-reading it in Rome shifts
// the day for any server zone east of Rome.
function fmtIsoDate(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-');
  return y && mo && d ? `${d}/${mo}/${y}` : '';
}

function boolLabel(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  return v ? 'Sì' : 'No';
}

interface UserMeta {
  name: string;
  email: string;
  /** Anagrafica fields, kept apart from `name` so a sheet can print them as
   *  separate identifying columns. Empty when the account carries only a
   *  display name, or when the membership has no codice fiscale. */
  firstName: string;
  lastName: string;
  codiceFiscale: string;
}

async function loadUserMeta(job: ExportJobRow): Promise<Map<string, UserMeta>> {
  const r = await adminPool.query(
    `SELECT m.user_id,
            COALESCE(au.email, m.user_id::text) AS email,
            COALESCE(au.first_name, '') AS first_name,
            COALESCE(au.last_name, '') AS last_name,
            COALESCE(m.codice_fiscale, '') AS codice_fiscale,
            COALESCE(
              NULLIF(au.display_name, ''),
              NULLIF(trim(COALESCE(au.first_name, '') || ' ' || COALESCE(au.last_name, '')), ''),
              au.email,
              m.user_id::text
            ) AS name
       FROM memberships m
       LEFT JOIN auth_users au ON au.id = m.user_id
      WHERE m.tenant_id = $1`,
    [job.tenant_id]
  );
  const map = new Map<string, UserMeta>();
  for (const row of r.rows) {
    map.set(row.user_id, {
      name: row.name,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      codiceFiscale: row.codice_fiscale,
    });
  }
  return map;
}

function metaName(meta: Map<string, UserMeta>, userId: string, fallback?: string): string {
  return meta.get(userId)?.name ?? fallback ?? userId;
}
function metaEmail(meta: Map<string, UserMeta>, userId: string, fallback?: string): string {
  return meta.get(userId)?.email ?? fallback ?? userId;
}
function metaFirstName(meta: Map<string, UserMeta>, userId: string): string {
  return meta.get(userId)?.firstName ?? '';
}
function metaLastName(meta: Map<string, UserMeta>, userId: string): string {
  return meta.get(userId)?.lastName ?? '';
}
function metaCodiceFiscale(meta: Map<string, UserMeta>, userId: string): string {
  return meta.get(userId)?.codiceFiscale ?? '';
}

async function loadBranchMeta(job: ExportJobRow): Promise<Map<string, string>> {
  const r = await adminPool.query(`SELECT id, name FROM branches WHERE tenant_id = $1`, [
    job.tenant_id,
  ]);
  const map = new Map<string, string>();
  for (const row of r.rows) map.set(row.id, row.name);
  return map;
}

interface StampDetailRow {
  user_id: string;
  event_type: string;
  occurred_at: Date;
  source: string;
  branch_id: string | null;
  device_platform: string | null;
  device_app_version: string | null;
  suspicious_mock_location: boolean;
  out_of_geofence: boolean;
  notes: string | null;
  original_occurred_at: Date | null;
  original_event_type: string | null;
  edited_at: Date | null;
  edited_by_user_id: string | null;
  edit_count: number;
  deleted_at: Date | null;
  deleted_by_user_id: string | null;
  deletion_reason: string | null;
}

/**
 * Raw stamp detail for the period.
 *
 * `includeDeleted` is REQUIRED and has no default on purpose. Two callers with
 * opposite needs read this: the Timbrature sheet is an audit trail and must
 * show punches an admin removed (they are what a dispute is about), while
 * Centro Paghe turns these same rows into the LUL in/out pairs and must never
 * see them — a deleted punch in a payroll file is a wrong payslip. A defaulted
 * flag would make the payroll path silently inherit whichever default the audit
 * path happened to want.
 */
// Exported for the regression test only: the deleted-punch predicate below is
// the difference between an audit sheet and a wrong payslip, so it is pinned
// directly rather than inferred from a generated workbook.
export async function loadStampsDetail(
  job: ExportJobRow,
  timeZone: string,
  opts: { includeDeleted: boolean }
): Promise<StampDetailRow[]> {
  const { start, end } = periodWindow(job, timeZone);
  const r = await adminPool.query(
    `SELECT user_id, event_type, occurred_at, source, branch_id,
            device_platform, device_app_version, suspicious_mock_location, out_of_geofence, notes,
            original_occurred_at, original_event_type, edited_at, edited_by_user_id, edit_count,
            deleted_at, deleted_by_user_id, deletion_reason
       FROM stamps
      WHERE tenant_id = $1
        AND (deleted_at IS NULL OR $4::boolean)
        AND occurred_at >= $2::timestamptz
        AND occurred_at <  $3::timestamptz
      ORDER BY user_id, occurred_at`,
    [job.tenant_id, start.toISOString(), end.toISOString(), opts.includeDeleted]
  );
  return r.rows as StampDetailRow[];
}

/**
 * "Ore originali" — what the day added up to BEFORE any rettifica, read next to
 * "Ore lavorate" (the corrected, payroll-bearing figure). The gap between the
 * two is exactly what editing and deleting punches changed.
 *
 * Two deliberate differences from the payroll aggregation:
 *  - original values: COALESCE(original_*, current), so a punch an admin moved
 *    counts at the time it was first recorded;
 *  - deleted punches included: before the deletion that punch was part of the
 *    day, and a removed punch is precisely what a dispute is about.
 *
 * EVERY source counts, admin_manual and system_auto included. An earlier cut
 * restricted this to employee-stamped punches, which sounded right but, on real
 * data, read as 0 for anyone whose hours are typed in by the office and
 * understated everyone whose missing uscita an admin had supplied (the in/out
 * pair never closed). Because admin-inserted punches now appear on BOTH sides,
 * they cancel and the gap isolates edits and deletions alone; WHO entered a
 * punch is answered by the Origine column of the Timbrature sheet instead.
 *
 * The period window is applied to the ORIGINAL instant too, so a punch an admin
 * moved across a month boundary is still counted in the month it was stamped in.
 */
// Exported for the regression test: the definition is a product decision, so it
// is pinned rather than left to the workbook to imply.
export async function loadOriginalMinutes(
  job: ExportJobRow,
  timeZone: string
): Promise<Map<string, Map<string, number>>> {
  const { start, end } = periodWindow(job, timeZone);
  const r = await adminPool.query(
    `SELECT user_id,
            COALESCE(original_event_type, event_type)   AS event_type,
            COALESCE(original_occurred_at, occurred_at) AS occurred_at
       FROM stamps
      WHERE tenant_id = $1
        AND COALESCE(original_occurred_at, occurred_at) >= $2::timestamptz
        AND COALESCE(original_occurred_at, occurred_at) <  $3::timestamptz
      ORDER BY user_id, COALESCE(original_occurred_at, occurred_at)`,
    [job.tenant_id, start.toISOString(), end.toISOString()]
  );

  const byUser = new Map<string, Array<{ event: string; at: Date }>>();
  for (const row of r.rows) {
    const list = byUser.get(row.user_id) ?? [];
    list.push({ event: row.event_type as string, at: new Date(row.occurred_at) });
    byUser.set(row.user_id, list);
  }

  const out = new Map<string, Map<string, number>>();
  for (const [userId, stamps] of byUser) {
    out.set(userId, workedMinutesByDay(stamps, timeZone));
  }
  return out;
}

/**
 * Raw worked minutes per tenant-local day from a punch list.
 *
 * Mirrors the in/out pairing of aggregateForExport (clock_in opens; break/lunch
 * start closes and accrues; break/lunch end reopens; clock_out closes) but
 * applies NO shift deductions, overtime split or rounding — "ore originali" is
 * what the punches literally add up to, not a payroll figure. Kept as its own
 * function so it can never alter the payroll numbers.
 */
function workedMinutesByDay(
  stamps: Array<{ event: string; at: Date }>,
  timeZone: string
): Map<string, number> {
  const perDay = new Map<string, number>();
  let openIn: Date | null = null;
  let openPause: Date | null = null;
  const add = (at: Date, minutes: number): void => {
    const key = zonedDateKey(at, timeZone);
    perDay.set(key, (perDay.get(key) ?? 0) + minutes);
  };
  for (const s of stamps) {
    if (s.event === 'clock_in') {
      openIn = s.at;
    } else if ((s.event === 'break_start' || s.event === 'lunch_start') && openIn) {
      add(openIn, diffMin(openIn, s.at));
      openPause = s.at;
      openIn = null;
    } else if ((s.event === 'break_end' || s.event === 'lunch_end') && openPause) {
      openIn = s.at;
      openPause = null;
    } else if (s.event === 'clock_out' && openIn) {
      add(openIn, diffMin(openIn, s.at));
      openIn = null;
    }
    // An unmatched event (open shift, missing entrata) contributes nothing —
    // same as the payroll pass, which also only accrues on a closed pair.
  }
  return perDay;
}

interface RettificaRow {
  user_id: string;
  recorded_at: Date;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  changed_by: string | null;
  change_reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  stamp_occurred_at: Date | null;
}

/**
 * Every change made to a punch of the period, from the append-only history.
 * INSERT rows are excluded: they are the punches themselves, already listed in
 * the Timbrature sheet — this sheet is only about what happened to them after.
 */
async function loadRettifiche(job: ExportJobRow, timeZone: string): Promise<RettificaRow[]> {
  const { start, end } = periodWindow(job, timeZone);
  const r = await adminPool.query(
    // Scoped by the punch's own time, not by when the change was made: a
    // rettifica applied in August to a July punch belongs to the July payroll
    // pack. COALESCE picks the original time so a punch moved across the period
    // boundary still surfaces in the period it was stamped in.
    `SELECT h.user_id, h.recorded_at, h.operation, h.changed_by, h.change_reason,
            h.before, h.after,
            COALESCE(s.original_occurred_at, s.occurred_at) AS stamp_occurred_at
       FROM stamps_history h
       JOIN stamps s ON s.id = h.stamp_id
      WHERE h.tenant_id = $1
        AND h.operation <> 'INSERT'
        AND COALESCE(s.original_occurred_at, s.occurred_at) >= $2::timestamptz
        AND COALESCE(s.original_occurred_at, s.occurred_at) <  $3::timestamptz
      ORDER BY h.user_id, h.recorded_at, h.id`,
    [job.tenant_id, start.toISOString(), end.toISOString()]
  );
  return r.rows as RettificaRow[];
}

interface CorrectionRow {
  user_id: string;
  claimed_event_type: string;
  claimed_occurred_at: Date;
  claimed_branch_id: string | null;
  justification: string;
  status: string;
  resolved_by: string | null;
  resolved_at: Date | null;
  resolution_note: string | null;
  created_at: Date;
}

async function loadCorrections(job: ExportJobRow, timeZone: string): Promise<CorrectionRow[]> {
  const { start, end } = periodWindow(job, timeZone);
  // Corrections about stamps that fall inside the payroll period.
  const r = await adminPool.query(
    `SELECT user_id, claimed_event_type, claimed_occurred_at, claimed_branch_id,
            justification, status, resolved_by, resolved_at, resolution_note, created_at
       FROM correction_requests
      WHERE tenant_id = $1
        AND claimed_occurred_at >= $2::timestamptz
        AND claimed_occurred_at <  $3::timestamptz
      ORDER BY user_id, claimed_occurred_at`,
    [job.tenant_id, start.toISOString(), end.toISOString()]
  );
  return r.rows as CorrectionRow[];
}

interface LeaveDetailRow {
  user_id: string;
  type: string;
  status: string;
  from_ts: Date;
  to_ts: Date;
  duration_hours: string;
  inps_protocol: string | null;
  assenza_subtype: string | null;
  is_paid: boolean | null;
  user_note: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  rejection_reason: string | null;
  created_by_admin: boolean;
}

async function loadLeaveDetail(job: ExportJobRow, timeZone: string): Promise<LeaveDetailRow[]> {
  const { start, end } = periodWindow(job, timeZone);
  // Individual leave events overlapping the period. Company-wide closures
  // (chiusura) go to the dedicated "Eventi aziendali" sheet instead.
  const r = await adminPool.query(
    `SELECT user_id, type, status, from_ts, to_ts, duration_hours,
            inps_protocol, assenza_subtype, is_paid, user_note,
            decided_by, decided_at, rejection_reason, created_by_admin
       FROM leave_requests
      WHERE tenant_id = $1
        AND type IN ('ferie','permessi','malattia','assenza')
        AND to_ts   > $2::timestamptz
        AND from_ts < $3::timestamptz
      ORDER BY user_id, from_ts`,
    [job.tenant_id, start.toISOString(), end.toISOString()]
  );
  return r.rows as LeaveDetailRow[];
}

interface JustificationRow {
  user_id: string;
  anomaly_date: string;
  anomaly_kind: string;
  note: string;
  created_by: string | null;
  created_at: Date;
}

async function loadJustifications(job: ExportJobRow): Promise<JustificationRow[]> {
  // Note-only anomaly justifications (see anomaly_justifications): the deviation
  // was acknowledged with an explanation rather than fixed with stamps.
  const r = await adminPool.query(
    `SELECT user_id, to_char(anomaly_date, 'YYYY-MM-DD') AS anomaly_date,
            anomaly_kind, note, created_by, created_at
       FROM anomaly_justifications
      WHERE tenant_id = $1
        AND anomaly_date >= $2::date AND anomaly_date <= $3::date
      ORDER BY user_id, anomaly_date`,
    [job.tenant_id, job.period_from, job.period_to]
  );
  return r.rows as JustificationRow[];
}

interface EventRow {
  title: string | null;
  type: string;
  from_ts: Date;
  to_ts: Date;
  users_count: string;
  total_hours: string;
}

async function loadEventi(job: ExportJobRow, timeZone: string): Promise<EventRow[]> {
  const { start, end } = periodWindow(job, timeZone);
  // Admin-pushed events: company closures + any batch the admin created.
  // Grouped by batch (one logical event = many per-user rows).
  const r = await adminPool.query(
    `SELECT MIN(title) AS title,
            MIN(type) AS type,
            MIN(from_ts) AS from_ts,
            MAX(to_ts) AS to_ts,
            -- DISTINCT, because one employee can hold several rows of one
            -- batch: splitClosureAroundOverlaps emits a segment per run of free
            -- days, and applyMalattiaOverlap cuts a closure charged to ferie in
            -- half when a sick note lands inside it. COUNT(*) counted rows, so
            -- the "Dipendenti coinvolti" column of Eventi aziendali reported
            -- more employees than the company has.
            COUNT(DISTINCT user_id) AS users_count,
            SUM(duration_hours) AS total_hours
       FROM leave_requests
      WHERE tenant_id = $1
        AND (type = 'chiusura' OR (created_by_admin = true AND batch_id IS NOT NULL))
        AND to_ts   > $2::timestamptz
        AND from_ts < $3::timestamptz
      GROUP BY COALESCE(batch_id::text, id::text)
      ORDER BY MIN(from_ts)`,
    [job.tenant_id, start.toISOString(), end.toISOString()]
  );
  return r.rows as EventRow[];
}

interface ResidueRow {
  type: 'ferie' | 'permessi';
  initial: number;
  accrued: number;
  used: number;
  residual: number;
}

async function loadResidue(job: ExportJobRow): Promise<Map<string, ResidueRow[]>> {
  // Mirrors getQuotaSummary (lib/leave-quota.ts): residual = initial_balance
  // + Σ accruals − Σ approved leave of the same type. Point-in-time (all-time
  // totals), matching the residue shown in the app's Ferie & Permessi page.
  const r = await adminPool.query(
    `SELECT a.user_id,
            a.type,
            a.initial_balance::float8 AS initial,
            COALESCE((SELECT SUM(ac.hours)::float8 FROM leave_accruals ac
                       WHERE ac.assignment_id = a.id), 0) AS accrued,
            COALESCE((SELECT SUM(lr.duration_hours)::float8 FROM leave_requests lr
                       WHERE lr.user_id = a.user_id
                         AND lr.type = a.type
                         AND lr.status = 'approved'), 0) AS used
       FROM leave_quota_assignments a
      WHERE a.tenant_id = $1
        AND a.ended_on IS NULL`,
    [job.tenant_id]
  );
  const map = new Map<string, ResidueRow[]>();
  for (const row of r.rows) {
    const initial = Number(row.initial);
    const accrued = Number(row.accrued);
    const used = Number(row.used);
    const list = map.get(row.user_id) ?? [];
    list.push({ type: row.type, initial, accrued, used, residual: initial + accrued - used });
    map.set(row.user_id, list);
  }
  return map;
}

function residualOf(rows: ResidueRow[] | undefined, type: 'ferie' | 'permessi'): number | null {
  const row = rows?.find((r) => r.type === type);
  return row ? row.residual : null;
}

/** Bold + freeze the header row and enable an auto-filter across all columns. */
function styleHeader(ws: ExcelJS.Worksheet): void {
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (ws.columnCount > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  }
}

function setHourFormat(ws: ExcelJS.Worksheet, keys: string[]): void {
  for (const k of keys) {
    const col = ws.getColumn(k);
    if (col) col.numFmt = '0.00';
  }
}

async function writeJson(job: ExportJobRow, data: UserAgg[]): Promise<ExportResult> {
  const timeZone = await loadTenantTimeZone(job.tenant_id);
  // Aggregates feed the `users` array; leaves + justifications carry the
  // provenance of any admin correction (created_by_admin / note-only fixes).
  const [leaves, justifications] = await Promise.all([
    loadLeaveDetail(job, timeZone),
    loadJustifications(job),
  ]);
  const body = {
    schema_version: 'v1',
    tenant_id: job.tenant_id,
    period: { from: job.period_from, to: job.period_to },
    generated_at: new Date().toISOString(),
    users: data,
    leaves: leaves.map((l) => ({
      user_id: l.user_id,
      type: l.type,
      status: l.status,
      from_ts: l.from_ts,
      to_ts: l.to_ts,
      duration_hours: Number(l.duration_hours),
      created_by_admin: l.created_by_admin,
      user_note: l.user_note,
    })),
    anomaly_justifications: justifications.map((j) => ({
      user_id: j.user_id,
      date: j.anomaly_date,
      kind: j.anomaly_kind,
      note: j.note,
    })),
  };
  const key = `tenants/${job.tenant_id}/exports/${job.id}.json`;
  await persist(key, Buffer.from(JSON.stringify(body, null, 2), 'utf8'));
  return { storageKey: key, signedUrlExpiresAt: new Date(Date.now() + 15 * 60_000) };
}

async function writeXlsx(job: ExportJobRow, data: UserAgg[]): Promise<ExportResult> {
  const timeZone = await loadTenantTimeZone(job.tenant_id);
  // Load all payroll detail in parallel — each is a single tenant-scoped query.
  const [
    userMeta,
    branchMeta,
    residueByUser,
    stamps,
    corrections,
    leaves,
    eventi,
    justifications,
    rettifiche,
    originalByUserDay,
  ] = await Promise.all([
    loadUserMeta(job),
    loadBranchMeta(job),
    loadResidue(job),
    // Audit sheet: deleted punches included, flagged in a Stato column.
    loadStampsDetail(job, timeZone, { includeDeleted: true }),
    loadCorrections(job, timeZone),
    loadLeaveDetail(job, timeZone),
    loadEventi(job, timeZone),
    loadJustifications(job),
    loadRettifiche(job, timeZone),
    loadOriginalMinutes(job, timeZone),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'sonoQui';

  /* 1. Riepilogo — one row per employee, totals + residual balances. */
  const riep = wb.addWorksheet('Riepilogo');
  riep.columns = [
    { header: 'Dipendente', key: 'name', width: 26 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Ore lavorate', key: 'worked', width: 14 },
    // Sits next to "Ore lavorate" on purpose: the two side by side show how much
    // of the month was rewritten after the fact.
    { header: 'Ore originali', key: 'original', width: 14 },
    // Ordinarie immediately before straordinarie, on both sheets: the customer
    // reads the pair the way the payslip prints it ("8 ordinarie, accanto le
    // straordinarie"), and splitting them apart is what made them ask.
    { header: 'Ore ordinarie', key: 'ordinary', width: 16 },
    { header: 'Ore straordinarie', key: 'overtime', width: 18 },
    { header: 'Pausa retribuita', key: 'paid', width: 18 },
    { header: 'Pausa non retribuita', key: 'unpaid', width: 22 },
    { header: 'Ore ferie', key: 'ferie', width: 12 },
    { header: 'Ore permessi', key: 'permessi', width: 14 },
    { header: 'Ore malattia', key: 'malattia', width: 14 },
    // The two columns the shutdown incident asked for: 'chiusura' and
    // 'assenza' hours used to be added to Ore malattia. They sit after the
    // three historical leave columns so the leave block reads in the same
    // order as the Tipo values of the "Ferie e Permessi" sheet.
    { header: 'Ore assenze', key: 'assenza', width: 14 },
    { header: 'Ore chiusura aziendale', key: 'chiusura', width: 24 },
    { header: 'Giorni lavorati', key: 'days', width: 16 },
    { header: 'Residuo ferie (h)', key: 'res_ferie', width: 18 },
    { header: 'Residuo permessi (h)', key: 'res_permessi', width: 20 },
  ];
  for (const u of data) {
    const res = residueByUser.get(u.user_id);
    const originalDays = originalByUserDay.get(u.user_id);
    const originalTotal = originalDays
      ? [...originalDays.values()].reduce((a, b) => a + b, 0)
      : 0;
    riep.addRow({
      name: metaName(userMeta, u.user_id, u.email),
      email: metaEmail(userMeta, u.user_id, u.email),
      worked: u.worked_minutes_total / 60,
      original: originalTotal / 60,
      ordinary: u.ordinary_minutes_total / 60,
      overtime: u.overtime_minutes_total / 60,
      paid: u.paid_break_minutes_total / 60,
      unpaid: u.unpaid_break_minutes_total / 60,
      ferie: u.ferie_minutes_total / 60,
      permessi: u.permessi_minutes_total / 60,
      malattia: u.malattia_minutes_total / 60,
      assenza: u.assenza_minutes_total / 60,
      chiusura: u.chiusura_minutes_total / 60,
      days: u.worked_days,
      res_ferie: residualOf(res, 'ferie'),
      res_permessi: residualOf(res, 'permessi'),
    });
  }
  setHourFormat(riep, [
    'worked', 'original', 'ordinary', 'overtime', 'paid', 'unpaid', 'ferie', 'permessi',
    'malattia', 'assenza', 'chiusura', 'res_ferie', 'res_permessi',
  ]);
  styleHeader(riep);

  /* 2. Dettaglio giornaliero — every employee-day of the period in ONE sheet.
   *
   * This used to be one sheet per employee. A workbook with thirty tabs cannot
   * be filtered, sorted or pivoted as a whole, and payroll software that reads
   * the file has to know the sheet names in advance. A single flat table with
   * the employee repeated on every row can do all of that; the identity columns
   * (Nome / Cognome / Codice fiscale) are what makes each row attributable, so
   * they lead the table. */
  const dt = wb.addWorksheet('Dettaglio giornaliero');
  dt.columns = [
    { header: 'Dipendente', key: 'name', width: 26 },
    { header: 'Nome', key: 'first', width: 18 },
    { header: 'Cognome', key: 'last', width: 18 },
    { header: 'Codice fiscale', key: 'cf', width: 20 },
    { header: 'Giorno', key: 'day', width: 14 },
    { header: 'Marker', key: 'marker', width: 8 },
    { header: 'Ore lavorate', key: 'worked', width: 14 },
    { header: 'Ore originali', key: 'original', width: 14 },
    // Same pairing as Riepilogo: ordinarie then straordinarie, side by side.
    { header: 'Ore ordinarie', key: 'ordinary', width: 16 },
    { header: 'Ore straordinarie', key: 'overtime', width: 18 },
    { header: 'Ore ferie', key: 'ferie', width: 12 },
    { header: 'Ore permessi', key: 'permessi', width: 14 },
    { header: 'Ore malattia', key: 'malattia', width: 14 },
    // Same block, same order as Riepilogo — the two sheets are read side by
    // side and a column that moves between them is a column that gets summed
    // against the wrong one.
    { header: 'Ore assenze', key: 'assenza', width: 14 },
    { header: 'Ore chiusura aziendale', key: 'chiusura', width: 24 },
    { header: 'Pausa retribuita (min)', key: 'paid', width: 22 },
    { header: 'Pausa non retribuita (min)', key: 'unpaid', width: 26 },
  ];
  // Employee blocks in alphabetical order: the aggregate rows come out of the
  // aggregator keyed by user_id, which is uuid order — fine when it is one row
  // per person (Riepilogo), unreadable when it is thirty rows each.
  const detailUsers = [...data].sort((a, b) =>
    metaName(userMeta, a.user_id, a.email).localeCompare(metaName(userMeta, b.user_id, b.email))
  );
  for (const u of detailUsers) {
    const originalDays = originalByUserDay.get(u.user_id);
    const identity = {
      name: metaName(userMeta, u.user_id, u.email),
      first: metaFirstName(userMeta, u.user_id),
      last: metaLastName(userMeta, u.user_id),
      cf: metaCodiceFiscale(userMeta, u.user_id),
    };
    for (const d of u.days) {
      dt.addRow({
        ...identity,
        day: d.day,
        marker: d.leave_marker ?? '',
        worked: d.worked_minutes / 60,
        original: (originalDays?.get(d.day) ?? 0) / 60,
        ordinary: d.ordinary_minutes / 60,
        overtime: d.overtime_minutes / 60,
        ferie: d.ferie_minutes / 60,
        permessi: d.permessi_minutes / 60,
        malattia: d.malattia_minutes / 60,
        assenza: d.assenza_minutes / 60,
        chiusura: d.chiusura_minutes / 60,
        paid: d.paid_break_minutes,
        unpaid: d.unpaid_break_minutes,
      });
    }
  }
  setHourFormat(dt, [
    'worked', 'original', 'ordinary', 'overtime', 'ferie', 'permessi', 'malattia',
    'assenza', 'chiusura',
  ]);
  styleHeader(dt);
  // The identity columns stay on screen while scrolling right through the hour
  // columns — without this the numbers lose the person they belong to.
  dt.views = [{ state: 'frozen', xSplit: 4, ySplit: 1 }];

  /* 3. Timbrature — raw stamp detail (audit trail). */
  const tb = wb.addWorksheet('Timbrature');
  tb.columns = [
    { header: 'Dipendente', key: 'name', width: 24 },
    { header: 'Data e ora', key: 'when', width: 18 },
    { header: 'Evento', key: 'event', width: 14 },
    { header: 'Origine', key: 'source', width: 18 },
    { header: 'Sede', key: 'branch', width: 20 },
    { header: 'Dispositivo', key: 'device', width: 14 },
    { header: 'Versione app', key: 'appv', width: 14 },
    { header: 'Pos. sospetta', key: 'mock', width: 14 },
    { header: 'Fuori area', key: 'oog', width: 12 },
    { header: 'Stato', key: 'state', width: 12 },
    { header: 'Modificata', key: 'edited', width: 12 },
    { header: 'Ora originale', key: 'orig_when', width: 18 },
    { header: 'Evento originale', key: 'orig_event', width: 18 },
    { header: 'Modificata da', key: 'edited_by', width: 24 },
    { header: 'Modificata il', key: 'edited_at', width: 18 },
    { header: 'Eliminata da', key: 'deleted_by', width: 24 },
    { header: 'Motivo eliminazione', key: 'deleted_why', width: 30 },
    { header: 'Note', key: 'notes', width: 30 },
  ];
  for (const s of stamps) {
    const edited = s.original_occurred_at !== null || s.original_event_type !== null;
    tb.addRow({
      name: metaName(userMeta, s.user_id),
      when: fmtRome(s.occurred_at),
      event: EVENT_LABEL[s.event_type] ?? s.event_type,
      source: SOURCE_LABEL[s.source] ?? s.source,
      branch: s.branch_id ? branchMeta.get(s.branch_id) ?? '' : '',
      device: s.device_platform ?? '',
      appv: s.device_app_version ?? '',
      mock: s.suspicious_mock_location ? 'Sì' : '',
      oog: s.out_of_geofence ? 'Sì' : '',
      state: s.deleted_at ? 'Eliminata' : 'Attiva',
      edited: edited ? `Sì (${s.edit_count})` : '',
      orig_when: s.original_occurred_at ? fmtRome(s.original_occurred_at) : '',
      orig_event: s.original_event_type
        ? EVENT_LABEL[s.original_event_type] ?? s.original_event_type
        : '',
      edited_by: s.edited_by_user_id ? metaName(userMeta, s.edited_by_user_id, '') : '',
      edited_at: fmtRome(s.edited_at),
      deleted_by: s.deleted_by_user_id ? metaName(userMeta, s.deleted_by_user_id, '') : '',
      deleted_why: s.deletion_reason ?? '',
      notes: s.notes ?? '',
    });
  }
  styleHeader(tb);

  /* 3b. Rettifiche — the append-only trail of every change to a punch. */
  const rt = wb.addWorksheet('Rettifiche');
  rt.columns = [
    { header: 'Dipendente', key: 'name', width: 24 },
    { header: 'Timbratura (giorno)', key: 'day', width: 18 },
    { header: 'Tipo intervento', key: 'kind', width: 30 },
    { header: 'Campo', key: 'field', width: 16 },
    { header: 'Valore precedente', key: 'before', width: 24 },
    { header: 'Nuovo valore', key: 'after', width: 24 },
    { header: 'Motivazione', key: 'why', width: 40 },
    { header: 'Operatore', key: 'by', width: 24 },
    { header: 'Data intervento', key: 'at', width: 18 },
  ];
  for (const h of rettifiche) {
    const ev = describeHistoryRow({
      id: 0,
      stamp_id: '',
      user_id: h.user_id,
      operation: h.operation,
      recorded_at: h.recorded_at,
      changed_by: h.changed_by,
      change_reason: h.change_reason,
      before: h.before,
      after: h.after,
    });
    const base = {
      name: metaName(userMeta, h.user_id),
      day: fmtRome(h.stamp_occurred_at, false),
      kind: RETTIFICA_KIND_LABEL[ev.kind] ?? ev.kind,
      why: ev.justification ?? '',
      by: h.changed_by ? metaName(userMeta, h.changed_by, '') : '',
      at: fmtRome(h.recorded_at),
    };
    // A row that names no changed field, no reason and no operator says
    // nothing — legacy history written before app.change_reason was set on
    // every path. Printing it as a blank line in a document that may be read
    // in a dispute is worse than omitting it.
    if (ev.changes.length === 0 && !ev.justification && !h.changed_by) continue;
    // One row per changed field so the sheet can be filtered on "Campo =
    // Data e ora" — the only change a payroll dispute usually turns on.
    if (ev.changes.length === 0) {
      rt.addRow(base);
      continue;
    }
    for (const ch of ev.changes) {
      rt.addRow({
        ...base,
        field: RETTIFICA_FIELD_LABEL[ch.field] ?? ch.field,
        before: fmtRettificaValue(ch.field, ch.before, branchMeta),
        after: fmtRettificaValue(ch.field, ch.after, branchMeta),
      });
    }
  }
  styleHeader(rt);

  /* 4. Correzioni — correction requests touching this period. */
  const co = wb.addWorksheet('Correzioni');
  co.columns = [
    { header: 'Dipendente', key: 'name', width: 24 },
    { header: 'Evento richiesto', key: 'event', width: 16 },
    { header: 'Data/ora richiesta', key: 'when', width: 18 },
    { header: 'Sede', key: 'branch', width: 20 },
    { header: 'Giustificazione', key: 'just', width: 36 },
    { header: 'Stato', key: 'status', width: 14 },
    { header: 'Risolta da', key: 'by', width: 24 },
    { header: 'Risolta il', key: 'at', width: 18 },
    { header: 'Nota risoluzione', key: 'note', width: 30 },
    { header: 'Inviata il', key: 'created', width: 18 },
  ];
  for (const c of corrections) {
    co.addRow({
      name: metaName(userMeta, c.user_id),
      event: EVENT_LABEL[c.claimed_event_type] ?? c.claimed_event_type,
      when: fmtRome(c.claimed_occurred_at),
      branch: c.claimed_branch_id ? branchMeta.get(c.claimed_branch_id) ?? '' : '',
      just: c.justification,
      status: CORRECTION_STATUS_LABEL[c.status] ?? c.status,
      by: c.resolved_by ? metaName(userMeta, c.resolved_by, c.resolved_by) : '',
      at: fmtRome(c.resolved_at),
      note: c.resolution_note ?? '',
      created: fmtRome(c.created_at),
    });
  }
  styleHeader(co);

  /* 5. Ferie e Permessi — individual leave events (ferie/permessi/malattia/assenza). */
  const fp = wb.addWorksheet('Ferie e Permessi');
  fp.columns = [
    { header: 'Dipendente', key: 'name', width: 24 },
    { header: 'Tipo', key: 'type', width: 14 },
    { header: 'Stato', key: 'status', width: 18 },
    { header: 'Dal', key: 'from', width: 18 },
    { header: 'Al', key: 'to', width: 18 },
    { header: 'Ore', key: 'hours', width: 10 },
    { header: 'Retribuito', key: 'paid', width: 12 },
    { header: 'Sottotipo assenza', key: 'subtype', width: 18 },
    { header: 'Protocollo INPS', key: 'inps', width: 18 },
    { header: 'Nota dipendente', key: 'note', width: 30 },
    { header: 'Origine', key: 'origin', width: 22 },
    { header: 'Deciso da', key: 'by', width: 24 },
    { header: 'Deciso il', key: 'at', width: 18 },
    { header: 'Motivo rifiuto', key: 'reject', width: 28 },
  ];
  for (const l of leaves) {
    fp.addRow({
      name: metaName(userMeta, l.user_id),
      type: LEAVE_TYPE_LABEL[l.type] ?? l.type,
      status: LEAVE_STATUS_LABEL[l.status] ?? l.status,
      from: fmtRome(l.from_ts),
      to: fmtRome(l.to_ts),
      hours: Number(l.duration_hours),
      paid: l.type === 'assenza' ? boolLabel(l.is_paid) : '',
      subtype: l.assenza_subtype ?? '',
      inps: l.inps_protocol ?? '',
      note: l.user_note ?? '',
      origin: l.created_by_admin ? 'Inserito da admin' : 'Richiesta dipendente',
      by: l.decided_by ? metaName(userMeta, l.decided_by, l.decided_by) : '',
      at: fmtRome(l.decided_at),
      reject: l.rejection_reason ?? '',
    });
  }
  setHourFormat(fp, ['hours']);
  styleHeader(fp);

  /* 5b. Giustifiche anomalie — note-only resolutions of schedule anomalies. */
  const gj = wb.addWorksheet('Giustifiche anomalie');
  gj.columns = [
    { header: 'Dipendente', key: 'name', width: 24 },
    { header: 'Data', key: 'date', width: 14 },
    { header: 'Tipo anomalia', key: 'kind', width: 28 },
    { header: 'Nota', key: 'note', width: 40 },
    { header: 'Inserita da', key: 'by', width: 24 },
    { header: 'Inserita il', key: 'at', width: 18 },
  ];
  for (const j of justifications) {
    gj.addRow({
      name: metaName(userMeta, j.user_id),
      date: fmtIsoDate(j.anomaly_date),
      kind: ANOMALY_KIND_LABEL[j.anomaly_kind] ?? j.anomaly_kind,
      note: j.note,
      by: j.created_by ? metaName(userMeta, j.created_by, j.created_by) : '',
      at: fmtRome(j.created_at),
    });
  }
  styleHeader(gj);

  /* 6. Eventi aziendali — admin-pushed batches / company closures. */
  const ev = wb.addWorksheet('Eventi aziendali');
  ev.columns = [
    { header: 'Titolo', key: 'title', width: 32 },
    { header: 'Tipo', key: 'type', width: 18 },
    { header: 'Dal', key: 'from', width: 18 },
    { header: 'Al', key: 'to', width: 18 },
    { header: 'Dipendenti coinvolti', key: 'users', width: 20 },
    { header: 'Ore totali', key: 'hours', width: 12 },
  ];
  for (const e of eventi) {
    ev.addRow({
      title: e.title ?? '(senza titolo)',
      type: LEAVE_TYPE_LABEL[e.type] ?? e.type,
      from: fmtRome(e.from_ts),
      to: fmtRome(e.to_ts),
      users: Number(e.users_count),
      hours: Number(e.total_hours),
    });
  }
  setHourFormat(ev, ['hours']);
  styleHeader(ev);

  /* 7. Ferie residue — quota balance per employee/type (point-in-time). */
  const rs = wb.addWorksheet('Ferie residue');
  rs.columns = [
    { header: 'Dipendente', key: 'name', width: 26 },
    { header: 'Tipo', key: 'type', width: 14 },
    { header: 'Saldo iniziale (h)', key: 'initial', width: 18 },
    { header: 'Maturato (h)', key: 'accrued', width: 14 },
    { header: 'Usato approvato (h)', key: 'used', width: 20 },
    { header: 'Residuo (h)', key: 'residual', width: 14 },
  ];
  const residueIds = [...residueByUser.keys()].sort((a, b) =>
    metaName(userMeta, a).localeCompare(metaName(userMeta, b))
  );
  for (const uid of residueIds) {
    for (const r of residueByUser.get(uid)!) {
      rs.addRow({
        name: metaName(userMeta, uid),
        type: LEAVE_TYPE_LABEL[r.type] ?? r.type,
        initial: r.initial,
        accrued: r.accrued,
        used: r.used,
        residual: r.residual,
      });
    }
  }
  setHourFormat(rs, ['initial', 'accrued', 'used', 'residual']);
  styleHeader(rs);

  /* 8. Metadati — provenance, counts and the column dictionary.
   *
   * Added LAST on purpose: the dictionary is derived from the worksheets that
   * already exist on the workbook, so a column added anywhere shows up here
   * automatically (with an explicit "(descrizione mancante)" if nobody wrote
   * one) instead of the documentation quietly going stale. */
  const meta = wb.addWorksheet('Metadati');
  // Four columns, not three: the provenance rows carry a VALUE (a period, a
  // count) while the dictionary rows carry a DESCRIPTION. Folding both into one
  // "Descrizione" column put counts under a heading that promised an
  // explanation, and forced a filler label in the first column on every row.
  meta.columns = [
    { header: 'Sezione', key: 'sheet', width: 22 },
    { header: 'Voce', key: 'k', width: 30 },
    { header: 'Valore', key: 'val', width: 34 },
    { header: 'Descrizione', key: 'v', width: 92 },
  ];

  // Section header, then rows with a blank first cell — same shape the
  // dictionary below uses, so the sheet reads consistently top to bottom.
  const sectionRows: number[] = [];
  sectionRows.push(
    meta.addRow({ sheet: 'INFORMAZIONI FILE', v: 'Provenienza del file e conteggi del periodo.' })
      .number
  );
  const info = (k: string, val: string | number, v: string): void => {
    meta.addRow({ k, val, v });
  };
  info('tenant_id', job.tenant_id, 'Identificativo interno dell’azienda in sonoQui.');
  info('period_from', String(job.period_from), 'Primo giorno del periodo esportato (incluso).');
  info('period_to', String(job.period_to), 'Ultimo giorno del periodo esportato (incluso).');
  info(
    'generated_at',
    new Date().toISOString(),
    'Data e ora di generazione del file, in UTC (formato ISO 8601).'
  );
  // v3: Timbrature keeps soft-deleted punches (flagged) and carries the
  // original-value columns; Rettifiche and the column dictionary are new.
  // v4: the per-employee sheets are gone, folded into a single "Dettaglio
  // giornaliero" table keyed by Nome / Cognome / Codice fiscale.
  info(
    'schema_version',
    'v4',
    'Versione del tracciato di questo file. Cambia quando vengono aggiunti o rinominati fogli e colonne.'
  );
  info('Dipendenti', data.length, 'Dipendenti inclusi nell’esportazione.');
  info(
    'Timbrature',
    stamps.length,
    'Timbrature del periodo elencate nel foglio Timbrature, comprese quelle eliminate.'
  );
  info(
    'di cui eliminate',
    stamps.filter((s) => s.deleted_at !== null).length,
    'Timbrature eliminate da un amministratore: restano elencate ma non contano nelle ore lavorate.'
  );
  info(
    'di cui modificate',
    stamps.filter((s) => s.original_occurred_at !== null || s.original_event_type !== null).length,
    'Timbrature il cui orario o tipo evento è stato cambiato dopo la registrazione.'
  );
  info(
    'Rettifiche',
    rettifiche.length,
    'Interventi registrati nel foglio Rettifiche (modifiche ed eliminazioni, una riga per campo toccato).'
  );
  info('Correzioni', corrections.length, 'Richieste di correzione inviate dai dipendenti.');
  info(
    'Ferie / permessi / assenze',
    leaves.length,
    'Voci di ferie, permesso, malattia e assenza ricadenti nel periodo.'
  );
  info('Eventi aziendali', eventi.length, 'Chiusure ed eventi imposti dall’azienda.');

  meta.addRow({});
  sectionRows.push(
    meta.addRow({
      sheet: 'DIZIONARIO COLONNE',
      v: 'Significato di ogni colonna, foglio per foglio.',
    }).number
  );
  for (const ws of wb.worksheets) {
    if (ws.name === 'Metadati') continue;
    const descrs = COLUMN_DESCRIPTIONS[ws.name];
    meta.addRow({ sheet: ws.name, k: '', v: SHEET_DESCRIPTIONS[ws.name] ?? '' });
    for (const col of ws.columns ?? []) {
      const header = typeof col.header === 'string' ? col.header : '';
      if (!header) continue;
      meta.addRow({ sheet: '', k: header, v: descrs?.[header] ?? '(descrizione mancante)' });
    }
  }
  styleHeader(meta);
  for (const n of sectionRows) meta.getRow(n).font = { bold: true };
  meta.getColumn('v').alignment = { wrapText: true, vertical: 'top' };

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const key = `tenants/${job.tenant_id}/exports/${job.id}.xlsx`;
  await persist(key, Buffer.from(buf));
  return { storageKey: key, signedUrlExpiresAt: new Date(Date.now() + 15 * 60_000) };
}

/* ───────────────────── Centro Paghe (ORARIO / TRORAPRO) ───────────────────── */

interface CentroPagheTenantConfig {
  codiceDitta: string;
  codeLen: 2 | 4;
  donazioneCf: string;
  map: Record<string, string>;
}

async function loadCentroPagheTenantConfig(job: ExportJobRow): Promise<CentroPagheTenantConfig> {
  const r = await adminPool.query(
    `SELECT codice_ditta, cp_code_len, cp_donazione_cf, cp_giustificativo_map
       FROM tenants WHERE id = $1`,
    [job.tenant_id]
  );
  const row = r.rows[0] ?? {};
  return {
    codiceDitta: row.codice_ditta ?? '',
    codeLen: row.cp_code_len === 2 ? 2 : 4,
    donazioneCf: row.cp_donazione_cf ?? '',
    map: effectiveCentroPagheMap(row.cp_giustificativo_map ?? {}),
  };
}

interface Anagrafica {
  active: boolean;
  /** memberships.deleted_at — set by DELETE /users/:id, null otherwise. The only
   *  timestamped "this person is gone" signal the schema has; see
   *  contractedDaysUntil(). */
  deletedAt: Date | null;
  inail: string | null;
  qualifica: string | null;
  qualifica2: string | null;
  matricola: string | null;
  codiceFiscale: string | null;
}

async function loadAnagrafica(job: ExportJobRow): Promise<Map<string, Anagrafica>> {
  // EVERY membership row of the tenant, removed ones included — the employment
  // status is what both writers bound their contracted days with, and a removed
  // member still reaches the aggregate through their own stamps, so leaving
  // them out of this map means answering "still employed?" with a shrug.
  //
  // `deleted_at IS NULL` used to be in the WHERE, which is how the two writers
  // came to disagree about a removed member: the xlsx kept them (their stamps
  // carried them in) while the LUL, reading only this map, could not see them at
  // all. Both call sites now run the same exportsEmployee() gate over the full
  // list. The removed rows join the `ORDER BY matricola NULLS LAST` insertion
  // order the LUL employee sequence relies on, which is intended — they are
  // employees of that month like any other.
  const r = await adminPool.query(
    `SELECT user_id, active, deleted_at, inail, qualifica, qualifica2, matricola, codice_fiscale
       FROM memberships
      WHERE tenant_id = $1
      ORDER BY matricola NULLS LAST`,
    [job.tenant_id]
  );
  const map = new Map<string, Anagrafica>();
  for (const row of r.rows) {
    map.set(row.user_id, {
      active: row.active,
      deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
      inail: row.inail,
      qualifica: row.qualifica,
      qualifica2: row.qualifica2,
      matricola: row.matricola,
      codiceFiscale: row.codice_fiscale,
    });
  }
  return map;
}

interface DetailedLeave {
  type: string;
  subtype: string | null;
  minutes: number;
}

/** Per user → per day → list of (type, subtype, minutes). Unlike loadLeavesPerDay
 *  (which buckets into ferie/permessi/malattia for the xlsx), this keeps the full
 *  type + assenza subtype so each maps to its own giustificativo code.
 *
 *  Same rows, same day shares as the xlsx projection — see leaveDayShares(). The
 *  two used to distribute duration_hours with two hand-copied blocks of the same
 *  arithmetic, so the boundary-straddling defect double-billed the giustificativi
 *  in the LUL exactly as it double-billed "Ore chiusura aziendale" in the xlsx. */
async function loadLeavesPerDayDetailed(
  job: ExportJobRow,
  timeZone: string
): Promise<Map<string, Map<string, DetailedLeave[]>>> {
  const rows = await loadLeaveRows(job, timeZone);
  const result = new Map<string, Map<string, DetailedLeave[]>>();
  for (const row of rows) {
    const shares = leaveDayShares(row, timeZone, job.period_from, job.period_to);
    if (shares.length === 0) continue;
    const userMap = result.get(row.userId) ?? new Map<string, DetailedLeave[]>();
    for (const s of shares) {
      const list = userMap.get(s.day) ?? [];
      list.push({ type: row.type, subtype: row.subtype, minutes: s.minutes });
      userMap.set(s.day, list);
    }
    result.set(row.userId, userMap);
  }
  return result;
}

/** Malattia events with an INPS protocol → record type 3. */
async function loadInpsEvents(
  job: ExportJobRow,
  timeZone: string
): Promise<Map<string, CentroPagheInpsEvent[]>> {
  const { start: periodFrom, end: periodEnd } = periodWindow(job, timeZone);
  const r = await adminPool.query(
    `SELECT user_id, from_ts, to_ts, inps_protocol
       FROM leave_requests
      WHERE tenant_id = $1
        AND type = 'malattia'
        AND status IN ('approved','cancellation_pending')
        AND inps_protocol IS NOT NULL AND length(inps_protocol) > 0
        AND to_ts   >  $2::timestamptz
        AND from_ts <  $3::timestamptz
      ORDER BY user_id, from_ts`,
    [job.tenant_id, periodFrom.toISOString(), periodEnd.toISOString()]
  );
  const map = new Map<string, CentroPagheInpsEvent[]>();
  for (const row of r.rows) {
    const list = map.get(row.user_id) ?? [];
    list.push({
      tipo: 'PR',
      code: String(row.inps_protocol),
      start: zonedDateKey(new Date(row.from_ts), timeZone),
      end: zonedDateKey(new Date(row.to_ts), timeZone),
    });
    map.set(row.user_id, list);
  }
  return map;
}

/** Rome-local HH:MM for a stamp instant. */
function hhmmRome(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: ROME_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** Inclusive YYYY-MM-DD list from period_from..period_to. */
function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (cur.getTime() <= end.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Pair a day's raw stamps into presence intervals (≤4 in/out pairs). A
 *  break/lunch shows as out (start) then in (end). */
function pairPunches(stamps: Array<{ event: string; at: Date }>): CentroPaghePunch[] {
  const pairs: CentroPaghePunch[] = [];
  let openIn: string | null = null;
  for (const s of stamps) {
    const e = s.event;
    if (e === 'clock_in' || e === 'break_end' || e === 'lunch_end') {
      if (openIn === null) openIn = hhmmRome(s.at);
    } else if (e === 'clock_out' || e === 'break_start' || e === 'lunch_start') {
      if (openIn !== null) {
        pairs.push({ in: openIn, out: hhmmRome(s.at) });
        openIn = null;
      }
    }
  }
  if (openIn !== null) pairs.push({ in: openIn, out: null });
  return pairs.slice(0, 4);
}

async function writeCentroPaghe(job: ExportJobRow, data: UserAgg[]): Promise<ExportResult> {
  const cfg = await loadCentroPagheTenantConfig(job);
  if (!cfg.codiceDitta || cfg.codiceDitta.trim().length === 0) {
    throw new Error(
      'Codice ditta mancante: impostalo in Impostazioni → Centro Paghe prima di esportare.'
    );
  }

  const timeZone = await loadTenantTimeZone(job.tenant_id);

  const [anagrafica, shiftByUser, leavesDetailed, inpsByUser, stampsDetail] = await Promise.all([
    loadAnagrafica(job),
    loadShiftAssignments(job),
    loadLeavesPerDayDetailed(job, timeZone),
    loadInpsEvents(job, timeZone),
    // Payroll: live punches ONLY. These become the LUL in/out pairs.
    loadStampsDetail(job, timeZone, { includeDeleted: false }),
  ]);

  // Per-user DayAgg lookup (worked + overtime, already deducted/rounded).
  const aggByUser = new Map<string, Map<string, DayAgg>>();
  for (const u of data) {
    const m = new Map<string, DayAgg>();
    for (const d of u.days) m.set(d.day, d);
    aggByUser.set(u.user_id, m);
  }

  // Per-user raw stamps grouped by tenant-local day (matches DayAgg day keys).
  const stampsByUserDay = new Map<string, Map<string, Array<{ event: string; at: Date }>>>();
  for (const s of stampsDetail) {
    const at = new Date(s.occurred_at);
    const dayKey = zonedDateKey(at, timeZone);
    const byDay = stampsByUserDay.get(s.user_id) ?? new Map();
    const list = byDay.get(dayKey) ?? [];
    list.push({ event: s.event_type, at });
    byDay.set(dayKey, list);
    stampsByUserDay.set(s.user_id, byDay);
  }

  const periodoAAAAMM = job.period_from.slice(0, 4) + job.period_from.slice(5, 7);
  const allDates = eachDateInclusive(job.period_from, job.period_to);
  // Tenant-local today, read once for the whole file — see contractedDaysUntil().
  const todayKey = zonedDateKey(new Date(), timeZone);

  // Employee set = exportsEmployee() over the membership list (each survivor
  // gets a full month of type-1 rows).
  const employees: CentroPagheEmployee[] = [];
  for (const [userId, ana] of anagrafica) {
    // A member removed with DELETE /users/:id is NOT skipped, and that is a
    // change: this file used to drop them while the xlsx kept them (their own
    // stamps put them in byUser), so the two files of one month disagreed about
    // who worked here and only one of them said so out loud.
    //
    // The LUL is the register of hours actually worked. Removing somebody from
    // the app is a membership action — a soft delete that leaves their stamps,
    // their approved leave and their anagrafica exactly where they were — not an
    // erasure request, and it usually happens the week AFTER the month they
    // worked. Dropping them here meant the hours of a period already worked
    // never reached the payroll bureau at all: unpaid wages, produced by an
    // admin clicking "Elimina" a few days too early. No privacy is bought by it
    // either — the employer already holds those hours in this very database, and
    // the payroll system it is sending them to holds the person's contract.
    //
    // So removal now decides only WHEN the contract stops (contractedDaysUntil
    // reads deleted_at as the one dated departure the schema has), never whether
    // the hours are reported. exportsEmployee() is the sole gate, on both sides.
    const agg = aggByUser.get(userId);
    const userStamps = stampsByUserDay.get(userId);
    const userLeaves = leavesDetailed.get(userId);
    const shiftAssigns = shiftByUser.get(userId);

    // Skip long-gone employees: an inactive member with no activity this period.
    // exportsEmployee() is the same predicate aggregateForExport() applies to
    // this same map, with removal no longer overriding it on one side only, so
    // the two files of one month now cover the same people. The one residual
    // asymmetry is structural and cannot be closed from here: the xlsx reads
    // approved leave straight out of leave_requests, so a user with leave but NO
    // membership row at all still gets an xlsx line, while the LUL cannot emit a
    // record for somebody who has neither matricola nor codice fiscale.
    const hadActivity = Boolean(agg) || Boolean(userStamps) || Boolean(userLeaves);
    if (!exportsEmployee(ana.active, hadActivity)) continue;

    // Same contracted-day ceiling the xlsx aggregate applies, from the same
    // membership row — otherwise the fix for the leaver would land in one file
    // and not the other, and the two would disagree about the month all over
    // again. Built from stamps ∪ approved leave only: `agg` also contains the
    // days the xlsx seeded, and feeding those back in would let the bound
    // authorise itself.
    const activityDays = [...(userStamps?.keys() ?? []), ...(userLeaves?.keys() ?? [])];
    const contractedUntil = contractedDaysUntil(job.period_to, todayKey, {
      active: ana.active,
      deletedDay: ana.deletedAt ? zonedDateKey(ana.deletedAt, timeZone) : null,
      lastActivityDay: activityDays.length > 0 ? activityDays.sort().at(-1)! : null,
    });

    const days: CentroPagheDay[] = allDates.map((date): CentroPagheDay => {
      const day = agg?.get(date);
      const worked = day?.worked_minutes ?? 0;
      const overtime = day?.overtime_minutes ?? 0;
      const oreLavorate = Math.max(0, worked - overtime);

      // Theoretical + tipo-giorno from the shift calendar.
      //
      // Same formula as DayAgg.ordinary_minutes (Σ fasce − auto-lunch) but
      // deliberately NOT read from it: the LUL emits a type-1 record for every
      // date of the month, while the aggregate only holds days with a stamp or
      // an approved leave — reusing it would silently write 0 theoretical
      // minutes on every untimbrated working day of the payroll file.
      //
      // Left null past contractedUntil — the same three fields a date with no
      // assignment already leaves empty (00000 theoretical, 00000 contract,
      // blank tipo giorno), so the record layout and the record COUNT are
      // untouched. That matters because nothing closes a shift assignment when
      // an employee leaves: for a full-timer removed on 15 September the LUL
      // used to carry 8h of contract and 'GL' on all eleven remaining working
      // days, i.e. a full month of salary owed to somebody who had gone. The
      // punches and the giustificativi of those dates are not gated — an
      // approved leave stays an approved leave — only the contract is.
      let theoreticalMin: number | null = null;
      let contractMin: number | null = null;
      let tipoGiorno: 'GL' | 'SA' | 'DO' | '' = '';
      // Resolved per date: a mid-month shift change must not backdate the new
      // contract over the first half of the LUL either.
      const shift = contractsDay(contractedUntil, date)
        ? configForDay(shiftAssigns, date)
        : undefined;
      if (shift) {
        const dow = isoDowUtc(date);
        const slots = shift.slotsByDow.get(dow) ?? [];
        const dur = slots.reduce(
          (acc, sl) => acc + diffMin(combineDateTime(date, sl.start), combineDateTime(date, sl.end)),
          0
        );
        const autoLunch = shift.lunchByDow.get(dow) ?? 0;
        theoreticalMin = Math.max(0, dur - autoLunch);
        contractMin = theoreticalMin;
        tipoGiorno = dow === 7 ? 'DO' : dow === 6 ? 'SA' : dur > 0 ? 'GL' : 'DO';
      }

      // Giustificativi: leaves (mapped) + straordinario (overtime).
      const giuByInp = new Map<string, number>();
      for (const lv of userLeaves?.get(date) ?? []) {
        const inp = cfg.map[centroPagheKeyForLeave(lv.type, lv.subtype)];
        if (!inp) continue; // unmapped (e.g. chiusura with no code) → skip
        giuByInp.set(inp, (giuByInp.get(inp) ?? 0) + lv.minutes);
      }
      if (overtime > 0) {
        const inp = cfg.map['straordinario'];
        if (inp) giuByInp.set(inp, (giuByInp.get(inp) ?? 0) + overtime);
      }
      const giustificativi = [...giuByInp.entries()]
        .map(([inp, minutes]) => ({ inp, minutes }))
        .filter((g) => g.minutes > 0)
        .slice(0, 6);

      return {
        date,
        punches: userStamps ? pairPunches(userStamps.get(date) ?? []) : [],
        workedMin: oreLavorate,
        theoreticalMin,
        contractMin,
        tipoGiorno,
        giustificativi,
      };
    });

    employees.push({
      inail: ana.inail,
      qualifica: ana.qualifica,
      qualifica2: ana.qualifica2,
      matricola: ana.matricola,
      codiceFiscale: ana.codiceFiscale,
      days,
      inpsEvents: inpsByUser.get(userId) ?? [],
    });
  }

  const body = buildCentroPagheFile({
    codiceDitta: cfg.codiceDitta,
    periodoAAAAMM,
    codeLen: cfg.codeLen,
    donazioneCf: cfg.donazioneCf,
    employees,
  });
  const key = `tenants/${job.tenant_id}/exports/${job.id}.txt`;
  await persist(key, body);
  return { storageKey: key, signedUrlExpiresAt: new Date(Date.now() + 15 * 60_000) };
}

async function persist(key: string, body: Buffer): Promise<void> {
  if (env.STORAGE_DRIVER === 'disk') {
    const full = join(env.STORAGE_DISK_PATH, key);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, body);
    return;
  }
  await putObject(key, body, 'text/plain; charset=ISO-8859-1');
}

export async function readExportFile(storageKey: string): Promise<Buffer> {
  if (env.STORAGE_DRIVER === 'disk') {
    const fs = await import('node:fs/promises');
    return await fs.readFile(join(env.STORAGE_DISK_PATH, storageKey));
  }
  return await getObject(storageKey);
}

export async function deleteExportFile(storageKey: string): Promise<void> {
  if (env.STORAGE_DRIVER === 'disk') {
    const fs = await import('node:fs/promises');
    await fs.rm(join(env.STORAGE_DISK_PATH, storageKey), { force: true });
    return;
  }
  await deleteObject(storageKey);
}
