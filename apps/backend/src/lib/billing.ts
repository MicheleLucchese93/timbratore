import type Stripe from 'stripe';
import type { PoolClient } from 'pg';
import {
  BILLABLE_MODULES,
  MODULE_PRICE_CENTS,
  OVER_LIMIT_GRACE_DAYS,
  PLAN_CAPS,
  PLAN_PRICES_CENTS,
  VAT_RATE_PERCENT,
  billingProfileGaps,
  deriveEntitlements,
  isEntitledStatus,
  isValidCap,
  isValidCodiceFiscale,
  isValidProvincia,
  isValidSdiCode,
  moduleLookupKey,
  overLimitKinds,
  parseLookupKey,
  planLookupKey,
  productLineOf,
  type BillingInterval,
  type EntitlementOverrides,
  type ModuleKey,
  type PaidPlanKey,
} from '@sonoqui/shared';
import { env } from '../env.js';
import { adminPool } from './admin-db.js';
import { AppError, ConflictError, ValidationError } from '../errors/index.js';
import {
  billingEnabled,
  billingOpenFor,
  getCatalog,
  getIvaTaxRateId,
  getPortalConfigurationId,
  getStripe,
  priceFor,
  stripeLivemode,
  tenantLivemode,
} from './stripe.js';
import { invalidateTenantCaches } from './tenant-caches.js';
import { logAuditAs, type AuditAction } from './audit.js';
import { sendMail } from './mailer.js';
import {
  buildBillingActivatedMail,
  buildOperatorPaymentMail,
  buildPaymentFailedMail,
  buildSubscriptionEndedMail,
  type Lang,
} from './billing-mail.js';
import { createLogger } from './logger.js';

// Stripe billing for self-service companies (Specs/SELF_SERVICE_BILLING.md §3.3–3.5).
//
// Topology (D3): one Stripe customer per tenant, one subscription per product
// line — the plan, and each module separately. Every purchase is a Checkout
// Session; plan switches, card updates and cancellations go through the
// Customer Portal (invoice history off); a single module can be cancelled
// in-app (cancel_at_period_end). What a company may use is DERIVED from its
// entitled subscriptions and written onto the tenant row by applyEntitlementsTx,
// the only writer of those columns for billing_mode = 'stripe'.

const logger = createLogger('billing');

export type CheckoutItem =
  | { kind: 'plan'; plan: PaidPlanKey; interval: BillingInterval }
  | { kind: 'module'; module: ModuleKey };

export type PortalFlow = 'payment_method_update' | 'subscription_update' | 'subscription_cancel' | null;

interface SubscriptionRow {
  stripe_subscription_id: string;
  product_line: string;
  price_lookup_key: string;
  status: string;
  billing_interval: string;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  created_at: Date;
}

// ---- small helpers -----------------------------------------------------------

