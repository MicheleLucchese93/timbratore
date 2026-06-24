import { useTranslation } from 'react-i18next';
import './PartnerHero.css';

// Decorative company names for the portfolio stage — brand-neutral placeholders,
// not real tenants. Only the payoff/status labels are translated.
const COMPANIES = [
  { name: 'Rossi S.r.l.', initials: 'RS', tint: 'a' as const, delay: '0s' },
  { name: 'Bianchi & Co.', initials: 'BC', tint: 'b' as const, delay: '0.9s' },
  { name: 'Verdi SPA', initials: 'VS', tint: 'c' as const, delay: '1.8s' },
];

export function PartnerHero() {
  const { t } = useTranslation();
  return (
    <div className="phero">
      <div className="phero__bg" />
      <svg className="phero__blob phero__blob--1" viewBox="0 0 200 200" aria-hidden>
        <circle cx="100" cy="100" r="100" fill="rgba(255,255,255,0.10)" />
      </svg>
      <svg className="phero__blob phero__blob--2" viewBox="0 0 200 200" aria-hidden>
        <circle cx="100" cy="100" r="100" fill="rgba(255,255,255,0.08)" />
      </svg>

      <div className="phero__content">
        <h1 className="phero__brand">
          sonoQui
          <span className="phero__brand-tag">Partner</span>
        </h1>
        <p className="phero__payoff">{t('login.hero.payoff')}</p>

        <div className="phero__stage" aria-hidden>
          <span className="phero__portfolio-label">{t('login.hero.managed')}</span>
          {COMPANIES.map((c) => (
            <div
              key={c.name}
              className={`phero__company phero__company--${c.tint}`}
              style={{ animationDelay: c.delay }}
            >
              <span className="phero__company-avatar">{c.initials}</span>
              <span className="phero__company-name">{c.name}</span>
              <span className="phero__company-status">
                <span className="phero__company-dot" />
                {t('login.hero.statusActive')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
