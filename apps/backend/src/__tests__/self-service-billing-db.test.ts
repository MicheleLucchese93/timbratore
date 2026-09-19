import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

// Integration tests for self-service signup + billing (Specs/SELF_SERVICE_BILLING.md
// §9) against a migrated database: the entitlement guard trigger, the signup
// token lifecycle, account-only authentication and the Stripe webhook's
// signature + idempotency layer.
//
// env.ts only fills variables that are still unset, so the flags and the
// test-only Stripe values below win over any local .env — and the modules
// that read env are imported dynamically, AFTER this block. No request leaves
// the machine: the webhook events used here never reach a Stripe API call.
process.env.SIGNUP_ENABLED = 'true';
process.env.DEV_AUTH_ENABLED = 'true';
process.env.STRIPE_MODE = 'sandbox';
process.env.STRIPE_SANDBOX_SECRET_KEY = 'sk_test_unit_only_never_called';
process.env.STRIPE_SANDBOX_WEBHOOK_SECRET = 'whsec_unit_sandbox_only';
// The other mode's destination secret: its events must be acknowledged, never applied.
process.env.STRIPE_LIVE_WEBHOOK_SECRET = 'whsec_unit_live_only';
// Entitlement changes notify company admins: never send mail from a test run.
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';

const { adminPool } = await import('../lib/admin-db.js');
const { pool, withTenantRLS } = await import('../lib/db.js');
const { signupRouter, hashSignupToken } = await import('../routes/signup.js');
const { stripeWebhookRouter } = await import('../routes/stripe-webhook.js');
const { authenticateAccount } = await import('../middleware/account-auth.js');
const { signDevToken } = await import('../lib/jwt.js');
const { signSupportToken } = await import('../lib/support-session.js');
const { getStripe } = await import('../lib/stripe.js');
const { errorHandler } = await import('../middleware/error-handler.js');
const { applyEntitlements } = await import('../lib/billing.js');

const servers: Server[] = [];
const tenantIds: string[] = [];
const userIds: string[] = [];
const signupEmails: string[] = [];
const eventIds: string[] = [];

after(async () => {
  for (const s of servers) await new Promise((r) => s.close(r));
  if (signupEmails.length) {
    const users = await adminPool.query(`SELECT id FROM auth_users WHERE email = ANY($1)`, [signupEmails]);
    userIds.push(...users.rows.map((u) => u.id as string));
    await adminPool.query(`DELETE FROM signup_requests WHERE email = ANY($1)`, [signupEmails]);
  }
  if (userIds.length) {
    await adminPool.query(`DELETE FROM legal_acceptances WHERE user_id = ANY($1)`, [userIds]);
    await adminPool.query(`DELETE FROM memberships WHERE user_id = ANY($1)`, [userIds]);
    await adminPool.query(`DELETE FROM auth_users WHERE id = ANY($1)`, [userIds]);
  }
  if (tenantIds.length) {
    await adminPool.query(`DELETE FROM billing_subscriptions WHERE tenant_id = ANY($1)`, [tenantIds]);
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id = ANY($1)`, [tenantIds]);
    await adminPool.query(`DELETE FROM tenants WHERE id = ANY($1)`, [tenantIds]);
  }
  if (eventIds.length) await adminPool.query(`DELETE FROM stripe_webhook_events WHERE event_id = ANY($1)`, [eventIds]);
  await pool.end();
  await adminPool.end();
});

async function serve(mount: (app: express.Express) => void): Promise<string> {
  const app = express();
  mount(app);
  app.use(errorHandler);
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((r) => server.once('listening', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function post(url: string, body: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

// ── entitlement guard trigger ───────────────────────────────────────────────

async function seedTenantWithAdmin(): Promise<{ tenantId: string; adminId: string }> {
  const tenantId = randomUUID();
  const adminId = randomUUID();
  tenantIds.push(tenantId);
  userIds.push(adminId);
  await adminPool.query(
    `INSERT INTO tenants (id, ragione_sociale, language, max_users) VALUES ($1, $2, 'it', 3)`,
    [tenantId, `GUARD-${Date.now()}`]
  );
  await adminPool.query(`INSERT INTO auth_users (id, email) VALUES ($1, $2)`, [
    adminId,
    `guard-admin-${adminId}@sonoqui.local`,
  ]);
  await adminPool.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'admin')`, [
    tenantId,
    adminId,
  ]);
  return { tenantId, adminId };
}

const NOT_WRITABLE = (e: unknown) =>
  (e as { code?: string }).code === '42501' &&
  /not writable from a tenant request/.test((e as Error).message);

test('guard: a tenant admin edits its settings but can never grant itself a plan, caps or modules', async () => {
  const f = await seedTenantWithAdmin();

  // The Settings page's own columns stay writable (tenants_self_update, 002).
  await withTenantRLS(f.adminId, f.tenantId, (c) =>
    c.query(`UPDATE tenants SET timezone = 'Europe/Rome' WHERE id = $1`, [f.tenantId])
  );

  // Every value differs from the fixture's, so each UPDATE really changes the column.
  const attempts: Array<[string, unknown]> = [
    ['max_users', 99],
    ['max_branches', 9],
    ['cantieri_enabled', true],
    ['api_enabled', true],
    ['plan', 'media'],
    ['billing_mode', 'stripe'],
    ['signup_source', 'self_service'],
    ['over_limit_since', new Date()],
    ['deleted_at', new Date()],
  ];
  for (const [column, value] of attempts) {
    await assert.rejects(
      withTenantRLS(f.adminId, f.tenantId, (c) =>
        c.query(`UPDATE tenants SET ${column} = $2 WHERE id = $1`, [f.tenantId, value])
      ),
      NOT_WRITABLE,
      `the app role must not write ${column}`
    );
  }
});

test('guard: the owner role writes entitlements outside a tenant scope, never inside one', async () => {
  const f = await seedTenantWithAdmin();

  // A request transaction that happens to use the owner pool still carries the
  // tenant GUC — refused, so a future route can't grant entitlements by accident.
  const c = await adminPool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [f.tenantId]);
    await assert.rejects(c.query(`UPDATE tenants SET max_users = 99 WHERE id = $1`, [f.tenantId]), NOT_WRITABLE);
    await c.query('ROLLBACK');
  } finally {
    c.release();
  }

  // The partner console and the billing sync: owner pool, no tenant GUC.
  await adminPool.query(`UPDATE tenants SET max_users = 10, plan = 'piccola' WHERE id = $1`, [f.tenantId]);
  const r = await adminPool.query(`SELECT max_users, plan FROM tenants WHERE id = $1`, [f.tenantId]);
  assert.deepEqual(r.rows[0], { max_users: 10, plan: 'piccola' });
});

