// Stripe sandbox ↔ live switch (Specs/SELF_SERVICE_BILLING.md). Pure helpers,
// kept apart from env.ts so the rules can be unit-tested without booting env.
//
// Both key pairs can sit in the environment at the same time; STRIPE_MODE
// decides which one the API uses. Every Stripe object (customer, subscription,
// invoice) belongs to exactly one mode, and the billing tables carry that
// `livemode` flag, so switching the mode never lets a sandbox purchase grant
// anything in live — or the other way round.

export type StripeMode = 'sandbox' | 'live';

export const STRIPE_MODES = ['sandbox', 'live'] as const;

/** Which mode a secret or restricted key belongs to, from its prefix. */
export function keyMode(key: string | undefined | null): StripeMode | null {
  if (!key) return null;
  if (/^(sk|rk)_test_/.test(key)) return 'sandbox';
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  return null;
}

export interface StripeConfig {
  mode: StripeMode;
  sandboxSecretKey?: string;
  sandboxWebhookSecret?: string;
  liveSecretKey?: string;
  liveWebhookSecret?: string;
  billingEnabled: boolean;
}

/** The key pair STRIPE_MODE selects. */
export function activePair(c: StripeConfig): { secretKey?: string; webhookSecret?: string } {
  return c.mode === 'live'
    ? { secretKey: c.liveSecretKey, webhookSecret: c.liveWebhookSecret }
    : { secretKey: c.sandboxSecretKey, webhookSecret: c.sandboxWebhookSecret };
}

/**
 * Everything wrong with a Stripe configuration, as messages naming the env var
 * to fix. Empty = bootable. A key in the wrong slot is always an error — that is
 * the mistake that would run "sandbox" on real money, or silently not charge.
 */
export function stripeConfigProblems(c: StripeConfig): string[] {
  const problems: string[] = [];
  if (c.sandboxSecretKey && keyMode(c.sandboxSecretKey) !== 'sandbox') {
    problems.push('STRIPE_SANDBOX_SECRET_KEY must be a sandbox key (sk_test_… or rk_test_…)');
  }
  if (c.liveSecretKey && keyMode(c.liveSecretKey) !== 'live') {
    problems.push('STRIPE_LIVE_SECRET_KEY must be a live key (sk_live_… or rk_live_…)');
  }
  for (const [name, value] of [
    ['STRIPE_SANDBOX_WEBHOOK_SECRET', c.sandboxWebhookSecret],
    ['STRIPE_LIVE_WEBHOOK_SECRET', c.liveWebhookSecret],
  ] as const) {
    if (value && !value.startsWith('whsec_')) problems.push(`${name} must be a webhook signing secret (whsec_…)`);
  }
  if (c.billingEnabled) {
    // Billing needs both halves of the ACTIVE pair: the key to create sessions
    // and the secret to trust the webhooks that grant entitlements. Half a
    // configuration would take money without ever activating what was bought.
    const prefix = c.mode === 'live' ? 'STRIPE_LIVE' : 'STRIPE_SANDBOX';
    const pair = activePair(c);
    if (!pair.secretKey) problems.push(`BILLING_ENABLED with STRIPE_MODE=${c.mode} requires ${prefix}_SECRET_KEY`);
    if (!pair.webhookSecret) {
      problems.push(`BILLING_ENABLED with STRIPE_MODE=${c.mode} requires ${prefix}_WEBHOOK_SECRET`);
    }
  }
  return problems;
}

/**
 * Whether a company's LIVE rows are the ones that count for it. The API's mode
 * decides — except on a production running the sandbox, where only the
 * allow-listed test companies use it: every other company keeps what its live
 * subscriptions give it, so a test window can never downgrade a paying
 * customer (or let one start a sandbox purchase).
 */
export function tenantUsesLive(p: { mode: StripeMode; production: boolean; allowlisted: boolean }): boolean {
  if (p.mode === 'live') return true;
  return p.production && !p.allowlisted;
}

/**
 * What the webhook does with a correctly signed event, given its `livemode`
 * and the API's: apply it; defer it (a LIVE event while the API runs the
 * sandbox — answer 503 so Stripe keeps retrying it for up to 3 days, a real
 * payment is never dropped); or ignore it (sandbox test data while live).
 */
export function webhookModeAction(eventLivemode: boolean, apiLivemode: boolean): 'apply' | 'defer' | 'ignore' {
  if (eventLivemode === apiLivemode) return 'apply';
  return eventLivemode ? 'defer' : 'ignore';
}

/** Tenant ids allowed to pay while production runs the sandbox (comma list). */
export function parseTenantList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s));
}
