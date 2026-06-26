import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/PageHeader.tsx';
import { ChangePasswordModal } from '../components/ChangePasswordModal.tsx';
import { LANGS, setLanguage, currentLang, type Lang } from '../i18n/index.ts';

const LABELS: Record<Lang, string> = { it: 'Italiano', en: 'English' };

export function Settings() {
  const { t, i18n } = useTranslation();
  void i18n.language; // re-render on language change
  const cur = currentLang();
  const [pwOpen, setPwOpen] = useState(false);
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

      <div className="card" style={{ padding: '1.25rem', maxWidth: 460, marginTop: '1rem' }}>
        <div className="label">{t('settings.security')}</div>
        <p className="muted" style={{ margin: '0.25rem 0 1rem' }}>{t('settings.securityDesc')}</p>
        <button type="button" className="btn btn-primary" onClick={() => setPwOpen(true)}>
          {t('password.title')}
        </button>
      </div>

      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
    </>
  );
}
