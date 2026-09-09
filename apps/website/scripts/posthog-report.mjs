#!/usr/bin/env node
// Marketing-site analytics report straight from the PostHog API — no browser.
//
//   npm -w apps/website run analytics:report            # last 7 days
//   npm -w apps/website run analytics:report -- --days 30
//   node apps/website/scripts/posthog-report.mjs --json # machine-readable
//
// Reads a PostHog *personal* API key (phx_…, read scopes only) from
// ~/.config/sonoqui/posthog.env — deliberately outside the repo, because the
// repo's .env is fed to docker build args and this key must never reach an
// image. Environment variables of the same names override the file.
//
// Every query is independent: one failing (a renamed column, a HogQL change)
// prints its error and the rest still run, so the daily routine always gets a
// partial report rather than nothing.
//
// The exclusions mirror the project's "Filter out internal and test users"
// rules: HogQL does not apply those automatically, so they are repeated here.
// Keep the two in step.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENV_FILE = join(homedir(), ".config", "sonoqui", "posthog.env");

function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // Missing file is fine when the variables come from the environment.
  }
  return { ...out, ...process.env };
}

const env = loadEnv();
const HOST = (env.POSTHOG_HOST || "https://eu.posthog.com").replace(/\/$/, "");
const PROJECT = env.POSTHOG_PROJECT_ID || "260322";
const KEY = env.POSTHOG_PERSONAL_API_KEY;

const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf("--days") + 1]) || 7;
const JSON_OUT = args.includes("--json");

if (!KEY || !KEY.startsWith("phx_")) {
  console.error(
    `No personal API key. Put POSTHOG_PERSONAL_API_KEY=phx_… in ${ENV_FILE}\n` +
      `(PostHog → Settings → Personal API keys; scopes: query:read, project:read, ` +
      `event_definition:read, insight:read; restrict to project ${PROJECT}).`,
  );
  process.exit(2);
}

// The same rules as the project's test-account filter, expressed in HogQL.
const EXCLUDE =
  "properties.$current_url NOT ILIKE '%localhost%' " +
  "AND properties.$current_url NOT ILIKE '%probe=%' " +
  "AND properties.$current_url NOT ILIKE '%cachebust=%' " +
  "AND properties.$current_url NOT ILIKE '%custodo.ai%' " +
  // Local dev of other projects that briefly shipped this token, and the
  // pre-cutover xdevapp host: neither is caught by "localhost".
  "AND properties.$current_url NOT ILIKE '%127.0.0.1%' " +
  "AND properties.$current_url NOT ILIKE '%xdevapp.it%'";
const WINDOW = `timestamp > now() - interval ${DAYS} day`;

async function hogql(query) {
  const res = await fetch(`${HOST}/api/projects/${PROJECT}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${body.detail || body.error || JSON.stringify(body).slice(0, 200)}`);
  return { columns: body.columns ?? [], rows: body.results ?? [] };
}

