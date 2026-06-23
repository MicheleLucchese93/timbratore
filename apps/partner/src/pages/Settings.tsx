import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/PageHeader.tsx';
import { LANGS, setLanguage, currentLang, type Lang } from '../i18n/index.ts';

const LABELS: Record<Lang, string> = { it: 'Italiano', en: 'English' };

export function Settings() {
  const { t, i18n } = useTranslation();
  void i18n.language; // re-render on language change
  const cur = currentLang();
  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className="card" style={{ padding: '1.25rem', maxWidth: 460 }}>
        <div className="label">{t('settings.language')}</div>
        <div className="lang-options">
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              data-testid={`lang-${l}`}
              className={`lang-option ${cur === l ? 'is-active' : ''}`}
              aria-pressed={cur === l}
              onClick={() => setLanguage(l)}
            >
              {LABELS[l]}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
