import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Catalogs are split one JSON per namespace per language under ./locales/<lng>/<ns>.json.
// Vite eagerly bundles them so i18next initialises synchronously (no Suspense, no flash).
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
const STORAGE_KEY = 'sonoqui.lang';

// Map the browser's preferred languages to a supported UI language. Walk the
// ordered navigator list and take the first IT or EN match; anything else
// (French, German, …) falls back to English.
function detectBrowser(): Lang {
  try {
    const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const p of prefs) {
      const base = p?.toLowerCase().split('-')[0];
      if (base === 'it') return 'it';
      if (base === 'en') return 'en';
    }
  } catch {
    /* ignore */
  }
  return 'en';
}

// Initial language, highest priority first: an explicit prior choice cached in
// localStorage, otherwise the browser's language (EN for non-IT/EN browsers).
// The per-user server preference, once known, is reconciled by
// applyServerLanguage after /me resolves.
function detectInitial(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'it' || v === 'en') return v;
  } catch {
    /* ignore */
  }
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

/** Persist + switch the UI language. Used by the language selector. */
export function setLanguage(lng: Lang): Promise<unknown> {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* ignore */
  }
  return i18n.changeLanguage(lng);
}

/**
 * Reconcile the UI with the per-user preference returned by /me. The server is
 * the source of truth for the user's language; the local cache only avoids a
 * flash on first paint before /me resolves.
 */
export function applyServerLanguage(lng: Lang | null | undefined): void {
  if ((lng === 'it' || lng === 'en') && i18n.language !== lng) {
    try {
      localStorage.setItem(STORAGE_KEY, lng);
    } catch {
      /* ignore */
    }
    void i18n.changeLanguage(lng);
  }
}

export function currentLang(): Lang {
  return i18n.language === 'en' ? 'en' : 'it';
}

export default i18n;
