import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activePair,
  keyMode,
  parseTenantList,
  stripeConfigProblems,
  tenantUsesLive,
  webhookModeAction,
} from '../lib/stripe-mode.js';

// The sandbox ↔ live switch (STRIPE_MODE). These rules run at boot (env.ts):
// a key in the wrong slot must stop the API, never run "sandbox" on real money.

test('keyMode reads the mode from secret and restricted key prefixes', () => {
  assert.equal(keyMode('sk_test_abc'), 'sandbox');
  assert.equal(keyMode('rk_test_abc'), 'sandbox');
  assert.equal(keyMode('sk_live_abc'), 'live');
  assert.equal(keyMode('rk_live_abc'), 'live');
  assert.equal(keyMode('pk_live_abc'), null, 'a publishable key is not a secret key');
  assert.equal(keyMode(''), null);
  assert.equal(keyMode(undefined), null);
});

test('STRIPE_MODE picks the pair; nothing configured is fine while billing is off', () => {
  const both = {
    sandboxSecretKey: 'sk_test_1',
    sandboxWebhookSecret: 'whsec_s',
    liveSecretKey: 'rk_live_1',
    liveWebhookSecret: 'whsec_l',
    billingEnabled: true,
  };
  assert.deepEqual(activePair({ ...both, mode: 'sandbox' }), { secretKey: 'sk_test_1', webhookSecret: 'whsec_s' });
  assert.deepEqual(activePair({ ...both, mode: 'live' }), { secretKey: 'rk_live_1', webhookSecret: 'whsec_l' });
  assert.deepEqual(stripeConfigProblems({ ...both, mode: 'live' }), []);
  assert.deepEqual(stripeConfigProblems({ mode: 'sandbox', billingEnabled: false }), []);
});

test('a key in the wrong slot is refused whatever the mode', () => {
  assert.deepEqual(stripeConfigProblems({ mode: 'sandbox', billingEnabled: false, liveSecretKey: 'sk_test_x' }), [
    'STRIPE_LIVE_SECRET_KEY must be a live key (sk_live_… or rk_live_…)',
  ]);
  assert.deepEqual(stripeConfigProblems({ mode: 'live', billingEnabled: false, sandboxSecretKey: 'rk_live_x' }), [
    'STRIPE_SANDBOX_SECRET_KEY must be a sandbox key (sk_test_… or rk_test_…)',
  ]);
  assert.deepEqual(stripeConfigProblems({ mode: 'live', billingEnabled: false, liveWebhookSecret: 'sk_live_oops' }), [
    'STRIPE_LIVE_WEBHOOK_SECRET must be a webhook signing secret (whsec_…)',
  ]);
});

test('billing on needs the ACTIVE pair complete — the idle pair may be missing', () => {
  assert.deepEqual(
    stripeConfigProblems({ mode: 'live', billingEnabled: true, sandboxSecretKey: 'sk_test_1', sandboxWebhookSecret: 'whsec_s' }),
    [
      'BILLING_ENABLED with STRIPE_MODE=live requires STRIPE_LIVE_SECRET_KEY',
      'BILLING_ENABLED with STRIPE_MODE=live requires STRIPE_LIVE_WEBHOOK_SECRET',
    ]
  );
  assert.deepEqual(
    stripeConfigProblems({ mode: 'live', billingEnabled: true, liveSecretKey: 'rk_live_1' }),
    ['BILLING_ENABLED with STRIPE_MODE=live requires STRIPE_LIVE_WEBHOOK_SECRET'],
    'a key without its webhook secret would take money without activating anything'
  );
  assert.deepEqual(
    stripeConfigProblems({ mode: 'sandbox', billingEnabled: true, sandboxSecretKey: 'sk_test_1', sandboxWebhookSecret: 'whsec_s' }),
    []
  );
});

test('STRIPE_SANDBOX_TENANTS keeps only well-formed tenant ids', () => {
  assert.deepEqual(
    parseTenantList(' 26D838E3-B924-4C7C-A591-9553D442DFE1 , nope,, dc1529ee-940e-40bd-a4cc-104a714bd57c'),
    ['26d838e3-b924-4c7c-a591-9553d442dfe1', 'dc1529ee-940e-40bd-a4cc-104a714bd57c']
  );
  assert.deepEqual(parseTenantList(undefined), []);
});

test('a production running the sandbox keeps every non-test company on its live rows', () => {
  // live: everyone is live
  assert.equal(tenantUsesLive({ mode: 'live', production: true, allowlisted: true }), true);
  // production on the sandbox: only the allow-listed test companies use sandbox rows
  assert.equal(tenantUsesLive({ mode: 'sandbox', production: true, allowlisted: true }), false);
  assert.equal(
    tenantUsesLive({ mode: 'sandbox', production: true, allowlisted: false }),
    true,
    'a paying customer must not drop to Free because someone is testing'
  );
  // development / CI on the sandbox: everyone is sandbox
  assert.equal(tenantUsesLive({ mode: 'sandbox', production: false, allowlisted: false }), false);
});

test('webhook: same mode applies, a live event on the sandbox waits, sandbox data on live is dropped', () => {
  assert.equal(webhookModeAction(true, true), 'apply');
  assert.equal(webhookModeAction(false, false), 'apply');
  assert.equal(webhookModeAction(true, false), 'defer', 'real payments are retried by Stripe, never lost');
  assert.equal(webhookModeAction(false, true), 'ignore');
});