const QUERIES = {
  // Visitors = people with a $pageview, not people with any event: the SDK
  // defers the initial $pageview while the tab is hidden, so background-tab
  // visits emit only $pageleave/$web_vitals and were inflating visitors above
  // pageviews (8 vs 6 on 2026-09-07).
  overview: `
    select
      uniqIf(distinct_id, event = '$pageview') as visitors,
      countIf(event = '$pageview') as pageviews,
      uniq(properties.$session_id) as sessions
    from events
    where ${WINDOW} and ${EXCLUDE}`,

  byDay: `
    select toDate(timestamp) as day,
      uniqIf(distinct_id, event = '$pageview') as visitors,
      countIf(event = '$pageview') as pageviews
    from events
    where ${WINDOW} and ${EXCLUDE}
    group by day order by day`,

  topPaths: `
    select properties.$pathname as path,
      uniqIf(distinct_id, event = '$pageview') as visitors,
      count() as views
    from events
    where event = '$pageview' and ${WINDOW} and ${EXCLUDE}
    group by path order by views desc limit 15`,

  channels: `
    select $channel_type as channel,
      count() as sessions,
      countIf($is_bounce) as bounced
    from sessions
    where $start_timestamp > now() - interval ${DAYS} day
      and $entry_current_url NOT ILIKE '%localhost%'
      and $entry_current_url NOT ILIKE '%probe=%'
      and $entry_current_url NOT ILIKE '%cachebust=%'
      and $entry_current_url NOT ILIKE '%custodo.ai%'
    group by channel order by sessions desc`,

  referrers: `
    select properties.$referring_domain as referrer, uniqIf(distinct_id, event = '$pageview') as visitors
    from events
    where event = '$pageview' and ${WINDOW} and ${EXCLUDE}
      and properties.$referring_domain != '$direct' and properties.$referring_domain is not null
    group by referrer order by visitors desc limit 10`,

  utm: `
    select properties.utm_source as source, properties.utm_medium as medium,
      properties.utm_campaign as campaign, uniqIf(distinct_id, event = '$pageview') as visitors
    from events
    where event = '$pageview' and ${WINDOW} and ${EXCLUDE} and properties.utm_source is not null
    group by source, medium, campaign order by visitors desc limit 10`,

  devices: `
    select properties.$device_type as device, uniqIf(distinct_id, event = '$pageview') as visitors
    from events
    where event = '$pageview' and ${WINDOW} and ${EXCLUDE}
    group by device order by visitors desc`,

  contactForm: `
    select event, properties.motivo as motivo, count() as n
    from events
    where event in ('form_contatto_inviato', 'form_contatto_errore') and ${WINDOW} and ${EXCLUDE}
    group by event, motivo order by event, n desc`,

  seoLandingPages: `
    select properties.$pathname as path, uniqIf(distinct_id, event = '$pageview') as visitors, count() as views
    from events
    where event = '$pageview' and ${WINDOW} and ${EXCLUDE}
      and (properties.$pathname ILIKE '/it/timbratura-gps-app%'
        or properties.$pathname ILIKE '/it/rilevazione-presenze-pmi%'
        or properties.$pathname ILIKE '/it/migliori-app-rilevazione-presenze-2026%')
    group by path order by views desc`,

  frustration: `
    select event, properties.$pathname as path, count() as n
    from events
    where event in ('$rageclick', '$dead_click') and ${WINDOW} and ${EXCLUDE}
    group by event, path order by n desc limit 10`,

  contamination: `
    select properties.$host as host, count() as n, max(timestamp) as last_seen
    from events
    where ${WINDOW} and properties.$host NOT ILIKE '%sonoqui.pro%' and properties.$host NOT ILIKE '%localhost%'
    group by host order by n desc`,
};

function table({ columns, rows }) {
  if (!rows.length) return "  (none)";
  const w = columns.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i] ?? "").length)));
  const line = (r) => "  " + r.map((v, i) => String(v ?? "").padEnd(w[i])).join("  ");
  return [line(columns), "  " + w.map((n) => "-".repeat(n)).join("  "), ...rows.map(line)].join("\n");
}

const results = {};
for (const [name, query] of Object.entries(QUERIES)) {
  try {
    results[name] = await hogql(query);
  } catch (err) {
    results[name] = { error: String(err.message || err) };
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ project: PROJECT, days: DAYS, generatedAt: new Date().toISOString(), results }, null, 2));
  process.exit(0);
}

const section = (title, key) => {
  const r = results[key];
  console.log(`\n## ${title}`);
  console.log(r.error ? `  ERROR: ${r.error}` : table(r));
};

console.log(`# sonoqui.pro — PostHog report, last ${DAYS} days (project ${PROJECT}, ${new Date().toISOString().slice(0, 16)}Z)`);
console.log(`Exclusions applied: localhost, probe=, cachebust=, custodo.ai`);
section("Overview", "overview");
section("By day", "byDay");
section("Top paths", "topPaths");
section("Channels (sessions table)", "channels");
section("Referrers", "referrers");
section("UTM campaigns", "utm");
section("Devices", "devices");
section("Contact form — inviato / errore by motivo", "contactForm");
section("SEO landing pages (should not be empty)", "seoLandingPages");
section("Frustration signals (rage / dead clicks)", "frustration");
section("Contamination check — hosts that are not sonoqui.pro (should be empty)", "contamination");
