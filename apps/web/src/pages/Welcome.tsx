import { type FormEvent, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  HEADCOUNT_BANDS,
  isValidPartitaIva,
  normalizePartitaIva,
  type BillingInterval,
  type PaidPlanKey,
} from '@sonoqui/shared';
import { api, setTenantId, type ApiError } from '../lib/api.ts';
import { useSession } from '../store/session.ts';
import { LanguageToggle } from '../components/LanguageSwitcher.tsx';
import { PlanCards } from '../components/billing/PlanCards.tsx';
import { BillingProfileForm } from '../components/billing/BillingProfileForm.tsx';
import { dismissPendingPlan, getBilling, startCheckout, type BillingOverview } from '../lib/billing.ts';

const WEBSITE = (import.meta.env.VITE_WEBSITE_URL || 'https://sonoqui.pro').replace(/\/$/, '');

type VatStatus = 'valid' | 'not_in_vies' | 'unavailable';
interface VatCheck {
  partita_iva: string;
  status: VatStatus;
  name: string | null;
  address: { address: string | null; cap: string | null; city: string | null; province: string | null };
}

/**
 * Self-service registration, steps 3 and 4 (Specs/SELF_SERVICE_BILLING.md §3.2):
 * the company (P.IVA checked on VIES, soft — D2) and then the plan. Shown by
 * App whenever the signed-in account still has no company. The company is
 * created on the Free plan; a paid plan goes through the billing details and
 * Stripe Checkout, and an abandoned payment simply leaves it on Free (D15).
 */
export function Welcome() {
  const { t } = useTranslation(['signup', 'billing']);
  const onboarding = useSession((s) => s.onboarding);
  const logout = useSession((s) => s.logout);
  const finishOnboarding = useSession((s) => s.finishOnboarding);
  const [step, setStep] = useState<'company' | 'plan'>('company');
  const [tenantId, setTid] = useState<string | null>(null);

  if (!onboarding) return null;

  return (
    <main className="signup-shell">
      <div className="signup-card signup-card-wide card space-y-5" data-testid="welcome-wizard">
        <div className="flex items-center justify-between gap-3">
          <div className="signup-brand">
            <img src="/icon-192.png" alt="" width={32} height={32} />
            <span>sono<span className="text-[color:var(--color-primary)]">Qui</span></span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void logout()}>
              {t('wizard.logout')}
            </button>
          </div>
        </div>
        <div>
          <h1 className="page-title">{t('wizard.hello', { name: onboarding.first_name })}</h1>
          <p className="muted">{t('wizard.intro')}</p>
        </div>
        <ol className="wizard-steps" aria-label="steps">
          <li className="is-done">{t('wizard.steps.account')}</li>
          <li className={step === 'company' ? 'is-current' : 'is-done'}>{t('wizard.steps.company')}</li>
          <li className={step === 'plan' ? 'is-current' : ''}>{t('wizard.steps.plan')}</li>
        </ol>
        {step === 'company' ? (
          <CompanyStep
            onCreated={(id) => {
              // From here on the account IS the company's admin: the billing
              // calls of the plan step need the X-Tenant-Id header.
              setTenantId(id);
              setTid(id);
              setStep('plan');
            }}
          />
        ) : (
          <PlanStep
            planHint={onboarding.plan_hint}
            onFree={async (keepPending) => {
              // "Continua gratis" is an explicit choice: stop offering the plan
              // picked on the website. "Lo farò più tardi" keeps the reminder.
              if (!keepPending && onboarding.plan_hint) await dismissPendingPlan().catch(() => {});
              await finishOnboarding(tenantId!);
            }}
          />
        )}
      </div>
    </main>
  );
}