async function lockTenant(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('billing:' || $1))`, [tenantId]);
}

export function itemLabel(parsed: ReturnType<typeof parseLookupKey>, lang: Lang): string {
  if (!parsed) return lang === 'it' ? 'Abbonamento' : 'Subscription';
  if (parsed.kind === 'plan') {
    const name = parsed.plan === 'piccola' ? 'Piccola' : 'Media';
    return lang === 'it' ? `Piano ${name}` : `${name} plan`;
  }
  const name = parsed.module === 'cantieri' ? 'Cantieri' : 'API';
  return lang === 'it' ? `Modulo ${name}` : `${name} module`;
}

async function adminEmails(tenantId: string): Promise<string[]> {
  const r = await adminPool.query(
    `SELECT DISTINCT au.email
       FROM memberships m JOIN auth_users au ON au.id = m.user_id
      WHERE m.tenant_id = $1 AND m.role = 'admin' AND m.active = TRUE AND m.deleted_at IS NULL
        AND au.email IS NOT NULL`,
    [tenantId]
  );
  return r.rows.map((x) => x.email as string);
}

async function notifyAdmins(tenantId: string, mail: { subject: string; text: string; html: string }): Promise<void> {
  const to = await adminEmails(tenantId);
  if (to.length === 0) return;
  await sendMail({ to, ...mail });
}

async function notifyOperator(mail: { subject: string; text: string; html: string }): Promise<void> {
  await sendMail({ to: env.SUPPORT_TICKET_TO, ...mail });
}

function toDate(unix: number | null | undefined): Date | null {
  return typeof unix === 'number' && unix > 0 ? new Date(unix * 1000) : null;
}

function customerIdOf(c: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!c) return null;
  return typeof c === 'string' ? c : c.id;
}

// ---- billing profile -------------------------------------------------------

export interface BillingProfile {
  tenant_id: string;
  legal_name: string;
  partita_iva: string;
  codice_fiscale: string | null;
  address: string | null;
  cap: string | null;
  city: string | null;
  province: string | null;
  country: string;
  sdi_code: string | null;
  pec: string | null;
  billing_email: string | null;
  vat_status: string;
  vies_request_id: string | null;
  vies_checked_at: Date | null;
  headcount_band: string | null;
}

export async function loadBillingProfile(tenantId: string): Promise<BillingProfile | null> {
  const r = await adminPool.query(
    `SELECT tenant_id, legal_name, partita_iva, codice_fiscale, address, cap, city, province, country,
            sdi_code, pec, billing_email, vat_status, vies_request_id, vies_checked_at, headcount_band
       FROM tenant_billing_profiles WHERE tenant_id = $1`,
    [tenantId]
  );
  return (r.rows[0] as BillingProfile | undefined) ?? null;
}

export interface BillingProfilePatch {
  legal_name?: string;
  codice_fiscale?: string | null;
  address?: string;
  cap?: string;
  city?: string;
  province?: string;
  sdi_code?: string | null;
  pec?: string | null;
  billing_email?: string;
}

/**
 * Save the data the fattura elettronica is drafted from. The P.IVA is not
 * editable here: it identifies the company (a different P.IVA is a different
 * customer) and was checked on VIES at registration.
 */
export async function saveBillingProfile(
  tenantId: string,
  actorUserId: string,
  patch: BillingProfilePatch
): Promise<BillingProfile> {
  const bad: string[] = [];
  if (patch.codice_fiscale && !isValidCodiceFiscale(patch.codice_fiscale)) bad.push('codice_fiscale');
  if (patch.sdi_code && !isValidSdiCode(patch.sdi_code)) bad.push('sdi_code');
  if (patch.pec && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.pec)) bad.push('pec');
  if (patch.cap !== undefined && !isValidCap(patch.cap)) bad.push('cap');
  if (patch.province !== undefined && !isValidProvincia(patch.province)) bad.push('province');
  if (bad.length) throw new ValidationError('invalid billing profile', { fieldErrors: Object.fromEntries(bad.map((f) => [f, ['invalid']])) });

  const before = await loadBillingProfile(tenantId);
  if (!before) throw new AppError({ status: 404, code: 'NO_BILLING_PROFILE', message: 'No billing profile' });
  const next = {
    legal_name: patch.legal_name?.trim() || before.legal_name,
    codice_fiscale:
      patch.codice_fiscale === undefined ? before.codice_fiscale : patch.codice_fiscale?.trim().toUpperCase() || null,
    address: patch.address?.trim() ?? before.address,
    cap: patch.cap?.trim() ?? before.cap,
    city: patch.city?.trim() ?? before.city,
    province: patch.province?.trim().toUpperCase() ?? before.province,
    sdi_code: patch.sdi_code === undefined ? before.sdi_code : patch.sdi_code?.trim().toUpperCase() || null,
    pec: patch.pec === undefined ? before.pec : patch.pec?.trim().toLowerCase() || null,
    billing_email: patch.billing_email?.trim().toLowerCase() ?? before.billing_email,
  };
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE tenant_billing_profiles
          SET legal_name = $2, codice_fiscale = $3, address = $4, cap = $5, city = $6, province = $7,
              sdi_code = $8, pec = $9, billing_email = $10, updated_at = now(), updated_by = $11
        WHERE tenant_id = $1`,
      [tenantId, next.legal_name, next.codice_fiscale, next.address, next.cap, next.city, next.province,
        next.sdi_code, next.pec, next.billing_email, actorUserId]
    );
    await logAuditAs(client, tenantId, actorUserId, {
      action: 'billing.profile_update',
      resourceType: 'billing',
      resourceId: tenantId,
      before: pick(before, Object.keys(next)),
      after: next,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  // Keep the Stripe customer's name/email/address in step (receipts are off,
  // but the dashboard and Radar use them). Best effort.
  const customerId = await getCustomerId(tenantId);
  if (customerId && billingEnabled()) {
    try {
      await getStripe().customers.update(customerId, {
        name: next.legal_name,
        email: next.billing_email ?? undefined,
        address: {
          line1: next.address ?? undefined,
          postal_code: next.cap ?? undefined,
          city: next.city ?? undefined,
          state: next.province ?? undefined,
          country: 'IT',
        },
      });
    } catch (err) {
      logger.warn({ err, tenantId }, 'Stripe customer update failed');
    }
  }
  return (await loadBillingProfile(tenantId))!;
}

function pick(obj: object, keys: string[]): Record<string, unknown> {
  const o = obj as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}

// ---- customer / checkout / portal -------------------------------------------

/** The company's Stripe customer in ITS mode (sandbox and live each have their own). */
export async function getCustomerId(tenantId: string): Promise<string | null> {
  const r = await adminPool.query(
    `SELECT stripe_customer_id FROM billing_customers WHERE tenant_id = $1 AND livemode = $2`,
    [tenantId, tenantLivemode(tenantId)]
  );
  return (r.rows[0]?.stripe_customer_id as string | undefined) ?? null;
}

async function ensureCustomer(tenantId: string, profile: BillingProfile): Promise<string> {
  const existing = await getCustomerId(tenantId);
  if (existing) return existing;
  const customer = await getStripe().customers.create(
    {
      name: profile.legal_name,
      email: profile.billing_email ?? undefined,
      address: {
        line1: profile.address ?? undefined,
        postal_code: profile.cap ?? undefined,
        city: profile.city ?? undefined,
        state: profile.province ?? undefined,
        country: 'IT',
      },
      preferred_locales: ['it'],
      tax_id_data: [{ type: 'eu_vat', value: `IT${profile.partita_iva}` }],
      metadata: { tenant_id: tenantId, partita_iva: profile.partita_iva },
    },
    // Two concurrent first checkouts must not create two customers.
    { idempotencyKey: `sonoqui-customer-${tenantId}` }
  );
  await adminPool.query(
    `INSERT INTO billing_customers (tenant_id, stripe_customer_id, livemode)
     VALUES ($1, $2, $3) ON CONFLICT (tenant_id, livemode) DO NOTHING`,
    [tenantId, customer.id, customer.livemode]
  );
  return (await getCustomerId(tenantId))!;
}

async function loadTenantBilling(tenantId: string): Promise<{
  billing_mode: string;
  plan: string;
  language: Lang;
  ragione_sociale: string;
}> {
  const r = await adminPool.query(
    `SELECT billing_mode, plan, language, ragione_sociale FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
    [tenantId]
  );
  if (!r.rowCount) throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'tenant not found' });
  const t = r.rows[0];
  return { ...t, language: t.language === 'en' ? 'en' : 'it' };
}

function requireBillingOpen(tenantId: string): void {
  if (!billingOpenFor(tenantId)) {
    throw new AppError({ status: 503, code: 'BILLING_DISABLED', message: 'Online payments are not active yet' });
  }
}

/** Create a Checkout Session for one plan or module; returns the hosted URL. */
export async function createCheckout(p: {
  tenantId: string;
  actorUserId: string;
  item: CheckoutItem;
}): Promise<{ url: string }> {
  requireBillingOpen(p.tenantId);
  const tenant = await loadTenantBilling(p.tenantId);
  if (tenant.billing_mode !== 'stripe') {
    throw new ConflictError('Billing for this company is managed by its partner', 'BILLING_MANAGED');
  }
  const profile = await loadBillingProfile(p.tenantId);
  const gaps = billingProfileGaps(profile);
  if (!profile || gaps.length) {
    throw new AppError({ status: 422, code: 'PROFILE_INCOMPLETE', message: 'Billing data incomplete', details: { gaps } });
  }
  const lookupKey = p.item.kind === 'plan' ? planLookupKey(p.item.plan, p.item.interval) : moduleLookupKey(p.item.module);
  const productLine = productLineOf(parseLookupKey(lookupKey)!);

  // Refresh the mirror first: a stale row must neither block a legitimate
  // purchase nor let a second subscription for the same line through.
  const existingCustomer = await getCustomerId(p.tenantId);
  if (existingCustomer) await syncCustomer(existingCustomer);
  const live = await adminPool.query(
    `SELECT status FROM billing_subscriptions WHERE tenant_id = $1 AND product_line = $2 AND livemode = $3`,
    [p.tenantId, productLine, tenantLivemode(p.tenantId)]
  );
  if (live.rows.some((r) => isEntitledStatus(r.status as string))) {
    throw new ConflictError('Already subscribed: manage it from the billing portal', 'ALREADY_SUBSCRIBED');
  }

  const [price, taxRateId] = await Promise.all([priceFor(lookupKey), getIvaTaxRateId()]);
  const customerId = await ensureCustomer(p.tenantId, profile);
  const web = env.WEB_PUBLIC_URL.replace(/\/$/, '');
  const meta = { tenant_id: p.tenantId, product_line: productLine, initiated_by: p.actorUserId };
  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: p.tenantId,
    line_items: [{ price: price.priceId, quantity: 1, tax_rates: [taxRateId] }],
    subscription_data: { metadata: meta },
    metadata: meta,
    allow_promotion_codes: true,
    locale: tenant.language === 'en' ? 'en' : 'it',
    billing_address_collection: 'auto',
    // Card (with Apple Pay / Google Pay on top) + Link only — spec D8. The
    // account's dynamic methods include Klarna, Amazon Pay, Satispay…: not
    // what a B2B subscription should be paid with, and asynchronous methods
    // would activate a plan before the money is there.
    payment_method_types: ['card', 'link'],
    consent_collection: { terms_of_service: 'required' },
    custom_text: {
      terms_of_service_acceptance: {
        message:
          tenant.language === 'en'
            ? 'I accept the [terms of service](https://sonoqui.pro/it/termini-e-condizioni/) and the automatic renewal of the subscription until cancelled.'
            : 'Accetto i [termini di servizio](https://sonoqui.pro/it/termini-e-condizioni/) e il rinnovo automatico dell’abbonamento fino a disdetta.',
      },
      submit: {
        message:
          tenant.language === 'en'
            ? 'The electronic invoice (fattura elettronica) is issued by Idealcopy S.r.l. through the SDI system.'
            : 'La fattura elettronica viene emessa da Idealcopy S.r.l. tramite il Sistema di Interscambio (SDI).',
      },
    },
    success_url: `${web}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${web}/checkout/cancel`,
  });
  if (!session.url) throw new AppError({ status: 502, code: 'CHECKOUT_FAILED', message: 'Stripe returned no URL' });
  await logAuditAs(adminPool, p.tenantId, p.actorUserId, {
    action: 'billing.checkout_started',
    resourceType: 'billing',
    resourceId: session.id,
    after: { item: lookupKey },
  });
  return { url: session.url };
}

/** A Customer Portal session, optionally deep-linked into one flow. */
export async function createPortal(p: {
  tenantId: string;
  flow: PortalFlow;
  returnPath?: string;
}): Promise<{ url: string }> {
  requireBillingOpen(p.tenantId);
  const tenant = await loadTenantBilling(p.tenantId);
  const customerId = await getCustomerId(p.tenantId);
  if (!customerId) throw new ConflictError('No payment account yet', 'NO_CUSTOMER');
  const web = env.WEB_PUBLIC_URL.replace(/\/$/, '');
  const returnUrl = `${web}${p.returnPath ?? '/settings/subscription'}`;
  let flow: Stripe.BillingPortal.SessionCreateParams.FlowData | undefined;
  if (p.flow === 'payment_method_update') {
    flow = { type: 'payment_method_update', after_completion: { type: 'redirect', redirect: { return_url: returnUrl } } };
  } else if (p.flow === 'subscription_update' || p.flow === 'subscription_cancel') {
    const plan = await adminPool.query(
      `SELECT stripe_subscription_id, status FROM billing_subscriptions
        WHERE tenant_id = $1 AND product_line = 'plan' AND livemode = $2 ORDER BY created_at DESC`,
      [p.tenantId, tenantLivemode(p.tenantId)]
    );
    const sub = plan.rows.find((r) => isEntitledStatus(r.status as string));
    if (!sub) throw new ConflictError('No active plan to change', 'NO_PLAN_SUBSCRIPTION');
    flow =
      p.flow === 'subscription_update'
        ? { type: 'subscription_update', subscription_update: { subscription: sub.stripe_subscription_id } }
        : { type: 'subscription_cancel', subscription_cancel: { subscription: sub.stripe_subscription_id } };
  }
  const configuration = await getPortalConfigurationId();
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    locale: tenant.language === 'en' ? 'en' : 'it',
    configuration,
    ...(flow ? { flow_data: flow } : {}),
  });
  return { url: session.url };
}

/** Schedule (or undo) the end of one module at the end of the paid period. */
export async function setModuleCancellation(p: {
  tenantId: string;
  actorUserId: string;
  module: ModuleKey;
  cancel: boolean;
}): Promise<void> {
  requireBillingOpen(p.tenantId);
  const r = await adminPool.query(
    `SELECT stripe_subscription_id, status FROM billing_subscriptions
      WHERE tenant_id = $1 AND product_line = $2 AND livemode = $3 ORDER BY created_at DESC`,
    [p.tenantId, `module:${p.module}`, tenantLivemode(p.tenantId)]
  );
  const sub = r.rows.find((x) => isEntitledStatus(x.status as string));
  if (!sub) throw new ConflictError('Module not subscribed', 'MODULE_NOT_SUBSCRIBED');
  const updated = await getStripe().subscriptions.update(sub.stripe_subscription_id as string, {
    cancel_at_period_end: p.cancel,
  });
  await syncCustomer(customerIdOf(updated.customer)!, { actorUserId: p.actorUserId });
}

// ---- sync: Stripe → mirror → entitlements ------------------------------------

/**
 * Re-read every subscription of a customer from Stripe and apply the result.
 * Order-independent by construction: event payloads are only a trigger, the
 * state always comes from the API, fetched while holding the tenant's billing
 * lock so two concurrent webhooks can't apply stale state over fresh.
 */
export async function syncCustomer(
  customerId: string,
  opts: { actorUserId?: string | null } = {}
): Promise<string | null> {
  const map = await adminPool.query(
    `SELECT tenant_id, livemode FROM billing_customers WHERE stripe_customer_id = $1`,
    [customerId]
  );
  const tenantId = map.rows[0]?.tenant_id as string | undefined;
  if (!tenantId) {
    logger.warn({ customerId }, 'Stripe customer not linked to any tenant — ignored');
    return null;
  }
  if (map.rows[0].livemode !== stripeLivemode()) {
    // A customer of the other Stripe mode: this key cannot read it, and its
    // subscriptions must not touch entitlements while the API runs this mode.
    logger.info({ customerId }, 'Stripe customer belongs to the other mode — not synced');
    return null;
  }
  const client = await adminPool.connect();
  let outcome: ApplyOutcome | null = null;
  try {
    await client.query('BEGIN');
    await lockTenant(client, tenantId);
    const prevRows = await client.query(
      `SELECT stripe_subscription_id, cancel_at_period_end, status, product_line, price_lookup_key
         FROM billing_subscriptions WHERE tenant_id = $1 AND livemode = $2`,
      [tenantId, stripeLivemode()]
    );
    const previous = new Map(prevRows.rows.map((r) => [r.stripe_subscription_id as string, r]));

    const subs: Stripe.Subscription[] = [];
    for await (const s of getStripe().subscriptions.list({ customer: customerId, status: 'all', limit: 100 })) {
      subs.push(s);
    }
    for (const s of subs) {
      const item = s.items.data[0];
      const lookupKey = item?.price?.lookup_key ?? null;
      const parsed = parseLookupKey(lookupKey);
      if (!item || !parsed) {
        logger.warn({ subscription: s.id, lookupKey }, 'subscription with an unknown price — not mirrored');
        continue;
      }
      await client.query(
        `INSERT INTO billing_subscriptions
           (stripe_subscription_id, tenant_id, product_line, price_lookup_key, status, billing_interval,
            quantity, current_period_start, current_period_end, cancel_at_period_end, cancel_at,
            canceled_at, ended_at, created_at, livemode, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
         ON CONFLICT (stripe_subscription_id) DO UPDATE SET
           product_line = EXCLUDED.product_line, price_lookup_key = EXCLUDED.price_lookup_key,
           status = EXCLUDED.status, billing_interval = EXCLUDED.billing_interval,
           quantity = EXCLUDED.quantity, current_period_start = EXCLUDED.current_period_start,
           current_period_end = EXCLUDED.current_period_end,
           cancel_at_period_end = EXCLUDED.cancel_at_period_end, cancel_at = EXCLUDED.cancel_at,
           canceled_at = EXCLUDED.canceled_at, ended_at = EXCLUDED.ended_at, synced_at = now()`,
        [
          s.id,
          tenantId,
          productLineOf(parsed),
          lookupKey,
          s.status,
          item.price.recurring?.interval ?? 'month',
          item.quantity ?? 1,
          toDate(item.current_period_start),
          toDate(item.current_period_end),
          s.cancel_at_period_end || (typeof s.cancel_at === 'number' && s.status !== 'canceled'),
          toDate(typeof s.cancel_at === 'number' ? s.cancel_at : null),
          toDate(s.canceled_at),
          toDate(s.ended_at),
          toDate(s.created),
          s.livemode,
        ]
      );
    }
    outcome = await applyEntitlementsTx(client, tenantId, { actorUserId: opts.actorUserId ?? null, previous });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (outcome) await afterApply(outcome);
  return tenantId;
}

/** Re-apply entitlements from the local mirror (overrides edited, mode switched). */
export async function applyEntitlements(tenantId: string, actorUserId: string | null): Promise<void> {
  const client = await adminPool.connect();
  let outcome: ApplyOutcome | null = null;
  try {
    await client.query('BEGIN');
    await lockTenant(client, tenantId);
    outcome = await applyEntitlementsTx(client, tenantId, { actorUserId, previous: null });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (outcome) await afterApply(outcome);
}

interface BillingEvent {
  action: AuditAction;
  label: string;
  kind: 'plan' | 'module';
  notify: 'activated' | 'ended' | null;
  detail: Record<string, unknown>;
}

interface ApplyOutcome {
  tenantId: string;
  companyName: string;
  language: Lang;
  events: BillingEvent[];
  overLimit: boolean;
  changed: boolean;
}

async function applyEntitlementsTx(
  client: PoolClient,
  tenantId: string,
  ctx: { actorUserId: string | null; previous: Map<string, Record<string, unknown>> | null }
): Promise<ApplyOutcome | null> {
  const tr = await client.query(
    `SELECT billing_mode, plan, max_users, max_branches, max_admins, max_documentali,
            cantieri_enabled, api_enabled, entitlement_overrides, over_limit_since,
            ragione_sociale, language
       FROM tenants WHERE id = $1 FOR UPDATE`,
    [tenantId]
  );
  const t = tr.rows[0];
  if (!t || t.billing_mode !== 'stripe') return null;
  const language: Lang = t.language === 'en' ? 'en' : 'it';

  const subs = (
    await client.query(
      `SELECT stripe_subscription_id, product_line, price_lookup_key, status, billing_interval,
              current_period_end, cancel_at_period_end, created_at
         FROM billing_subscriptions WHERE tenant_id = $1 AND livemode = $2 ORDER BY created_at DESC`,
      [tenantId, tenantLivemode(tenantId)]
    )
  ).rows as SubscriptionRow[];
  const entitled = subs.filter((s) => isEntitledStatus(s.status));
  const planSubs = entitled
    .map((s) => ({ s, parsed: parseLookupKey(s.price_lookup_key) }))
    .filter((x): x is { s: SubscriptionRow; parsed: { kind: 'plan'; plan: PaidPlanKey; interval: BillingInterval } } =>
      x.parsed?.kind === 'plan'
    );
  // Two live plan subscriptions should not exist (checkout refuses it); if
  // they ever do, the bigger plan wins rather than the customer losing access.
  const planSub = planSubs.find((x) => x.parsed.plan === 'media') ?? planSubs[0] ?? null;
  const modules = BILLABLE_MODULES.filter((m) => entitled.some((s) => s.product_line === `module:${m}`));
  const ent = deriveEntitlements({
    plan: planSub?.parsed.plan ?? null,
    modules,
    overrides: (t.entitlement_overrides ?? {}) as EntitlementOverrides,
  });

  const usage = (
    await client.query(
      `SELECT
         (SELECT count(*)::int FROM memberships WHERE tenant_id = $1 AND deleted_at IS NULL) AS users,
         (SELECT count(*)::int FROM memberships WHERE tenant_id = $1 AND deleted_at IS NULL AND role = 'admin') AS admins,
         (SELECT count(*)::int FROM branches WHERE tenant_id = $1 AND deleted_at IS NULL) AS branches`,
      [tenantId]
    )
  ).rows[0] as { users: number; admins: number; branches: number };
  const kinds = overLimitKinds(ent, usage);
  const overLimitSince: Date | null = kinds.length ? (t.over_limit_since ?? new Date()) : null;

  const changed =
    t.plan !== ent.plan ||
    t.max_users !== ent.maxUsers ||
    t.max_branches !== ent.maxBranches ||
    t.max_admins !== ent.maxAdmins ||
    t.max_documentali !== ent.maxDocumentali ||
    t.cantieri_enabled !== ent.cantieriEnabled ||
    t.api_enabled !== ent.apiEnabled ||
    (t.over_limit_since === null) !== (overLimitSince === null);

  await client.query(
    `UPDATE tenants
        SET plan = $2, max_users = $3, max_branches = $4, max_admins = $5, max_documentali = $6,
            cantieri_enabled = $7, api_enabled = $8, over_limit_since = $9,
            over_limit_notices = CASE WHEN $9::timestamptz IS NULL THEN 0 ELSE over_limit_notices END,
            pending_plan = CASE WHEN $2 <> 'free' THEN NULL ELSE pending_plan END
      WHERE id = $1`,
    [tenantId, ent.plan, ent.maxUsers, ent.maxBranches, ent.maxAdmins, ent.maxDocumentali,
      ent.cantieriEnabled, ent.apiEnabled, overLimitSince]
  );
  if (ent.cantieriEnabled && !t.cantieri_enabled) {
    // Make the module visible at once: every admin without a Cantieri role
    // becomes its admin (they can hand it on from the Utenti page).
    await client.query(
      `UPDATE memberships SET cantieri_role = 'admin'
        WHERE tenant_id = $1 AND role = 'admin' AND active = TRUE AND deleted_at IS NULL AND cantieri_role IS NULL`,
      [tenantId]
    );
  }

  // Customer-visible trail (Registro attività) + the mails worth sending.
  const events: BillingEvent[] = [];
  const planLabel = (p: string): string => itemLabel({ kind: 'plan', plan: p as PaidPlanKey, interval: 'month' }, language);
  const prevPaid = t.plan === 'piccola' || t.plan === 'media';
  const nowPaid = ent.plan !== 'free';
  if (!prevPaid && nowPaid) {
    events.push({ action: 'billing.plan_started', label: planLabel(ent.plan), kind: 'plan', notify: 'activated', detail: { plan: ent.plan, interval: planSub?.parsed.interval } });
  } else if (prevPaid && nowPaid && t.plan !== ent.plan) {
    events.push({ action: 'billing.plan_changed', label: planLabel(ent.plan), kind: 'plan', notify: 'activated', detail: { from: t.plan, to: ent.plan } });
  } else if (prevPaid && !nowPaid) {
    events.push({ action: 'billing.plan_ended', label: planLabel(t.plan as string), kind: 'plan', notify: 'ended', detail: { plan: t.plan } });
  }
  for (const m of BILLABLE_MODULES) {
    const flag = m === 'cantieri' ? 'cantieri_enabled' : 'api_enabled';
    const was = t[flag] === true;
    const is = m === 'cantieri' ? ent.cantieriEnabled : ent.apiEnabled;
    const label = itemLabel({ kind: 'module', module: m }, language);
    if (!was && is) events.push({ action: 'billing.module_activated', label, kind: 'module', notify: 'activated', detail: { module: m } });
    if (was && !is) events.push({ action: 'billing.module_ended', label, kind: 'module', notify: 'ended', detail: { module: m } });
  }
  if (ctx.previous) {
    for (const s of entitled) {
      const prev = ctx.previous.get(s.stripe_subscription_id);
      if (!prev || prev.cancel_at_period_end === s.cancel_at_period_end) continue;
      const parsed = parseLookupKey(s.price_lookup_key);
      const label = itemLabel(parsed, language);
      const isModule = parsed?.kind === 'module';
      events.push({
        action: s.cancel_at_period_end
          ? isModule ? 'billing.module_cancel_scheduled' : 'billing.plan_changed'
          : isModule ? 'billing.module_resumed' : 'billing.plan_changed',
        label,
        kind: isModule ? 'module' : 'plan',
        notify: null,
        detail: { item: s.price_lookup_key, cancel_at_period_end: s.cancel_at_period_end, ends_at: s.current_period_end },
      });
    }
  }
  for (const e of events) {
    await logAuditAs(client, tenantId, ctx.actorUserId, {
      action: e.action,
      resourceType: 'billing',
      resourceId: tenantId,
      targetLabel: e.label,
      after: e.detail,
    });
  }

  return {
    tenantId,
    companyName: t.ragione_sociale as string,
    language,
    events,
    overLimit: kinds.length > 0,
    changed,
  };
}

async function afterApply(o: ApplyOutcome): Promise<void> {
  if (o.changed || o.events.length) await invalidateTenantCaches(o.tenantId);
  for (const e of o.events) {
    try {
      if (e.notify === 'activated') {
        await notifyAdmins(o.tenantId, buildBillingActivatedMail({ companyName: o.companyName, itemLabel: e.label, language: o.language }));
      } else if (e.notify === 'ended') {
        await notifyAdmins(
          o.tenantId,
          buildSubscriptionEndedMail({
            companyName: o.companyName,
            itemLabel: e.label,
            kind: e.kind,
            overLimit: o.overLimit,
            graceDays: OVER_LIMIT_GRACE_DAYS,
            language: o.language,
          })
        );
      }
    } catch (err) {
      logger.warn({ err, tenantId: o.tenantId }, 'billing notice failed');
    }
  }
}

// ---- invoices → the "da fatturare" ledger -----------------------------------

/** Copy a paid Stripe invoice into billing_payments. Idempotent per invoice. */
export async function recordInvoicePaid(invoiceId: string): Promise<void> {
  const stripe = getStripe();
  const inv = await stripe.invoices.retrieve(invoiceId, { expand: ['payments'] });
  if (inv.status !== 'paid') return;
  const customerId = customerIdOf(inv.customer);
  if (!customerId) return;
  const map = await adminPool.query(`SELECT tenant_id FROM billing_customers WHERE stripe_customer_id = $1`, [customerId]);
  const tenantId = map.rows[0]?.tenant_id as string | undefined;
  if (!tenantId) {
    logger.warn({ invoiceId, customerId }, 'paid invoice for an unlinked customer — not recorded');
    return;
  }
  const total = inv.amount_paid;
  if (total <= 0) return; // nothing was charged (credit, 100% coupon): no fattura needed
  const tax = (inv.total_taxes ?? []).reduce((sum, t) => sum + t.amount, 0);
  const net = inv.total_excluding_tax ?? total - tax;
  // Our own Italian label per line ("Piano Piccola (mensile)"): Stripe's line
  // text is generated in English and is not what goes on a fattura.
  const byPriceId = new Map([...(await getCatalog()).values()].map((c) => [c.priceId, c]));
  const lines = inv.lines.data.map((l) => {
    const price = l.pricing?.price_details?.price;
    const priceId = typeof price === 'string' ? price : (price?.id ?? null);
    const cat = priceId ? byPriceId.get(priceId) : undefined;
    const label = cat
      ? `${itemLabel(cat.parsed, 'it')} (${cat.interval === 'year' ? 'annuale' : 'mensile'})`
      : null;
    return {
      label,
      description: l.description,
      amount_cents: l.amount,
      proration: /prorat|remaining|unused/i.test(l.description ?? ''),
      period_start: toDate(l.period?.start)?.toISOString() ?? null,
      period_end: toDate(l.period?.end)?.toISOString() ?? null,
      price_id: priceId,
      lookup_key: cat?.lookupKey ?? null,
    };
  });
  const starts = inv.lines.data.map((l) => l.period?.start).filter((x): x is number => typeof x === 'number');
  const ends = inv.lines.data.map((l) => l.period?.end).filter((x): x is number => typeof x === 'number');

  let paymentIntentId: string | null = null;
  let chargeId: string | null = null;
  let feeCents: number | null = null;
  const payment = inv.payments?.data.find((p) => p.status === 'paid') ?? inv.payments?.data[0];
  const pi = payment?.payment.payment_intent;
  paymentIntentId = typeof pi === 'string' ? pi : (pi?.id ?? null);
  if (paymentIntentId) {
    try {
      const full = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge.balance_transaction'] });
      const charge = full.latest_charge && typeof full.latest_charge !== 'string' ? full.latest_charge : null;
      chargeId = charge?.id ?? (typeof full.latest_charge === 'string' ? full.latest_charge : null);
      const bt = charge?.balance_transaction;
      feeCents = bt && typeof bt !== 'string' ? bt.fee : null;
    } catch (err) {
      logger.warn({ err, paymentIntentId }, 'could not read the Stripe fee');
    }
  }

  const prof = await adminPool.query(
    `SELECT t.ragione_sociale, p.legal_name, p.partita_iva, p.codice_fiscale, p.address, p.cap, p.city,
            p.province, p.country, p.sdi_code, p.pec, p.billing_email, p.vat_status
       FROM tenants t LEFT JOIN tenant_billing_profiles p ON p.tenant_id = t.id
      WHERE t.id = $1`,
    [tenantId]
  );
  const snapshot = prof.rows[0] ?? {};
  const inserted = await adminPool.query(
    `INSERT INTO billing_payments
       (tenant_id, stripe_invoice_id, stripe_payment_intent_id, stripe_charge_id, livemode, paid_at,
        currency, net_cents, tax_cents, total_cents, fee_cents, period_start, period_end, lines, billing_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb)
     ON CONFLICT (stripe_invoice_id) DO NOTHING
     RETURNING id`,
    [
      tenantId,
      inv.id,
      paymentIntentId,
      chargeId,
      inv.livemode,
      toDate(inv.status_transitions?.paid_at) ?? new Date(),
      inv.currency,
      net,
      tax,
      total,
      feeCents,
      starts.length ? toDate(Math.min(...starts)) : toDate(inv.period_start),
      ends.length ? toDate(Math.max(...ends)) : toDate(inv.period_end),
      JSON.stringify(lines),
      JSON.stringify(snapshot),
    ]
  );
  if (inserted.rowCount) {
    await notifyOperator(
      buildOperatorPaymentMail({
        kind: 'paid',
        companyName: (snapshot.legal_name ?? snapshot.ragione_sociale ?? '—') as string,
        partitaIva: (snapshot.partita_iva ?? null) as string | null,
        totalCents: total,
        description: lines.map((l) => l.label ?? l.description ?? '').filter(Boolean).join(' · ') || '—',
      })
    ).catch((err) => logger.warn({ err }, 'operator payment notice failed'));
  }
}

/** A payment attempt failed: tell the company's admins (and the operator). */
export async function handlePaymentFailed(invoiceId: string): Promise<void> {
  const inv = await getStripe().invoices.retrieve(invoiceId);
  const customerId = customerIdOf(inv.customer);
  if (!customerId) return;
  const map = await adminPool.query(`SELECT tenant_id FROM billing_customers WHERE stripe_customer_id = $1`, [customerId]);
  const tenantId = map.rows[0]?.tenant_id as string | undefined;
  if (!tenantId) return;
  const tenant = await loadTenantBilling(tenantId);
  const firstPrice = inv.lines.data[0]?.pricing?.price_details?.price;
  let lookupKey: string | null = null;
  if (firstPrice && typeof firstPrice !== 'string') lookupKey = firstPrice.lookup_key ?? null;
  else if (typeof firstPrice === 'string') {
    try {
      lookupKey = (await getStripe().prices.retrieve(firstPrice)).lookup_key ?? null;
    } catch {
      lookupKey = null;
    }
  }
  const label = itemLabel(parseLookupKey(lookupKey), tenant.language);
  await logAuditAs(adminPool, tenantId, null, {
    action: 'billing.payment_failed',
    resourceType: 'billing',
    resourceId: inv.id,
    targetLabel: label,
    after: { attempt_count: inv.attempt_count, amount_due: inv.amount_due },
  });
  await notifyAdmins(tenantId, buildPaymentFailedMail({ companyName: tenant.ragione_sociale, itemLabel: label, language: tenant.language }));
  await notifyOperator(
    buildOperatorPaymentMail({
      kind: 'failed',
      companyName: tenant.ragione_sociale,
      partitaIva: (await loadBillingProfile(tenantId))?.partita_iva ?? null,
      totalCents: inv.amount_due,
      description: label,
    })
  ).catch(() => {});
}

/** Refunds and disputes land on the ledger row: a nota di credito may be due. */
export async function handleChargeEvent(kind: 'refunded' | 'disputed', chargeId: string): Promise<void> {
  const charge = await getStripe().charges.retrieve(chargeId);
  const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : (charge.payment_intent?.id ?? null);
  const where = `WHERE stripe_charge_id = $1 OR ($2::text IS NOT NULL AND stripe_payment_intent_id = $2)`;
  const r =
    kind === 'refunded'
      ? await adminPool.query(
          `UPDATE billing_payments SET refunded_cents = $3 ${where}
           RETURNING tenant_id, total_cents, billing_snapshot`,
          [chargeId, piId, charge.amount_refunded]
        )
      : await adminPool.query(
          `UPDATE billing_payments SET disputed = TRUE ${where}
           RETURNING tenant_id, total_cents, billing_snapshot`,
          [chargeId, piId]
        );
  const row = r.rows[0];
  if (!row) return;
  await notifyOperator(
    buildOperatorPaymentMail({
      kind,
      companyName: (row.billing_snapshot?.legal_name ?? row.billing_snapshot?.ragione_sociale ?? '—') as string,
      partitaIva: (row.billing_snapshot?.partita_iva ?? null) as string | null,
      totalCents: kind === 'refunded' ? charge.amount_refunded : (row.total_cents as number),
      description: kind === 'refunded' ? 'Rimborso' : 'Contestazione',
    })
  ).catch(() => {});
}

// ---- read model for the web app ---------------------------------------------

export interface OverLimitState {
  since: string | null;
  deadline: string | null;
  locked: boolean;
  kinds: Array<'users' | 'branches' | 'admins'>;
}

/**
 * Over-limit is evaluated on READ against live counts: deleting the extra
 * users clears it immediately, with no cron in the way. Clears the stored
 * marker when the company fits again.
 */
export async function overLimitState(tenantId: string): Promise<OverLimitState> {
  const r = await adminPool.query(
    `SELECT t.billing_mode, t.max_users, t.max_branches, t.max_admins, t.over_limit_since,
            (SELECT count(*)::int FROM memberships m WHERE m.tenant_id = t.id AND m.deleted_at IS NULL) AS users,
            (SELECT count(*)::int FROM memberships m WHERE m.tenant_id = t.id AND m.deleted_at IS NULL AND m.role = 'admin') AS admins,
            (SELECT count(*)::int FROM branches b WHERE b.tenant_id = t.id AND b.deleted_at IS NULL) AS branches
       FROM tenants t WHERE t.id = $1`,
    [tenantId]
  );
  const t = r.rows[0];
  if (!t || t.billing_mode !== 'stripe' || !t.over_limit_since) {
    return { since: null, deadline: null, locked: false, kinds: [] };
  }
  const kinds = overLimitKinds(
    { maxUsers: t.max_users, maxBranches: t.max_branches, maxAdmins: t.max_admins },
    { users: t.users, branches: t.branches, admins: t.admins }
  );
  if (kinds.length === 0) {
    await adminPool.query(
      `UPDATE tenants SET over_limit_since = NULL, over_limit_notices = 0 WHERE id = $1 AND over_limit_since IS NOT NULL`,
      [tenantId]
    );
    return { since: null, deadline: null, locked: false, kinds: [] };
  }
  const since = new Date(t.over_limit_since);
  const deadline = new Date(since.getTime() + OVER_LIMIT_GRACE_DAYS * 24 * 3600 * 1000);
  return { since: since.toISOString(), deadline: deadline.toISOString(), locked: Date.now() >= deadline.getTime(), kinds };
}

/** Export endpoints call this: 402 once the grace period is over (D7). */
export async function assertExportsAllowed(tenantId: string): Promise<void> {
  const s = await overLimitState(tenantId);
  if (s.locked) {
    throw new AppError({
      status: 402,
      code: 'PLAN_LIMIT_EXCEEDED',
      message: 'Exports are locked until the company fits its plan limits',
      details: { kinds: s.kinds, since: s.since },
    });
  }
}

export async function billingOverview(tenantId: string): Promise<Record<string, unknown>> {
  const t = (
    await adminPool.query(
      `SELECT billing_mode, signup_source, plan, pending_plan, max_users, max_branches, max_admins,
              max_documentali, cantieri_enabled, api_enabled
         FROM tenants WHERE id = $1`,
      [tenantId]
    )
  ).rows[0];
  const usage = (
    await adminPool.query(
      `SELECT
         (SELECT count(*)::int FROM memberships WHERE tenant_id = $1 AND deleted_at IS NULL) AS users,
         (SELECT count(*)::int FROM memberships WHERE tenant_id = $1 AND deleted_at IS NULL AND role = 'admin') AS admins,
         (SELECT count(*)::int FROM branches WHERE tenant_id = $1 AND deleted_at IS NULL) AS branches`,
      [tenantId]
    )
  ).rows[0];
  const subs = (
    await adminPool.query(
      `SELECT stripe_subscription_id AS id, product_line, price_lookup_key, status, billing_interval,
              current_period_end, cancel_at_period_end, cancel_at
         FROM billing_subscriptions WHERE tenant_id = $1 AND livemode = $2 ORDER BY created_at DESC`,
      [tenantId, tenantLivemode(tenantId)]
    )
  ).rows;
  const live = subs.filter((s) => isEntitledStatus(s.status as string));
  const profile = await loadBillingProfile(tenantId);
  const moduleState = (m: ModuleKey): Record<string, unknown> => {
    const sub = live.find((s) => s.product_line === `module:${m}`) ?? null;
    return {
      enabled: m === 'cantieri' ? t.cantieri_enabled : t.api_enabled,
      subscription: sub,
      price_cents: MODULE_PRICE_CENTS[m],
    };
  };
  return {
    billing_mode: t.billing_mode,
    signup_source: t.signup_source,
    billing_enabled: billingOpenFor(tenantId),
    plan: t.plan,
    pending_plan: t.pending_plan,
    limits: {
      max_users: t.max_users,
      max_branches: t.max_branches,
      max_admins: t.max_admins,
      max_documentali: t.max_documentali,
    },
    usage,
    over_limit: await overLimitState(tenantId),
    plan_subscription: live.find((s) => s.product_line === 'plan') ?? null,
    modules: { cantieri: moduleState('cantieri'), api: moduleState('api') },
    subscriptions: subs,
    has_customer: !!(await getCustomerId(tenantId)),
    profile,
    profile_gaps: billingProfileGaps(profile),
    catalog: {
      plans: {
        piccola: { prices: PLAN_PRICES_CENTS.piccola, caps: PLAN_CAPS.piccola },
        media: { prices: PLAN_PRICES_CENTS.media, caps: PLAN_CAPS.media },
      },
      free: { caps: PLAN_CAPS.free },
      modules: MODULE_PRICE_CENTS,
      vat_rate: VAT_RATE_PERCENT,
      grace_days: OVER_LIMIT_GRACE_DAYS,
    },
  };
}

/**
 * State of a Checkout Session this tenant started, for /checkout/success: the
 * session must belong to the tenant (client_reference_id), and a completed one
 * triggers a sync so activation never waits on webhook delivery.
 */
export async function checkoutStatus(
  tenantId: string,
  sessionId: string,
  actorUserId: string
): Promise<{ status: string; product_line: string | null; label: string | null; active: boolean }> {
  requireBillingOpen(tenantId);
  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  if (session.client_reference_id !== tenantId) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'checkout session not found' });
  }
  const productLine = session.metadata?.product_line ?? null;
  const customerId = customerIdOf(session.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null);
  if (session.status === 'complete' && customerId) await syncCustomer(customerId, { actorUserId });
  let active = false;
  let label: string | null = null;
  if (productLine) {
    const r = await adminPool.query(
      `SELECT price_lookup_key, status FROM billing_subscriptions
        WHERE tenant_id = $1 AND product_line = $2 AND livemode = $3 ORDER BY created_at DESC`,
      [tenantId, productLine, tenantLivemode(tenantId)]
    );
    const live = r.rows.find((x) => isEntitledStatus(x.status as string));
    active = !!live;
    const tenant = await loadTenantBilling(tenantId);
    label = itemLabel(parseLookupKey((live ?? r.rows[0])?.price_lookup_key as string | undefined), tenant.language);
  }
  return { status: session.status ?? 'open', product_line: productLine, label, active };
}
