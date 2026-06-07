// Live mirror of apps/backend/src/services/export-service.ts day-level rules,
// reduced to what makes sense before the shift closes. Used by the mobile
// hero card to show "Ore conteggiate" (timesheet-aware) alongside
// "Ore lavorate" (raw arithmetic).
//
// While the day is open (no clock_out yet), we cannot know whether the user
// will trigger the early-clock-out breach. We therefore skip that one rule
// and apply only the breaches that are already realized:
//   - late clock-in beyond tolerance_in_min          → subtract tolerance_in_breach_deduct_min
//   - break total over expected_break_max_min        → subtract tolerance_break_breach_deduct_min
// Overtime treats `now` as a virtual clock-out: surplus past expected_end is
// counted in whole blocks of extraordinary_threshold_min (15/30/60), a partial
// block not counted. Only when count_extraordinary is on.

import type { DayStamp, DayTotals } from './day-totals';
import { computeDayTotals } from './day-totals';

export interface AssignmentSlot {
  day_of_week: number;
  start_time: string; // "HH:MM"
  end_time: string;   // "HH:MM"
}

export interface ActiveAssignment {
  id: string;
  shift_template_id: string;
  template_name: string;
  tolerance_in_min: number;
  tolerance_out_min: number;
  expected_break_min_min: number;
  expected_break_max_min: number;
  expected_lunch_min_min: number;
  expected_lunch_max_min: number;
  extraordinary_threshold_min: 15 | 30 | 60;
  count_extraordinary: boolean;
  tolerance_in_breach_deduct_min: number;
  tolerance_out_breach_deduct_min: number;
  tolerance_break_breach_deduct_min: number;
  // Orario flessibile (flextime). Default 0/false → fixed-span behaviour.
  flexible_enabled?: boolean;
  flex_in_before_min?: number;
  flex_in_after_min?: number;
  flex_out_before_min?: number;
  flex_out_after_min?: number;
  flex_lunch_before_min?: number;
  flex_lunch_after_min?: number;
  slots: AssignmentSlot[];
  // Feature B per-weekday auto-deduct lunch (absent = none that day).
  day_lunch?: Array<{ day_of_week: number; lunch_min: number }>;
}

export interface CountedDay extends DayTotals {
  /** Arithmetic worked minutes after live tick (== DayTotals.workedMs). */
  workedMs: number;
  /** Standard counted minutes (worked - breach deductions, clamped at 0). */
  countedMs: number;
  /** Overtime minutes — surplus past expected_end, counted in whole blocks of
   *  extraordinary_threshold_min. Only when count_extraordinary is on. */
  overtimeMs: number;
  /** countedMs + overtimeMs — the value to show as "Ore conteggiate". */
  countedTotalMs: number;
}

const MINUTE_MS = 60_000;
const QUARTER_MS = 15 * MINUTE_MS;

/** Approved-leave window. Used to waive a late-in / early-out breach when an
 *  approved ferie/permesso covers the deviating stretch. */
export interface LeaveInterval {
  from_ts: string;
  to_ts: string;
}

// "Ore conteggiate" rounds down to 15-minute blocks: 14 min of work counts as
// 0, 15–29 min as 15, etc. Mirrors backend export-service.ts.
function floorQuarter(ms: number): number {
  return Math.floor(Math.max(0, ms) / QUARTER_MS) * QUARTER_MS;
}

// Σ slot durations (ms) for a day — the flextime worked target before any
// auto-lunch deduction. Lunch gaps between fasce are not slots, so excluded.
function slotsDurationMs(slots: AssignmentSlot[]): number {
  let ms = 0;
  for (const s of slots) {
    const [sh, sm] = s.start_time.split(':').map(Number) as [number, number];
    const [eh, em] = s.end_time.split(':').map(Number) as [number, number];
    const d = eh * 60 + em - (sh * 60 + sm);
    if (d > 0) ms += d * MINUTE_MS;
  }
  return ms;
}

function autoLunchMinFor(assignment: ActiveAssignment, dow: number): number {
  return (assignment.day_lunch ?? []).find((d) => d.day_of_week === dow)?.lunch_min ?? 0;
}

// Minutes of approved leave overlapping [startMs, endMs]. Mirrors
// leaveOverlapMin in backend routes/shifts.ts + export-service.ts.
function leaveOverlapMin(leaves: LeaveInterval[], startMs: number, endMs: number): number {
  if (endMs <= startMs) return 0;
  let covered = 0;
  for (const lv of leaves) {
    const ov = Math.min(new Date(lv.to_ts).getTime(), endMs) - Math.max(new Date(lv.from_ts).getTime(), startMs);
    if (ov > 0) covered += Math.round(ov / MINUTE_MS);
  }
  return covered;
}