// ── signup token lifecycle ─────────────────────────────────────────────────

const PASSWORD = 'Unit#Signup1';
let signupBase: string | null = null;
async function signupUrl(path: string): Promise<string> {
  signupBase ??= await serve((app) => {
    app.use(express.json());
    app.use('/signup', signupRouter);
  });
  return `${signupBase}/signup${path}`;
}

async function seedRequest(opts: { mode?: 'new' | 'existing'; expired?: boolean } = {}) {
  const token = randomBytes(32).toString('base64url');
  const email = `unit-signup-${randomUUID()}@sonoqui.local`;
  signupEmails.push(email);
  await adminPool.query(
    `INSERT INTO signup_requests
       (token_hash, mode, email, first_name, last_name, consents, language, ip, user_agent, created_at, expires_at)
     VALUES ($1, $2, $3, 'Giulia', 'Verdi', $4, 'it', '203.0.113.7', 'unit-test-agent',
             now() - interval '2 hours', $5)`,
    [
      hashSignupToken(token),
      opts.mode ?? 'new',
      email,
      JSON.stringify({
        tos: { accepted: true, version: '2026-09-18' },
        privacy_ack: { accepted: true, version: '2026-09-18' },
        marketing: { accepted: false },
      }),
      new Date(Date.now() + (opts.expired ? -60_000 : 3_600_000)),
    ]
  );
  return { token, email };
}

test('token: unknown and expired links are refused alike (410 SIGNUP_TOKEN_INVALID)', async () => {
  const unknown = await post(await signupUrl('/confirm'), {
    token: randomBytes(32).toString('base64url'),
    password: PASSWORD,
  });
  assert.equal(unknown.status, 410);
  assert.equal(unknown.body.error.code, 'SIGNUP_TOKEN_INVALID');

  const { token } = await seedRequest({ expired: true });
  const expired = await post(await signupUrl('/confirm'), { token, password: PASSWORD });
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error.code, 'SIGNUP_TOKEN_INVALID');
  const preview = await post(await signupUrl('/preview'), { token });
  assert.equal(preview.body.error.code, 'SIGNUP_TOKEN_INVALID');
});

