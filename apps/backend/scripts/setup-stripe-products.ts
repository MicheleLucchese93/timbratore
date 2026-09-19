/**
 * Idempotent bootstrap of the Stripe side of self-service billing
 * (Specs/SELF_SERVICE_BILLING.md §6). Safe to re-run; creates or updates:
 *
 *   - 4 products (Piano Piccola, Piano Media, Modulo Cantieri, Modulo API),
 *     matched by metadata.sonoqui_key
 *   - 6 prices, addressed by lookup_key (never by id), net EUR, tax exclusive.
 *     A changed amount creates a NEW price and moves the lookup key onto it
 *     (transfer_lookup_key) — existing subscriptions keep their old price.
 *   - the manual "IVA 22%" tax rate (exclusive, IT), metadata.sonoqui_key=iva22
 *   - the Customer Portal configuration (invoice history OFF, cancel at period
 *     end, plan switching between Piccola/Media), metadata.sonoqui_key=portal
 *
 * Works against the sandbox and the live account alike: STRIPE_MODE decides
 * which configured key is used (STRIPE_SANDBOX_SECRET_KEY / STRIPE_LIVE_SECRET_KEY).
 *
 *   npx tsx scripts/setup-stripe-products.ts            # apply
 *   npx tsx scripts/setup-stripe-products.ts --dry-run  # show what would change
 *   STRIPE_MODE=live npx tsx scripts/setup-stripe-products.ts --dry-run
 *
 * Account-level settings that have no API (customer emails off, branding,
 * public details, payment methods) are listed at the end as a checklist.
 */
import type Stripe from 'stripe';
import {
  BILLABLE_MODULES,
  MODULE_PRICE_CENTS,
  PAID_PLANS,
  PLAN_CAPS,
  PLAN_PRICES_CENTS,
  VAT_RATE_PERCENT,
  moduleLookupKey,
  planLookupKey,
  type BillingInterval,
} from '@sonoqui/shared';
import {
  IVA_TAX_RATE_KEY,
  PORTAL_CONFIG_KEY,
  STRIPE_META_KEY,
  getStripe,
  stripeTestMode,
} from '../src/lib/stripe.js';

const DRY = process.argv.includes('--dry-run');
const SITE = 'https://sonoqui.pro';

interface ProductSpec {
  key: string;
  name: string;
  description: string;
}

interface PriceSpec {
  lookupKey: string;
  productKey: string;
  amount: number;
  interval: BillingInterval;
  nickname: string;
}

const PRODUCTS: ProductSpec[] = [
  {
    key: 'plan_piccola',
    name: 'sonoQui — Piano Piccola',
    description: `Rilevazione presenze fino a ${PLAN_CAPS.piccola.maxUsers} utenti e ${PLAN_CAPS.piccola.maxBranches} sedi.`,
  },
  {
    key: 'plan_media',
    name: 'sonoQui — Piano Media',
    description: `Rilevazione presenze fino a ${PLAN_CAPS.media.maxUsers} utenti e ${PLAN_CAPS.media.maxBranches} sedi.`,
  },
  {
    key: 'module_cantieri',
    name: 'sonoQui — Modulo Cantieri',
    description: 'Attività di cantiere, mezzi, campi personalizzati e report PDF.',
  },
  {
    key: 'module_api',
    name: 'sonoQui — Modulo API',
    description: 'API REST per integrare sonoQui con gestionali, tornelli e BI.',
  },
];

const PRICES: PriceSpec[] = [
  ...PAID_PLANS.flatMap((plan) =>
    (['month', 'year'] as const).map((interval) => ({
      lookupKey: planLookupKey(plan, interval),
      productKey: `plan_${plan}`,
      amount: PLAN_PRICES_CENTS[plan][interval],
      interval,
      nickname: `${plan === 'piccola' ? 'Piccola' : 'Media'} ${interval === 'month' ? 'mensile' : 'annuale'}`,
    }))
  ),
  ...BILLABLE_MODULES.map((m) => ({
    lookupKey: moduleLookupKey(m),
    productKey: `module_${m}`,
    amount: MODULE_PRICE_CENTS[m],
    interval: 'month' as const,
    nickname: `${m === 'cantieri' ? 'Cantieri' : 'API'} mensile`,
  })),
];

