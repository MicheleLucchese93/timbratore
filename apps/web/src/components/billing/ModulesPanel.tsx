import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BILLABLE_MODULES, MODULE_PRICE_CENTS, type ModuleKey } from '@sonoqui/shared';
import type { ApiError } from '../../lib/api.ts';
import { useConfirm } from '../ConfirmDialog.tsx';
import { useReadOnly, useSession } from '../../store/session.ts';
import {
  cancelModule,
  euro,
  formatDay,
  isLive,
  resumeModule,
  startCheckout,
  type BillingOverview,
} from '../../lib/billing.ts';

/**
 * Cantieri and API at €50/month each (D14): buyable by any self-service
 * company, on the Free plan too. Partner-managed companies see the state
 * read-only — their partner switches modules on, so the in-app purchase can
 * never route around the partner.
 */
export function ModulesPanel({
  overview,
  onChanged,
  onNeedProfile,
  onMessage,
}: {
  overview: BillingOverview;
  onChanged: (o: BillingOverview) => void;
  onNeedProfile: () => void;
  onMessage: (kind: 'ok' | 'err', text: string) => void;
}) {
  const { t, i18n } = useTranslation('billing');
  const confirm = useConfirm();
  const readOnly = useReadOnly();
  const refreshQuiet = useSession((s) => s.refreshQuiet);
  const [busy, setBusy] = useState<ModuleKey | null>(null);
  const managed = overview.billing_mode !== 'stripe';
  const lang = i18n.language;

  function fail(e: unknown) {
    const code = (e as ApiError).code;
    onMessage('err', t(`errors.${code ?? 'default'}`, { defaultValue: t('errors.default') }));
  }

  async function activate(m: ModuleKey) {
    if (overview.profile_gaps.length > 0) {
      onNeedProfile();
      return;
    }
    setBusy(m);
    try {
      await startCheckout({ kind: 'module', module: m });
    } catch (e) {
      fail(e);
      setBusy(null);
    }
  }

  async function cancel(m: ModuleKey, periodEnd: string | null) {
    const ok = await confirm({
      title: t('modules.confirmCancelTitle', { name: t(`modules.${m}.name`) }),
      message: t(m === 'api' ? 'modules.confirmCancelApi' : 'modules.confirmCancelCantieri', {
        date: formatDay(periodEnd, lang),
      }),
      confirmLabel: t('modules.confirmCancelOk'),
      danger: true,
    });
    if (!ok) return;
    setBusy(m);
    try {
      onChanged(await cancelModule(m));
      onMessage('ok', t('modules.cancelled'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function resume(m: ModuleKey) {
    setBusy(m);
    try {
      onChanged(await resumeModule(m));
      await refreshQuiet();
      onMessage('ok', t('modules.resumed'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="muted text-sm">
        {managed ? t('modules.managedNote') : t('modules.subheading', { price: euro(MODULE_PRICE_CENTS.cantieri, lang) })}
      </p>
      <div className="module-cards">
        {BILLABLE_MODULES.map((m) => {
          const st = overview.modules[m];
          const sub = st.subscription;
          const paid = isLive(sub);
          const endsAt = sub?.current_period_end ?? null;
          return (
            <div key={m} className={`module-card${st.enabled ? ' module-card-on' : ''}`} data-testid={`module-card-${m}`}>
              <div className="module-card-head">
                <h4>{t(`modules.${m}.name`)}</h4>
                {st.enabled && <span className="badge badge-ok">{t('modules.active')}</span>}
              </div>
              <p className="muted text-sm">{t(`modules.${m}.desc`)}</p>
              <div className="module-card-foot">
                <span className="module-card-price">{t('modules.price', { amount: euro(st.price_cents, lang) })}</span>
                {managed ? (
                  st.enabled ? <span className="muted text-sm">{t('modules.includedNote')}</span> : null
                ) : paid ? (
                  sub?.cancel_at_period_end ? (
                    <span className="module-card-actions">
                      <span className="muted text-sm">{t('modules.endsOn', { date: formatDay(endsAt, lang) })}</span>
                      <button type="button" className="btn btn-sm btn-secondary" disabled={!!busy || readOnly} onClick={() => void resume(m)} data-testid={`module-resume-${m}`}>
                        {t('modules.resume')}
                      </button>
                    </span>
                  ) : (
                    <span className="module-card-actions">
                      <span className="muted text-sm">{t('modules.renews', { date: formatDay(endsAt, lang) })}</span>
                      <button type="button" className="btn btn-sm btn-ghost" disabled={!!busy || readOnly} onClick={() => void cancel(m, endsAt)} data-testid={`module-cancel-${m}`}>
                        {t('modules.cancel')}
                      </button>
                    </span>
                  )
                ) : st.enabled ? (
                  <span className="muted text-sm">{t('modules.includedNote')}</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={!!busy || readOnly || !overview.billing_enabled}
                    onClick={() => void activate(m)}
                    data-testid={`module-activate-${m}`}
                  >
                    {t('modules.activate')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