export function computeCountedDay(
  stamps: DayStamp[],
  assignment: ActiveAssignment | null,
  now: Date = new Date(),
  leaves: LeaveInterval[] = []
): CountedDay {
  const totals = computeDayTotals(stamps, now);

  if (!assignment) {
    const countedMs = floorQuarter(totals.workedMs);
    return {
      ...totals,
      countedMs,
      overtimeMs: 0,
      countedTotalMs: countedMs,
    };
  }

  // Resolve today's slots (use `now` for the local day; falls back to UTC date
  // if local rolls past midnight). Multiple slots = split shift; treat
  // expectedStart = earliest start, expectedEnd = latest end on that DOW.
  const dow = isoDowLocal(now);
  const todaySlots = assignment.slots
    .filter((s) => s.day_of_week === dow)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  if (todaySlots.length === 0) {
    // Rest day per shift_template — nothing to compare against.
    const countedMs = floorQuarter(totals.workedMs);
    return {
      ...totals,
      countedMs,
      overtimeMs: 0,
      countedTotalMs: countedMs,
    };
  }

  const dateStr = isoLocalDate(now);
  const expectedStart = combineLocalDateTime(dateStr, todaySlots[0]!.start_time);
  const expectedEnd = combineLocalDateTime(dateStr, todaySlots[todaySlots.length - 1]!.end_time);

  const flex = assignment.flexible_enabled === true;
  const autoLunchMin = autoLunchMinFor(assignment, dow);
  // Feature B auto-lunch: worked = presence − L, ignoring stamped break/lunch.
  const baseWorkedMs =
    autoLunchMin > 0
      ? Math.max(0, totals.workedMs + totals.breakMs + totals.lunchMs - autoLunchMin * MINUTE_MS)
      : totals.workedMs;

  let deductMs = 0;

  // late clock-in breach, measured past the flexed entry anchor. An approved
  // permesso/ferie covering [expectedStart, firstIn] waives it.
  if (totals.firstInAt) {
    const firstInMs = new Date(totals.firstInAt).getTime();
    const flexInAfterMin = flex ? assignment.flex_in_after_min ?? 0 : 0;
    const lateMin = Math.max(
      0,
      Math.round((firstInMs - expectedStart.getTime()) / MINUTE_MS) - flexInAfterMin
    );
    const coveredMin = leaveOverlapMin(leaves, expectedStart.getTime(), firstInMs);
    if (lateMin - coveredMin > assignment.tolerance_in_min) {
      deductMs += assignment.tolerance_in_breach_deduct_min * MINUTE_MS;
    }
  }

  // break/lunch-too-long breaches don't apply on auto-lunch days.
  if (autoLunchMin === 0) {
    const breakMin = Math.round(totals.breakMs / MINUTE_MS);
    if (breakMin > assignment.expected_break_max_min) {
      deductMs += assignment.tolerance_break_breach_deduct_min * MINUTE_MS;
    }
    const lunchMin = Math.round(totals.lunchMs / MINUTE_MS);
    if (lunchMin > assignment.expected_lunch_max_min) {
      deductMs += assignment.tolerance_break_breach_deduct_min * MINUTE_MS;
    }
  }

  // overtime, in whole blocks of extraordinary_threshold_min. Flextime: surplus
  // of WORKED time past the contracted duration (now ticks into baseWorkedMs via
  // the open segment). Fixed schedule: surplus of `now` past expectedEnd.
  let overtimeMs = 0;
  if (assignment.count_extraordinary) {
    const blockMs = assignment.extraordinary_threshold_min * MINUTE_MS;
    const overMs = flex
      ? baseWorkedMs - (slotsDurationMs(todaySlots) - autoLunchMin * MINUTE_MS)
      : now.getTime() - expectedEnd.getTime();
    if (overMs > 0) {
      overtimeMs = Math.floor(overMs / blockMs) * blockMs;
    }
  }

  const countedMs = floorQuarter(baseWorkedMs - deductMs);
  return {
    ...totals,
    countedMs,
    overtimeMs,
    countedTotalMs: countedMs + overtimeMs,
  };
}

