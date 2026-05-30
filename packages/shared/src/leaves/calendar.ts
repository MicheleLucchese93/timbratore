// Dependency-free calendar grid math for day / week / month / year views.
//
// Weeks are Monday-first (Italian convention). All functions work in the
// host's local time — fine for display. Authoritative quota/timezone math
// lives server-side (Europe/Rome) in the backend.

export type CalView = 'day' | 'week' | 'month' | 'year';

export const WEEKDAY_LABELS_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'] as const;
export const MONTH_LABELS = [
  'Gennaio',
  'Febbraio',
  'Marzo',
  'Aprile',
  'Maggio',
  'Giugno',
  'Luglio',
  'Agosto',
  'Settembre',
  'Ottobre',
  'Novembre',
  'Dicembre',
] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local-time YYYY-MM-DD for a Date. */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local midnight Date from a YYYY-MM-DD string. */
export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + n);
  return out;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isWeekend(d: Date): boolean {
  const g = d.getDay(); // 0 = Sun … 6 = Sat
  return g === 0 || g === 6;
}

/** Monday (00:00 local) on or before the given date. */
export function startOfWeekMonday(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const g = out.getDay(); // 0=Sun..6=Sat
  const back = g === 0 ? 6 : g - 1; // days since Monday
  out.setDate(out.getDate() - back);
  return out;
}

/** The 7 days (Mon–Sun) of the week containing `d`. */
export function weekDays(d: Date): Date[] {
  const start = startOfWeekMonday(d);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/**
 * 6×7 month grid (always 42 cells, Monday-first) covering the month of
 * `year`/`month` (month is 0-based) plus leading/trailing days from adjacent
 * months so the grid is rectangular.
 */
export function monthGrid(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const gridStart = startOfWeekMonday(first);
  const weeks: Date[][] = [];
  let cursor = gridStart;
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let i = 0; i < 7; i++) {
      row.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(row);
  }
  return weeks;
}

/** The 12 first-of-month Dates for a year (for the year overview). */
export function monthsOfYear(year: number): Date[] {
  return Array.from({ length: 12 }, (_, m) => new Date(year, m, 1));
}

/**
 * True if a leave event spanning [fromTs, toTs) touches the local calendar day
 * `dayISO`. Endpoints are ISO timestamp strings; comparison is done against the
 * local-time bounds of the day so a multi-day leave lights up every day it
 * overlaps.
 */
export function leaveCoversDay(fromTs: string, toTs: string, dayISO: string): boolean {
  const dayStart = fromISODate(dayISO).getTime();
  const dayEnd = addDays(fromISODate(dayISO), 1).getTime();
  const from = new Date(fromTs).getTime();
  const to = new Date(toTs).getTime();
  return from < dayEnd && to > dayStart;
}

/** Human label for the current view's header (e.g. "Agosto 2026"). */
export function viewTitle(view: CalView, anchor: Date): string {
  if (view === 'year') return String(anchor.getFullYear());
  if (view === 'month') return `${MONTH_LABELS[anchor.getMonth()]} ${anchor.getFullYear()}`;
  if (view === 'week') {
    const days = weekDays(anchor);
    const a = days[0]!;
    const b = days[6]!;
    return `${a.getDate()} ${MONTH_LABELS[a.getMonth()]} – ${b.getDate()} ${MONTH_LABELS[b.getMonth()]} ${b.getFullYear()}`;
  }
  return `${anchor.getDate()} ${MONTH_LABELS[anchor.getMonth()]} ${anchor.getFullYear()}`;
}
