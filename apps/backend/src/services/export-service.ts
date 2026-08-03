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
  overtime_minutes: number;
  ferie_minutes: number;
  permessi_minutes: number;
  malattia_minutes: number;
  /** Marker: 'F' full-day ferie, 'P' partial permesso, 'M' malattia. Null otherwise. */
  leave_marker: 'F' | 'P' | 'M' | null;
}

interface UserAgg {
  user_id: string;
  email: string;
  days: DayAgg[];
  worked_minutes_total: number;
  paid_break_minutes_total: number;
  unpaid_break_minutes_total: number;
  overtime_minutes_total: number;
  worked_days: number;
  ferie_minutes_total: number;
  permessi_minutes_total: number;
  malattia_minutes_total: number;
}

interface ShiftConfig {
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

  const shiftByUser = await loadShiftConfigs(job);
  const leavesByUserDay = await loadLeavesPerDay(job, timeZone);
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
  // Ensure users that only have leave (no stamps) still appear in the export.
  for (const userId of leavesByUserDay.keys()) {
    if (!byUser.has(userId)) {
      const meta = await adminPool.query(
        // $1::uuid pins the param type. The old `COALESCE(au.email, $1::text)`
        // forced $1 to text, so `au.id = $1` became uuid=text and threw
        // "operator does not exist: uuid = text" for any user with approved
        // leave but no stamps in the period. The `?? userId` below is the
        // email fallback the COALESCE used to provide.
        `SELECT email FROM auth_users WHERE id = $1::uuid`,
        [userId]
      );
      byUser.set(userId, { email: meta.rows[0]?.email ?? userId, stamps: [] });
    }
  }

  const out: UserAgg[] = [];
  for (const [userId, u] of byUser) {
    const cfg = shiftByUser.get(userId);
    const days = new Map<string, DayAgg & { firstIn: Date | null; lastOut: Date | null }>();
    let openClockIn: Date | null = null;
    let openBreak: Date | null = null;
    let openLunch: Date | null = null;

    for (const s of u.stamps) {
      const dayKey = zonedDateKey(s.at, timeZone);
      const day =
        days.get(dayKey) ?? {
          day: dayKey,
          worked_minutes: 0,
          paid_break_minutes: 0,
          unpaid_break_minutes: 0,
          overtime_minutes: 0,
          ferie_minutes: 0,
          permessi_minutes: 0,
          malattia_minutes: 0,
          leave_marker: null,
          firstIn: null,
          lastOut: null,
        };

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
        const day =
          days.get(dayKey) ?? {
            day: dayKey,
            worked_minutes: 0,
            paid_break_minutes: 0,
            unpaid_break_minutes: 0,
            overtime_minutes: 0,
            ferie_minutes: 0,
            permessi_minutes: 0,
            malattia_minutes: 0,
            leave_marker: null,
            firstIn: null,
            lastOut: null,
          };
        day.ferie_minutes = (day.ferie_minutes ?? 0) + leave.ferie;
        day.permessi_minutes = (day.permessi_minutes ?? 0) + leave.permessi;
        day.malattia_minutes = (day.malattia_minutes ?? 0) + leave.malattia;
        days.set(dayKey, day);
      }
    }

    // Apply shift-driven breach deductions + overtime calc per day.
    for (const day of days.values()) {
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
        const ferie = d.ferie_minutes ?? 0;
        const permessi = d.permessi_minutes ?? 0;
        const malattia = d.malattia_minutes ?? 0;
        let marker: 'F' | 'P' | 'M' | null = null;
        if (malattia > 0) marker = 'M';
        else if (ferie > 0 && d.worked_minutes === 0) marker = 'F';
        else if (permessi > 0) marker = 'P';
        return {
          day: d.day,
          worked_minutes: d.worked_minutes,
          paid_break_minutes: d.paid_break_minutes,
          unpaid_break_minutes: d.unpaid_break_minutes,
          overtime_minutes: d.overtime_minutes,
          ferie_minutes: ferie,
          permessi_minutes: permessi,
          malattia_minutes: malattia,
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
      overtime_minutes_total: sum(dayList.map((d) => d.overtime_minutes)),
      ferie_minutes_total: sum(dayList.map((d) => d.ferie_minutes)),
      permessi_minutes_total: sum(dayList.map((d) => d.permessi_minutes)),
      malattia_minutes_total: sum(dayList.map((d) => d.malattia_minutes)),
      worked_days: dayList.filter((d) => d.worked_minutes > 0).length,
    });
  }
  return out;
}

