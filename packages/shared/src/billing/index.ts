// Self-service plans, billable modules and Italian fiscal-identifier checks.
//
// One source of truth for the backend (entitlements, Stripe lookup keys), the
// web app (plan cards, billing-profile validation) and the partner console.
// Prices here are the NET amounts (IVA esclusa) and must match both the Stripe
// catalog built by apps/backend/scripts/setup-stripe-products.ts and the public
// pricing page (apps/website/src/components/Pricing.astro).

export type PlanKey = 'free' | 'piccola' | 'media' | 'custom';
export type PaidPlanKey = 'piccola' | 'media';
export type BillingInterval = 'month' | 'year';
export type ModuleKey = 'cantieri' | 'api';
export type BillingMode = 'managed' | 'stripe';
export type SignupSource = 'partner' | 'self_service';

export const PAID_PLANS: readonly PaidPlanKey[] = ['piccola', 'media'];
export const BILLABLE_MODULES: readonly ModuleKey[] = ['cantieri', 'api'];

export interface PlanCaps {
  maxUsers: number;
  maxBranches: number;
  maxAdmins: number;
  maxDocumentali: number;
}

// Users are counted the way every create path already counts them: each
// non-deleted membership, the admin included (so Free = admin + 2 employees).
export const PLAN_CAPS: Record<Exclude<PlanKey, 'custom'>, PlanCaps> = {
  free: { maxUsers: 3, maxBranches: 1, maxAdmins: 1, maxDocumentali: 1 },
  piccola: { maxUsers: 10, maxBranches: 3, maxAdmins: 2, maxDocumentali: 1 },
  media: { maxUsers: 20, maxBranches: 5, maxAdmins: 3, maxDocumentali: 2 },
};

/** Net prices in euro cents, IVA esclusa. Annual = 11 × monthly ("1 mese gratis"). */
export const PLAN_PRICES_CENTS: Record<PaidPlanKey, Record<BillingInterval, number>> = {
  piccola: { month: 2499, year: 27489 },
  media: { month: 3999, year: 43989 },
};

/** Modules are billed monthly only, whatever the plan interval. */
export const MODULE_PRICE_CENTS: Record<ModuleKey, number> = {
  cantieri: 5000,
  api: 5000,
};

/** Italian IVA applied on top of every net price (manual Stripe TaxRate, exclusive). */
export const VAT_RATE_PERCENT = 22;

/** The tenant column each billable module switches on. */
export const MODULE_TENANT_FLAG: Record<ModuleKey, 'cantieri_enabled' | 'api_enabled'> = {
  cantieri: 'cantieri_enabled',
  api: 'api_enabled',
};

/** Days a downgraded company may stay over the free caps before exports lock. */
export const OVER_LIMIT_GRACE_DAYS = 14;

export const HEADCOUNT_BANDS = ['1-3', '4-10', '11-20', '20+'] as const;
export type HeadcountBand = (typeof HEADCOUNT_BANDS)[number];

// ---- Stripe lookup keys ----------------------------------------------------
// Prices are always addressed by lookup_key, never by id, so the sandbox and the
// live account stay interchangeable: the same code resolves both catalogs.

export function planLookupKey(plan: PaidPlanKey, interval: BillingInterval): string {
  return `plan_${plan}_${interval === 'month' ? 'monthly' : 'yearly'}`;
}

export function moduleLookupKey(module: ModuleKey): string {
  return `module_${module}_monthly`;
}

export const ALL_LOOKUP_KEYS: readonly string[] = [
  ...PAID_PLANS.flatMap((p) => [planLookupKey(p, 'month'), planLookupKey(p, 'year')]),
  ...BILLABLE_MODULES.map((m) => moduleLookupKey(m)),
];

export type ParsedLookupKey =
  | { kind: 'plan'; plan: PaidPlanKey; interval: BillingInterval }
  | { kind: 'module'; module: ModuleKey };

