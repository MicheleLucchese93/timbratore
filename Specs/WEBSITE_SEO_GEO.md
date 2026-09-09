# Website SEO / GEO — action plan and conventions

Living document for `apps/website` (sonoqui.pro). Read by the daily
`sonoqui-prod-log-triage` routine on its weekly SEO step. Keep the backlog
honest: an item is either done (with a date), owned by a person, or owned by
the routine. No "someday" bucket.

Audit: 2026-09-09 (`/seo audit https://sonoqui.pro`, claude-seo skill +
manual passes; Googlebot never fetched the content pages, PSI quota was
exhausted so performance is lab/static only, no GSC/CrUX access).

## Scores (estimates — no field data)

| Category (weight)          | Before | After 2026-09-09 | Notes |
|----------------------------|-------:|-----------------:|-------|
| Technical (22%)            | 72     | 84  | HSTS added; CSP still missing; www→apex still 2 hops |
| Content (23%)              | 58     | 80  | dates/author/sources/table; buyer guide 889 → 1,697 words |
| On-page (20%)              | 70     | 82  | contextual inlinks from homepage; anchors; page-specific FAQs |
| Schema (10%)               | 74     | 90  | @id graph, Article, hasOfferCatalog, ItemList urls |
| Performance (10%)          | 65     | 78  | hero variants, logo, font preload, Turnstile lazy |
| AI readiness (10%)         | 46     | 74  | citable 134–167-word blocks, sources, dates, Content-Signal |
| Images (5%)                | 60     | 80  | 354 KB logo gone; hero srcset |
| **Health score**           | **65** | **81** | weighted per claude-seo methodology |

Re-score only with evidence (GSC impressions, Googlebot fetches, PostHog
`seoLandingPages`), not by re-reading the code.

## Conventions (quality gates — do not regress)

- Italian only. No `en` pages, no hreflang beyond `it` + `x-default`.
- **Dates come from one registry**: `apps/website/src/data/revisions.mjs`.
  Visible `<time>`, schema `datePublished`/`dateModified`, sitemap `lastmod`
  all read it. Bump `updated` ONLY when the page's copy changes. Never write a
  date by hand in a template or in JSON-LD. The sitemap build throws on an
  unregistered page — that is intentional.
- Schema: never `HowTo`; keep `FAQPage` (no Google rich result since May 2026,
  kept for AI citability); never `aggregateRating`/reviews we don't have;
  Organization deliberately omits `legalName`/address/VAT (see
  `project_website_legal_status`); site-wide entities are referenced by
  `@id` (`https://sonoqui.pro/#organization`, `#website`), not re-embedded.
- Buyer guide: competitor facts only from the vendors' public pages, "n.d."
  where undeclared. No invented prices, no ratings, no "best" claims without
  the conditional framing already used.
- Legal claims (Statuto art. 4, CGUE C-55/18, GDPR) must cite a primary
  source in the page's `sources`. New rulings (e.g. Tribunale di Cosenza n.
  972/2026) ship only after the user's legal review.
- CTAs never promise a trial: there is no self-serve signup. "Richiedi
  l'attivazione" / "Richiedi l'accesso".
- Hero images: regenerate variants with `npm run images:hero -w sonoqui-website`
  after replacing `public/screenshots/{storico,timbra}.webp`.
- `robots.txt`: `Content-Signal` per named group; GPTBot/ClaudeBot/CCBot
  stay disallowed (product decision, revisit if AI referrals matter).
- Never commit PostHog personal keys (`~/.config/sonoqui/posthog.env`).
- After every website deploy: `node apps/website/scripts/indexnow-submit.mjs`
  (Bing/Yandex/Naver; Google ignores IndexNow).

## Adding a content page

1. Register `{ published, updated }` in `revisions.mjs` (`CONTENT_REVISIONS`).
2. Add the page to `contentPages` in `src/data/seo.ts` (title with the
   query's own words, intro that front-loads the answer, `sources`,
   page-specific FAQ answers — no verbatim reuse of `homeFaq` beyond the
   canonical answers).
3. Link it from a homepage feature card (`Features.astro`) — the footer link
   alone is not an inlink Googlebot acts on.
4. `npm run build -w sonoqui-website` (sitemap throws if step 1 was skipped),
   deploy, IndexNow, then ask the user to "Request indexing" in GSC.

## Backlog

