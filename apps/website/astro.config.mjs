import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

const site = 'https://sonoqui.xdevapp.it';
const lastmod = new Date('2026-05-28T00:00:00.000Z');

export default defineConfig({
  site,
  integrations: [
    sitemap({
      changefreq: 'weekly',
      lastmod,
      priority: 0.7,
      filter: (page) => page !== `${site}/`,
      serialize: (item) => {
        if (item.url.endsWith('/it/')) {
          return { ...item, priority: 1 };
        }
        if (
          item.url.includes('/privacy-policy/') ||
          item.url.includes('/cookie-policy/') ||
          item.url.includes('/termini-e-condizioni/') ||
          item.url.includes('/eula/')
        ) {
          return { ...item, changefreq: 'yearly', priority: 0.2 };
        }
        return { ...item, priority: 0.8 };
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