export function parseLookupKey(key: string | null | undefined): ParsedLookupKey | null {
  if (!key) return null;
  const plan = /^plan_(piccola|media)_(monthly|yearly)$/.exec(key);
  if (plan) {
    return {
      kind: 'plan',
      plan: plan[1] as PaidPlanKey,
      interval: plan[2] === 'monthly' ? 'month' : 'year',
    };
  }
  const mod = /^module_(cantieri|api)_monthly$/.exec(key);
  if (mod) return { kind: 'module', module: mod[1] as ModuleKey };
  return null;
}

/** 'plan' | 'module:cantieri' | 'module:api' — one Stripe subscription per line. */
export function productLineOf(parsed: ParsedLookupKey): string {
  return parsed.kind === 'plan' ? 'plan' : `module:${parsed.module}`;
}

// ---- Entitlements ----------------------------------------------------------

/** Subscription statuses that keep what was bought (past_due = dunning grace). */
export const ENTITLED_SUBSCRIPTION_STATUSES: readonly string[] = ['active', 'trialing', 'past_due'];

export function isEntitledStatus(status: string | null | undefined): boolean {
  return !!status && ENTITLED_SUBSCRIPTION_STATUSES.includes(status);
}

/** Super-user courtesy extras, merged on top of what the subscriptions grant. */
export interface EntitlementOverrides {
  max_users?: number;
  max_branches?: number;
  max_admins?: number;
  max_documentali?: number;
  cantieri_enabled?: boolean;
  api_enabled?: boolean;
}

export interface Entitlements {
  plan: 'free' | PaidPlanKey;
  maxUsers: number;
  maxBranches: number;
  maxAdmins: number;
  maxDocumentali: number;
  cantieriEnabled: boolean;
  apiEnabled: boolean;
}

/**
 * What a self-service company may use, from what it currently pays for.
 * Overrides can only ADD (max() for caps, OR for flags): a courtesy extra never
 * takes away something that was bought.
 */
export function deriveEntitlements(input: {
  plan: PaidPlanKey | null;
  modules: readonly ModuleKey[];
  overrides?: EntitlementOverrides | null;
}): Entitlements {
  const plan = input.plan ?? 'free';
  const caps = PLAN_CAPS[plan];
  const o = input.overrides ?? {};
  const cap = (base: number, extra: number | undefined): number =>
    typeof extra === 'number' && Number.isFinite(extra) ? Math.max(base, Math.trunc(extra)) : base;
  return {
    plan,
    maxUsers: cap(caps.maxUsers, o.max_users),
    maxBranches: cap(caps.maxBranches, o.max_branches),
    maxAdmins: cap(caps.maxAdmins, o.max_admins),
    maxDocumentali: cap(caps.maxDocumentali, o.max_documentali),
    cantieriEnabled: input.modules.includes('cantieri') || o.cantieri_enabled === true,
    apiEnabled: input.modules.includes('api') || o.api_enabled === true,
  };
}

/** Which caps a company is above, given its entitlements and current usage. */
export function overLimitKinds(
  ent: Pick<Entitlements, 'maxUsers' | 'maxBranches' | 'maxAdmins'>,
  usage: { users: number; branches: number; admins: number }
): Array<'users' | 'branches' | 'admins'> {
  const out: Array<'users' | 'branches' | 'admins'> = [];
  if (usage.users > ent.maxUsers) out.push('users');
  if (usage.branches > ent.maxBranches) out.push('branches');
  if (usage.admins > ent.maxAdmins) out.push('admins');
  return out;
}

/** Euro cents → "24,99 €" (Italian formatting, no currency lib needed). */
export function formatEuroCents(cents: number, locale: 'it' | 'en' = 'it'): string {
  const v = (cents / 100).toFixed(2);
  return locale === 'it' ? `${v.replace('.', ',')} €` : `€${v}`;
}

/** Gross amount (net + IVA) in cents, rounded like Stripe's exclusive tax rates. */
export function grossCents(netCents: number): number {
  return netCents + Math.round((netCents * VAT_RATE_PERCENT) / 100);
}

// ---- Italian fiscal identifiers --------------------------------------------

/** Strip spaces/dots/dashes and an optional "IT" country prefix; uppercase. */
export function normalizePartitaIva(input: string): string {
  let v = input.replace(/[\s.\-_/]/g, '').toUpperCase();
  if (v.startsWith('IT')) v = v.slice(2);
  return v;
}

