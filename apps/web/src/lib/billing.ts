import { formatEuroCents, grossCents, type BillingInterval, type ModuleKey, type PaidPlanKey } from '@sonoqui/shared';
import { api } from './api.ts';

// Client for /api/v1/billing (Specs/SELF_SERVICE_BILLING.md). Redirect-only
// Stripe integration: the SPA never loads Stripe.js — it asks the API for a
// hosted Checkout or Customer Portal URL and navigates there.

export interface BillingSubscription {
  id: string;
  product_line: string;
  price_lookup_key: string;
  status: string;
  billing_interval: 'month' | 'year';
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
}

export interface BillingProfile {
  legal_name: string;
  partita_iva: string;
  codice_fiscale: string | null;
  address: string | null;
  cap: string | null;
  city: string | null;
  province: string | null;
  sdi_code: string | null;
  pec: string | null;
  billing_email: string | null;
  vat_status: 'valid' | 'not_in_vies' | 'unavailable';
}

export interface ModuleState {
  enabled: boolean;
  subscription: BillingSubscription | null;
  price_cents: number;
}

export interface BillingOverview {
  billing_mode: 'managed' | 'stripe';
  signup_source: 'partner' | 'self_service';
  billing_enabled: boolean;
  plan: 'free' | 'piccola' | 'media' | 'custom';
  pending_plan: PaidPlanKey | null;
  limits: { max_users: number; max_branches: number; max_admins: number; max_documentali: number };
  usage: { users: number; admins: number; branches: number };
  over_limit: { since: string | null; deadline: string | null; locked: boolean; kinds: string[] };
  plan_subscription: BillingSubscription | null;
  modules: Record<ModuleKey, ModuleState>;
  subscriptions: BillingSubscription[];
  has_customer: boolean;
  profile: BillingProfile | null;
  profile_gaps: string[];
  catalog: {
    plans: Record<PaidPlanKey, { prices: Record<BillingInterval, number>; caps: { maxUsers: number; maxBranches: number; maxAdmins: number; maxDocumentali: number } }>;
    free: { caps: { maxUsers: number; maxBranches: number; maxAdmins: number; maxDocumentali: number } };
    modules: Record<ModuleKey, number>;
    vat_rate: number;
    grace_days: number;
  };
}

export type CheckoutItem =
  | { kind: 'plan'; plan: PaidPlanKey; interval: BillingInterval }
  | { kind: 'module'; module: ModuleKey };

export type PortalFlow = 'payment_method_update' | 'subscription_update' | 'subscription_cancel' | null;

export function getBilling(): Promise<BillingOverview> {
  return api<BillingOverview>('/api/v1/billing');
}

export function refreshBilling(): Promise<BillingOverview> {
  return api<BillingOverview>('/api/v1/billing/refresh', { method: 'POST' });
}

export function saveBillingProfile(patch: Partial<BillingProfile>): Promise<BillingProfile> {
  return api<BillingProfile>('/api/v1/billing/profile', { method: 'PUT', json: patch });
}

/** Ask for a Checkout Session and leave the app for Stripe's hosted page. */
export async function startCheckout(item: CheckoutItem): Promise<void> {
  const { url } = await api<{ url: string }>('/api/v1/billing/checkout', { method: 'POST', json: item });
  window.location.assign(url);
}

/** Open the Stripe Customer Portal (optionally straight into one flow). */
export async function openPortal(flow: PortalFlow = null): Promise<void> {
  const { url } = await api<{ url: string }>('/api/v1/billing/portal', { method: 'POST', json: { flow } });
  window.location.assign(url);
}

export function cancelModule(module: ModuleKey): Promise<BillingOverview> {
  return api<BillingOverview>(`/api/v1/billing/modules/${module}/cancel`, { method: 'POST' });
}

export function resumeModule(module: ModuleKey): Promise<BillingOverview> {
  return api<BillingOverview>(`/api/v1/billing/modules/${module}/resume`, { method: 'POST' });
}

export function dismissPendingPlan(): Promise<unknown> {
  return api('/api/v1/billing/pending-plan/dismiss', { method: 'POST' });
}

export function euro(cents: number, lang: string): string {
  return formatEuroCents(cents, lang === 'en' ? 'en' : 'it');
}

export function euroGross(cents: number, lang: string): string {
  return formatEuroCents(grossCents(cents), lang === 'en' ? 'en' : 'it');
}

export function formatDay(iso: string | null | undefined, lang: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Rome',
  });
}

/** Is a subscription still granting what it sells (past_due = dunning grace)? */
export function isLive(sub: BillingSubscription | null | undefined): boolean {
  return !!sub && ['active', 'trialing', 'past_due'].includes(sub.status);
}

export interface CheckoutStatus {
  status: string;
  product_line: string | null;
  label: string | null;
  active: boolean;
}

export function getCheckoutStatus(sessionId: string): Promise<CheckoutStatus> {
  return api<CheckoutStatus>(`/api/v1/billing/checkout/${encodeURIComponent(sessionId)}`);
}