test('token: first use creates the account with the REGISTRATION consents; a second use is SIGNUP_TOKEN_USED', async () => {
  const { token, email } = await seedRequest();
  const preview = await post(await signupUrl('/preview'), { token });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.data.email, email);

  const first = await post(await signupUrl('/confirm'), { token, password: PASSWORD });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.data, { email, mode: 'new' });

  const req = await adminPool.query(`SELECT status, user_id FROM signup_requests WHERE email = $1`, [email]);
  assert.equal(req.rows[0].status, 'email_confirmed');
  const userId = req.rows[0].user_id as string;
  assert.ok(userId);
  const acc = await adminPool.query(
    `SELECT document, host(ip) AS ip, user_agent, accepted_at < now() - interval '1 hour' AS at_registration
       FROM legal_acceptances WHERE user_id = $1 ORDER BY document`,
    [userId]
  );
  // Marketing was declined, so only the two mandatory acceptances exist — and
  // they carry the registration's moment, IP and browser, not the confirm's.
  assert.deepEqual(acc.rows, [
    { document: 'privacy_ack', ip: '203.0.113.7', user_agent: 'unit-test-agent', at_registration: true },
    { document: 'tos', ip: '203.0.113.7', user_agent: 'unit-test-agent', at_registration: true },
  ]);

  const again = await post(await signupUrl('/confirm'), { token, password: PASSWORD });
  assert.equal(again.status, 410);
  assert.equal(again.body.error.code, 'SIGNUP_TOKEN_USED');
  const previewAgain = await post(await signupUrl('/preview'), { token });
  assert.equal(previewAgain.body.error.code, 'SIGNUP_TOKEN_USED');
});

test('token: two concurrent confirmations of one link create exactly one account', async () => {
  const { token, email } = await seedRequest();
  const url = await signupUrl('/confirm');
  const results = await Promise.all([
    post(url, { token, password: PASSWORD }),
    post(url, { token, password: PASSWORD }),
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 410]);
  assert.equal(results.find((r) => r.status === 410)!.body.error.code, 'SIGNUP_TOKEN_USED');
  const users = await adminPool.query(`SELECT count(*)::int AS n FROM auth_users WHERE email = $1`, [email]);
  assert.equal(users.rows[0].n, 1);
});

test('token: an address that already has an account is sent to log in (USE_LOGIN), its password untouched', async () => {
  const { token } = await seedRequest({ mode: 'existing' });
  const r = await post(await signupUrl('/confirm'), { token, password: PASSWORD });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'USE_LOGIN');
});

// ── account-only authentication ────────────────────────────────────────────

async function runAccountAuth(token: string) {
  const req = { header: (n: string) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined) } as any;
  let nextArg: unknown = 'next not called';
  await authenticateAccount(req, {} as any, (e?: unknown) => {
    nextArg = e;
  });
  return { req, nextArg };
}

test('authenticateAccount resolves the person only — never a company — and refuses support tokens', async () => {
  const id = randomUUID();
  const { req, nextArg } = await runAccountAuth(await signDevToken({ sub: id, email: 'Mixed.Case@Example.it' }));
  assert.equal(nextArg, undefined);
  assert.deepEqual(req.account, { id, email: 'mixed.case@example.it' });
  assert.equal(req.user, undefined, 'no tenant/membership context may be attached');

  const support = await signSupportToken({
    partnerUserId: id,
    email: null,
    claim: { sid: randomUUID(), tid: randomUUID() },
    expiresAt: new Date(Date.now() + 60_000),
  });
  const refused = await runAccountAuth(support);
  assert.equal((refused.nextArg as { code?: string }).code, 'SUPPORT_SESSION_INVALID');
  assert.equal(refused.req.account, undefined);
});

// ── Stripe webhook: signature + idempotency ────────────────────────────────

