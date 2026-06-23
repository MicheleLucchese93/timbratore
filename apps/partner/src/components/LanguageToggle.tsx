import { useTranslation } from 'react-i18next';
import { currentLang, setLanguage } from '../i18n/index.ts';

/** Compact IT / EN toggle. */
export function LanguageToggle() {
  const { i18n } = useTranslation();
  const lang = currentLang();
  void i18n.language; // re-render on change
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      <button
        type="button"
        className={lang === 'it' ? 'is-active' : ''}
        onClick={() => setLanguage('it')}
      >
        IT
      </button>
      <button
        type="button"
        className={lang === 'en' ? 'is-active' : ''}
        onClick={() => setLanguage('en')}
      >
        EN
      </button>
    </div>
  );
}
