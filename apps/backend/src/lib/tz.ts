// Timezone-aware wall-clock ↔ UTC conversion.
//
// Schedule slot times (shift_template_slots.start_time/end_time) are stored as
// `time` — wall-clock in the tenant's local timezone (tenants.timezone, default
// Europe/Rome). Stamps (stamps.occurred_at) are `timestamptz` — true UTC
// instants. To compare a scheduled time against a real stamp we must resolve the
// wall-clock into the correct UTC instant for that calendar day, honouring DST
// (Europe/Rome is CET/+01 in winter, CEST/+02 in summer).
//
// Building the instant with `Date.UTC(...)` instead treats the wall-clock as
// UTC: it is wrong by the zone offset (+1h winter, +2h summer) and is exactly
// what produced bogus early-exit / missing-clock anomalies and wrong payroll
// breach deductions.

export const DEFAULT_TZ = 'Europe/Rome';

// Offset (ms) of `timeZone` at the given UTC instant: local wall-clock − UTC.
// Positive east of Greenwich (Europe/Rome → +3_600_000 winter, +7_200_000 summer).
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const f: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') f[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(f.year!, f.month! - 1, f.day!, f.hour!, f.minute!, f.second!);
  return asUtc - utcMs;
}

// UTC ms of the wall-clock `dateStr` ('YYYY-MM-DD') `hhmm` ('HH:MM') interpreted
// in `timeZone`. DST-correct via a two-pass offset solve so the day a transition
// lands on resolves to the right instant. Nonexistent/ambiguous spring-forward
// wall times resolve to a nearby valid instant — acceptable for schedule anchors.
export function zonedWallClockToUtcMs(
  dateStr: string,
  hhmm: string,
  timeZone: string = DEFAULT_TZ
): number {
  const [y, mo, d] = dateStr.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  // First approximation: subtract the offset measured at the naive instant.
  let utc = naiveUtc - zoneOffsetMs(naiveUtc, timeZone);
  // Re-solve once: the offset at the corrected instant can differ across a DST
  // boundary. One extra step suffices for any valid wall time; a non-existent
  // spring-forward wall time (the 02:00–03:00 gap) has no fixed point and
  // resolves deterministically to the post-jump instant — acceptable here since
  // schedule slot times never fall inside that gap.
  const utc2 = naiveUtc - zoneOffsetMs(utc, timeZone);
  if (utc2 !== utc) utc = utc2;
  return utc;
}

// `Date` of the wall-clock `dateStr`/`hhmm` interpreted in `timeZone`.
export function zonedWallClock(
  dateStr: string,
  hhmm: string,
  timeZone: string = DEFAULT_TZ
): Date {
  return new Date(zonedWallClockToUtcMs(dateStr, hhmm, timeZone));
}

// 00:00 of `dateStr` in `timeZone`, as UTC ms.
export function startOfZonedDayUtcMs(dateStr: string, timeZone: string = DEFAULT_TZ): number {
  return zonedWallClockToUtcMs(dateStr, '00:00', timeZone);
}

// The ISO date ('YYYY-MM-DD') one calendar day after `dateStr`.
export function nextIsoDate(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
}

// The business day ('YYYY-MM-DD') a UTC instant falls on in `timeZone`.
//
// Reading the day off `toISOString().slice(0, 10)` instead answers in UTC. Every
// Europe/Rome instant from 22:00Z (23:00Z in winter) to midnight belongs to the
// NEXT local day, so a leave starting at Rome midnight — stored as the previous
// day 22:00Z — buckets one day early and payroll grows a phantom day.
export function zonedDateKey(at: Date | number, timeZone: string = DEFAULT_TZ): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const f: Record<string, string> = {};
  for (const p of dtf.formatToParts(typeof at === 'number' ? new Date(at) : at)) {
    if (p.type !== 'literal') f[p.type] = p.value;
  }
  return `${f.year}-${f.month}-${f.day}`;
}

// Inclusive list of `timeZone` business days spanned by the instants `from`..`to`.
// Iterates on the date string, not on a UTC instant stepped by 24h: a DST
// transition day is 23 or 25 hours long, so instant arithmetic drifts across it.
export function eachZonedDateKeyInclusive(
  from: Date | number,
  to: Date | number,
  timeZone: string = DEFAULT_TZ
): string[] {
  const out: string[] = [];
  const last = zonedDateKey(to, timeZone);
  // Zero-padded YYYY-MM-DD compares lexicographically in chronological order.
  for (let cur = zonedDateKey(from, timeZone); cur <= last; cur = nextIsoDate(cur)) {
    out.push(cur);
  }
  return out;
}

// Wall-clock 'HH:MM' of a UTC instant (ms) rendered in `timeZone`.
export function hhmmInZone(ms: number, timeZone: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}
