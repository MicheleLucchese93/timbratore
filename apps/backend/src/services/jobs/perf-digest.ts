import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';
import { env } from '../../env.js';
import { sendMail, escapeHtml } from '../../lib/mailer.js';

const logger = createLogger('perf_digest');

/** Routes listed in the digest, worst p95 first. */
const TOP_N = 12;

/** A route needs this many requests in the week before its p95 means anything. */
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
 * A p95-of-hourly-p95s is not the true weekly p95 — the real one needs the raw
 * samples, which are deliberately not kept. What this answers is "how bad did a
 * typical bad hour get", which is the question a trend report should ask anyway,
 * and it is directly comparable between the two windows. The header says so.
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

export async function perfDigest(): Promise<void> {
  const [current, previous] = await Promise.all([windowStats(7, 0), windowStats(14, 7)]);
  if (current.size === 0) {
    logger.info('no metrics for the window, digest skipped');
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

  const head = `${totalReq} requests over 7 days, ${total5xx} 5xx.`;
  const note =
    'Figures are the worst hour in the window (max of the hourly p95), not a true weekly p95 — ' +
    'comparable between windows, which is what the deltas use.';

  const rowText = ranked
    .map(
      (w) =>
        `${String(w.durP95).padStart(6)}ms p95 (${delta(w.durP95, previous.get(w.route)?.durP95).padStart(5)})  ` +
        `${String(w.durMax).padStart(6)}ms max  db ${String(w.dbP95).padStart(5)}ms  n=${String(w.n).padStart(5)}  ${w.route}`
    )
    .join('\n');

  const text =
    `${head}\n${note}\n\nWorst routes by p95:\n${rowText}\n` +
    (regressions.length
      ? `\nRegressions vs the previous 7 days:\n` +
        regressions.map((x) => `  ${x.w.route}: ${x.before}ms -> ${x.w.durP95}ms`).join('\n') +
        '\n'
      : '\nNo route regressed by more than 50% vs the previous 7 days.\n');

  const html =
    `<p><b>${escapeHtml(head)}</b></p><p style="color:#555;font-size:13px">${escapeHtml(note)}</p>` +
    `<table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;font-family:monospace;font-size:13px">` +
    `<tr style="background:#f0f0f0"><th align="left">route</th><th align="right">p95</th><th align="right">Δ</th>` +
    `<th align="right">max</th><th align="right">db p95</th><th align="right">n</th><th align="right">5xx</th></tr>` +
    ranked
      .map(
        (w, i) =>
          `<tr style="background:${i % 2 ? '#fafafa' : '#fff'}">` +
          `<td>${escapeHtml(w.route)}</td><td align="right"><b>${w.durP95}ms</b></td>` +
          `<td align="right">${escapeHtml(delta(w.durP95, previous.get(w.route)?.durP95))}</td>` +
          `<td align="right">${w.durMax}ms</td><td align="right">${w.dbP95}ms</td>` +
          `<td align="right">${w.n}</td><td align="right">${w.n5xx || ''}</td></tr>`
      )
      .join('') +
    `</table>` +
    (regressions.length
      ? `<p><b>Regressions vs the previous 7 days</b></p><ul>` +
        regressions
          .map(
            (x) =>
              `<li><code>${escapeHtml(x.w.route)}</code>: ${x.before}ms → <b>${x.w.durP95}ms</b></li>`
          )
          .join('') +
        `</ul>`
      : `<p>No route regressed by more than 50% vs the previous 7 days.</p>`);

  const to = env.PERF_DIGEST_TO || env.SUPER_ADMIN_EMAIL;
  const sent = await sendMail({ to, subject: '[sonoQui] weekly performance digest', text, html });
  logger.info({ to, routes: ranked.length, regressions: regressions.length, sent }, 'perf digest sent');
}
