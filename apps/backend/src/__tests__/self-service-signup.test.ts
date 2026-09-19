import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapViesResponse, parseItalianAddress } from '../lib/vat.js';
import { buildSignupConfirmMail, buildOperatorSignupMail, signupConfirmUrl } from '../lib/billing-mail.js';
import { hashSignupToken } from '../routes/signup.js';

// Self-service signup (Specs/SELF_SERVICE_BILLING.md §3.2): the pure parts —
// how a VIES answer becomes a status (D2: never a hard block), how its one-line
// address is split for the fattura, and what the confirmation email carries.

const NOW = '2026-09-18T10:00:00.000Z';

test('VIES: a valid number keeps name + address, blanks become null', () => {
  const r = mapViesResponse(
    '00488410010',
    200,
    {
      valid: true,
      name: 'TIM S.P.A.',
      address: 'VIA GAETANO NEGRI 1 \n20123 MILANO MI\n',
      requestIdentifier: '',
    },
    NOW
  );
  assert.equal(r.status, 'valid');
  assert.equal(r.name, 'TIM S.P.A.');
  assert.equal(r.address, 'VIA GAETANO NEGRI 1\n20123 MILANO MI');
  assert.equal(r.requestIdentifier, null);
});

test('VIES: "not valid" is not_in_vies (accepted + flagged), never a rejection', () => {
  const r = mapViesResponse('01234567897', 200, { valid: false, name: '---', address: '---' }, NOW);
  assert.equal(r.status, 'not_in_vies');
  assert.equal(r.name, null);
  assert.equal(r.address, null);
});

test('VIES: member-state outages and throttling map to unavailable', () => {
  assert.equal(mapViesResponse('x', 200, { valid: false, userError: 'MS_UNAVAILABLE' }, NOW).status, 'unavailable');
  assert.equal(mapViesResponse('x', 200, { valid: false, userError: 'MS_MAX_CONCURRENT_REQ' }, NOW).status, 'unavailable');
  assert.equal(
    mapViesResponse('x', 400, { errorWrappers: [{ error: 'SERVICE_UNAVAILABLE' }] }, NOW).status,
    'unavailable'
  );
  assert.equal(mapViesResponse('x', 503, null, NOW).status, 'unavailable');
  assert.equal(mapViesResponse('x', 429, { valid: false }, NOW).status, 'unavailable');
  // The consultation number is kept when present (proof the check was made).
  assert.equal(
    mapViesResponse('x', 200, { valid: true, name: 'A', address: 'B', requestIdentifier: 'WAPIAAAAX' }, NOW)
      .requestIdentifier,
    'WAPIAAAAX'
  );
});

test('address: VIES single string → street / CAP / city / province', () => {
  assert.deepEqual(parseItalianAddress('VIA GAETANO NEGRI 1 \n20123 MILANO MI\n'), {
    address: 'Via Gaetano Negri 1',
    cap: '20123',
    city: 'Milano',
    province: 'MI',
  });
  assert.deepEqual(parseItalianAddress('VIALE DELLA FIERA 6/B\n37135 VERONA VR'), {
    address: 'Viale Della Fiera 6/B',
    cap: '37135',
    city: 'Verona',
    province: 'VR',
  });
  assert.deepEqual(parseItalianAddress('CORSO ITALIA 12\n00100 ROMA (RM)'), {
    address: 'Corso Italia 12',
    cap: '00100',
    city: 'Roma',
    province: 'RM',
  });
  // Multi-word city, no province.
  const noProv = parseItalianAddress('LOC. CASE SPARSE 4\n37057 SAN GIOVANNI LUPATOTO');
  assert.equal(noProv.cap, '37057');
  assert.equal(noProv.city, 'San Giovanni Lupatoto');
  assert.equal(noProv.province, null);
  // Nothing recognisable → everything stays in `address` for the user to fix.
  assert.deepEqual(parseItalianAddress('SOMEWHERE'), { address: 'Somewhere', cap: null, city: null, province: null });
  assert.deepEqual(parseItalianAddress(null), { address: null, cap: null, city: null, province: null });
});

test('signup tokens are stored as a sha256 hex digest', () => {
  const h = hashSignupToken('abc');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, hashSignupToken('abc'));
  assert.notEqual(h, hashSignupToken('abd'));
});

test('confirmation email: token only in the URL fragment, name escaped, both languages', () => {
  const url = signupConfirmUrl('tok_123');
  assert.match(url, /\/registrazione\/conferma#t=tok_123$/);
  assert.ok(!url.includes('?'), 'token must not travel as a query parameter');

  const it = buildSignupConfirmMail({ firstName: '<b>Gio</b>', token: 'tok_123', mode: 'new', ttlHours: 48, language: 'it' });
  assert.match(it.subject, /Conferma la tua email/);
  assert.ok(it.html.includes('&lt;b&gt;Gio&lt;/b&gt;'));
  assert.ok(!it.html.includes('<b>Gio</b>'));
  assert.ok(it.html.includes('#t=tok_123'));
  assert.ok(it.text.includes('<b>Gio</b>'), 'plain-text part shows the name as typed');
  assert.match(it.text, /48 ore/);

  const en = buildSignupConfirmMail({ firstName: 'Ann', token: 't', mode: 'existing', ttlHours: 24, language: 'en' });
  assert.match(en.subject, /Create a new company/);
  assert.match(en.text, /usual password/);
});

test('operator notice flags an unverified P.IVA', () => {
  const m = buildOperatorSignupMail({
    companyName: 'Acme Srl',
    partitaIva: '01234567897',
    vatStatus: 'not_in_vies',
    headcountBand: '4-10',
    planHint: 'piccola',
    adminName: 'Giulia Verdi',
    adminEmail: 'g@acme.it',
    phone: null,
    tenantId: '00000000-0000-0000-0000-000000000000',
  });
  assert.match(m.subject, /Nuova registrazione: Acme Srl/);
  assert.match(m.text, /non presente nel VIES/);
  assert.match(m.html, /da verificare/);
});