function log(action: string, what: string): void {
  // eslint-disable-next-line no-console
  console.log(`${DRY ? '[dry-run] ' : ''}${action.padEnd(9)} ${what}`);
}

async function ensureProducts(stripe: Stripe): Promise<Map<string, string>> {
  const byKey = new Map<string, Stripe.Product>();
  for await (const p of stripe.products.list({ limit: 100 })) {
    const k = p.metadata?.[STRIPE_META_KEY];
    if (k && !byKey.has(k)) byKey.set(k, p);
  }
  const ids = new Map<string, string>();
  for (const spec of PRODUCTS) {
    const existing = byKey.get(spec.key);
    if (!existing) {
      log('create', `product ${spec.key}`);
      if (!DRY) {
        const p = await stripe.products.create({
          name: spec.name,
          description: spec.description,
          metadata: { [STRIPE_META_KEY]: spec.key },
        });
        ids.set(spec.key, p.id);
      } else ids.set(spec.key, `prod_dry_${spec.key}`);
      continue;
    }
    ids.set(spec.key, existing.id);
    if (existing.name !== spec.name || existing.description !== spec.description || !existing.active) {
      log('update', `product ${spec.key} (${existing.id})`);
      if (!DRY) {
        await stripe.products.update(existing.id, {
          name: spec.name,
          description: spec.description,
          active: true,
        });
      }
    } else log('ok', `product ${spec.key} (${existing.id})`);
  }
  return ids;
}

async function ensurePrices(stripe: Stripe, productIds: Map<string, string>): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const spec of PRICES) {
    const productId = productIds.get(spec.productKey)!;
    const found = await stripe.prices.list({ lookup_keys: [spec.lookupKey], limit: 1 });
    const current = found.data[0];
    const matches =
      current &&
      current.active &&
      current.unit_amount === spec.amount &&
      current.currency === 'eur' &&
      current.recurring?.interval === spec.interval &&
      current.recurring?.interval_count === 1 &&
      current.tax_behavior === 'exclusive' &&
      (typeof current.product === 'string' ? current.product : current.product.id) === productId;
    if (matches) {
      log('ok', `price ${spec.lookupKey} (${current.id}) ${spec.amount}c/${spec.interval}`);
      ids.set(spec.lookupKey, current.id);
      continue;
    }
    log(current ? 'replace' : 'create', `price ${spec.lookupKey} ${spec.amount}c/${spec.interval}`);
    if (DRY) continue;
    const created = await stripe.prices.create({
      product: productId,
      currency: 'eur',
      unit_amount: spec.amount,
      recurring: { interval: spec.interval, interval_count: 1 },
      tax_behavior: 'exclusive',
      lookup_key: spec.lookupKey,
      transfer_lookup_key: true,
      nickname: spec.nickname,
      metadata: { [STRIPE_META_KEY]: spec.lookupKey },
    });
    ids.set(spec.lookupKey, created.id);
    if (current && current.active) {
      await stripe.prices.update(current.id, { active: false });
      log('archive', `price ${current.id} (superseded)`);
    }
  }
  return ids;
}

async function ensureTaxRate(stripe: Stripe): Promise<string | null> {
  for await (const tr of stripe.taxRates.list({ active: true, limit: 100 })) {
    if (tr.metadata?.[STRIPE_META_KEY] === IVA_TAX_RATE_KEY) {
      if (tr.percentage !== VAT_RATE_PERCENT || tr.inclusive) {
        throw new Error(
          `Tax rate ${tr.id} tagged ${IVA_TAX_RATE_KEY} is ${tr.percentage}% inclusive=${tr.inclusive}; ` +
            'tax rates are immutable — archive it in the dashboard and re-run.'
        );
      }
      log('ok', `tax rate IVA ${tr.percentage}% (${tr.id})`);
      return tr.id;
    }
  }
  log('create', `tax rate IVA ${VAT_RATE_PERCENT}% exclusive IT`);
  if (DRY) return null;
  const tr = await stripe.taxRates.create({
    display_name: 'IVA',
    description: `IVA ${VAT_RATE_PERCENT}% (Italia)`,
    percentage: VAT_RATE_PERCENT,
    inclusive: false,
    country: 'IT',
    jurisdiction: 'IT',
    tax_type: 'vat',
    metadata: { [STRIPE_META_KEY]: IVA_TAX_RATE_KEY },
  });
  return tr.id;
}

