import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// One JSON per namespace per language under ./locales/<lng>/<ns>.json, eagerly
// bundled so i18next initialises synchronously (no Suspense flash).
const modules = import.meta.glob('./locales/*/*.json', { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;

type Resources = Record<string, Record<string, Record<string, unknown>>>;
const resources: Resources = {};
for (const [path, mod] of Object.entries(modules)) {
  const m = /\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!m) continue;
  const lng = m[1];
  const ns = m[2];
  if (!lng || !ns) continue;
  (resources[lng] ??= {})[ns] = mod.default;
}

export type Lang = 'it' | 'en';
export const LANGS: Lang[] = ['it', 'en'];
const STORAGE_KEY = 'sonoqui.partner.lang';

function detectBrowser(): Lang {
  try {
    const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const p of prefs) {
      const base = p?.toLowerCase().split('-')[0];
      if (base === 'it') return 'it';
      if (base === 'en') return 'en';
    }
  } catch { /* ignore */ }
  return 'it';
}

function detectInitial(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'it' || v === 'en') return v;
  } catch { /* ignore */ }
  return detectBrowser();
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectInitial(),
  fallbackLng: 'it',
  defaultNS: 'common',
  ns: Object.keys(resources.it ?? {}),
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLanguage(lng: Lang): Promise<unknown> {
  try { localStorage.setItem(STORAGE_KEY, lng); } catch { /* ignore */ }
  return i18n.changeLanguage(lng);
}

export function currentLang(): Lang {
  return i18n.language === 'en' ? 'en' : 'it';
}

export default i18n;
