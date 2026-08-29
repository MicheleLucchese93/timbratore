import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import { LEGAL_REVISIONS } from './src/data/legal.mjs';

const site = 'https://sonoqui.pro';
// Build-time date for content pages so the sitemap reflects each deploy instead
// of a frozen string; legal pages carry their own (rarely-changing) date.
const buildDate = new Date();
// Legal pages date themselves from src/data/legal.mjs, the same registry
// LegalLayout renders from — so the sitemap `lastmod`, the schema.org
// `dateModified` and the date printed on the page cannot disagree. Registering
// a new legal page there also enrols it here automatically.
const legalLastmod = Object.entries(LEGAL_REVISIONS).map(
  ([slug, { date }]) => [`/${slug}/`, new Date(`${date}T00:00:00.000Z`)],
);
const legalEntry = (url) => legalLastmod.find(([path]) => url.includes(path));

export default defineConfig({
  site,
  integrations: [
    sitemap({
      changefreq: 'weekly',
      lastmod: buildDate,
      priority: 0.7,
      filter: (page) => page !== `${site}/`,
      serialize: (item) => {
        if (item.url.endsWith('/it/')) {
          return { ...item, lastmod: buildDate, priority: 1 };
        }
        const legal = legalEntry(item.url);
        if (legal) {
          return { ...item, changefreq: 'yearly', lastmod: legal[1], priority: 0.2 };
        }
        return { ...item, lastmod: buildDate, priority: 0.8 };
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
