import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PLAN_CAPS } from '@sonoqui/shared';
import { useReadOnly, useSession } from '../../store/session.ts';
import { dismissPendingPlan, formatDay } from '../../lib/billing.ts';

/**
 * Plan notices at the top of every admin page (Specs/SELF_SERVICE_BILLING.md §3.5–3.6):
 *  - a paid plan picked on the website but not paid yet (D15: the company runs
 *    on Free meanwhile) → "Completa l'attivazione" / "Continua con il gratuito";
 *  - a company above its caps after a downgrade → the 14-day grace countdown,
 *    then the export lock (D7). Stamping is never blocked, and the copy says so.
 */
export function PlanBanners() {
  const { t, i18n } = useTranslation('billing');
  const me = useSession((s) => s.me);
  const refreshQuiet = useSession((s) => s.refreshQuiet);
  const readOnly = useReadOnly();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!me || readOnly || me.user.role !== 'admin' || me.tenant.billing_mode !== 'stripe') return null;

  const over = me.tenant.over_limit;
  const pending = me.tenant.plan === 'free' ? me.tenant.pending_plan : null;

  async function dismiss() {
    setBusy(true);
    try {
      await dismissPendingPlan();
      await refreshQuiet();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {over?.since && (
        <div className={`plan-banner ${over.locked ? 'plan-banner-err' : 'plan-banner-warn'}`} role="status" data-testid="over-limit-banner">
          <span>
            {over.locked
              ? t('banner.overLocked', { what: over.kinds.map((k) => t(`banner.kinds.${k}`)).join(', ') })
              : t('banner.over', {
                  what: over.kinds.map((k) => t(`banner.kinds.${k}`)).join(', '),
                  date: formatDay(over.deadline, i18n.language),
                })}
          </span>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => nav('/settings/subscription')}>
            {t('banner.overCta')}
          </button>
        </div>
      )}
      {pending && !over?.since && (
        <div className="plan-banner plan-banner-info" role="status" data-testid="pending-plan-banner">
          <span>
            {t('banner.pending', {
              plan: t(`plan.${pending}`),
              users: PLAN_CAPS[pending].maxUsers,
              branches: PLAN_CAPS[pending].maxBranches,
            })}
          </span>
          <span className="plan-banner-actions">
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void dismiss()}>
              {t('banner.pendingDismiss')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => nav(`/settings/subscription?plan=${pending}`)}
            >
              {t('banner.pendingCta')}
            </button>
          </span>
        </div>
      )}
    </>
  );
}
