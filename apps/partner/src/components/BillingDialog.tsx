import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PLAN_CAPS, isEntitledStatus, type EntitlementOverrides } from '@sonoqui/shared';
import { api, type ApiError } from '../lib/api.ts';
import {
  fmtDate,
  fmtDateTime,
  fmtMoney,
  subscriptionLabel,
  utmSummary,
  type BillingModeKey,
  type PlanKey,
  type SignupSource,
  type VatStatus,
} from '../lib/billing.ts';
import { MODULES, moduleFlag } from '../lib/modules.ts';
import { useToast } from './Toast.tsx';
import { useConfirm } from './ConfirmProvider.tsx';
import { Modal } from './Modal.tsx';
import { OriginBadge, PlanBadge, SubStatusBadge, VatBadge } from './BillingBadges.tsx';
import { IconExternal } from './icons.tsx';

// Super-user control panel for one company's self-service billing
// (Specs/SELF_SERVICE_BILLING.md §3.7): what it pays for, the data its fattura is
// drafted from, and four levers — courtesy overrides, the Stripe ↔ manual billing
// switch, the human VIES review and a forced Stripe re-sync. Every call here is
// super-user only on the server too (403 SUPER_ADMIN_REQUIRED).

interface BillingTenant {
  id: string;
  ragione_sociale: string;
  partita_iva: string | null;
  signup_source: SignupSource;
  billing_mode: BillingModeKey;
  plan: PlanKey;
  pending_plan: 'piccola' | 'media' | null;
  entitlement_overrides: EntitlementOverrides | null;
  over_limit_since: string | null;
  max_users: number;
  max_branches: number;
  max_admins: number;
  max_documentali: number;
  cantieri_enabled: boolean;
  api_enabled: boolean;
  created_at: string;
}

interface BillingProfile {
  legal_name: string;
  partita_iva: string;
  codice_fiscale: string | null;
  address: string | null;
  cap: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  sdi_code: string | null;
  pec: string | null;
  billing_email: string | null;
  vat_status: VatStatus;
  vies_request_id: string | null;
  vies_checked_at: string | null;
  headcount_band: string | null;
}

interface BillingSub {
  id: string;
  product_line: string;
  price_lookup_key: string | null;
  status: string;
  billing_interval: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  ended_at: string | null;
}

interface BillingDetail {
  tenant: BillingTenant;
  profile: BillingProfile | null;
  stripe_customer_id: string | null;
  stripe_dashboard_url: string | null;
  subscriptions: BillingSub[];
  payments: { count: number; total_cents: number; to_invoice: number };
  signup: {
    email: string;
    first_name: string;
    last_name: string;
    phone: string | null;
    plan_hint: 'piccola' | 'media' | null;
    utm: Record<string, string> | null;
    created_at: string;
    company_created_at: string | null;
  } | null;
  billing_enabled: boolean;
  stripe_mode?: 'sandbox' | 'live';
}

type SubsChoice = 'keep' | 'cancel_at_period_end' | 'cancel_now';

const CAP_FIELDS = ['max_users', 'max_branches', 'max_admins', 'max_documentali'] as const;
type CapField = (typeof CAP_FIELDS)[number];
// Mirrors the server's zod bounds so an out-of-range value fails here, in words.
const CAP_MAX: Record<CapField, number> = {
  max_users: 100000,
  max_branches: 10000,
  max_admins: 1000,
  max_documentali: 1000,
};
const PLAN_CAP_KEY: Record<CapField, 'maxUsers' | 'maxBranches' | 'maxAdmins' | 'maxDocumentali'> = {
  max_users: 'maxUsers',
  max_branches: 'maxBranches',
  max_admins: 'maxAdmins',
  max_documentali: 'maxDocumentali',
};

/** Caps as typed text ('' = no override); module flags keyed by their tenant field. */
interface OverrideForm {
  caps: Record<CapField, string>;
  modules: Record<string, boolean>;
}

