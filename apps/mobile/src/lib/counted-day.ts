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
// Overtime treats `now` as a virtual clock-out only when count_extraordinary
// is on and now is past expected_end + extraordinary_threshold_min.

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
  extraordinary_threshold_min: 1 | 15 | 30;
  count_extraordinary: boolean;
  tolerance_in_breach_deduct_min: number;
  tolerance_out_breach_deduct_min: number;
  tolerance_break_breach_deduct_min: number;
  slots: AssignmentSlot[];
}

export interface CountedDay extends DayTotals {
  /** Arithmetic worked minutes after live tick (== DayTotals.workedMs). */
  workedMs: number;
  /** Standard counted minutes (worked - breach deductions, clamped at 0). */
  countedMs: number;
  /** Overtime minutes (only when count_extraordinary is on and we are past
   *  expected_end + extraordinary_threshold_min). */
  overtimeMs: number;
  /** countedMs + overtimeMs — the value to show as "Ore conteggiate". */
  countedTotalMs: number;
}

const MINUTE_MS = 60_000;
const QUARTER_MS = 15 * MINUTE_MS;

// "Ore conteggiate" rounds down to 15-minute blocks: 14 min of work counts as
// 0, 15–29 min as 15, etc. Mirrors backend export-service.ts.
function floorQuarter(ms: number): number {
  return Math.floor(Math.max(0, ms) / QUARTER_MS) * QUARTER_MS;
}

export function computeCountedDay(
  stamps: DayStamp[],
  assignment: ActiveAssignment | null,
  now: Date = new Date()
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

  let deductMs = 0;

  // late clock-in breach
  if (totals.firstInAt) {
    const lateMs = new Date(totals.firstInAt).getTime() - expectedStart.getTime();
    const lateMin = Math.max(0, Math.round(lateMs / MINUTE_MS));
    if (lateMin > assignment.tolerance_in_min) {
      deductMs += assignment.tolerance_in_breach_deduct_min * MINUTE_MS;
    }
  }

  // break-too-long breach (regular pausa)
  const breakMin = Math.round(totals.breakMs / MINUTE_MS);
  if (breakMin > assignment.expected_break_max_min) {
    deductMs += assignment.tolerance_break_breach_deduct_min * MINUTE_MS;
  }

  // lunch-too-long breach
  const lunchMin = Math.round(totals.lunchMs / MINUTE_MS);
  if (lunchMin > assignment.expected_lunch_max_min) {
    deductMs += assignment.tolerance_break_breach_deduct_min * MINUTE_MS;
  }

  // overtime: only when feature on and now is past expectedEnd + threshold
  let overtimeMs = 0;
  if (assignment.count_extraordinary) {
    const cutoff = expectedEnd.getTime() + assignment.extraordinary_threshold_min * MINUTE_MS;
    if (now.getTime() > cutoff) {
      overtimeMs = now.getTime() - cutoff;
    }
  }

  const countedMs = floorQuarter(totals.workedMs - deductMs);
  const overtimeMsQuarter = floorQuarter(overtimeMs);
  return {
    ...totals,
    countedMs,
    overtimeMs: overtimeMsQuarter,
    countedTotalMs: countedMs + overtimeMsQuarter,
  };
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