test('webhook: a bad signature is 400; a signed event is processed once, its redelivery acknowledged', async () => {
  const base = await serve((app) => app.use('/webhooks/stripe', stripeWebhookRouter));
  const url = `${base}/webhooks/stripe`;
  const eventId = `evt_unit_${randomBytes(8).toString('hex')}`;
  eventIds.push(eventId);
  // A type the router acknowledges without calling Stripe (default branch).
  const payload = JSON.stringify({
    id: eventId,
    object: 'event',
    type: 'customer.created',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    api_version: '2026-08-26.dahlia',
    data: { object: { id: 'cus_unit', object: 'customer' } },
  });
  const send = (signature: string) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
      body: payload,
    });

  const forged = await send(`t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`);
  assert.equal(forged.status, 400);
  assert.equal(((await forged.json()) as { error: { code: string } }).error.code, 'BAD_SIGNATURE');
  const none = await adminPool.query(`SELECT 1 FROM stripe_webhook_events WHERE event_id = $1`, [eventId]);
  assert.equal(none.rowCount, 0, 'a rejected delivery leaves no trace in the idempotency log');

  const signature = getStripe().webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_SANDBOX_WEBHOOK_SECRET!,
  });
  const first = await send(signature);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { received: true });

  const again = await send(signature);
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { received: true, duplicate: true });

  const row = await adminPool.query(
    `SELECT type, livemode, processed_at IS NOT NULL AS processed FROM stripe_webhook_events WHERE event_id = $1`,
    [eventId]
  );
  assert.deepEqual(row.rows[0], { type: 'customer.created', livemode: false, processed: true });
});

test('webhook: the other mode\'s events are never applied — live ones are deferred for retry', async () => {
  const base = await serve((app) => app.use('/webhooks/stripe', stripeWebhookRouter));
  const url = `${base}/webhooks/stripe`;
  const event = (livemode: boolean) => {
    const id = `evt_unit_${randomBytes(8).toString('hex')}`;
    eventIds.push(id);
    return {
      id,
      payload: JSON.stringify({
        id,
        object: 'event',
        type: 'customer.created',
        livemode,
        created: Math.floor(Date.now() / 1000),
        api_version: '2026-08-26.dahlia',
        data: { object: { id: 'cus_unit', object: 'customer' } },
      }),
    };
  };
  const send = (payload: string, secret: string) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': getStripe().webhooks.generateTestHeaderString({ payload, secret }),
      },
      body: payload,
    });
  const recorded = async (id: string) =>
    (await adminPool.query(`SELECT 1 FROM stripe_webhook_events WHERE event_id = $1`, [id])).rowCount;

  // Signed by the LIVE destination while the API runs the sandbox: real money,
  // so Stripe is told to retry (503) instead of it being dropped or applied.
  const live = event(true);
  const r1 = await send(live.payload, process.env.STRIPE_LIVE_WEBHOOK_SECRET!);
  assert.equal(r1.status, 503);
  assert.equal(((await r1.json()) as { error: { code: string } }).error.code, 'STRIPE_MODE_INACTIVE');
  assert.equal(await recorded(live.id), 0);

  // Signed with the sandbox secret but carrying a live object: same, never applied.
  const mislabeled = event(true);
  const r2 = await send(mislabeled.payload, process.env.STRIPE_SANDBOX_WEBHOOK_SECRET!);
  assert.equal(r2.status, 503);
  assert.equal(await recorded(mislabeled.id), 0);

  // An unknown signer is still a 400, whatever the mode.
  const forged = event(false);
  const r3 = await send(forged.payload, 'whsec_someone_else');
  assert.equal(r3.status, 400);
});

test('mode scoping: a subscription from the other Stripe mode never grants anything', async () => {
  const f = await seedTenantWithAdmin();
  await adminPool.query(`UPDATE tenants SET billing_mode = 'stripe', plan = 'free' WHERE id = $1`, [f.tenantId]);
  const sub = async (livemode: boolean, lookupKey: string, productLine: string) => {
    await adminPool.query(
      `INSERT INTO billing_subscriptions
         (stripe_subscription_id, tenant_id, livemode, product_line, price_lookup_key, status, billing_interval,
          current_period_end)
       VALUES ($1, $2, $3, $4, $5, 'active', 'month', now() + interval '20 days')`,
      [`sub_unit_${randomBytes(6).toString('hex')}`, f.tenantId, livemode, productLine, lookupKey]
    );
  };
  const tenant = async () =>
    (
      await adminPool.query(`SELECT plan, max_users, max_branches, api_enabled FROM tenants WHERE id = $1`, [f.tenantId])
    ).rows[0];

  // A LIVE Media plan + API module, while the API runs the sandbox: Free stays Free.
  await sub(true, 'plan_media_monthly', 'plan');
  await sub(true, 'module_api_monthly', 'module:api');
  await applyEntitlements(f.tenantId, null);
  assert.deepEqual(await tenant(), { plan: 'free', max_users: 3, max_branches: 1, api_enabled: false });

  // The same purchase in the sandbox counts.
  await sub(false, 'plan_piccola_monthly', 'plan');
  await applyEntitlements(f.tenantId, null);
  assert.deepEqual(await tenant(), { plan: 'piccola', max_users: 10, max_branches: 3, api_enabled: false });
});
