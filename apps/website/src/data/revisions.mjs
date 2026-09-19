// Single source of truth for page revision dates — legal pages AND content
// pages. (Formerly legal.mjs; widened when the content pages gained visible
// dates, because a second registry would have reintroduced the exact drift a
// single one exists to prevent.)
//
// The same date used to live in three places that drift apart silently: the
// `lastUpdated` string printed on the page, the `isoDate` feeding schema.org
// `dateModified`, and the sitemap's per-page `lastmod` in astro.config.mjs.
// Nothing cross-checks them, so on 2026-08-29 the privacy policy had all three
// disagreeing at once. Edit an entry here and every consumer follows.
//
// Plain .mjs rather than .ts: astro.config.mjs imports this as well, and the
// config is loaded outside the app's TypeScript pipeline.

/**
 * Legal pages: slug -> revision. `date` is rendered for humans, emitted as
 * schema.org `dateModified`, and used as the sitemap `lastmod`.
 *
 * @type {Record<string, { version: string; date: string }>}
 */
export const LEGAL_REVISIONS = {
  // 2.0 (2026-09-18): self-service signup, subscriptions and Stripe payments,
  // seller Idealcopy S.r.l. Keep the dates in step with LEGAL_VERSIONS in
  // packages/shared/src/billing (what legal_acceptances records at signup).
  'privacy-policy': { version: '2.1', date: '2026-09-19' },
  'cookie-policy': { version: '1.4', date: '2026-08-29' },
  'termini-e-condizioni': { version: '2.1', date: '2026-09-19' },
  eula: { version: '1.1', date: '2026-06-16' },
  dpa: { version: '1.1', date: '2026-09-19' },
};

/**
 * Content / landing pages: slug -> { published, updated }. `updated` is what
 * the page shows as "Aggiornato il", what the Article node reports as
 * `dateModified`, and what the sitemap reports as `lastmod`. Bump it ONLY
 * when the page's copy actually changes — a lastmod that moves on every
 * deploy is exactly the signal search engines learn to ignore, and a visible
 * date that lies is worse than none.
 *
 * @type {Record<string, { published: string; updated: string }>}
 */
export const CONTENT_REVISIONS = {
  'timbratura-gps-app': { published: '2026-07-08', updated: '2026-09-18' },
  'rilevazione-presenze-pmi': { published: '2026-07-08', updated: '2026-09-18' },
  'migliori-app-rilevazione-presenze-2026': { published: '2026-07-08', updated: '2026-09-18' },
  partner: { published: '2026-06-23', updated: '2026-09-09' },
  // Self-service signup form (step 1 of Specs/SELF_SERVICE_BILLING.md §3.2).
  // Shows no visible date, so only the sitemap reads this entry.
  registrazione: { published: '2026-09-18', updated: '2026-09-18' },
};

/** @param {string} slug */
export function legalRevision(slug) {
  const revision = LEGAL_REVISIONS[slug];
  if (!revision) {
    // Fail the build rather than quietly shipping an undated legal page.
    throw new Error(`No legal revision registered for "${slug}" — add it to src/data/revisions.mjs`);
  }
  return revision;
}

/** @param {string} slug */
export function contentRevision(slug) {
  const revision = CONTENT_REVISIONS[slug];
  if (!revision) {
    throw new Error(`No content revision registered for "${slug}" — add it to src/data/revisions.mjs`);
  }
  return revision;
}

// Formatted in UTC on purpose. `new Date('2026-08-29T00:00:00.000Z')` is UTC
// midnight, so formatting it in any negative-offset zone would render the
// previous day — a build machine in the Americas would silently publish
// "28 agosto 2026" on a page dated 2026-08-29.
const dateFormatter = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** @param {string} isoDate  e.g. "2026-09-09" -> "9 settembre 2026" */
export function formatItDate(isoDate) {
  return dateFormatter.format(new Date(`${isoDate}T00:00:00.000Z`));
}

/** @param {string} slug */
export function legalDate(slug) {
  return new Date(`${legalRevision(slug).date}T00:00:00.000Z`);
}

/**
 * The visible revision line on legal pages, e.g. "29 agosto 2026 · v1.4".
 * @param {string} slug
 */
export function legalLastUpdated(slug) {
  return `${formatItDate(legalRevision(slug).date)} · v${legalRevision(slug).version}`;
}
