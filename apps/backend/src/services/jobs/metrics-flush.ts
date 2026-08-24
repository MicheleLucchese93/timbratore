import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';
import { closedBuckets, dropBucket, type MetricRow } from '../../lib/metrics.js';
import { env } from '../../env.js';
import { sendMail } from '../../lib/mailer.js';
import { escapeHtml } from '../../lib/mailer.js';

const logger = createLogger('metrics_flush');

/** Hours of history kept. Rows are ~30 per hour, so a year would still be small;
 *  90 days is long enough to answer "was it always like this?" without becoming
 *  a table nobody prunes. */
const RETAIN_DAYS = 90;

/** Per-route cooldown between alert mails, so a route that stays slow reports
 *  once every 6h rather than every hour. In-memory: a deploy resets it, which at
 *  worst costs one extra mail. */
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const lastAlert = new Map<string, number>();

/** Requests needed in the hour before a p95 is worth alerting on — two slow
 *  calls are noise, not a trend. */
const ALERT_MIN_N = 5;

export async function flushRequestMetrics(now: number = Date.now()): Promise<void> {
  const pending = closedBuckets(now);
  if (pending.length === 0) return;

  for (const { hour, rows } of pending) {
    if (rows.length === 0) {
      dropBucket(hour);
      continue;
    }
    // ON CONFLICT DO NOTHING, deliberately NOT DO UPDATE.
    //
    // A bucket is removed from memory only after its whole hour committed, so a
    // conflict can only mean "this hour is already on record". Keeping the
    // stored row is then always right, and it closes a destructive edge case:
    // with DO UPDATE SET n = EXCLUDED.n, a single straggler recorded into an
    // already-flushed hour (a backwards NTP step is the only way to get one)
    // would replace that hour's 40-request row with a 1-request row. Losing a
    // late sample is the correct trade against losing the hour.
    const values: unknown[] = [];
    const tuples = rows.map((r, i) => {
      const b = i * 13;
      values.push(
        r.bucketStart, r.method, r.route, r.n,
        r.durP50, r.durP95, r.durMax,
        r.dbP50, r.dbP95, r.dbMax,
        r.bytesMax, r.n4xx, r.n5xx
      );
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13})`;
    });
    const ins = await adminPool.query(
      `INSERT INTO request_metrics
         (bucket_start, method, route, n, dur_p50, dur_p95, dur_max,
          db_p50, db_p95, db_max, bytes_max, n_4xx, n_5xx)
       VALUES ${tuples.join(',')}
       ON CONFLICT (bucket_start, method, route) DO NOTHING`,
      values
    );
    if ((ins.rowCount ?? 0) < rows.length) {
      logger.warn(
        { hour: new Date(hour * 3_600_000).toISOString(), offered: rows.length, inserted: ins.rowCount },
        'some metric rows already on record, kept the stored values'
      );
    }
    // Only now: an unpersisted bucket must stay in memory for the next attempt.
    dropBucket(hour);
    logger.info({ hour: new Date(hour * 3_600_000).toISOString(), routes: rows.length }, 'metrics flushed');
    await alertOnBreaches(rows, now);
  }

  const purged = await adminPool.query(
    `DELETE FROM request_metrics WHERE bucket_start < now() - ($1 || ' days')::interval`,
    [String(RETAIN_DAYS)]
  );
  if (purged.rowCount) logger.info({ rows: purged.rowCount }, 'old metric rows purged');
}

/**
 * Mail the routes whose p95 crossed the threshold in the hour just closed.
 *
 * Failures are logged and swallowed: an alert that cannot be delivered must not
 * make the flush retry and re-alert the following hour.
 */
async function alertOnBreaches(rows: MetricRow[], now: number): Promise<void> {
  if (env.PERF_ALERT_P95_MS <= 0) return;
  const to = env.PERF_DIGEST_TO || env.SUPER_ADMIN_EMAIL;
  const breaches = rows
    .filter((r) => r.n >= ALERT_MIN_N && r.durP95 >= env.PERF_ALERT_P95_MS)
    .filter((r) => now - (lastAlert.get(`${r.method} ${r.route}`) ?? 0) >= ALERT_COOLDOWN_MS)
    .sort((a, b) => b.durP95 - a.durP95);
  if (breaches.length === 0) return;

  const hour = rows[0]!.bucketStart.toISOString().slice(0, 16).replace('T', ' ');
  const lines = breaches.map(
    (r) => `${r.method} ${r.route} — p95 ${r.durP95}ms (db ${r.dbP95}ms), max ${r.durMax}ms, n=${r.n}`
  );
  const ok = await sendMail({
    to,
    subject: `[sonoQui] ${breaches.length} slow route${breaches.length > 1 ? 's' : ''} at ${hour}Z`,
    text: `Routes over ${env.PERF_ALERT_P95_MS}ms p95 in the hour starting ${hour}Z:\n\n${lines.join('\n')}\n`,
    html:
      `<p>Routes over ${env.PERF_ALERT_P95_MS}ms p95 in the hour starting ${escapeHtml(hour)}Z:</p><ul>` +
      breaches
        .map(
          (r) =>
            `<li><code>${escapeHtml(`${r.method} ${r.route}`)}</code> — p95 <b>${r.durP95}ms</b> ` +
            `(db ${r.dbP95}ms), max ${r.durMax}ms, n=${r.n}</li>`
        )
        .join('') +
      `</ul>`,
  }).catch((err) => {
    logger.error({ err }, 'perf alert mail failed');
    return false;
  });
  // Mark regardless of delivery: a broken SMTP must not turn into an hourly
  // retry loop against Brevo.
  for (const r of breaches) lastAlert.set(`${r.method} ${r.route}`, now);
  logger.warn({ routes: breaches.length, mailed: ok }, 'perf threshold breached');
}
