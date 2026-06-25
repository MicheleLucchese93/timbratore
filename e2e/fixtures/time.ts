// Europe/Rome wall-clock → UTC instant, for seeding stamps in e2e specs.
//
// The backend resolves schedule slot times (e.g. "09:00") in the tenant
// timezone (Europe/Rome), not UTC — see apps/backend/src/lib/tz.ts. So a seeded
// stamp meant to land at "09:00 on the schedule" must be the matching Rome-local
// instant (07:00Z in summer / 08:00Z in winter), NOT 09:00Z. Using UTC hours
// would mis-shift it by the zone offset and fabricate late/early anomalies.
//
// This is a small standalone mirror of the backend helper (no DST library — the
// offset is solved by probing Intl, which Playwright's Node runtime supports).

const TZ = 'Europe/Rome';

// Offset (ms) of Europe/Rome at the given UTC instant: local wall-clock − UTC.
function zoneOffsetMs(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
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
  return Date.UTC(f.year!, f.month! - 1, f.day!, f.hour!, f.minute!, f.second!) - utcMs;
}

// UTC ISO string + 'YYYY-MM-DD' for `hour:minute` Europe/Rome wall-clock on the
// UTC calendar date of `base`. (For daytime hours the Rome date equals the UTC
// date, so `date` is the day the stamp belongs to in both the seeder and the
// backend anomaly bucketing.)
export function romeWallClockISO(
  base: Date,
  hour: number,
  minute = 0
): { iso: string; date: string } {
  const y = base.getUTCFullYear();
  const mo = base.getUTCMonth();
  const d = base.getUTCDate();
  const naive = Date.UTC(y, mo, d, hour, minute, 0);
  let utc = naive - zoneOffsetMs(naive);
  const utc2 = naive - zoneOffsetMs(utc);
  if (utc2 !== utc) utc = utc2;
  const date = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { iso: new Date(utc).toISOString(), date };
}