interface DayLeaveBucket {
  ferie: number;
  permessi: number;
  malattia: number;
}

async function loadLeavesPerDay(
  job: ExportJobRow,
  timeZone: string
): Promise<Map<string, Map<string, DayLeaveBucket>>> {
  const { start: periodFrom, end: periodEnd } = periodWindow(job, timeZone);
  // approved + cancellation_pending count as "user is out" for export purposes.
  const r = await adminPool.query(
    `SELECT lr.user_id, lr.type, lr.from_ts, lr.to_ts, lr.duration_hours
       FROM leave_requests lr
      WHERE lr.tenant_id = $1
        AND lr.status IN ('approved','cancellation_pending')
        AND lr.to_ts   >  $2::timestamptz
        AND lr.from_ts <  $3::timestamptz`,
    [job.tenant_id, periodFrom.toISOString(), periodEnd.toISOString()]
  );
  const result = new Map<string, Map<string, DayLeaveBucket>>();
  if (r.rowCount === 0) return result;

  // Last instant still inside the period, for clipping a leave that overruns it.
  const periodTo = new Date(periodEnd.getTime() - 1);

  for (const row of r.rows) {
    const from = new Date(row.from_ts);
    const to = new Date(row.to_ts);
    const userMap = result.get(row.user_id) ?? new Map<string, DayLeaveBucket>();

    const clipFrom = from < periodFrom ? periodFrom : from;
    const clipTo = to > periodTo ? periodTo : to;

    if (row.type === 'permessi') {
      // single-day, distribute minutes precisely
      const dayKey = zonedDateKey(clipFrom, timeZone);
      const minutes = Math.max(0, Math.round((clipTo.getTime() - clipFrom.getTime()) / 60000));
      const bucket = userMap.get(dayKey) ?? { ferie: 0, permessi: 0, malattia: 0 };
      bucket.permessi += minutes;
      userMap.set(dayKey, bucket);
    } else {
      // ferie / malattia: span multiple days. Distribute duration_hours evenly
      // across the inclusive day count — close enough for payroll display.
      const days = eachZonedDateKeyInclusive(clipFrom, clipTo, timeZone);
      if (days.length === 0) continue;
      const perDayMin = Math.round((Number(row.duration_hours) * 60) / days.length);
      for (const d of days) {
        const bucket = userMap.get(d) ?? { ferie: 0, permessi: 0, malattia: 0 };
        if (row.type === 'ferie') bucket.ferie += perDayMin;
        else bucket.malattia += perDayMin;
        userMap.set(d, bucket);
      }
    }
    result.set(row.user_id, userMap);
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

async function loadShiftConfigs(job: ExportJobRow): Promise<Map<string, ShiftConfig>> {
  // Latest active assignment overlapping the export period — one row per user.
  const assigns = await adminPool.query(
    `SELECT DISTINCT ON (a.user_id)
            a.user_id, a.shift_template_id,
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
      ORDER BY a.user_id, a.valid_from DESC`,
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

  const out = new Map<string, ShiftConfig>();
  for (const r of assigns.rows) {
    out.set(r.user_id, {
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
    });
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
  '<dipendente>':
    'Un foglio per dipendente con il dettaglio giorno per giorno. Il nome del foglio è il nome del dipendente.',
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
const ORE_ORIGINALI_DESC =
  'Ore risultanti dalle timbrature PRIMA di ogni rettifica: orari e tipi evento originali (quelli con cui la timbratura è stata registrata la prima volta) e timbrature eliminate ancora incluse. Confrontala con "Ore lavorate": se coincidono la giornata non è stata rettificata, altrimenti la differenza è esattamente l\'effetto delle modifiche di orario e delle eliminazioni. Le timbrature inserite da un amministratore rientrano in entrambe le colonne, quindi non generano differenza: per sapere CHI ha registrato una timbratura usa la colonna Origine del foglio Timbrature.';

const COLUMN_DESCRIPTIONS: Record<string, Record<string, string>> = {
  Riepilogo: {
    Dipendente: 'Nome e cognome (o email se l’anagrafica non è compilata).',
    Email: 'Email dell’account del dipendente.',
    'Ore lavorate': ORE_LAVORATE_DESC,
    'Ore originali': ORE_ORIGINALI_DESC,
    'Ore straordinarie':
      'Quota di straordinario già compresa nelle ore lavorate: non va sommata, è un di cui.',
    'Pausa retribuita': 'Totale pause entro la soglia di retribuzione.',
    'Pausa non retribuita': 'Totale pause oltre la soglia, non retribuite.',
    'Ore ferie': 'Ore di ferie approvate ricadenti nel periodo.',
    'Ore permessi': 'Ore di permesso approvate ricadenti nel periodo.',
    'Ore malattia': 'Ore di malattia registrate nel periodo.',
    'Giorni lavorati': 'Numero di giornate con almeno una timbratura utile.',
    'Residuo ferie (h)': 'Saldo ferie residuo alla data di generazione del file.',
    'Residuo permessi (h)': 'Saldo permessi residuo alla data di generazione del file.',
  },
  '<dipendente>': {
    Giorno: 'Data della giornata (fuso orario aziendale).',
    Marker: 'F = ferie intera giornata, P = permesso parziale, M = malattia.',
    'Ore lavorate': ORE_LAVORATE_DESC,
    'Ore originali': ORE_ORIGINALI_DESC,
    'Ore straordinarie': 'Quota di straordinario compresa nelle ore lavorate del giorno.',
    'Ore ferie': 'Ore di ferie approvate nella giornata.',
    'Ore permessi': 'Ore di permesso approvate nella giornata.',
    'Ore malattia': 'Ore di malattia nella giornata.',
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
    Lat: 'Latitudine rilevata (vuota se la modalità non prevede GPS).',
    Lon: 'Longitudine rilevata.',
    'Accuratezza GPS (m)': 'Raggio di incertezza della posizione, in metri.',
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
}

async function loadUserMeta(job: ExportJobRow): Promise<Map<string, UserMeta>> {
  const r = await adminPool.query(
    `SELECT m.user_id,
            COALESCE(au.email, m.user_id::text) AS email,
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
  for (const row of r.rows) map.set(row.user_id, { name: row.name, email: row.email });
  return map;
}

function metaName(meta: Map<string, UserMeta>, userId: string, fallback?: string): string {
  return meta.get(userId)?.name ?? fallback ?? userId;
}
function metaEmail(meta: Map<string, UserMeta>, userId: string, fallback?: string): string {
  return meta.get(userId)?.email ?? fallback ?? userId;
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
  latitude: number | null;
  longitude: number | null;
  gps_accuracy_m: number | null;
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
            latitude, longitude, gps_accuracy_m,
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
            COUNT(*) AS users_count,
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
    { header: 'Ore straordinarie', key: 'overtime', width: 18 },
    { header: 'Pausa retribuita', key: 'paid', width: 18 },
    { header: 'Pausa non retribuita', key: 'unpaid', width: 22 },
    { header: 'Ore ferie', key: 'ferie', width: 12 },
    { header: 'Ore permessi', key: 'permessi', width: 14 },
    { header: 'Ore malattia', key: 'malattia', width: 14 },
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
      overtime: u.overtime_minutes_total / 60,
      paid: u.paid_break_minutes_total / 60,
      unpaid: u.unpaid_break_minutes_total / 60,
      ferie: u.ferie_minutes_total / 60,
      permessi: u.permessi_minutes_total / 60,
      malattia: u.malattia_minutes_total / 60,
      days: u.worked_days,
      res_ferie: residualOf(res, 'ferie'),
      res_permessi: residualOf(res, 'permessi'),
    });
  }
  setHourFormat(riep, [
    'worked', 'original', 'overtime', 'paid', 'unpaid', 'ferie', 'permessi', 'malattia',
    'res_ferie', 'res_permessi',
  ]);
  styleHeader(riep);

  /* 2. One sheet per employee — daily breakdown. */
  const RESERVED = [
    'riepilogo', 'timbrature', 'correzioni', 'ferie e permessi',
    'eventi aziendali', 'ferie residue', 'metadati',
  ];
  const usedNames = new Set<string>(RESERVED);
  // Tracked so the Metadati dictionary can document the per-employee shape once
  // instead of repeating identical columns for every member of the company.
  const employeeSheetNames: string[] = [];
  for (const u of data) {
    const label = metaName(userMeta, u.user_id, u.email);
    const base = (label.replace(/[\\/?*\[\]:]/g, '_').slice(0, 28) || 'Utente');
    let candidate = base;
    let i = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${base}_${i++}`.slice(0, 31);
    }
    usedNames.add(candidate.toLowerCase());
    employeeSheetNames.push(candidate);
    const ws = wb.addWorksheet(candidate);
    ws.columns = [
      { header: 'Giorno', key: 'day', width: 14 },
      { header: 'Marker', key: 'marker', width: 8 },
      { header: 'Ore lavorate', key: 'worked', width: 14 },
      { header: 'Ore originali', key: 'original', width: 14 },
      { header: 'Ore straordinarie', key: 'overtime', width: 18 },
      { header: 'Ore ferie', key: 'ferie', width: 12 },
      { header: 'Ore permessi', key: 'permessi', width: 14 },
      { header: 'Ore malattia', key: 'malattia', width: 14 },
      { header: 'Pausa retribuita (min)', key: 'paid', width: 22 },
      { header: 'Pausa non retribuita (min)', key: 'unpaid', width: 26 },
    ];
    const originalDays = originalByUserDay.get(u.user_id);
    for (const d of u.days) {
      ws.addRow({
        day: d.day,
        marker: d.leave_marker ?? '',
        worked: d.worked_minutes / 60,
        original: (originalDays?.get(d.day) ?? 0) / 60,
        overtime: d.overtime_minutes / 60,
        ferie: d.ferie_minutes / 60,
        permessi: d.permessi_minutes / 60,
        malattia: d.malattia_minutes / 60,
        paid: d.paid_break_minutes,
        unpaid: d.unpaid_break_minutes,
      });
    }
    setHourFormat(ws, ['worked', 'original', 'overtime', 'ferie', 'permessi', 'malattia']);
    styleHeader(ws);
  }

  /* 3. Timbrature — raw stamp detail (audit trail). */
  const tb = wb.addWorksheet('Timbrature');
  tb.columns = [
    { header: 'Dipendente', key: 'name', width: 24 },
    { header: 'Data e ora', key: 'when', width: 18 },
    { header: 'Evento', key: 'event', width: 14 },
    { header: 'Origine', key: 'source', width: 18 },
    { header: 'Sede', key: 'branch', width: 20 },
    { header: 'Lat', key: 'lat', width: 12 },
    { header: 'Lon', key: 'lon', width: 12 },
    { header: 'Accuratezza GPS (m)', key: 'acc', width: 18 },
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
      lat: s.latitude ?? '',
      lon: s.longitude ?? '',
      acc: s.gps_accuracy_m ?? '',
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
  info(
    'schema_version',
    'v3',
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
  const perEmployeeNames = new Set(employeeSheetNames);
  for (const ws of wb.worksheets) {
    if (ws.name === 'Metadati') continue;
    // Every per-employee sheet has identical columns; document the shape once
    // rather than repeating it for each member of the company.
    if (perEmployeeNames.has(ws.name) && ws.name !== employeeSheetNames[0]) continue;
    const sheetLabel = perEmployeeNames.has(ws.name) ? '<dipendente>' : ws.name;
    const descrs = COLUMN_DESCRIPTIONS[perEmployeeNames.has(ws.name) ? '<dipendente>' : ws.name];
    meta.addRow({ sheet: sheetLabel, k: '', v: SHEET_DESCRIPTIONS[sheetLabel] ?? '' });
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
  inail: string | null;
  qualifica: string | null;
  qualifica2: string | null;
  matricola: string | null;
  codiceFiscale: string | null;
}

async function loadAnagrafica(job: ExportJobRow): Promise<Map<string, Anagrafica>> {
  // All non-deleted members (incl. recently deactivated, so an employee who
  // worked part of the month still exports). The writer filters out inactive
  // members with no activity in the period.
  const r = await adminPool.query(
    `SELECT user_id, active, inail, qualifica, qualifica2, matricola, codice_fiscale
       FROM memberships
      WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY matricola NULLS LAST`,
    [job.tenant_id]
  );
  const map = new Map<string, Anagrafica>();
  for (const row of r.rows) {
    map.set(row.user_id, {
      active: row.active,
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
 *  type + assenza subtype so each maps to its own giustificativo code. */
async function loadLeavesPerDayDetailed(
  job: ExportJobRow,
  timeZone: string
): Promise<Map<string, Map<string, DetailedLeave[]>>> {
  const { start: periodFrom, end: periodEnd } = periodWindow(job, timeZone);
  const r = await adminPool.query(
    `SELECT lr.user_id, lr.type, lr.assenza_subtype, lr.from_ts, lr.to_ts, lr.duration_hours
       FROM leave_requests lr
      WHERE lr.tenant_id = $1
        AND lr.status IN ('approved','cancellation_pending')
        AND lr.to_ts   >  $2::timestamptz
        AND lr.from_ts <  $3::timestamptz`,
    [job.tenant_id, periodFrom.toISOString(), periodEnd.toISOString()]
  );
  const result = new Map<string, Map<string, DetailedLeave[]>>();
  if (r.rowCount === 0) return result;

  const periodTo = new Date(periodEnd.getTime() - 1);

  for (const row of r.rows) {
    const from = new Date(row.from_ts);
    const to = new Date(row.to_ts);
    const userMap = result.get(row.user_id) ?? new Map<string, DetailedLeave[]>();
    const clipFrom = from < periodFrom ? periodFrom : from;
    const clipTo = to > periodTo ? periodTo : to;

    const push = (dayKey: string, minutes: number) => {
      if (minutes <= 0) return;
      const list = userMap.get(dayKey) ?? [];
      list.push({ type: row.type, subtype: row.assenza_subtype ?? null, minutes });
      userMap.set(dayKey, list);
    };

    if (row.type === 'permessi') {
      push(
        zonedDateKey(clipFrom, timeZone),
        Math.max(0, Math.round((clipTo.getTime() - clipFrom.getTime()) / 60000))
      );
    } else {
      const days = eachZonedDateKeyInclusive(clipFrom, clipTo, timeZone);
      if (days.length > 0) {
        const perDayMin = Math.round((Number(row.duration_hours) * 60) / days.length);
        for (const d of days) push(d, perDayMin);
      }
    }
    result.set(row.user_id, userMap);
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
    loadShiftConfigs(job),
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

  // Employee set = every active member (each gets a full month of type-1 rows).
  const employees: CentroPagheEmployee[] = [];
  for (const [userId, ana] of anagrafica) {
    const agg = aggByUser.get(userId);
    const userStamps = stampsByUserDay.get(userId);
    const userLeaves = leavesDetailed.get(userId);
    const shift = shiftByUser.get(userId);

    // Skip long-gone employees: an inactive member with no activity this period.
    const hadActivity = Boolean(agg) || Boolean(userStamps) || Boolean(userLeaves);
    if (!ana.active && !hadActivity) continue;

    const days: CentroPagheDay[] = allDates.map((date): CentroPagheDay => {
      const day = agg?.get(date);
      const worked = day?.worked_minutes ?? 0;
      const overtime = day?.overtime_minutes ?? 0;
      const oreLavorate = Math.max(0, worked - overtime);

      // Theoretical + tipo-giorno from the shift calendar.
      let theoreticalMin: number | null = null;
      let contractMin: number | null = null;
      let tipoGiorno: 'GL' | 'SA' | 'DO' | '' = '';
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
