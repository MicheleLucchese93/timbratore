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

// Wall-clock 'HH:MM' of a UTC instant (ms) rendered in `timeZone`.
export function hhmmInZone(ms: number, timeZone: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}