### Owner: user (needs an account we don't automate)

- [ ] **GSC — Request indexing** for `/it/timbratura-gps-app/`,
      `/it/rilevazione-presenze-pmi/`,
      `/it/migliori-app-rilevazione-presenze-2026/`, `/it/partner/`; confirm
      the sitemap is (re)submitted. Highest-leverage item: nothing else
      matters until Googlebot fetches these URLs.
- [ ] **PostHog personal API key** → `~/.config/sonoqui/posthog.env` (scopes
      `query:read project:read event_definition:read insight:read`, project
      260322). Unblocks `node apps/website/scripts/posthog-report.mjs`.
- [ ] Cloudflare: single-hop `www.sonoqui.pro` → `https://sonoqui.pro/…`
      redirect rule (today http→https→apex = 2 hops).
- [ ] Legal review of a possible "Timbratura GPS e giurisprudenza 2026" page
      (Cosenza n. 972 del 1 luglio 2026). Draft only on request.
- [ ] Brand-mention surfaces (GEO: mentions correlate ~3× more than backlinks
      with AI citations): a YouTube upload of the promo video with a
      description that names the product category; a LinkedIn company page.

### Owner: routine (weekly SEO step, code-only)

- [ ] `Content-Security-Policy-Report-Only` in `nginx.conf`. Needed sources:
      `default-src 'self'`; `script-src 'self' https://challenges.cloudflare.com`
      (Turnstile) + the inline `document.documentElement.classList.add("js")`
      snippet (hash it or move to a file); `connect-src 'self'
      https://sonoqui.pro/relay https://challenges.cloudflare.com`;
      `frame-src https://challenges.cloudflare.com https://player.vimeo.com`;
      `img-src 'self' data:`; `font-src 'self'`; `style-src 'self'
      'unsafe-inline'` (Tailwind inline styles). Ship Report-Only first, read
      the website container logs for a week, then enforce.
- [ ] Homepage heading hierarchy: feature cards are `h3` under an `h2` — fine;
      but `Moduli` / `Pricing` / `FAQ` sub-blocks mix `h3`/`p.font-bold`.
      Normalise to `h3`.
- [ ] Refresh cadence: each content page's copy (and `updated`) should move at
      least every ~90 days with a real change (recency ≈ 3× citation
      likelihood). Candidates: update the buyer-guide "verified" month, add a
      new FAQ from a real support ticket, add a screenshot ImageObject.
- [ ] Sector landing pages (cantieri, pulizie, ristorazione) — only if the
      PostHog `seoLandingPages` query shows organic entries on the existing
      pages first; ≥800 unique words each; no thin programmatic variants.
- [ ] Original data piece: anonymised, aggregate platform statistics (e.g. %
      of stamps outside the geofence, average correction rate) — needs a
      product decision on what may be published; ask, don't ship.

### Skipped on purpose

- Image sitemap (nine pages, screenshots already in `primaryImageOfPage`).
- `hreflang` beyond `it`/`x-default` (single-language site).
- RSL 1.0 licensing file (no measurable citation effect; revisit if an AI
  licensing signal becomes something crawlers act on).
- Person/author schema: the byline is the team, not an individual; do not
  invent a person.

## Leading indicators (check without re-auditing)

- Website container access log: `Googlebot` lines whose path starts with
  `/it/timbratura-gps-app/`, `/it/rilevazione-presenze-pmi/`,
  `/it/migliori-app-rilevazione-presenze-2026/` — first fetch = the
  inlink/lastmod fix worked; a 304 stream = normal.
- `node apps/website/scripts/posthog-report.mjs --days 7` →
  `seoLandingPages` (entries per content page by channel) and
  `contactForm` (`form_contatto_inviato` by `motivo`).
- Bing Webmaster (IndexNow) shows the URLs within a day of a submit.
- GSC (user): impressions for "migliori app rilevazione presenze",
  "rilevazione presenze pmi", "app timbratura gps".

## History

- 2026-06-22 — first SEO/GEO pass (schema, OG, llms.txt, webp). Commit 691a6ed.
- 2026-09-09 — full audit + this pass (dates registry, Article/@id schema,
  buyer-guide comparison, contextual inlinks, hero/logo/font/Turnstile
  performance work, HSTS, Content-Signal, IndexNow). Commit: see
  `git log --grep="SEO/GEO pass"`.
