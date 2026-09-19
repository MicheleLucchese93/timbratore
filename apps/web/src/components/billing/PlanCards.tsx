import { useTranslation } from 'react-i18next';
import {
  PAID_PLANS,
  PLAN_CAPS,
  PLAN_PRICES_CENTS,
  type BillingInterval,
  type PaidPlanKey,
} from '@sonoqui/shared';
import { euro, euroGross } from '../../lib/billing.ts';

/**
 * Free / Piccola / Media, the tiers already published on the website (D1).
 * Prices are shown NET with "+ IVA" (B2B convention) and the gross amount as
 * a hint, so the Stripe total on the next page is never a surprise.
 */
export function PlanCards({
  current,
  interval,
  onInterval,
  selected,
  onChoose,
  onFree,
  busy,
  showFree = true,
  contactHref = '/tickets',
}: {
  current: 'free' | 'piccola' | 'media' | 'custom';
  interval: BillingInterval;
  onInterval: (i: BillingInterval) => void;
  selected?: PaidPlanKey | null;
  onChoose: (plan: PaidPlanKey) => void;
  onFree?: () => void;
  busy?: boolean;
  showFree?: boolean;
  /** Where "Contattaci" goes: the in-app support page, or the website form. */
  contactHref?: string;
}) {
  const { t, i18n } = useTranslation('billing');
  const lang = i18n.language;
  return (
    <div className="space-y-4">
      <div className="plan-interval" role="radiogroup" aria-label={t('plans.heading')}>
        {(['month', 'year'] as const).map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={interval === i}
            className={`plan-interval-btn${interval === i ? ' is-active' : ''}`}
            onClick={() => onInterval(i)}
            data-testid={`interval-${i}`}
          >
            {i === 'month' ? t('plans.monthly') : t('plans.yearly')}
            {i === 'year' && <span className="plan-interval-hint">{t('plans.yearlyHint')}</span>}
          </button>
        ))}
      </div>
      <div className="plan-cards">
        {showFree && (
          <div className={`plan-card${current === 'free' ? ' plan-card-current' : ''}`} data-testid="plan-card-free">
            <h4>{t('plans.free.title')}</h4>
            <div className="plan-card-price">
              <span className="plan-card-amount">{t('plans.free.price')}</span>
              <span className="plan-card-unit">{t('plans.free.forever')}</span>
            </div>
            <PlanFeatures caps={PLAN_CAPS.free} />
            {onFree ? (
              <button
                type="button"
                className="btn btn-secondary plan-card-cta"
                onClick={onFree}
                disabled={busy}
                data-testid="plan-free-cta"
              >
                {t('plans.freeCta')}
              </button>
            ) : current === 'free' ? (
              <span className="badge badge-muted plan-card-cta">{t('plans.current')}</span>
            ) : null}
          </div>
        )}
        {PAID_PLANS.map((p) => {
          const cents = PLAN_PRICES_CENTS[p][interval];
          const isCurrent = current === p;
          return (
            <div
              key={p}
              className={`plan-card${isCurrent ? ' plan-card-current' : ''}${selected === p ? ' plan-card-selected' : ''}`}
              data-testid={`plan-card-${p}`}
            >
              <h4>{t(`plan.${p}`)}</h4>
              <div className="plan-card-price">
                <span className="plan-card-amount">{euro(cents, lang)}</span>
                <span className="plan-card-unit">
                  {interval === 'month' ? t('plans.perMonth') : t('plans.perYear')} {t('plans.plusVat')}
                </span>
              </div>
              <div className="plan-card-gross">{t('plans.withVat', { amount: euroGross(cents, lang) })}</div>
              <PlanFeatures caps={PLAN_CAPS[p]} />
              {isCurrent ? (
                <span className="badge badge-ok plan-card-cta">{t('plans.current')}</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary plan-card-cta"
                  onClick={() => onChoose(p)}
                  disabled={busy}
                  data-testid={`plan-choose-${p}`}
                >
                  {t('plans.choose', { plan: t(`plan.${p}`) })}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted text-sm">
        <strong>{t('plans.enterprise.title')}</strong> {t('plans.enterprise.text')}{' '}
        <a className="font-semibold underline-offset-4 hover:underline" style={{ color: 'var(--color-primary)' }} href={contactHref}>
          {t('plans.enterprise.cta')}
        </a>
      </p>
    </div>
  );
}

function PlanFeatures({ caps }: { caps: { maxUsers: number; maxBranches: number; maxAdmins: number } }) {
  const { t } = useTranslation('billing');
  return (
    <ul className="plan-card-features">
      <li>{t('plans.users', { count: caps.maxUsers })}</li>
      <li>{t('plans.branches', { count: caps.maxBranches })}</li>
      <li>{t('plans.admins', { count: caps.maxAdmins })}</li>
      <li>{t('plans.features')}</li>
    </ul>
  );
}
