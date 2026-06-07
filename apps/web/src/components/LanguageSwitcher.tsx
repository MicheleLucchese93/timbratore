import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { setLanguage, type Lang, LANGS } from '../i18n/index.ts';

// The language is a per-user preference: switch the UI immediately, persist it
// locally, then sync to the server (PATCH /me). A failed sync is non-fatal —
// the choice still applies on this device and is retried on next change.
async function change(lng: Lang) {
  await setLanguage(lng);
  try {
    await api('/api/v1/me', { method: 'PATCH', json: { language: lng } });
  } catch {
    /* keep the local choice even if the server sync fails */
  }
}

/** Full-width labelled <select>, for the Settings page. */
export function LanguageSelect() {
  const { t, i18n } = useTranslation('common');
  const cur: Lang = i18n.language === 'en' ? 'en' : 'it';
  return (
    <select
      className="input"
      value={cur}
      onChange={(e) => void change(e.target.value as Lang)}
      aria-label={t('lang.label')}
    >
      {LANGS.map((l) => (
        <option key={l} value={l}>
          {t(`lang.${l}`)}
        </option>
      ))}
    </select>
  );
}

/** Compact IT|EN segmented toggle, for the sidebar footer (all roles). */
export function LanguageToggle({ collapsed }: { collapsed?: boolean }) {
  const { t, i18n } = useTranslation('common');
  const cur: Lang = i18n.language === 'en' ? 'en' : 'it';
  return (
    <div className="lang-toggle" role="group" aria-label={t('lang.label')} title={t('lang.label')}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          className={`lang-toggle-btn ${cur === l ? 'lang-toggle-btn-active' : ''}`}
          aria-pressed={cur === l}
          onClick={() => void change(l)}
        >
          {collapsed ? l.toUpperCase() : t(`lang.${l}`)}
        </button>
      ))}
    </div>
  );
}
