import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { stripeConfigProblems } from './lib/stripe-mode.js';

function loadDotenv(): void {
  const env = process.env.NODE_ENV ?? 'development';
  const path = `.env.${env}`;
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // file optional
  }
}

loadDotenv();

// `KEY=` in an env file means "not configured", not "configured as empty".
const blankIsUnset = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  ADMIN_DATABASE_URL: z.string().optional(),
  GOTRUE_JWT_SECRET: z.string().min(32),
  GOTRUE_JWT_ISSUER: z.string().min(1),
  GOTRUE_JWT_AUDIENCE: z.string().optional(),
  GOTRUE_URL: z.string().min(1),
  GOTRUE_SERVICE_ROLE_KEY: z.string().min(1),
  // Email of the single platform super-user allowed to PERMANENTLY delete a
  // tenant (soft-deletes the tenant + deletes its orphaned members' accounts).
  // Matches the first-admin seed in migration 044. Override in env to point the
  // capability at a different account (or at the e2e admin for the partner suite).
  SUPER_ADMIN_EMAIL: z.string().email().default('michele.lucchese@outlook.it'),
  CORS_ORIGINS: z.string().min(1),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().default(1000),
  BACKEND_URL: z.string().min(1),
  WEB_PUBLIC_URL: z.string().min(1),
  SCHEDULER_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  CRON_SECRET: z.string().min(8),
  TRUSTED_PROXY_HOPS: z.coerce.number().default(0),
  // Observability thresholds. A request at or over SLOW_REQUEST_MS is logged at
  // `warn` instead of `info` so the slow tail is greppable without parsing every
  // line; a single SQL statement at or over SLOW_QUERY_MS gets its own `warn`
  // with the statement text (never the parameters — see lib/request-perf.ts).
  SLOW_REQUEST_MS: z.coerce.number().default(500),
  SLOW_QUERY_MS: z.coerce.number().default(150),
  // Hourly alert: a route whose p95 crosses this (with enough calls in the hour)
  // is mailed to PERF_DIGEST_TO. 0 disables the alert. This is now the only
  // thing perf monitoring mails — the periodic digest is pulled on demand by
  // scripts/perf-digest.ts instead of being sent.
  PERF_ALERT_P95_MS: z.coerce.number().default(1500),
  // Recipient for the hourly perf alert. Defaults to SUPER_ADMIN_EMAIL when
  // unset. Name kept for continuity with the prod .env.
  PERF_DIGEST_TO: z.string().email().optional(),
  DEV_AUTH_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  STORAGE_DRIVER: z.enum(['disk', 'r2']).default('disk'),
  STORAGE_DISK_PATH: z.string().default('./storage'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  NOMINATIM_USER_AGENT: z.string().default('SonoQui/0.1'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  CENTRIFUGO_API_URL: z.string().optional(),
  CENTRIFUGO_API_KEY: z.string().optional(),
  CENTRIFUGO_PROXY_SECRET: z.string().optional(),
  SMTP_HOST: z.string().default('smtp-relay.brevo.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Recipient for website "Contattaci" form submissions (routes/helpdesk.ts).
  HELPDESK_TO: z.string().optional(),
  // The platform's support mailbox: every operator-side notice about a support
  // ticket (a new one, a customer reply) is ALWAYS sent here, on top of the
  // assigned operator or the tenant's managing partner when there is one. It is
  // the address that guarantees a ticket reaches a human even for a tenant no
  // partner manages — which is why it has a default rather than being optional.
  SUPPORT_TICKET_TO: z.string().email().default('michele.lucchese@outlook.it'),
  // Public origin of the partner console, for the "open in the console" link in
  // operator notices. Kept out of WEB_PUBLIC_URL because they are two different
  // apps on two different hostnames.
  PARTNER_PUBLIC_URL: z.string().min(1).default('https://partners.sonoqui.pro'),
  // Cloudflare Turnstile secret. When set, the helpdesk route requires + verifies a token.
  TURNSTILE_SECRET_KEY: z.string().optional(),
  // Bearer secret for the e2e fixture purge endpoint. Endpoint is only
  // registered when this is set; required length keeps brute-force out of reach.
  E2E_PURGE_SECRET: z.string().min(32).optional(),
  // Demo/test tenant the e2e purge + fixture endpoints are HARD-pinned to.
  // Required for the internal-e2e router to mount (see app.ts): every
  // destructive query is scoped to this tenant, so the endpoint can never
  // touch a real customer tenant — even running against production, where
  // the demo tenant lives alongside real ones. This is what makes running
  // e2e against prod safe.
  E2E_TEST_TENANT_ID: z.string().uuid().optional(),
  // Deterministic Documentale OTP for the e2e suite: when set, document OTP
  // requests for E2E_TEST_TENANT_ID return THIS fixed code instead of a random
  // one, so the mutating suite can verify the OTP gate without reading email.
  // Only honoured for the pinned test tenant; never fires for real tenants.
  E2E_FIXED_OTP: z.string().regex(/^\d{6}$/).optional(),
  // Bearer secret for the internal tenant-provisioning endpoint
  // (POST /api/v1/_internal/provision/tenant). The router mounts ONLY when this
  // is set (see app.ts), so a deploy without it has no provisioning route at
  // all — fail closed. The endpoint creates a tenant and invites its first
  // admin via GoTrue /invite. Min length keeps brute-force out of reach.
  PROVISION_SECRET: z.string().min(32).optional(),

  // ── Self-service signup + Stripe billing (Specs/SELF_SERVICE_BILLING.md) ──
  // Both flags default OFF so the code ships dark: with SIGNUP_ENABLED=false the
  // public /signup routes answer 503, with BILLING_ENABLED=false no checkout or
  // portal session can be created (the Free plan and the caps still apply).
  SIGNUP_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  BILLING_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  // Which Stripe key pair the API uses: `sandbox` or `live` (lib/stripe-mode.ts).
  // Both pairs may be configured at once; flipping the mode is an env change +
  // restart, and the billing tables keep each mode's customers apart.
  STRIPE_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
  // Sandbox pair: a sk_test_/rk_test_ key and its webhook destination's signing
  // secret. Locally the secret is any whsec_ value shared with
  // scripts/stripe-dev-webhooks.ts, which signs the events it forwards.
  STRIPE_SANDBOX_SECRET_KEY: blankIsUnset,
  STRIPE_SANDBOX_WEBHOOK_SECRET: blankIsUnset,
  // Live pair: a RESTRICTED key (rk_live_…, scopes in DEPLOY.md) and the live
  // destination's signing secret. Never a full sk_live_ at runtime.
  STRIPE_LIVE_SECRET_KEY: blankIsUnset,
  STRIPE_LIVE_WEBHOOK_SECRET: blankIsUnset,
  // Production + sandbox mode only: the companies (tenant ids, comma-separated)
  // allowed to open Checkout. Everyone else sees "pagamenti non attivi", so a
  // test card can never buy a real company a plan while prod runs the sandbox.
  STRIPE_SANDBOX_TENANTS: z.string().optional(),
  // Our own P.IVA, sent to VIES as the requester so every check returns a
  // consultation number (the legal proof the check was made). Seller:
  // Idealcopy S.r.l. Optional: without it VIES still answers, just unnumbered.
  VIES_REQUESTER_VAT: z
    .string()
    .regex(/^\d{11}$/)
    .optional(),
  VIES_TIMEOUT_MS: z.coerce.number().default(8000),
  // Public origin of the marketing site, for links in signup emails
  // ("registrati di nuovo") and the legal documents referenced at acceptance.
  WEBSITE_PUBLIC_URL: z.string().min(1).default('https://sonoqui.pro'),
  // Hours a signup confirmation link stays valid.
  SIGNUP_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(48),
  // Delete accounts that confirmed their email but never created a company,
  // 90 days after confirmation (with a notice at 80). Off by default: an
  // automated account deletion is worth switching on deliberately.
  SIGNUP_ORPHAN_PURGE_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
});

export const env = Env.parse(process.env);

if (env.NODE_ENV === 'production') {
  if (env.STORAGE_DRIVER !== 'r2') {
    throw new Error('Production document storage requires STORAGE_DRIVER=r2');
  }
  if (env.DEV_AUTH_ENABLED) {
    throw new Error('DEV_AUTH_ENABLED must be false in production');
  }
  if (!env.GOTRUE_JWT_AUDIENCE) {
    console.warn('Warning: GOTRUE_JWT_AUDIENCE not pinned in production');
  }
  // A public signup form without a CAPTCHA is an open account/tenant factory.
  if (env.SIGNUP_ENABLED && !env.TURNSTILE_SECRET_KEY) {
    throw new Error('SIGNUP_ENABLED requires TURNSTILE_SECRET_KEY in production');
  }
}

// Stripe: each key in its own slot, and a complete active pair when billing is
// on (lib/stripe-mode.ts). A misplaced key fails the boot instead of charging
// real cards "in sandbox" — or taking none "in live".
{
  const problems = stripeConfigProblems({
    mode: env.STRIPE_MODE,
    sandboxSecretKey: env.STRIPE_SANDBOX_SECRET_KEY,
    sandboxWebhookSecret: env.STRIPE_SANDBOX_WEBHOOK_SECRET,
    liveSecretKey: env.STRIPE_LIVE_SECRET_KEY,
    liveWebhookSecret: env.STRIPE_LIVE_WEBHOOK_SECRET,
    billingEnabled: env.BILLING_ENABLED,
  });
  if (problems.length) throw new Error(`Stripe configuration: ${problems.join('; ')}`);
  if (env.NODE_ENV === 'production' && env.BILLING_ENABLED && env.STRIPE_MODE === 'sandbox') {
    console.warn('Warning: BILLING_ENABLED in production on the Stripe SANDBOX (STRIPE_MODE=sandbox)');
  }
}

// Fail fast if R2 storage is selected without its credentials — otherwise
// uploads would silently fall back to ephemeral container disk and /download
// would hand back local /raw URLs (documents lost on redeploy).
if (env.STORAGE_DRIVER === 'r2') {
  const missing = (['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const).filter(
    (k) => !env[k]
  );
  if (missing.length) {
    throw new Error(`STORAGE_DRIVER=r2 requires these env vars: ${missing.join(', ')}`);
  }
}
