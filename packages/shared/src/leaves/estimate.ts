// Client-side mirror of the backend's computeHoursPerDay / computeDurationHours
// (apps/backend/src/lib/leave-quota.ts) so leave forms can preview the hours a
// request will claim before submitting. The backend stays authoritative — this
// is only a hint.
//
// All types: clipped (to − from) per day, capped at that day's scheduled
// hours. An all-day request spans 00:00–23:59 so it collapses to the shift
// length; a partial-day request (ferie/permessi "Orario specifico") counts
// only the selected window; a non-working day counts 0.
//
// Uses an 8h Mon–Fri / 0 weekend fallback when no template is assigned.
// Days are bucketed by the local calendar, which equals the backend's
// Europe/Rome day grid on the Italian devices/browsers this app targets.

import type { ActiveAssignment } from '../stamps/counted-day.js';

export type LeaveType = 'ferie' | 'permessi' | 'malattia' | 'assenza';

export function estimateLeaveHours(
  type: LeaveType,
  fromTs: string,
  toTs: string,
  assignment: ActiveAssignment | null
): number {
  const from = new Date(fromTs);
  const to = new Date(toTs);
  const days = enumerateLocalDays(from, to);
  if (days.length === 0) return 0;

  const hoursByDow = shiftHoursByDow(assignment);
  const scheduledHours = (dow: number): number =>
    hoursByDow.size > 0 ? hoursByDow.get(dow) ?? 0 : dow >= 1 && dow <= 5 ? 8 : 0;

  let total = 0;
  for (const d of days) {
    const startMs = Math.max(from.getTime(), d.startMs);
    const endMs = Math.min(to.getTime(), d.endMs);
    const clipped = Math.max(0, (endMs - startMs) / 3_600_000);
    total += Math.min(clipped, scheduledHours(d.dow));
  }
  return Math.round(total * 100) / 100;
}

// Σ shift-slot hours per ISO weekday (1=Mon..7=Sun). Empty when there's no
// assignment or no slots → the caller applies the 8h-weekday fallback, matching
// the backend's loadShiftHoursByDow.
function shiftHoursByDow(a: ActiveAssignment | null): Map<number, number> {
  const m = new Map<number, number>();
  for (const s of a?.slots ?? []) {
    const mins = slotMinutes(s.start_time, s.end_time);
    if (mins > 0) m.set(s.day_of_week, (m.get(s.day_of_week) ?? 0) + mins / 60);
  }
  return m;
}

// Minutes between two "HH:MM(:SS)" slot bounds, same day, end ≥ start.
function slotMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number) as [number, number];
  const [eh, em] = end.split(':').map(Number) as [number, number];
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

interface LocalDay {
  dow: number; // ISO weekday 1..7
  startMs: number; // local midnight
  endMs: number; // next local midnight
}

// Each local-calendar day touched by [from, to], with its ISO weekday and the
// midnight bounds used to clip permessi.
function enumerateLocalDays(from: Date, to: Date): LocalDay[] {
  const out: LocalDay[] = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const endMs = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  while (cur.getTime() <= endMs) {
    const next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    const jsDow = cur.getDay(); // 0=Sun..6=Sat
    out.push({ dow: jsDow === 0 ? 7 : jsDow, startMs: cur.getTime(), endMs: next.getTime() });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