function CompanyStep({ onCreated }: { onCreated: (tenantId: string) => void }) {
  const { t } = useTranslation('signup');
  const [piva, setPiva] = useState('');
  const [vat, setVat] = useState<VatCheck | null>(null);
  const [vatState, setVatState] = useState<'idle' | 'checking' | 'invalid'>('idle');
  const [f, setF] = useState({ ragione_sociale: '', address: '', cap: '', city: '', province: '' });
  const [band, setBand] = useState<(typeof HEADCOUNT_BANDS)[number] | ''>('');
  const [consent, setConsent] = useState({ dpa: false, art1341: false, powers: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function checkVat() {
    const v = normalizePartitaIva(piva);
    if (!isValidPartitaIva(v)) {
      setVatState('invalid');
      setVat(null);
      return;
    }
    setVatState('checking');
    try {
      const r = await api<VatCheck>('/api/v1/onboarding/vat-check', {
        method: 'POST',
        json: { partita_iva: v },
        noTenant: true,
      });
      setVat(r);
      setVatState('idle');
      // Prefill only what the user has not typed yet.
      setF((prev) => ({
        ragione_sociale: prev.ragione_sociale || r.name || '',
        address: prev.address || r.address.address || '',
        cap: prev.cap || r.address.cap || '',
        city: prev.city || r.address.city || '',
        province: prev.province || r.address.province || '',
      }));
    } catch (e) {
      setVatState((e as ApiError).code === 'INVALID_VAT' ? 'invalid' : 'idle');
      if ((e as ApiError).code !== 'INVALID_VAT') setErr(t('wizard.company.error'));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const v = normalizePartitaIva(piva);
    if (!isValidPartitaIva(v)) {
      setVatState('invalid');
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ tenant_id: string }>('/api/v1/onboarding/company', {
        method: 'POST',
        noTenant: true,
        json: {
          partita_iva: v,
          ragione_sociale: f.ragione_sociale.trim(),
          address: f.address.trim(),
          cap: f.cap.trim(),
          city: f.city.trim(),
          province: f.province.trim().toUpperCase(),
          headcount_band: band,
          accept_dpa: consent.dpa,
          accept_art1341: consent.art1341,
          accept_powers: consent.powers,
        },
      });
      onCreated(r.tenant_id);
    } catch (e2) {
      const code = (e2 as ApiError).code;
      setErr(
        code === 'VAT_ALREADY_REGISTERED'
          ? t('wizard.company.duplicate')
          : code === 'INVALID_VAT'
            ? t('wizard.company.invalidVat')
            : t('wizard.company.error')
      );
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const canSubmit =
    isValidPartitaIva(normalizePartitaIva(piva)) &&
    f.ragione_sociale.trim().length >= 2 &&
    f.address.trim().length >= 3 &&
    /^\d{5}$/.test(f.cap.trim()) &&
    f.city.trim().length >= 2 &&
    /^[A-Za-z]{2}$/.test(f.province.trim()) &&
    band !== '' &&
    consent.dpa &&
    consent.art1341 &&
    consent.powers;

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="company-step">
      <div>
        <h2 className="section-title">{t('wizard.company.title')}</h2>
        <p className="muted text-sm">{t('wizard.company.subtitle')}</p>
      </div>
      <div>
        <label className="label" htmlFor="wz-piva">{t('wizard.company.piva')}</label>
        <div className="flex gap-2">
          <input
            id="wz-piva"
            className="input num"
            inputMode="numeric"
            maxLength={16}
            value={piva}
            onChange={(e) => {
              setPiva(e.target.value);
              setVat(null);
              setVatState('idle');
            }}
            onBlur={() => {
              if (isValidPartitaIva(normalizePartitaIva(piva)) && !vat) void checkVat();
            }}
            placeholder="01234567890"
            data-testid="wz-piva"
          />
          <button type="button" className="btn btn-secondary" onClick={() => void checkVat()} disabled={vatState === 'checking'} data-testid="wz-verify">
            {vatState === 'checking' ? t('wizard.company.checking') : t('wizard.company.verify')}
          </button>
        </div>
        {vatState === 'invalid' && (
          <p className="field-hint text-[color:var(--color-error)]" role="alert">{t('wizard.company.vat.invalid')}</p>
        )}
        {vat && (
          <p className={`vat-chip vat-chip-${vat.status}`} data-testid={`vat-${vat.status}`}>
            {vat.status === 'valid'
              ? vat.name
                ? t('wizard.company.vat.valid', { name: vat.name })
                : t('wizard.company.vat.validNoName')
              : t(`wizard.company.vat.${vat.status}`)}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="label" htmlFor="wz-rs">{t('wizard.company.ragioneSociale')}</label>
          <input id="wz-rs" className="input" value={f.ragione_sociale} onChange={set('ragione_sociale')} data-testid="wz-ragione" />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="wz-addr">{t('wizard.company.address')}</label>
          <input id="wz-addr" className="input" value={f.address} onChange={set('address')} autoComplete="street-address" data-testid="wz-address" />
        </div>
        <div className="grid grid-cols-3 gap-3 md:col-span-2">
          <div>
            <label className="label" htmlFor="wz-cap">{t('wizard.company.cap')}</label>
            <input id="wz-cap" className="input num" inputMode="numeric" maxLength={5} value={f.cap} onChange={set('cap')} data-testid="wz-cap" />
          </div>
          <div>
            <label className="label" htmlFor="wz-city">{t('wizard.company.city')}</label>
            <input id="wz-city" className="input" value={f.city} onChange={set('city')} data-testid="wz-city" />
          </div>
          <div>
            <label className="label" htmlFor="wz-prov">{t('wizard.company.province')}</label>
            <input id="wz-prov" className="input" maxLength={2} value={f.province} onChange={(e) => setF((p) => ({ ...p, province: e.target.value.toUpperCase() }))} placeholder="VR" data-testid="wz-province" />
          </div>
        </div>
      </div>
      <fieldset>
        <legend className="label">{t('wizard.company.headcount')}</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {HEADCOUNT_BANDS.map((b) => (
            <label key={b} className={`chip-radio${band === b ? ' is-active' : ''}`}>
              <input type="radio" name="band" value={b} checked={band === b} onChange={() => setBand(b)} data-testid={`wz-band-${b}`} />
              {t(`wizard.company.headcountOpts.${b}`)}
            </label>
          ))}
        </div>
        <p className="field-hint">{t('wizard.company.headcountHint')}</p>
      </fieldset>
      <div className="space-y-2 consent-list">
        <label className="consent">
          <input type="checkbox" checked={consent.dpa} onChange={(e) => setConsent((c) => ({ ...c, dpa: e.target.checked }))} data-testid="wz-dpa" />
          <span>
            <Trans t={t} i18nKey="wizard.company.dpa" components={{ a: <a href={`${WEBSITE}/it/dpa/`} target="_blank" rel="noreferrer" /> }} />
          </span>
        </label>
        <label className="consent">
          <input type="checkbox" checked={consent.art1341} onChange={(e) => setConsent((c) => ({ ...c, art1341: e.target.checked }))} data-testid="wz-art1341" />
          <span>
            <Trans t={t} i18nKey="wizard.company.art1341" components={{ a: <a href={`${WEBSITE}/it/termini-e-condizioni/#clausole-vessatorie`} target="_blank" rel="noreferrer" /> }} />
          </span>
        </label>
        <label className="consent">
          <input type="checkbox" checked={consent.powers} onChange={(e) => setConsent((c) => ({ ...c, powers: e.target.checked }))} data-testid="wz-powers" />
          <span>{t('wizard.company.powers')}</span>
        </label>
      </div>
      {err && <p className="text-sm text-[color:var(--color-error)]" role="alert" data-testid="wz-error">{err}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !canSubmit} data-testid="wz-create">
        {busy ? t('wizard.company.creating') : t('wizard.company.submit')}
      </button>
    </form>
  );
}

function PlanStep({
  planHint,
  onFree,
}: {
  planHint: PaidPlanKey | null;
  onFree: (keepPending: boolean) => void | Promise<void>;
}) {
  const { t } = useTranslation(['signup', 'billing']);
  const [interval, setIntervalChoice] = useState<BillingInterval>('month');
  const [choice, setChoice] = useState<PaidPlanKey | null>(planHint);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function choose(plan: PaidPlanKey) {
    setChoice(plan);
    setErr(null);
    setBusy(true);
    try {
      const o = billing ?? (await getBilling());
      setBilling(o);
      if (o.profile_gaps.length === 0) {
        await startCheckout({ kind: 'plan', plan, interval });
        return;
      }
    } catch (e) {
      const code = (e as ApiError).code;
      setErr(t(`billing:errors.${code ?? 'default'}`, { defaultValue: t('billing:errors.default') }));
    }
    setBusy(false);
  }

  if (choice && billing && billing.profile && billing.profile_gaps.length > 0) {
    return (
      <div className="space-y-4" data-testid="plan-step-billing">
        <div>
          <h2 className="section-title">{t('wizard.plan.billingTitle')}</h2>
          <p className="muted text-sm">{t('wizard.plan.billingSubtitle', { plan: t(`billing:plan.${choice}`) })}</p>
        </div>
        <BillingProfileForm
          profile={billing.profile}
          submitLabel={t('wizard.plan.toPayment')}
          onSaved={async () => {
            const fresh = await getBilling();
            setBilling(fresh);
            if (fresh.profile_gaps.length === 0) {
              try {
                await startCheckout({ kind: 'plan', plan: choice, interval });
              } catch (e) {
                const code = (e as ApiError).code;
                setErr(t(`billing:errors.${code ?? 'default'}`, { defaultValue: t('billing:errors.default') }));
              }
            }
          }}
        />
        {err && <p className="text-sm text-[color:var(--color-error)]" role="alert">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setChoice(null)}>{t('wizard.plan.back')}</button>
          <button type="button" className="btn btn-ghost" onClick={() => void onFree(true)}>{t('wizard.plan.later')}</button>
        </div>
        <p className="muted text-xs">{t('billing:invoiceNote')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="plan-step">
      <div>
        <h2 className="section-title">{t('wizard.plan.title')}</h2>
        <p className="muted text-sm">{t('wizard.plan.subtitle')}</p>
      </div>
      <PlanCards
        current="free"
        interval={interval}
        onInterval={setIntervalChoice}
        selected={choice}
        onChoose={(p) => void choose(p)}
        onFree={() => void onFree(false)}
        busy={busy}
        contactHref={`${WEBSITE}/it/#contact`}
      />
      {err && <p className="text-sm text-[color:var(--color-error)]" role="alert">{err}</p>}
      <p className="muted text-xs">{t('billing:invoiceNote')}</p>
    </div>
  );
}
