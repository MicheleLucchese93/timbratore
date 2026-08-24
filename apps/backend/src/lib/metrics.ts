import { createLogger } from './logger.js';

const logger = createLogger('metrics');

/**
 * In-process hourly latency aggregation, flushed to `request_metrics`.
 *
 * Why not just read the log: the container log is capped and reset on every
 * deploy — exactly when a regression appears — so "is this slower than last
 * week?" was unanswerable. Aggregates are written hourly so the answer survives
 * restarts, and the weekly digest diffs one window against the previous one.
 *
 * Nothing tenant- or user-identifying is kept here. That is what makes this
 * table safe to hold indefinitely; the http log line still carries tenant/uid
 * for tracing a specific slow request while it is retained.
 */

/** Samples kept per route per hour for percentile purposes. */
const SAMPLE_CAP = 2000;

/**
 * Hours retained in memory before the oldest is dropped.
 *
 * The flush job removes a bucket once it is safely persisted, so this only
 * matters when flushing is failing (database down) or not running at all
 * (SCHEDULER_ENABLED=false, i.e. dev). Either way memory must stay bounded, and
 * dropping the oldest hour is the right loss: the recent hours are the ones an
 * investigation needs.
 */
const MAX_BUCKETS = 26;

/** Distinct routes tracked per hour. Real surface is ~30; the cap stops a
 *  path-scanning bot from turning unmatched URLs into unbounded keys. */
const MAX_KEYS = 500;

interface RouteStats {
  n: number;
  dur: number[];
  db: number[];
  bytesMax: number;
  n4xx: number;
  n5xx: number;
}

export interface MetricSample {
  method: string;
  route: string;
  status: number;
  durMs: number;
  dbMs: number;
  bytes: number;
}

// hour epoch (ms / 3_600_000) → "METHOD route" → stats
const buckets = new Map<number, Map<string, RouteStats>>();

export function recordRequest(s: MetricSample, at: number = Date.now()): void {
  const hour = Math.floor(at / 3_600_000);
  let bucket = buckets.get(hour);
  if (!bucket) {
    bucket = new Map();
    buckets.set(hour, bucket);
    while (buckets.size > MAX_BUCKETS) {
      const oldest = Math.min(...buckets.keys());
      buckets.delete(oldest);
      logger.warn({ hour: oldest }, 'metrics bucket dropped unflushed (retention cap)');
    }
  }
  const key = `${s.method} ${s.route}`;
  let st = bucket.get(key);
  if (!st) {
    if (bucket.size >= MAX_KEYS) return;
    st = { n: 0, dur: [], db: [], bytesMax: 0, n4xx: 0, n5xx: 0 };
    bucket.set(key, st);
  }
  st.n += 1;
  // Past the cap the counters and the max stay exact; only the percentile
  // sample stops growing. At this traffic the cap is never reached.
  if (st.dur.length < SAMPLE_CAP) {
    st.dur.push(s.durMs);
    st.db.push(s.dbMs);
  }
  if (s.bytes > st.bytesMax) st.bytesMax = s.bytes;
  if (s.status >= 500) st.n5xx += 1;
  else if (s.status >= 400) st.n4xx += 1;
}

export interface MetricRow {
  bucketStart: Date;
  method: string;
  route: string;
  n: number;
  durP50: number;
  durP95: number;
  durMax: number;
  dbP50: number;
  dbP95: number;
  dbMax: number;
  bytesMax: number;
  n4xx: number;
  n5xx: number;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  // Nearest-rank: index of the first value at or above the p-th position.
  const i = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, i)]!;
}

/**
 * Rows for every hour that has closed, i.e. every bucket before `now`'s hour.
 * The open hour is left alone so it is never written twice with partial data.
 */
export function closedBuckets(now: number = Date.now()): { hour: number; rows: MetricRow[] }[] {
  const currentHour = Math.floor(now / 3_600_000);
  const out: { hour: number; rows: MetricRow[] }[] = [];
  for (const hour of [...buckets.keys()].sort((a, b) => a - b)) {
    if (hour >= currentHour) continue;
    const bucket = buckets.get(hour)!;
    const rows: MetricRow[] = [];
    for (const [key, st] of bucket) {
      const sp = key.indexOf(' ');
      const dur = [...st.dur].sort((a, b) => a - b);
      const db = [...st.db].sort((a, b) => a - b);
      rows.push({
        bucketStart: new Date(hour * 3_600_000),
        method: key.slice(0, sp),
        route: key.slice(sp + 1),
        n: st.n,
        durP50: pct(dur, 0.5),
        durP95: pct(dur, 0.95),
        durMax: dur[dur.length - 1] ?? 0,
        dbP50: pct(db, 0.5),
        dbP95: pct(db, 0.95),
        dbMax: db[db.length - 1] ?? 0,
        bytesMax: st.bytesMax,
        n4xx: st.n4xx,
        n5xx: st.n5xx,
      });
    }
    out.push({ hour, rows });
  }
  return out;
}

/** Called only after the rows are committed — an unflushed bucket must survive. */
export function dropBucket(hour: number): void {
  buckets.delete(hour);
}

/** Test seam. */
export function resetMetrics(): void {
  buckets.clear();
}
