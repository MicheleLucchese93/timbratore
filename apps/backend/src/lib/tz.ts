import type { PoolClient } from 'pg';

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

// SQL scalar for the current tenant's zone, for use inside a tenantHandler
// (RLS on `tenants` restricts it to the caller's row).
//
// Filter bounds arrive as 'YYYY-MM-DD' wall-clock days but the columns they
// filter (occurred_at, created_at, …) are timestamptz. Comparing them with
// `$1::date` makes Postgres promote the date using the *server* clock — UTC in
// production — so the window runs 00:00Z..00:00Z while the business day it
// stands for runs 22:00Z..22:00Z. Resolve the bound on the parameter instead:
// the comparison value stays a constant, so the index is still usable.
//
//   occurred_at >= ($1::timestamp AT TIME ZONE ${TENANT_TZ_SQL})            -- from 00:00 local
//   occurred_at <  (($2::date + 1)::timestamp AT TIME ZONE ${TENANT_TZ_SQL}) -- to 24:00 local
export const TENANT_TZ_SQL =
  `(SELECT timezone FROM tenants WHERE id = current_setting('app.current_tenant_id')::uuid)`;

// Today's calendar day in the current tenant's zone, as 'YYYY-MM-DD'. For
// defaulting a `date` column the user left blank: `new Date().toISOString()`
// would answer in UTC and pick yesterday for the first hours of a local day.
export async function tenantToday(client: PoolClient): Promise<string> {
  const r = await client.query<{ d: string }>(
    `SELECT to_char((now() AT TIME ZONE ${TENANT_TZ_SQL})::date, 'YYYY-MM-DD') AS d`
  );
  return r.rows[0]!.d;
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
//
// An end instant sitting exactly on local midnight is the OPEN edge of the day
// it lands in, not a moment inside it: a leave stored 10 Aug 00:00 → 12 Aug
// 00:00 (Rome) covers two days, not three. Keying that end to its own day gave
// the third day a share of duration_hours — 5,33h each instead of 8h on two —
// and the phantom day could land on top of the employee's own absence, printing
// 13,33h and the wrong marker. Same family as the start-side bug zonedDateKey()
// documents above (Carlo Signorato / IdealCopy, July 2026), with the boundary on
// the other end of the span. A '…T23:59' end is untouched: it is already inside
// its own day.
export function eachZonedDateKeyInclusive(
  from: Date | number,
  to: Date | number,
  timeZone: string = DEFAULT_TZ
): string[] {
  const out: string[] = [];
  const toMs = typeof to === 'number' ? to : to.getTime();
  const endKey = zonedDateKey(toMs, timeZone);
  // Compare against local midnight of that same day rather than a fixed UTC
  // offset: midnight is 22:00Z in summer and 23:00Z in winter, and a DST day
  // shifts it again.
  const last =
    startOfZonedDayUtcMs(endKey, timeZone) === toMs ? zonedDateKey(toMs - 1, timeZone) : endKey;
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