// Closed historical day (Storico). Unlike computeCountedDay (live "today"),
// this resolves the shift slots from the day itself, applies the early
// clock-out breach, and bases overtime on the real last clock-out — mirroring
// the backend export-service per-day rules. Open segments contribute 0.
export function computeCountedDayClosed(
  stamps: DayStamp[],
  assignment: ActiveAssignment | null,
  dayIso: string,
  leaves: LeaveInterval[] = []
): CountedDay {
  const totals = computeDayTotals(stamps, undefined, false);

  const noShift = (): CountedDay => {
    const countedMs = floorQuarter(totals.workedMs);
    return { ...totals, countedMs, overtimeMs: 0, countedTotalMs: countedMs };
  };

  if (!assignment) return noShift();

  const dow = isoDowFromIso(dayIso);
  const slots = assignment.slots
    .filter((s) => s.day_of_week === dow)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  if (slots.length === 0) return noShift();

  const expectedStart = combineLocalDateTime(dayIso, slots[0]!.start_time);
  const expectedEnd = combineLocalDateTime(dayIso, slots[slots.length - 1]!.end_time);

  const flex = assignment.flexible_enabled === true;
  const autoLunchMin = autoLunchMinFor(assignment, dow);
  const baseWorkedMs =
    autoLunchMin > 0
      ? Math.max(0, totals.workedMs + totals.breakMs + totals.lunchMs - autoLunchMin * MINUTE_MS)
      : totals.workedMs;

  let deductMs = 0;

  // late clock-in breach, measured past the flexed entry anchor. An approved
  // permesso/ferie covering [expectedStart, firstIn] waives it.
  if (totals.firstInAt) {
    const firstInMs = new Date(totals.firstInAt).getTime();
    const flexInAfterMin = flex ? assignment.flex_in_after_min ?? 0 : 0;
    const lateMin = Math.max(
      0,
      Math.round((firstInMs - expectedStart.getTime()) / MINUTE_MS) - flexInAfterMin
    );
    const coveredMin = leaveOverlapMin(leaves, expectedStart.getTime(), firstInMs);
    if (lateMin - coveredMin > assignment.tolerance_in_min) {
      deductMs += assignment.tolerance_in_breach_deduct_min * MINUTE_MS;
    }
  }

  // early clock-out breach (only knowable once the shift has closed), measured
  // before the flexed exit anchor. An approved permesso/ferie covering
  // [lastOut, expectedEnd] waives it.
  if (totals.lastOutAt) {
    const lastOutMs = new Date(totals.lastOutAt).getTime();
    const flexOutBeforeMin = flex ? assignment.flex_out_before_min ?? 0 : 0;
    const earlyMin = Math.max(
      0,
      Math.round((expectedEnd.getTime() - lastOutMs) / MINUTE_MS) - flexOutBeforeMin
    );
    const coveredMin = leaveOverlapMin(leaves, lastOutMs, expectedEnd.getTime());
    if (earlyMin - coveredMin > assignment.tolerance_out_min) {
      deductMs += assignment.tolerance_out_breach_deduct_min * MINUTE_MS;
    }
  }

  // break/lunch-too-long breaches don't apply on auto-lunch days.
  if (autoLunchMin === 0) {
    const breakMin = Math.round(totals.breakMs / MINUTE_MS);
    if (breakMin > assignment.expected_break_max_min) {
      deductMs += assignment.tolerance_break_breach_deduct_min * MINUTE_MS;
    }
    const lunchMin = Math.round(totals.lunchMs / MINUTE_MS);
    if (lunchMin > assignment.expected_lunch_max_min) {
      deductMs += assignment.tolerance_break_breach_deduct_min * MINUTE_MS;
    }
  }

  // overtime in whole blocks of extraordinary_threshold_min. Flextime: surplus
  // of WORKED time past the contracted duration. Fixed: surplus of the actual
  // clock-out past expectedEnd.
  let overtimeMs = 0;
  if (assignment.count_extraordinary) {
    const blockMs = assignment.extraordinary_threshold_min * MINUTE_MS;
    let overMs = 0;
    if (flex) {
      overMs = baseWorkedMs - (slotsDurationMs(slots) - autoLunchMin * MINUTE_MS);
    } else if (totals.lastOutAt) {
      overMs = new Date(totals.lastOutAt).getTime() - expectedEnd.getTime();
    }
    if (overMs > 0) {
      overtimeMs = Math.floor(overMs / blockMs) * blockMs;
    }
  }

  const countedMs = floorQuarter(baseWorkedMs - deductMs);
  return {
    ...totals,
    countedMs,
    overtimeMs,
    countedTotalMs: countedMs + overtimeMs,
  };
}

function isoDowFromIso(dayIso: string): number {
  const [y, m, d] = dayIso.split('-').map(Number) as [number, number, number];
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 ? 7 : dow;
}

/** True if the shift schedules any slot on dayIso's weekday. Without an
 *  assignment the schedule is unknown, so the day is treated as a workday
 *  (callers should not hide it). */
export function isScheduledWorkday(assignment: ActiveAssignment | null, dayIso: string): boolean {
  if (!assignment) return true;
  return assignment.slots.some((s) => s.day_of_week === isoDowFromIso(dayIso));
}

function isoDowLocal(d: Date): number {
  // 0=Sun..6=Sat in JS → 1=Mon..7=Sun ISO.
  const dow = d.getDay();
  return dow === 0 ? 7 : dow;
}

function isoLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function combineLocalDateTime(dateStr: string, hhmm: string): Date {
  const [y, mo, da] = dateStr.split('-').map(Number) as [number, number, number];
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(y, mo - 1, da, h, m, 0, 0);
}