function formFromOverrides(o: EntitlementOverrides | null | undefined): OverrideForm {
  const src = (o ?? {}) as Record<string, unknown>;
  const caps = {} as Record<CapField, string>;
  for (const f of CAP_FIELDS) {
    const v = src[f];
    caps[f] = typeof v === 'number' ? String(v) : '';
  }
  const modules: Record<string, boolean> = {};
  for (const m of MODULES) modules[m.tenantField] = src[m.tenantField] === true;
  return { caps, modules };
}

function errMsg(t: (k: string, o?: Record<string, unknown>) => string, e: unknown): string {
  const code = (e as ApiError | null)?.code;
  return t(`errors.${code ?? 'default'}`, { defaultValue: t('errors.default') });
}

export function BillingDialog({
  tenantId,
  tenantName,
  vatReviewedAt,
  onClose,
  onChanged,
}: {
  tenantId: string;
  tenantName: string;
  /** From the Aziende row (the detail endpoint doesn't carry it). */
  vatReviewedAt?: string | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [data, setData] = useState<BillingDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // Which lever is running, so only its button shows progress.
  const [busy, setBusy] = useState<string | null>(null);
  const [ov, setOv] = useState<OverrideForm>(() => formFromOverrides(null));
  const [ovErr, setOvErr] = useState<string | null>(null);
  const [recheck, setRecheck] = useState(false);
  const [switchTo, setSwitchTo] = useState<BillingModeKey | null>(null);

  const base = `/api/v1/partnership/billing/tenants/${tenantId}`;

  const load = useCallback(async () => {
    try {
      const d = await api<BillingDetail>(`/api/v1/partnership/billing/tenants/${tenantId}`);
      setData(d);
      setOv(formFromOverrides(d.tenant.entitlement_overrides));
      setLoadErr(null);
    } catch (e) {
      setLoadErr(errMsg(t, e));
    }
  }, [tenantId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // One mutation: toast its outcome, then refresh this dialog and the Aziende
  // list. A failed refresh never turns a saved change into an error toast.
  async function run<R>(key: string, fn: () => Promise<R>, done: (r: R) => string): Promise<boolean> {
    setBusy(key);
    try {
      const r = await fn();
      toast(done(r));
    } catch (e) {
      toast(errMsg(t, e), true);
      setBusy(null);
      return false;
    }
    try {
      await Promise.all([load(), onChanged()]);
    } finally {
      setBusy(null);
    }
    return true;
  }

  async function saveOverrides(e: FormEvent) {
    e.preventDefault();
    setOvErr(null);
    const out: Record<string, number | boolean> = {};
    for (const f of CAP_FIELDS) {
      const raw = ov.caps[f].trim();
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > CAP_MAX[f]) {
        setOvErr(t('billing.overrides.invalid'));
        return;
      }
      out[f] = n;
    }
    // Flags only ever ADD a module (OR with what is paid), so "off" = no key.
    for (const m of MODULES) if (ov.modules[m.tenantField] === true) out[m.tenantField] = true;
    await run(
      'overrides',
      () => api(base, { method: 'PATCH', json: { entitlement_overrides: out } }),
      () => t(Object.keys(out).length ? 'billing.overrides.saved' : 'billing.overrides.cleared')
    );
  }

  async function clearOverrides() {
    const yes = await confirm({
      message: t('billing.overrides.clearConfirm'),
      confirmLabel: t('billing.overrides.clear'),
      danger: true,
    });
    if (!yes) return;
    await run(
      'overrides',
      () => api(base, { method: 'PATCH', json: { entitlement_overrides: {} } }),
      () => t('billing.overrides.cleared')
    );
  }

  async function switchMode(target: BillingModeKey, subs: SubsChoice) {
    const ok = await run(
      'mode',
      () => api(base, { method: 'PATCH', json: { billing_mode: target, stripe_subscriptions: subs } }),
      () => t('billing.mode.done')
    );
    if (ok) setSwitchTo(null);
  }

  async function reviewVat() {
    const ok = await run(
      'vat',
      () => api<{ vat_status: VatStatus }>(`${base}/vat-review`, { method: 'POST', json: { recheck } }),
      (r) => t('billing.vatReview.done', { status: t(`billing.vat.${r.vat_status}`, { defaultValue: r.vat_status }) })
    );
    if (ok) setRecheck(false);
  }

  async function sync() {
    await run('sync', () => api(`${base}/sync`, { method: 'POST' }), () => t('billing.sync.done'));
  }

  const title = `${t('billing.title')} · ${tenantName}`;

  if (!data) {
    return (
      <Modal title={title} onClose={onClose} wide testId="billing-dialog">
        <div className="modal-body">
          {loadErr ? <div className="form-err">{loadErr}</div> : <div className="muted">{t('common.loading')}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('actions.close')}
          </button>
        </div>
      </Modal>
    );
  }

  const { tenant, profile, signup } = data;
  const stripeMode = tenant.billing_mode === 'stripe';
  const liveSubs = data.subscriptions.filter((s) => isEntitledStatus(s.status)).length;
  const planCaps = tenant.plan !== 'custom' ? PLAN_CAPS[tenant.plan] : null;
  const activeModules = MODULES.filter((m) => moduleFlag(tenant, m.tenantField)).map((m) => t(`modules.${m.key}.name`));
  const hasOverrides = Object.keys(tenant.entitlement_overrides ?? {}).length > 0;
  const utm = utmSummary(signup?.utm);

  function openPayments() {
    const q = new URLSearchParams({ tenant_id: tenantId, tenant: tenant.ragione_sociale });
    onClose();
    navigate(`/payments?${q}`);
  }

  return (
    <>
      <Modal title={title} onClose={onClose} wide testId="billing-dialog">
        <div className="modal-body">
          {!data.billing_enabled && <div className="notice">{t('billing.dialog.billingDisabled')}</div>}
          {data.stripe_mode === 'sandbox' && (
            <div className="notice" data-testid="billing-sandbox">
              {t('billing.dialog.sandbox')}
            </div>
          )}

          <div className="form-cols">
            <div className="col-group">
              <section className="dlg-section">
                <h3 className="dlg-title">{t('billing.dialog.summary')}</h3>
                <dl className="kv-grid">
                  <dt>{t('billing.dialog.origin')}</dt>
                  <dd>
                    <OriginBadge source={tenant.signup_source} />
                  </dd>
                  <dt>{t('billing.dialog.plan')}</dt>
                  <dd>
                    <PlanBadge plan={tenant.plan} pendingPlan={tenant.pending_plan} overLimitSince={tenant.over_limit_since} />
                  </dd>
                  <dt>{t('billing.dialog.mode')}</dt>
                  <dd data-testid="billing-mode-current">{t(`billing.mode.${tenant.billing_mode}`)}</dd>
                  <dt>{t('billing.dialog.limits')}</dt>
                  <dd>
                    {t('billing.dialog.limitsValue', {
                      users: tenant.max_users,
                      branches: tenant.max_branches,
                      admins: tenant.max_admins,
                      documentali: tenant.max_documentali,
                    })}
                    {activeModules.length > 0 && ` · ${activeModules.join(', ')}`}
                  </dd>
                  {tenant.over_limit_since && (
                    <>
                      <dt>{t('billing.overLimit')}</dt>
                      <dd>{t('billing.overLimitSince', { date: fmtDate(tenant.over_limit_since, lang) })}</dd>
                    </>
                  )}
                  <dt>{t('billing.dialog.created')}</dt>
                  <dd>{fmtDate(tenant.created_at, lang)}</dd>
                  <dt>{t('billing.dialog.stripeCustomer')}</dt>
                  <dd>
                    {data.stripe_dashboard_url ? (
                      <a
                        className="link-inline"
                        href={data.stripe_dashboard_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="billing-stripe-link"
                      >
                        {t('billing.dialog.openStripe')} <IconExternal />
                      </a>
                    ) : (
                      <span className="muted">{t('billing.dialog.noCustomer')}</span>
                    )}
                  </dd>
                </dl>
              </section>

              <section className="dlg-section">
                <h3 className="dlg-title">{t('billing.subs.title')}</h3>
                {data.subscriptions.length === 0 ? (
                  <div className="muted">{t('billing.subs.empty')}</div>
                ) : (
                  <div className="admin-list" data-testid="billing-subscriptions">
                    {data.subscriptions.map((s) => (
                      <div className="entity-row" key={s.id} title={s.id}>
                        <span className="entity-row-main">
                          <span className="entity-row-name">{subscriptionLabel(t, s)}</span>
                          <span className="entity-row-sub">
                            {s.ended_at
                              ? t('billing.subs.ended', { date: fmtDate(s.ended_at, lang) })
                              : s.current_period_end
                                ? t(s.cancel_at_period_end ? 'billing.subs.endsOn' : 'billing.subs.renews', {
                                    date: fmtDate(s.current_period_end, lang),
                                  })
                                : '—'}
                          </span>
                        </span>
                        <span className="entity-row-badges">
                          <SubStatusBadge status={s.status} />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="dlg-section">
                <h3 className="dlg-title">{t('billing.dialog.paymentsTitle')}</h3>
                {data.payments.count === 0 ? (
                  <div className="muted">{t('billing.dialog.paymentsNone')}</div>
                ) : (
                  <div className="badge-line">
                    <span>
                      {t('billing.dialog.paymentsSummary', {
                        count: data.payments.count,
                        total: fmtMoney(data.payments.total_cents, lang),
                      })}
                    </span>
                    {data.payments.to_invoice > 0 && (
                      <span className="badge badge-caution">
                        {t('billing.dialog.paymentsToInvoice', { count: data.payments.to_invoice })}
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={openPayments}
                      data-testid="billing-open-payments"
                    >
                      {t('billing.dialog.paymentsOpen')}
                    </button>
                  </div>
                )}
              </section>
            </div>

            <div className="col-group">
              <section className="dlg-section">
                <h3 className="dlg-title">{t('billing.profile.title')}</h3>
                {!profile ? (
                  <div className="muted">{t('billing.profile.empty')}</div>
                ) : (
                  <>
                    <dl className="kv-grid" data-testid="billing-profile">
                      <dt>{t('billing.profile.legal_name')}</dt>
                      <dd>{profile.legal_name}</dd>
                      <dt>{t('billing.profile.partita_iva')}</dt>
                      <dd className="badge-line">
                        <span className="mono">{profile.partita_iva}</span>
                        <VatBadge status={profile.vat_status} reviewedAt={vatReviewedAt} requestId={profile.vies_request_id} />
                      </dd>
                      <dt>{t('billing.profile.codice_fiscale')}</dt>
                      <dd className="mono">{profile.codice_fiscale || '—'}</dd>
                      <dt>{t('billing.profile.address')}</dt>
                      <dd>
                        {[
                          profile.address,
                          [profile.cap, profile.city].filter(Boolean).join(' '),
                          profile.province ? `(${profile.province})` : null,
                          profile.country,
                        ]
                          .filter((x) => x && String(x).trim() !== '')
                          .join(', ') || '—'}
                      </dd>
                      <dt>{t('billing.profile.sdi_code')}</dt>
                      <dd className="mono">{profile.sdi_code || '—'}</dd>
                      <dt>{t('billing.profile.pec')}</dt>
                      <dd>{profile.pec || '—'}</dd>
                      <dt>{t('billing.profile.billing_email')}</dt>
                      <dd>{profile.billing_email || '—'}</dd>
                      <dt>{t('billing.profile.vies_request_id')}</dt>
                      <dd className="mono">{profile.vies_request_id || '—'}</dd>
                      <dt>{t('billing.profile.vies_checked_at')}</dt>
                      <dd>{fmtDateTime(profile.vies_checked_at, lang)}</dd>
                      <dt>{t('billing.profile.headcount_band')}</dt>
                      <dd>{profile.headcount_band || '—'}</dd>
                    </dl>
                    <div className="lever">
                      <label className="checkbox-row inline-check">
                        <input
                          type="checkbox"
                          checked={recheck}
                          onChange={(e) => setRecheck(e.target.checked)}
                          data-testid="billing-vat-recheck"
                        />
                        <span>{t('billing.vatReview.recheck')}</span>
                      </label>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy !== null}
                        onClick={() => void reviewVat()}
                        data-testid="billing-vat-review"
                      >
                        {busy === 'vat' ? t('common.saving') : t('billing.vatReview.submit')}
                      </button>
                    </div>
                    <span className="muted small">{t('billing.vatReview.hint')}</span>
                  </>
                )}
              </section>

              <section className="dlg-section">
                <h3 className="dlg-title">{t('billing.signup.title')}</h3>
                {!signup ? (
                  <div className="muted">{t('billing.signup.none')}</div>
                ) : (
                  <dl className="kv-grid">
                    <dt>{t('billing.signup.name')}</dt>
                    <dd>{`${signup.first_name} ${signup.last_name}`.trim() || '—'}</dd>
                    <dt>{t('billing.signup.email')}</dt>
                    <dd>{signup.email}</dd>
                    <dt>{t('billing.signup.phone')}</dt>
                    <dd>{signup.phone || '—'}</dd>
                    <dt>{t('billing.signup.planHint')}</dt>
                    <dd>{t(`billing.plan.${signup.plan_hint ?? 'free'}`)}</dd>
                    <dt>{t('billing.signup.utm')}</dt>
                    <dd>{utm.full || '—'}</dd>
                    <dt>{t('billing.signup.requested')}</dt>
                    <dd>{fmtDateTime(signup.created_at, lang)}</dd>
                    <dt>{t('billing.signup.companyCreated')}</dt>
                    <dd>{fmtDateTime(signup.company_created_at, lang)}</dd>
                  </dl>
                )}
              </section>
            </div>
          </div>

          <section className="dlg-section dlg-levers">
            <h3 className="dlg-title">{t('billing.overrides.title')}</h3>
            <p className="muted">{stripeMode ? t('billing.overrides.hint') : t('billing.overrides.managedHint')}</p>
            <form onSubmit={saveOverrides}>
              <div className="grid-4">
                {CAP_FIELDS.map((f) => (
                  <div key={f}>
                    <label className="label" htmlFor={`ov-${f}`}>
                      {t(`billing.overrides.${f}`)}
                    </label>
                    <input
                      id={`ov-${f}`}
                      className="input"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={CAP_MAX[f]}
                      step={1}
                      disabled={!stripeMode}
                      placeholder={
                        planCaps
                          ? t('billing.overrides.fromPlan', { n: planCaps[PLAN_CAP_KEY[f]] })
                          : t('billing.overrides.none')
                      }
                      value={ov.caps[f]}
                      onChange={(e) => {
                        const v = e.target.value;
                        setOv((s) => ({ ...s, caps: { ...s.caps, [f]: v } }));
                      }}
                      data-testid={`billing-override-${f}`}
                    />
                  </div>
                ))}
              </div>
              <div className="lever" style={{ marginTop: '0.625rem' }}>
                {MODULES.map((m) => (
                  <label key={m.key} className="checkbox-row inline-check">
                    <input
                      type="checkbox"
                      disabled={!stripeMode}
                      checked={ov.modules[m.tenantField] === true}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setOv((s) => ({ ...s, modules: { ...s.modules, [m.tenantField]: on } }));
                      }}
                      data-testid={`billing-override-${m.key}`}
                    />
                    <span>{t('billing.overrides.module', { module: t(`modules.${m.key}.name`) })}</span>
                  </label>
                ))}
              </div>
              {ovErr && (
                <div className="form-err" style={{ marginTop: '0.625rem' }}>
                  {ovErr}
                </div>
              )}
              <div className="lever" style={{ marginTop: '0.625rem' }}>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={!stripeMode || busy !== null}
                  data-testid="billing-override-save"
                >
                  {busy === 'overrides' ? t('common.saving') : t('billing.overrides.save')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!stripeMode || busy !== null || !hasOverrides}
                  onClick={() => void clearOverrides()}
                  data-testid="billing-override-clear"
                >
                  {t('billing.overrides.clear')}
                </button>
              </div>
            </form>
          </section>

          <section className="dlg-section dlg-levers">
            <h3 className="dlg-title">{t('billing.mode.title')}</h3>
            <p className="muted">{stripeMode ? t('billing.mode.stripeDesc') : t('billing.mode.managedDesc')}</p>
            <div className="lever">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy !== null}
                onClick={() => setSwitchTo(stripeMode ? 'managed' : 'stripe')}
                data-testid="billing-mode-switch"
              >
                {stripeMode ? t('billing.mode.toManaged') : t('billing.mode.toStripe')}
              </button>
            </div>
          </section>

          <section className="dlg-section dlg-levers">
            <h3 className="dlg-title">{t('billing.sync.title')}</h3>
            <p className="muted">{t('billing.sync.hint')}</p>
            <div className="lever">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy !== null || !data.stripe_customer_id || !data.billing_enabled}
                onClick={() => void sync()}
                data-testid="billing-sync"
              >
                {busy === 'sync' ? t('common.saving') : t('billing.sync.submit')}
              </button>
              {!data.stripe_customer_id && <span className="muted small">{t('billing.dialog.noCustomer')}</span>}
            </div>
          </section>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('actions.close')}
          </button>
        </div>
      </Modal>

      {switchTo && (
        <ModeSwitchDialog
          target={switchTo}
          liveSubs={liveSubs}
          billingEnabled={data.billing_enabled}
          busy={busy === 'mode'}
          onCancel={() => setSwitchTo(null)}
          onConfirm={(subs) => void switchMode(switchTo, subs)}
        />
      )}
    </>
  );
}

// Confirmation for the billing-mode switch. Leaving Stripe asks what to do with
// the subscriptions still charging the customer; nothing is cancelled unless it
// is chosen here (the default keeps them).
function ModeSwitchDialog({
  target,
  liveSubs,
  billingEnabled,
  busy,
  onCancel,
  onConfirm,
}: {
  target: BillingModeKey;
  liveSubs: number;
  billingEnabled: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (subs: SubsChoice) => void;
}) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<SubsChoice>('keep');
  const toManaged = target === 'managed';
  const choices: SubsChoice[] = ['keep', 'cancel_at_period_end', 'cancel_now'];
  return (
    <Modal title={t('billing.mode.confirmTitle')} onClose={onCancel} testId="billing-mode-dialog">
      <div className="modal-body">
        <p style={{ fontSize: '0.9rem' }}>{toManaged ? t('billing.mode.toManagedText') : t('billing.mode.toStripeText')}</p>
        {toManaged && liveSubs > 0 && (
          <div role="radiogroup" aria-label={t('billing.mode.liveSubs', { count: liveSubs })}>
            <div className="label">{t('billing.mode.liveSubs', { count: liveSubs })}</div>
            <div className="choice-list">
              {choices.map((c) => (
                <label key={c} className="choice-row">
                  <input
                    type="radio"
                    name="stripe-subs"
                    value={c}
                    checked={choice === c}
                    disabled={c !== 'keep' && !billingEnabled}
                    onChange={() => setChoice(c)}
                    data-testid={`billing-subs-${c}`}
                  />
                  <span>
                    <strong>{t(`billing.mode.subs.${c}`)}</strong>
                    <span className="muted" style={{ display: 'block' }}>
                      {t(`billing.mode.subs.${c}_hint`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {!billingEnabled && (
              <div className="muted" style={{ marginTop: '0.5rem' }}>
                {t('billing.mode.cancelDisabled')}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {t('actions.cancel')}
        </button>
        <button
          type="button"
          className={`btn ${choice === 'cancel_now' ? 'btn-danger' : 'btn-primary'}`}
          disabled={busy}
          onClick={() => onConfirm(toManaged ? choice : 'keep')}
          data-testid="billing-mode-confirm"
        >
          {busy ? t('common.saving') : toManaged ? t('billing.mode.toManaged') : t('billing.mode.toStripe')}
        </button>
      </div>
    </Modal>
  );
}
