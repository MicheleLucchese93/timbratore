import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { env } from '../env.js';

export interface ExportJobRow {
  id: string;
  tenant_id: string;
  format: 'xlsx' | 'json';
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
  return await writeXlsx(job, data);
}

// Paid-break cutoff: breaks at/under this duration count as paid, above as unpaid.
const PAID_BREAK_THRESHOLD_MIN = 30;

async function aggregateForExport(job: ExportJobRow): Promise<UserAgg[]> {
  const rows = await adminPool.query(
    `SELECT s.user_id, s.event_type, s.occurred_at, s.deleted_at,
            COALESCE(au.email, s.user_id::text) AS email
     FROM stamps s
     LEFT JOIN auth_users au ON au.id = s.user_id
     WHERE s.tenant_id = $1
       AND s.occurred_at >= $2::date
       AND s.occurred_at < ($3::date + INTERVAL '1 day')
       AND s.deleted_at IS NULL
     ORDER BY s.user_id, s.occurred_at`,
    [job.tenant_id, job.period_from, job.period_to]
  );

  const shiftByUser = await loadShiftConfigs(job);
  const leavesByUserDay = await loadLeavesPerDay(job);
  // Raw approved-leave intervals (windowed), used to waive late-in / early-out
  // breach deductions when an approved ferie/permesso covers the stretch —
  // mirroring the presence-anomaly logic in routes/shifts.ts (leaveOverlapMin).
  const leaveIntervalsByUser = await loadLeaveIntervals(job);

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
        `SELECT COALESCE(au.email, $1::text) AS email FROM auth_users au WHERE au.id = $1`,
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
      const dayKey = s.at.toISOString().slice(0, 10);
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
      const expectedStart = combineDateTime(day.day, dowSlots[0]!.start);
      const expectedEnd = combineDateTime(day.day, dowSlots[dowSlots.length - 1]!.end);
      const expectedDurationMin = dowSlots.reduce(
        (acc, s) =>
          acc + diffMin(combineDateTime(day.day, s.start), combineDateTime(day.day, s.end)),
        0
      );
      const userLeaves = leaveIntervalsByUser.get(userId);

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
      // An approved permesso/ferie covering [expectedStart, actualIn] justifies
      // the lateness (same rule as the late_clock_in anomaly).
      if (day.firstIn) {
        const lateMin = diffMin(expectedStart, day.firstIn) - flexInAfterMin;
        const coveredMin = leaveOverlapMin(userLeaves, expectedStart.getTime(), day.firstIn.getTime());
        if (lateMin - coveredMin > cfg.tolerance_in_min) {
          day.worked_minutes = Math.max(0, day.worked_minutes - cfg.tolerance_in_breach_deduct_min);
        }
      }
      // early clock-out beyond tolerance (before the flexed exit anchor) → deduct.
      if (day.lastOut) {
        const earlyMin = diffMin(day.lastOut, expectedEnd) - flexOutBeforeMin;
        const coveredMin = leaveOverlapMin(userLeaves, day.lastOut.getTime(), expectedEnd.getTime());
        if (earlyMin - coveredMin > cfg.tolerance_out_min) {
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
    // Mirrors mobile counted-day.ts.
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
  job: ExportJobRow
): Promise<Map<string, Map<string, DayLeaveBucket>>> {
  // approved + cancellation_pending count as "user is out" for export purposes.
  const r = await adminPool.query(
    `SELECT lr.user_id, lr.type, lr.from_ts, lr.to_ts, lr.duration_hours
       FROM leave_requests lr
      WHERE lr.tenant_id = $1
        AND lr.status IN ('approved','cancellation_pending')
        AND lr.to_ts >  $2::date
        AND lr.from_ts < ($3::date + INTERVAL '1 day')`,
    [job.tenant_id, job.period_from, job.period_to]
  );
  const result = new Map<string, Map<string, DayLeaveBucket>>();
  if (r.rowCount === 0) return result;

  const periodFrom = new Date(job.period_from + 'T00:00:00Z');
  const periodTo = new Date(job.period_to + 'T23:59:59Z');

  for (const row of r.rows) {
    const from = new Date(row.from_ts);
    const to = new Date(row.to_ts);
    const userMap = result.get(row.user_id) ?? new Map<string, DayLeaveBucket>();

    const clipFrom = from < periodFrom ? periodFrom : from;
    const clipTo = to > periodTo ? periodTo : to;

    if (row.type === 'permessi') {
      // single-day, distribute minutes precisely
      const dayKey = clipFrom.toISOString().slice(0, 10);
      const minutes = Math.max(0, Math.round((clipTo.getTime() - clipFrom.getTime()) / 60000));
      const bucket = userMap.get(dayKey) ?? { ferie: 0, permessi: 0, malattia: 0 };
      bucket.permessi += minutes;
      userMap.set(dayKey, bucket);
    } else {
      // ferie / malattia: span multiple days. Distribute duration_hours evenly
      // across the inclusive day count — close enough for payroll display.
      const days: string[] = [];
      const cur = new Date(clipFrom);
      cur.setUTCHours(12, 0, 0, 0);
      const end = new Date(clipTo);
      end.setUTCHours(12, 0, 0, 0);
      while (cur.getTime() <= end.getTime()) {
        days.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
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
  job: ExportJobRow
): Promise<Map<string, LeaveInterval[]>> {
  // Raw approved-leave windows per user overlapping the period. Mirrors the
  // leaves subquery feeding computeAnomalies in routes/shifts.ts (status =
  // 'approved', any type), so breach deductions and presence anomalies agree
  // on what counts as "covered by leave".
  const r = await adminPool.query(
    `SELECT lr.user_id, lr.from_ts, lr.to_ts
       FROM leave_requests lr
      WHERE lr.tenant_id = $1
        AND lr.status = 'approved'
        AND lr.to_ts   >  $2::date
        AND lr.from_ts < ($3::date + INTERVAL '1 day')`,
    [job.tenant_id, job.period_from, job.period_to]
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

// Minutes of approved leave overlapping [startMs, endMs]. Used to waive a
// late-in / early-out breach when an approved ferie/permesso covers the
// deviating stretch. Mirrors leaveOverlapMin in routes/shifts.ts.
function leaveOverlapMin(
  leaves: LeaveInterval[] | undefined,
  startMs: number,
  endMs: number
): number {
  if (!leaves || endMs <= startMs) return 0;
  let covered = 0;
  for (const lv of leaves) {
    const ov = Math.min(lv.to, endMs) - Math.max(lv.from, startMs);
    if (ov > 0) covered += Math.round(ov / 60000);
  }
  return covered;
}

function combineDateTime(dateStr: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const [y, mo, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, h, m, 0));
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
}

async function loadStampsDetail(job: ExportJobRow): Promise<StampDetailRow[]> {
  const r = await adminPool.query(
    `SELECT user_id, event_type, occurred_at, source, branch_id,
            latitude, longitude, gps_accuracy_m,
            device_platform, device_app_version, suspicious_mock_location, out_of_geofence, notes
       FROM stamps
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND occurred_at >= $2::date
        AND occurred_at < ($3::date + INTERVAL '1 day')
      ORDER BY user_id, occurred_at`,
    [job.tenant_id, job.period_from, job.period_to]
  );
  return r.rows as StampDetailRow[];
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

async function loadCorrections(job: ExportJobRow): Promise<CorrectionRow[]> {
  // Corrections about stamps that fall inside the payroll period.
  const r = await adminPool.query(
    `SELECT user_id, claimed_event_type, claimed_occurred_at, claimed_branch_id,
            justification, status, resolved_by, resolved_at, resolution_note, created_at
       FROM correction_requests
      WHERE tenant_id = $1
        AND claimed_occurred_at >= $2::date
        AND claimed_occurred_at < ($3::date + INTERVAL '1 day')
      ORDER BY user_id, claimed_occurred_at`,
    [job.tenant_id, job.period_from, job.period_to]
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

async function loadLeaveDetail(job: ExportJobRow): Promise<LeaveDetailRow[]> {
  // Individual leave events overlapping the period. Company-wide closures
  // (chiusura) go to the dedicated "Eventi aziendali" sheet instead.
  const r = await adminPool.query(
    `SELECT user_id, type, status, from_ts, to_ts, duration_hours,
            inps_protocol, assenza_subtype, is_paid, user_note,
            decided_by, decided_at, rejection_reason, created_by_admin
       FROM leave_requests
      WHERE tenant_id = $1
        AND type IN ('ferie','permessi','malattia','assenza')
        AND to_ts > $2::date
        AND from_ts < ($3::date + INTERVAL '1 day')
      ORDER BY user_id, from_ts`,
    [job.tenant_id, job.period_from, job.period_to]
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

async function loadEventi(job: ExportJobRow): Promise<EventRow[]> {
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
        AND to_ts > $2::date
        AND from_ts < ($3::date + INTERVAL '1 day')
      GROUP BY COALESCE(batch_id::text, id::text)
      ORDER BY MIN(from_ts)`,
    [job.tenant_id, job.period_from, job.period_to]
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
  // Aggregates feed the `users` array; leaves + justifications carry the
  // provenance of any admin correction (created_by_admin / note-only fixes).
  const [leaves, justifications] = await Promise.all([
    loadLeaveDetail(job),
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
  // Load all payroll detail in parallel — each is a single tenant-scoped query.
  const [userMeta, branchMeta, residueByUser, stamps, corrections, leaves, eventi, justifications] =
    await Promise.all([
      loadUserMeta(job),
      loadBranchMeta(job),
      loadResidue(job),
      loadStampsDetail(job),
      loadCorrections(job),
      loadLeaveDetail(job),
      loadEventi(job),
      loadJustifications(job),
    ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'sonoQui';

  /* 1. Riepilogo — one row per employee, totals + residual balances. */
  const riep = wb.addWorksheet('Riepilogo');
  riep.columns = [
    { header: 'Dipendente', key: 'name', width: 26 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Ore lavorate', key: 'worked', width: 14 },
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
    riep.addRow({
      name: metaName(userMeta, u.user_id, u.email),
      email: metaEmail(userMeta, u.user_id, u.email),
      worked: u.worked_minutes_total / 60,
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
    'worked', 'overtime', 'paid', 'unpaid', 'ferie', 'permessi', 'malattia',
    'res_ferie', 'res_permessi',
  ]);
  styleHeader(riep);

  /* 2. One sheet per employee — daily breakdown. */
  const RESERVED = [
    'riepilogo', 'timbrature', 'correzioni', 'ferie e permessi',
    'eventi aziendali', 'ferie residue', 'metadati',
  ];
  const usedNames = new Set<string>(RESERVED);
  for (const u of data) {
    const label = metaName(userMeta, u.user_id, u.email);
    const base = (label.replace(/[\\/?*\[\]:]/g, '_').slice(0, 28) || 'Utente');
    let candidate = base;
    let i = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${base}_${i++}`.slice(0, 31);
    }
    usedNames.add(candidate.toLowerCase());
    const ws = wb.addWorksheet(candidate);
    ws.columns = [
      { header: 'Giorno', key: 'day', width: 14 },
      { header: 'Marker', key: 'marker', width: 8 },
      { header: 'Ore lavorate', key: 'worked', width: 14 },
      { header: 'Ore straordinarie', key: 'overtime', width: 18 },
      { header: 'Ore ferie', key: 'ferie', width: 12 },
      { header: 'Ore permessi', key: 'permessi', width: 14 },
      { header: 'Ore malattia', key: 'malattia', width: 14 },
      { header: 'Pausa retribuita (min)', key: 'paid', width: 22 },
      { header: 'Pausa non retribuita (min)', key: 'unpaid', width: 26 },
    ];
    for (const d of u.days) {
      ws.addRow({
        day: d.day,
        marker: d.leave_marker ?? '',
        worked: d.worked_minutes / 60,
        overtime: d.overtime_minutes / 60,
        ferie: d.ferie_minutes / 60,
        permessi: d.permessi_minutes / 60,
        malattia: d.malattia_minutes / 60,
        paid: d.paid_break_minutes,
        unpaid: d.unpaid_break_minutes,
      });
    }
    setHourFormat(ws, ['worked', 'overtime', 'ferie', 'permessi', 'malattia']);
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
    { header: 'Note', key: 'notes', width: 30 },
  ];
  for (const s of stamps) {
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
      notes: s.notes ?? '',
    });
  }
  styleHeader(tb);

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
      date: fmtRome(j.anomaly_date + 'T00:00:00', false),
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

  /* 8. Metadati — provenance + counts. */
  const meta = wb.addWorksheet('Metadati');
  meta.columns = [
    { header: 'Campo', key: 'k', width: 24 },
    { header: 'Valore', key: 'v', width: 46 },
  ];
  meta.addRow({ k: 'tenant_id', v: job.tenant_id });
  meta.addRow({ k: 'period_from', v: job.period_from });
  meta.addRow({ k: 'period_to', v: job.period_to });
  meta.addRow({ k: 'generated_at', v: new Date().toISOString() });
  meta.addRow({ k: 'schema_version', v: 'v2' });
  meta.addRow({ k: 'Dipendenti', v: data.length });
  meta.addRow({ k: 'Timbrature', v: stamps.length });
  meta.addRow({ k: 'Correzioni', v: corrections.length });
  meta.addRow({ k: 'Ferie / permessi / assenze', v: leaves.length });
  meta.addRow({ k: 'Eventi aziendali', v: eventi.length });
  styleHeader(meta);

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const key = `tenants/${job.tenant_id}/exports/${job.id}.xlsx`;
  await persist(key, Buffer.from(buf));
  return { storageKey: key, signedUrlExpiresAt: new Date(Date.now() + 15 * 60_000) };
}

async function persist(key: string, body: Buffer): Promise<void> {
  if (env.STORAGE_DRIVER === 'disk') {
    const full = join(env.STORAGE_DISK_PATH, key);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, body);
    return;
  }
  // r2 driver wired in TASK-EXP-02 production path
  throw new Error('R2 driver not implemented in this scaffold');
}

export async function readExportFile(storageKey: string): Promise<Buffer> {
  if (env.STORAGE_DRIVER === 'disk') {
    const fs = await import('node:fs/promises');
    return await fs.readFile(join(env.STORAGE_DISK_PATH, storageKey));
  }
  throw new Error('R2 driver not implemented in this scaffold');
}

export async function deleteExportFile(storageKey: string): Promise<void> {
  if (env.STORAGE_DRIVER === 'disk') {
    const fs = await import('node:fs/promises');
    await fs.rm(join(env.STORAGE_DISK_PATH, storageKey), { force: true });
    return;
  }
  throw new Error('R2 driver not implemented in this scaffold');
}
