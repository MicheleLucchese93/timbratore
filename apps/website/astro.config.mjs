import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import { LEGAL_REVISIONS, CONTENT_REVISIONS } from './src/data/revisions.mjs';

const site = 'https://sonoqui.pro';
// Only the homepage gets the build date as lastmod: it aggregates every section
// and genuinely changes on most deploys. Every other page reports the date its
// copy last changed, from the one registry LegalLayout and the content pages
// also render from (src/data/revisions.mjs) — so the sitemap `lastmod`, the
// schema.org dates and the date printed on the page cannot disagree.
//
// Stamping the build date on every URL was actively harmful: it told search
// engines that all nine pages changed on every deploy, which is precisely how
// `lastmod` gets discounted as noise — and the three content pages Google had
// never crawled were the ones paying for it.
const buildDate = new Date();
const toDate = (iso) => new Date(`${iso}T00:00:00.000Z`);
const registeredLastmod = [
  ...Object.entries(LEGAL_REVISIONS).map(([slug, { date }]) => [`/${slug}/`, toDate(date), true]),
  ...Object.entries(CONTENT_REVISIONS).map(([slug, { updated }]) => [`/${slug}/`, toDate(updated), false]),
];
const registered = (url) => registeredLastmod.find(([path]) => url.includes(path));

export default defineConfig({
  site,
  integrations: [
    // No `priority` / `changefreq`: Google has ignored both since 2020, and a
    // `priority: 1.0` that means nothing only misleads the next maintainer.
    sitemap({
      lastmod: buildDate,
      filter: (page) => page !== `${site}/`,
      serialize: (item) => {
        if (item.url.endsWith('/it/')) {
          return { ...item, lastmod: buildDate };
        }
        const entry = registered(item.url);
        if (entry) {
          return { ...item, lastmod: entry[1] };
        }
        // An unregistered non-home page would silently fall back to the build
        // date — the exact bug this replaces. Make the omission loud instead.
        throw new Error(`Sitemap: no revision registered for ${item.url} — add it to src/data/revisions.mjs`);
      },
    }),
  ],
  i18n: {
    defaultLocale: 'it',
    locales: ['it'],
    routing: { prefixDefaultLocale: true },
  },
  vite: { plugins: [tailwindcss()] },
});
