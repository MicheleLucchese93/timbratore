import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getStoredLang, setStoredLang } from '../lib/api';
import { resources, NAMESPACES } from './resources';

export type Lang = 'it' | 'en';
export const LANGS: Lang[] = ['it', 'en'];

void i18n.use(initReactI18next).init({
  resources,
  lng: 'it',
  fallbackLng: 'it',
  defaultNS: 'common',
  ns: NAMESPACES as unknown as string[],
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Read the persisted choice once at startup and apply it. Resolves when done so
// the root layout can gate first paint and avoid a language flash.
export const i18nReady: Promise<void> = (async () => {
  try {
    const stored = await getStoredLang();
    if ((stored === 'it' || stored === 'en') && i18n.language !== stored) {
      await i18n.changeLanguage(stored);
    }
  } catch {
    /* default 'it' */
  }
})();

/** Persist + switch the UI language. Used by the language selector in Profilo. */
export function setLanguage(lng: Lang): Promise<unknown> {
  void setStoredLang(lng);
  return i18n.changeLanguage(lng);
}

/**
 * Reconcile the UI with the per-user preference returned by /me. The server is
 * the source of truth; the local cache only avoids a flash before /me resolves.
 */
export function applyServerLanguage(lng: Lang | null | undefined): void {
  if ((lng === 'it' || lng === 'en') && i18n.language !== lng) {
    void setStoredLang(lng);
    void i18n.changeLanguage(lng);
  }
}

export function currentLang(): Lang {
  return i18n.language === 'en' ? 'en' : 'it';
}

export default i18n;