async function ensurePortal(
  stripe: Stripe,
  productIds: Map<string, string>,
  priceIds: Map<string, string>
): Promise<string | null> {
  const planProducts = PAID_PLANS.map((plan) => ({
    product: productIds.get(`plan_${plan}`)!,
    prices: [planLookupKey(plan, 'month'), planLookupKey(plan, 'year')]
      .map((k) => priceIds.get(k))
      .filter((v): v is string => !!v),
  }));
  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    // Billing data belongs to the app (it feeds the fattura elettronica).
    customer_update: { enabled: false },
    // Customers never see a Stripe invoice: fatture are issued outside Stripe.
    invoice_history: { enabled: false },
    payment_method_update: { enabled: true },
    subscription_cancel: {
      enabled: true,
      mode: 'at_period_end',
      proration_behavior: 'none',
      cancellation_reason: {
        enabled: true,
        options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other'],
      },
    },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      products: planProducts,
      proration_behavior: 'always_invoice',
      schedule_at_period_end: {
        conditions: [{ type: 'decreasing_item_amount' }, { type: 'shortening_interval' }],
      },
    },
  };
  const businessProfile = {
    headline: 'sonoQui — gestisci il tuo abbonamento',
    privacy_policy_url: `${SITE}/it/privacy-policy/`,
    terms_of_service_url: `${SITE}/it/termini-e-condizioni/`,
  };
  let existing: Stripe.BillingPortal.Configuration | null = null;
  for await (const c of stripe.billingPortal.configurations.list({ active: true, limit: 100 })) {
    if (c.metadata?.[STRIPE_META_KEY] === PORTAL_CONFIG_KEY) {
      existing = c;
      break;
    }
  }
  if (existing) {
    log('update', `portal configuration (${existing.id})`);
    if (!DRY) {
      await stripe.billingPortal.configurations.update(existing.id, {
        features,
        business_profile: businessProfile,
        name: 'sonoQui self-service',
      });
    }
    return existing.id;
  }
  log('create', 'portal configuration');
  if (DRY) return null;
  const c = await stripe.billingPortal.configurations.create({
    features,
    business_profile: businessProfile,
    name: 'sonoQui self-service',
    metadata: { [STRIPE_META_KEY]: PORTAL_CONFIG_KEY },
  });
  return c.id;
}

async function main(): Promise<void> {
  const stripe = getStripe();
  const account = await stripe.accounts.retrieveCurrent();
  // eslint-disable-next-line no-console
  console.log(
    `Stripe account ${account.id} (${account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? '—'}), ` +
      `${stripeTestMode() ? 'TEST/SANDBOX' : 'LIVE'} mode${DRY ? ', dry run' : ''}\n`
  );
  const productIds = await ensureProducts(stripe);
  const priceIds = await ensurePrices(stripe, productIds);
  const taxRateId = await ensureTaxRate(stripe);
  const portalId = await ensurePortal(stripe, productIds, priceIds);
  // eslint-disable-next-line no-console
  console.log(`
Found at runtime by their sonoqui_key metadata (nothing to copy into .env):
  IVA 22% tax rate  ${taxRateId ?? '(dry run)'}
  portal config     ${portalId ?? '(dry run)'}

Dashboard-only settings (no API) — check once per account:
  - Impostazioni → Billing → Abbonamenti ed email: every customer email OFF
    (fatture finalizzate, promemoria, pagamenti falliti, carte in scadenza);
    "se tutti i tentativi falliscono → annulla l'abbonamento"
  - Impostazioni → Business → Email ai clienti: ricevute pagamenti OFF
  - Impostazioni → Branding: logo, colore #15569e
  - Impostazioni → Dettagli pubblici: email assistenza, URL termini/privacy
    (needed by Checkout consent_collection.terms_of_service)
  - Impostazioni → Metodi di pagamento: carte + Link
  - Webhook destination → https://api.sonoqui.pro/api/v1/webhooks/stripe (live)
`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
