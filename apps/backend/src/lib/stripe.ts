import Stripe from 'stripe';
import { ALL_LOOKUP_KEYS, parseLookupKey, type ParsedLookupKey } from '@sonoqui/shared';
import { env } from '../env.js';
import { AppError } from '../errors/index.js';
import { createLogger } from './logger.js';
import { activePair, parseTenantList, tenantUsesLive, type StripeMode } from './stripe-mode.js';

const logger = createLogger('stripe');

// Metadata the setup script (scripts/setup-stripe-products.ts) stamps on the
// objects this code resolves at runtime, so sandbox and live need no id pins.
export const STRIPE_META_KEY = 'sonoqui_key';
export const IVA_TAX_RATE_KEY = 'iva22';
export const PORTAL_CONFIG_KEY = 'portal';

let client: Stripe | null = null;

const pair = () =>
  activePair({
    mode: env.STRIPE_MODE,
    sandboxSecretKey: env.STRIPE_SANDBOX_SECRET_KEY,
    sandboxWebhookSecret: env.STRIPE_SANDBOX_WEBHOOK_SECRET,
    liveSecretKey: env.STRIPE_LIVE_SECRET_KEY,
    liveWebhookSecret: env.STRIPE_LIVE_WEBHOOK_SECRET,
    billingEnabled: env.BILLING_ENABLED,
  });

/** The Stripe mode the API runs in (STRIPE_MODE). */
export function stripeMode(): StripeMode {
  return env.STRIPE_MODE;
}

/**
 * The `livemode` value of every Stripe object this process creates or trusts.
 * Billing rows carry it, and every read that grants or lists something filters
 * on it: a sandbox subscription must never count once the API runs live.
 */
export function stripeLivemode(): boolean {
  return env.STRIPE_MODE === 'live';
}

/** Webhook signing secrets: the active mode's, plus the other one's if set. */
export function webhookSecrets(): { active?: string; other?: string } {
  return env.STRIPE_MODE === 'live'
    ? { active: env.STRIPE_LIVE_WEBHOOK_SECRET, other: env.STRIPE_SANDBOX_WEBHOOK_SECRET }
    : { active: env.STRIPE_SANDBOX_WEBHOOK_SECRET, other: env.STRIPE_LIVE_WEBHOOK_SECRET };
}

/** The active mode has a key — webhooks and syncs run even with BILLING_ENABLED off. */
export function stripeConfigured(): boolean {
  return !!pair().secretKey;
}

/** Billing is live only with the flag AND the active key; the Free plan works without either. */
export function billingEnabled(): boolean {
  return env.BILLING_ENABLED && stripeConfigured();
}

const sandboxTenants = parseTenantList(env.STRIPE_SANDBOX_TENANTS);

/**
 * The `livemode` of the rows that count for ONE company (lib/stripe-mode.ts
 * tenantUsesLive). Equal to stripeLivemode() except on a production running
 * the sandbox, where only STRIPE_SANDBOX_TENANTS use sandbox rows.
 */
export function tenantLivemode(tenantId: string): boolean {
  return tenantUsesLive({
    mode: env.STRIPE_MODE,
    production: env.NODE_ENV === 'production',
    allowlisted: sandboxTenants.includes(tenantId.toLowerCase()),
  });
}

/**
 * The same rule as SQL over a tenant-id column, for list queries. Literals
 * only: the ids were validated as UUIDs by parseTenantList.
 */
export function tenantLivemodeSql(tenantIdColumn: string): string {
  if (env.STRIPE_MODE === 'live') return 'TRUE';
  if (env.NODE_ENV !== 'production') return 'FALSE';
  if (!sandboxTenants.length) return 'TRUE';
  return `(${tenantIdColumn} <> ALL (ARRAY[${sandboxTenants.map((id) => `'${id}'`).join(', ')}]::uuid[]))`;
}

/**
 * Whether THIS company may open Checkout or the portal: billing on, and its
 * rows in the mode the key runs. On a production running the sandbox that is
 * only the listed test companies — anyone else could buy a real plan with a
 * public test card number.
 */
export function billingOpenFor(tenantId: string): boolean {
  return billingEnabled() && tenantLivemode(tenantId) === stripeLivemode();
}

export function getStripe(): Stripe {
  const key = pair().secretKey;
  if (!key) {
    throw new AppError({ status: 503, code: 'BILLING_NOT_CONFIGURED', message: 'Stripe is not configured' });
  }
  if (!client) {
    // The API version is the one pinned by this SDK release (stripe-node 22 →
    // 2026-08-26.dahlia). Pinning it explicitly would only be a second place
    // to forget when the SDK is bumped.
    client = new Stripe(key, {
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: 'sonoQui', url: 'https://sonoqui.pro' },
    });
  }
  return client;
}

