import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_LOOKUP_KEYS,
  billingProfileGaps,
  deriveEntitlements,
  grossCents,
  isEntitledStatus,
  isValidCodiceFiscale,
  isValidPartitaIva,
  moduleLookupKey,
  normalizePartitaIva,
  overLimitKinds,
  parseLookupKey,
  planLookupKey,
  productLineOf,
} from '../billing/index.ts';

// Builds a valid P.IVA from any 10-digit body, so the vectors don't depend on
// real companies' numbers.
function withCheckDigit(body: string): string {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const d = Number(body[i]);
    if (i % 2 === 0) sum += d;
    else sum += d * 2 > 9 ? d * 2 - 9 : d * 2;
  }
  return body + String((10 - (sum % 10)) % 10);
}

test('partita IVA checksum', () => {
  assert.equal(isValidPartitaIva('01234567897'), true); // hand-computed check digit 7
  assert.equal(isValidPartitaIva('01234567890'), false);
  assert.equal(isValidPartitaIva('IT 012 345 678 97'), true); // prefix + spaces normalised
  assert.equal(isValidPartitaIva('00000000000'), false); // arithmetic passes, not a number
  assert.equal(isValidPartitaIva('1234567890'), false); // 10 digits
  assert.equal(isValidPartitaIva('0123456789A'), false);
  for (const body of ['1000000000', '9876543210', '5555555555', '0808080808']) {
    const v = withCheckDigit(body);
    assert.equal(isValidPartitaIva(v), true, v);
    const wrong = v.slice(0, 10) + String((Number(v[10]) + 1) % 10);
    assert.equal(isValidPartitaIva(wrong), false, wrong);
  }
  assert.equal(normalizePartitaIva('it01234567897'), '01234567897');
});

test('codice fiscale: person (16) and company (11)', () => {
  assert.equal(isValidCodiceFiscale('RSSMRA85T10A562S'), true);
  assert.equal(isValidCodiceFiscale('rssmra85t10a562s'), true);
  assert.equal(isValidCodiceFiscale('RSSMRA85T10A562T'), false); // wrong check letter
  assert.equal(isValidCodiceFiscale('RSSMRA85T10A562'), false); // 15 chars
  assert.equal(isValidCodiceFiscale('01234567897'), true); // company CF = P.IVA rules
  assert.equal(isValidCodiceFiscale('01234567890'), false);
});

test('lookup keys round-trip', () => {
  assert.equal(planLookupKey('piccola', 'month'), 'plan_piccola_monthly');
  assert.equal(planLookupKey('media', 'year'), 'plan_media_yearly');
  assert.equal(moduleLookupKey('api'), 'module_api_monthly');
  for (const key of ALL_LOOKUP_KEYS) {
    const parsed = parseLookupKey(key);
    assert.ok(parsed, key);
  }
  assert.deepEqual(parseLookupKey('plan_media_yearly'), { kind: 'plan', plan: 'media', interval: 'year' });
  assert.deepEqual(parseLookupKey('module_cantieri_monthly'), { kind: 'module', module: 'cantieri' });
  assert.equal(parseLookupKey('plan_enterprise_monthly'), null);
  assert.equal(parseLookupKey(null), null);
  assert.equal(productLineOf({ kind: 'module', module: 'api' }), 'module:api');
  assert.equal(ALL_LOOKUP_KEYS.length, 6);
});

test('entitlements: free baseline, plans, modules', () => {
  const free = deriveEntitlements({ plan: null, modules: [] });
  assert.deepEqual(free, {
    plan: 'free',
    maxUsers: 3,
    maxBranches: 1,
    maxAdmins: 1,
    maxDocumentali: 1,
    cantieriEnabled: false,
    apiEnabled: false,
  });
  const media = deriveEntitlements({ plan: 'media', modules: ['api'] });
  assert.equal(media.maxUsers, 20);
  assert.equal(media.maxBranches, 5);
  assert.equal(media.apiEnabled, true);
  assert.equal(media.cantieriEnabled, false);
  // A module bought on the free plan (allowed: D14) keeps free caps.
  const freeWithCantieri = deriveEntitlements({ plan: null, modules: ['cantieri'] });
  assert.equal(freeWithCantieri.plan, 'free');
  assert.equal(freeWithCantieri.maxUsers, 3);
  assert.equal(freeWithCantieri.cantieriEnabled, true);
});

test('entitlements: overrides only add', () => {
  const e = deriveEntitlements({
    plan: 'piccola',
    modules: [],
    overrides: { max_users: 12, max_branches: 1, cantieri_enabled: true, api_enabled: false },
  });
  assert.equal(e.maxUsers, 12); // raised
  assert.equal(e.maxBranches, 3); // an override below the plan never lowers it
  assert.equal(e.cantieriEnabled, true);
  assert.equal(e.apiEnabled, false);
  const withBought = deriveEntitlements({
    plan: null,
    modules: ['api'],
    overrides: { api_enabled: false },
  });
  assert.equal(withBought.apiEnabled, true); // an override cannot switch off a paid module
});

test('entitled statuses', () => {
  for (const s of ['active', 'trialing', 'past_due']) assert.equal(isEntitledStatus(s), true, s);
  for (const s of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', '', null]) {
    assert.equal(isEntitledStatus(s), false, String(s));
  }
});

test('over-limit kinds', () => {
  const free = deriveEntitlements({ plan: null, modules: [] });
  assert.deepEqual(overLimitKinds(free, { users: 3, branches: 1, admins: 1 }), []);
  assert.deepEqual(overLimitKinds(free, { users: 7, branches: 2, admins: 1 }), ['users', 'branches']);
});

test('gross amount with 22% IVA', () => {
  assert.equal(grossCents(5000), 6100);
  assert.equal(grossCents(2499), 3049); // 549.78 rounds to 550
});

test('billing profile completeness', () => {
  const complete = {
    legal_name: 'Acme Srl',
    partita_iva: '01234567897',
    codice_fiscale: '01234567897',
    address: 'Via Roma 1',
    cap: '37100',
    city: 'Verona',
    province: 'vr',
    sdi_code: 'M5UXCR1',
    pec: null,
    billing_email: 'amministrazione@acme.it',
  };
  assert.deepEqual(billingProfileGaps(complete), []);
  assert.deepEqual(billingProfileGaps({ ...complete, sdi_code: null, pec: 'acme@pec.it' }), []);
  assert.deepEqual(billingProfileGaps({ ...complete, sdi_code: null, pec: null }), ['recipient']);
  assert.deepEqual(billingProfileGaps({ ...complete, cap: '3710', province: 'Verona' }), ['cap', 'province']);
  assert.ok(billingProfileGaps(null).length > 0);
});
