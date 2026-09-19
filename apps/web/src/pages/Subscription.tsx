import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { BillingInterval, PaidPlanKey } from '@sonoqui/shared';
import { PageHeader } from '../components/PageHeader.tsx';
import { PlanCards } from '../components/billing/PlanCards.tsx';
import { ModulesPanel } from '../components/billing/ModulesPanel.tsx';
import { BillingProfileForm } from '../components/billing/BillingProfileForm.tsx';
import type { ApiError } from '../lib/api.ts';
import { useReadOnly, useSession } from '../store/session.ts';
import {
  formatDay,
  getBilling,
  isLive,
  openPortal,
  startCheckout,
  type BillingOverview,
  type PortalFlow,
} from '../lib/billing.ts';

type Toast = { kind: 'ok' | 'err'; text: string } | null;

/**
 * Impostazioni → Piano e abbonamento (Specs/SELF_SERVICE_BILLING.md §3.6).
 * The "Passa a Premium" badge and the plan banners land here. Buying goes to
 * Stripe Checkout; card, plan switch and cancellation go to the Customer
 * Portal; modules can be switched off from here directly.
 */
export function Subscription() {
  const { t, i18n } = useTranslation(['billing', 'common']);
  const lang = i18n.language;
  const [params, setParams] = useSearchParams();
  const readOnly = useReadOnly();
  const refreshQuiet = useSession((s) => s.refreshQuiet);
  const [o, setO] = useState<BillingOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [interval, setIntervalChoice] = useState<BillingInterval>('month');
  const [choice, setChoice] = useState<PaidPlanKey | null>(null);
  const [needProfile, setNeedProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await getBilling();
      setO(data);
      const wanted = params.get('plan');
      if ((wanted === 'piccola' || wanted === 'media') && data.plan === 'free') setChoice(wanted);
      else if (data.pending_plan && data.plan === 'free') setChoice(data.pending_plan);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [params]);

  useEffect(() => {
    void load();
  }, [load]);

  // Link from the "payment failed" email: straight into the card-update flow.
  useEffect(() => {
    if (!o || params.get('action') !== 'payment-method' || readOnly) return;
    if (o.has_customer && o.billing_enabled) {
      setParams({}, { replace: true });
      void openPortal('payment_method_update').catch((e) => showErr(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  function showErr(e: unknown) {
    const code = (e as ApiError).code;
    setToast({ kind: 'err', text: t(`errors.${code ?? 'default'}`, { defaultValue: t('errors.default') }) });
  }

  function askProfile() {
    setNeedProfile(true);
    setTimeout(() => profileRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function buyPlan(plan: PaidPlanKey) {
    setChoice(plan);
    if (!o) return;
    if (o.profile_gaps.length > 0) {
      askProfile();
      return;
    }
    setBusy(true);
    try {
      await startCheckout({ kind: 'plan', plan, interval });
    } catch (e) {
      showErr(e);
      setBusy(false);
    }
  }

  async function portal(flow: PortalFlow) {
    setBusy(true);
    try {
      await openPortal(flow);
    } catch (e) {
      showErr(e);
      setBusy(false);
    }
  }

  if (err) return <p className="text-[color:var(--color-error)]">{err}</p>;
  if (!o) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-56 bg-[color:var(--color-surface-variant)] rounded" />
        <div className="card h-48" />
      </div>
    );
  }

  const managed = o.billing_mode !== 'stripe';
  const planSub = o.plan_subscription;
  const paid = o.plan === 'piccola' || o.plan === 'media';
  const canBuy = !managed && o.billing_enabled && !readOnly;

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <Link to="/settings" className="btn btn-secondary">
            {t('page.back')}
          </Link>
        }
      />

      {managed && (
        <div className="card" data-testid="billing-managed">
          <h3 className="section-title">{t('managed.title')}</h3>
          <p className="muted text-sm">{t('managed.text')}</p>
        </div>
      )}
      {!managed && !o.billing_enabled && <div className="plan-banner plan-banner-info">{t('disabled')}</div>}

      {/* Current plan + usage */}
      <section className="card space-y-4" data-testid="current-plan">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="section-title">{t('current.heading')}</h3>
            <p className="text-lg font-semibold">
              {o.plan === 'free'
                ? t('current.free')
                : o.plan === 'custom'
                  ? t('current.custom')
                  : t('current.paid', { plan: t(`plan.${o.plan}`) })}
              {planSub && ` · ${t(`current.interval.${planSub.billing_interval}`)}`}
            </p>
            {planSub && planSub.status === 'past_due' && (
              <p className="text-sm text-[color:var(--color-error)]">{t('current.pastDue')}</p>
            )}
            {planSub && isLive(planSub) && planSub.status !== 'past_due' && (
              <p className="muted text-sm">
                {planSub.cancel_at_period_end
                  ? t('current.endsOn', { date: formatDay(planSub.current_period_end, lang) })
                  : t('current.renews', { date: formatDay(planSub.current_period_end, lang) })}
              </p>
            )}
          </div>
          {canBuy && o.has_customer && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void portal('payment_method_update')} data-testid="portal-payment">
                {t('current.managePayment')}
              </button>
              {paid && (
                <>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void portal('subscription_update')} data-testid="portal-change">
                    {t('current.changePlan')}
                  </button>
                  {!planSub?.cancel_at_period_end && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void portal('subscription_cancel')} data-testid="portal-cancel">
                      {t('current.cancelPlan')}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <UsageBar label={t('current.users')} used={o.usage.users} max={o.limits.max_users} />
          <UsageBar label={t('current.branches')} used={o.usage.branches} max={o.limits.max_branches} />
          <UsageBar label={t('current.admins')} used={o.usage.admins} max={o.limits.max_admins} />
        </div>
      </section>

      {/* Plans — Free companies choose here; paid ones switch in the portal. */}
      {!managed && o.plan === 'free' && (
        <section className="space-y-3" data-testid="plan-picker">
          <h3 className="section-title">{t('plans.heading')}</h3>
          <PlanCards
            current={o.plan}
            interval={interval}
            onInterval={setIntervalChoice}
            selected={choice}
            onChoose={(p) => void buyPlan(p)}
            busy={busy || !canBuy}
          />
        </section>
      )}

      <section className="card space-y-3">
        <h3 className="section-title">{t('modules.heading')}</h3>
        <ModulesPanel
          overview={o}
          onChanged={setO}
          onNeedProfile={askProfile}
          onMessage={(kind, text) => setToast({ kind, text })}
        />
      </section>

      {o.profile && (
        <section className="card space-y-3" ref={profileRef} data-testid="billing-profile">
          <h3 className="section-title">{t('profile.heading')}</h3>
          <p className="muted text-sm">{t('profile.subheading')}</p>
          {needProfile && o.profile_gaps.length > 0 && (
            <div className="plan-banner plan-banner-warn">{t('profile.incomplete')}</div>
          )}
          <BillingProfileForm
            profile={o.profile}
            readOnly={readOnly || managed}
            submitLabel={needProfile && choice ? t('plans.choose', { plan: t(`plan.${choice}`) }) : undefined}
            onSaved={async () => {
              const fresh = await getBilling();
              setO(fresh);
              setToast({ kind: 'ok', text: t('profile.saved') });
              if (needProfile && choice && fresh.profile_gaps.length === 0 && fresh.plan === 'free') {
                setNeedProfile(false);
                await buyPlan(choice);
              }
              await refreshQuiet();
            }}
          />
        </section>
      )}

      {!managed && <p className="muted text-sm">{t('invoiceNote')}</p>}

      {toast && (
        <div className={`toast ${toast.kind === 'ok' ? 'toast-ok' : 'toast-err'}`} role="status">
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}

function UsageBar({ label, used, max }: { label: string; used: number; max: number }) {
  const { t } = useTranslation('billing');
  const pct = Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  const over = used > max;
  return (
    <div className="usage-bar">
      <div className="usage-bar-head">
        <span>{label}</span>
        <span className={over ? 'text-[color:var(--color-error)] font-semibold' : 'muted'}>
          {t('current.usage', { used, max })}
        </span>
      </div>
      <div className="usage-bar-track">
        <div className={`usage-bar-fill${over ? ' is-over' : pct >= 100 ? ' is-full' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
