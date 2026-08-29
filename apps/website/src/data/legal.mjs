// Single source of truth for legal-page revision dates.
//
// The same date used to live in three places that drift apart silently: the
// `lastUpdated` string printed on the page, the `isoDate` feeding schema.org
// `dateModified`, and the sitemap's per-page `lastmod` in astro.config.mjs.
// Nothing cross-checks them, so on 2026-08-29 the privacy policy had all three
// disagreeing at once — visible "25 agosto 2026", schema 2026-06-16, sitemap
// 2026-06-16. Edit an entry here and every consumer follows.
//
// Plain .mjs rather than .ts: astro.config.mjs imports this as well, and the
// config is loaded outside the app's TypeScript pipeline.

/**
 * Slug (matching the page's URL segment and its `legalMeta` key) -> revision.
 * `date` is an ISO calendar date; it is rendered for humans, emitted as
 * schema.org `dateModified`, and used as the sitemap `lastmod`.
 *
 * @type {Record<string, { version: string; date: string }>}
 */
export const LEGAL_REVISIONS = {
  'privacy-policy': { version: '1.3', date: '2026-08-29' },
  'cookie-policy': { version: '1.4', date: '2026-08-29' },
  'termini-e-condizioni': { version: '1.1', date: '2026-06-16' },
  eula: { version: '1.1', date: '2026-06-16' },
};

/** @param {string} slug */
export function legalRevision(slug) {
  const revision = LEGAL_REVISIONS[slug];
  if (!revision) {
    // Fail the build rather than quietly shipping an undated legal page.
    throw new Error(`No legal revision registered for "${slug}" — add it to src/data/legal.mjs`);
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

/** @param {string} slug */
export function legalDate(slug) {
  return new Date(`${legalRevision(slug).date}T00:00:00.000Z`);
}

/**
 * The visible revision line, e.g. "29 agosto 2026 · v1.4".
 * @param {string} slug
 */
export function legalLastUpdated(slug) {
  return `${dateFormatter.format(legalDate(slug))} · v${legalRevision(slug).version}`;
}
