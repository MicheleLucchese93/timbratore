/**
 * Per-route latency digest over request_metrics, printed to stdout.
 *
 * This used to be a cron that mailed itself every Monday at 07:00. Nobody acts
 * on a weekly email the morning it lands, so it is now pulled by the daily prod
 * triage routine instead (~/.claude/scheduled-tasks/sonoqui-prod-log-triage),
 * which already reads the logs and PostHog in the same pass and can act on what
 * it finds. Pull beats push: a regression introduced by a Wednesday deploy no
 * longer waits until Monday to be noticed.
 *
 * Reads request_metrics, which metrics-flush persists hourly — so unlike
 * perf-report.sh (which parses the container log) this survives a deploy and
 * the log's retention.
 *
 * Run it in the prod container, where DATABASE_URL already points at the box:
 *   docker exec sonoqui-api npx tsx scripts/perf-digest.ts
 *   docker exec sonoqui-api npx tsx scripts/perf-digest.ts --days 1
 */
import { adminPool } from '../src/lib/admin-db.js';

/** Routes listed in the digest, worst p95 first. */
const TOP_N = 12;

/** A route needs this many requests in the window before its p95 means anything. */
const MIN_N = 10;

interface Window {
  route: string;
  n: number;
  durP95: number;
  durMax: number;
  dbP95: number;
  bytesMax: number;
  n4xx: number;
  n5xx: number;
}

/**
 * Aggregate the hourly rows over a window.
 *
 * A p95-of-hourly-p95s is not the true p95 for the window — the real one needs
 * the raw samples, which are deliberately not kept. What this answers is "how
 * bad did a typical bad hour get", which is the question a trend report should
 * ask anyway, and it is directly comparable between the two windows. The header
 * says so.
 */
async function windowStats(fromDaysAgo: number, toDaysAgo: number): Promise<Map<string, Window>> {
  const r = await adminPool.query<{
    route: string; n: string; dur_p95: string; dur_max: string;
    db_p95: string; bytes_max: string; n_4xx: string; n_5xx: string;
  }>(
    `SELECT method || ' ' || route AS route,
            sum(n)::text                       AS n,
            max(dur_p95)::text                 AS dur_p95,
            max(dur_max)::text                 AS dur_max,
            max(db_p95)::text                  AS db_p95,
            max(bytes_max)::text               AS bytes_max,
            sum(n_4xx)::text                   AS n_4xx,
            sum(n_5xx)::text                   AS n_5xx
       FROM request_metrics
      WHERE bucket_start >= now() - ($1 || ' days')::interval
        AND bucket_start <  now() - ($2 || ' days')::interval
      GROUP BY 1`,
    [String(fromDaysAgo), String(toDaysAgo)]
  );
  const out = new Map<string, Window>();
  for (const row of r.rows) {
    out.set(row.route, {
      route: row.route,
      n: Number(row.n),
      durP95: Number(row.dur_p95),
      durMax: Number(row.dur_max),
      dbP95: Number(row.db_p95),
      bytesMax: Number(row.bytes_max),
      n4xx: Number(row.n_4xx),
      n5xx: Number(row.n_5xx),
    });
  }
  return out;
}

function delta(now: number, before: number | undefined): string {
  if (before === undefined || before === 0) return 'new';
  const pctChange = Math.round(((now - before) / before) * 100);
  if (pctChange > 0) return `+${pctChange}%`;
  return `${pctChange}%`;
}

function parseDays(argv: string[]): number {
  const i = argv.indexOf('--days');
  if (i === -1) return 7;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1 || n > 90) {
    throw new Error('--days wants an integer between 1 and 90');
  }
  return n;
}

async function main(): Promise<void> {
  const days = parseDays(process.argv.slice(2));
  // Two equal windows back to back, so the deltas compare like with like.
  const [current, previous] = await Promise.all([
    windowStats(days, 0),
    windowStats(days * 2, days),
  ]);
  if (current.size === 0) {
    console.log(`No request_metrics rows in the last ${days} day(s) — nothing to report.`);
    return;
  }

  const ranked = [...current.values()]
    .filter((w) => w.n >= MIN_N)
    .sort((a, b) => b.durP95 - a.durP95)
    .slice(0, TOP_N);

  const totalReq = [...current.values()].reduce((s, w) => s + w.n, 0);
  const total5xx = [...current.values()].reduce((s, w) => s + w.n5xx, 0);
  // Biggest regressions by worst-hour p95, restricted to routes present in both
  // windows so a newly added route never reads as a regression.
  const regressions = [...current.values()]
    .filter((w) => w.n >= MIN_N && previous.has(w.route))
    .map((w) => ({ w, before: previous.get(w.route)!.durP95 }))
    .filter((x) => x.before > 0 && x.w.durP95 > x.before * 1.5 && x.w.durP95 - x.before >= 50)
    .sort((a, b) => b.w.durP95 / b.before - a.w.durP95 / a.before)
    .slice(0, 5);

  console.log(`${totalReq} requests over ${days} day(s), ${total5xx} 5xx.`);
  console.log(
    'Figures are the worst hour in the window (max of the hourly p95), not a true ' +
      `${days}-day p95 — comparable between windows, which is what the deltas use.`
  );
  console.log('');
  console.log('Worst routes by p95:');
  for (const w of ranked) {
    console.log(
      `${String(w.durP95).padStart(6)}ms p95 (${delta(w.durP95, previous.get(w.route)?.durP95).padStart(5)})  ` +
        `${String(w.durMax).padStart(6)}ms max  db ${String(w.dbP95).padStart(5)}ms  ` +
        `n=${String(w.n).padStart(5)}  5xx=${String(w.n5xx).padStart(3)}  ${w.route}`
    );
  }
  console.log('');
  if (regressions.length) {
    console.log(`Regressions vs the previous ${days} day(s):`);
    for (const x of regressions) {
      console.log(`  ${x.w.route}: ${x.before}ms -> ${x.w.durP95}ms`);
    }
  } else {
    console.log(`No route regressed by more than 50% vs the previous ${days} day(s).`);
  }
}

main()
  .then(() => adminPool.end())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await adminPool.end().catch(() => {});
    process.exit(1);
  });