/**
 * Italian Partita IVA: 11 digits, the last a Luhn-style check digit. All-zero
 * passes the arithmetic but is not a real number, so it is rejected.
 */
export function isValidPartitaIva(value: string): boolean {
  const v = normalizePartitaIva(value);
  if (!/^\d{11}$/.test(v) || v === '00000000000') return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const d = v.charCodeAt(i) - 48;
    if (i % 2 === 0) {
      sum += d;
    } else {
      const x = d * 2;
      sum += x > 9 ? x - 9 : x;
    }
  }
  return (10 - (sum % 10)) % 10 === v.charCodeAt(10) - 48;
}

const CF_ODD: Record<string, number> = {
  '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

function cfEven(ch: string): number {
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57 ? c - 48 : c - 65;
}

/**
 * Codice fiscale: either a person's 16-character code (format + check letter,
 * omocodia letters allowed) or a company's 11-digit numeric code (same checksum
 * as a Partita IVA).
 */
export function isValidCodiceFiscale(value: string): boolean {
  const v = value.replace(/\s/g, '').toUpperCase();
  if (/^\d{11}$/.test(v)) return isValidPartitaIva(v);
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(v)) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = v[i]!;
    sum += i % 2 === 0 ? (CF_ODD[ch] ?? 0) : cfEven(ch);
  }
  return String.fromCharCode(65 + (sum % 26)) === v[15];
}

/** SDI recipient code for e-invoices: 7 alphanumerics ("0000000" = via PEC / cassetto). */
export function isValidSdiCode(value: string): boolean {
  return /^[A-Z0-9]{7}$/.test(value.trim().toUpperCase());
}

export function isValidCap(value: string): boolean {
  return /^\d{5}$/.test(value.trim());
}

export function isValidProvincia(value: string): boolean {
  return /^[A-Z]{2}$/.test(value.trim().toUpperCase());
}

/** What a billing profile needs before a checkout can start (fattura elettronica data). */
export interface BillingProfileInput {
  legal_name: string;
  partita_iva: string;
  codice_fiscale?: string | null;
  address?: string | null;
  cap?: string | null;
  city?: string | null;
  province?: string | null;
  sdi_code?: string | null;
  pec?: string | null;
  billing_email?: string | null;
}

/** Missing/invalid fields that block a checkout; empty array = complete. */
export function billingProfileGaps(p: BillingProfileInput | null | undefined): string[] {
  if (!p) return ['legal_name', 'address', 'cap', 'city', 'province', 'recipient', 'billing_email'];
  const gaps: string[] = [];
  if (!p.legal_name?.trim()) gaps.push('legal_name');
  if (!isValidPartitaIva(p.partita_iva ?? '')) gaps.push('partita_iva');
  if (p.codice_fiscale && !isValidCodiceFiscale(p.codice_fiscale)) gaps.push('codice_fiscale');
  if (!p.address?.trim()) gaps.push('address');
  if (!p.cap || !isValidCap(p.cap)) gaps.push('cap');
  if (!p.city?.trim()) gaps.push('city');
  if (!p.province || !isValidProvincia(p.province)) gaps.push('province');
  const sdiOk = !!p.sdi_code && isValidSdiCode(p.sdi_code);
  const pecOk = !!p.pec && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.pec.trim());
  if (!sdiOk && !pecOk) gaps.push('recipient');
  if (!p.billing_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.billing_email.trim())) {
    gaps.push('billing_email');
  }
  return gaps;
}

// ---- Legal documents accepted during signup --------------------------------
// Recorded in legal_acceptances with every acceptance. Bump the version here in
// the same change that edits the document on the website (src/data/revisions.mjs).
export const LEGAL_VERSIONS = {
  tos: '2026-09-18',
  privacy_ack: '2026-09-18',
  dpa: '2026-09-18',
  art1341: '2026-09-18',
  powers: '2026-09-18',
  paid_terms: '2026-09-18',
  marketing: '2026-09-18',
} as const;
export type LegalDocument = keyof typeof LEGAL_VERSIONS;
