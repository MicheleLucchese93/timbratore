import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

const site = 'https://sonoqui.pro';
// Build-time date for content pages so the sitemap reflects each deploy instead
// of a frozen string; legal pages carry their own (rarely-changing) date.
const buildDate = new Date();
const legalLastmod = new Date('2026-06-16T00:00:00.000Z');
const isLegal = (url) =>
  url.includes('/privacy-policy/') ||
  url.includes('/cookie-policy/') ||
  url.includes('/termini-e-condizioni/') ||
  url.includes('/eula/');

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
        if (isLegal(item.url)) {
          return { ...item, changefreq: 'yearly', lastmod: legalLastmod, priority: 0.2 };
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