/** True while the API runs on the Stripe sandbox. */
export function stripeTestMode(): boolean {
  return env.STRIPE_MODE === 'sandbox';
}

/** Dashboard deep link for a customer of the given mode, for the partner console. */
export function stripeDashboardCustomerUrl(customerId: string, livemode: boolean): string {
  return `https://dashboard.stripe.com/${livemode ? '' : 'test/'}customers/${customerId}`;
}

// ---- catalog ---------------------------------------------------------------

export interface CatalogPrice {
  lookupKey: string;
  priceId: string;
  productId: string;
  productName: string;
  unitAmount: number;
  currency: string;
  interval: 'month' | 'year';
  parsed: ParsedLookupKey;
}

let catalogCache: { at: number; prices: Map<string, CatalogPrice> } | null = null;
const CATALOG_TTL_MS = 60 * 60 * 1000;

/** Active prices by lookup_key, cached for an hour. */
export async function getCatalog(force = false): Promise<Map<string, CatalogPrice>> {
  if (!force && catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.prices;
  }
  const res = await getStripe().prices.list({
    lookup_keys: [...ALL_LOOKUP_KEYS],
    active: true,
    expand: ['data.product'],
    limit: 100,
  });
  const prices = new Map<string, CatalogPrice>();
  for (const p of res.data) {
    const parsed = parseLookupKey(p.lookup_key);
    if (!p.lookup_key || !parsed) continue;
    const product = typeof p.product === 'object' && p.product && !('deleted' in p.product && p.product.deleted)
      ? (p.product as Stripe.Product)
      : null;
    prices.set(p.lookup_key, {
      lookupKey: p.lookup_key,
      priceId: p.id,
      productId: product?.id ?? (typeof p.product === 'string' ? p.product : ''),
      productName: product?.name ?? '',
      unitAmount: p.unit_amount ?? 0,
      currency: p.currency,
      interval: p.recurring?.interval === 'year' ? 'year' : 'month',
      parsed,
    });
  }
  const missing = ALL_LOOKUP_KEYS.filter((k) => !prices.has(k));
  if (missing.length) logger.warn({ missing }, 'Stripe catalog incomplete — run scripts/setup-stripe-products.ts');
  catalogCache = { at: Date.now(), prices };
  return prices;
}

export async function priceFor(lookupKey: string): Promise<CatalogPrice> {
  const price = (await getCatalog()).get(lookupKey) ?? (await getCatalog(true)).get(lookupKey);
  if (!price) {
    throw new AppError({
      status: 503,
      code: 'PRICE_NOT_CONFIGURED',
      message: `No active Stripe price for ${lookupKey}`,
    });
  }
  return price;
}

// ---- IVA tax rate + portal configuration ------------------------------------

let ivaTaxRateId: string | null = null;

export async function getIvaTaxRateId(): Promise<string> {
  if (ivaTaxRateId) return ivaTaxRateId;
  for await (const tr of getStripe().taxRates.list({ active: true, limit: 100 })) {
    if (tr.metadata?.[STRIPE_META_KEY] === IVA_TAX_RATE_KEY) {
      ivaTaxRateId = tr.id;
      return tr.id;
    }
  }
  throw new AppError({
    status: 503,
    code: 'TAX_RATE_NOT_CONFIGURED',
    message: 'IVA 22% tax rate missing — run scripts/setup-stripe-products.ts',
  });
}

let portalConfigId: string | null = null;

/**
 * Our portal configuration (invoice history OFF). Missing is an error, never a
 * fallback: the account's default portal shows Stripe's invoices, which the
 * customer must not receive — the fattura elettronica is issued by hand.
 */
export async function getPortalConfigurationId(): Promise<string> {
  if (portalConfigId) return portalConfigId;
  for await (const c of getStripe().billingPortal.configurations.list({ active: true, limit: 100 })) {
    if (c.metadata?.[STRIPE_META_KEY] === PORTAL_CONFIG_KEY) {
      portalConfigId = c.id;
      return c.id;
    }
  }
  logger.error('portal configuration missing — run scripts/setup-stripe-products.ts');
  throw new AppError({
    status: 503,
    code: 'PORTAL_NOT_CONFIGURED',
    message: 'Customer portal configuration missing — run scripts/setup-stripe-products.ts',
  });
}

/** For tests and the setup script: forget everything resolved so far. */
export function resetStripeCaches(): void {
  catalogCache = null;
  ivaTaxRateId = null;
  portalConfigId = null;
}
