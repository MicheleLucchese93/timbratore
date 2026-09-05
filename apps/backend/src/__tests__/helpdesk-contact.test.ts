import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helpdeskSchema, buildHelpdeskMail } from '../lib/helpdesk-mail.js';

// The website "Contattaci" form is the only caller. Phone and company were made
// mandatory so every lead arrives with a callback number and a company name.

const valid = {
  name: 'Mario Rossi',
  email: 'mario@acme.it',
  phone: '+39 348 1234567',
  company: 'ACME S.r.l.',
  subject: 'Richiesta demo',
  message: 'Vorrei provare sonoQui.',
  source: 'sonoqui',
};

test('phone and company are required', () => {
  assert.equal(helpdeskSchema.safeParse(valid).success, true);

  const { phone: _phone, ...noPhone } = valid;
  assert.equal(helpdeskSchema.safeParse(noPhone).success, false);

  const { company: _company, ...noCompany } = valid;
  assert.equal(helpdeskSchema.safeParse(noCompany).success, false);

  // Empty strings are what an unfilled input actually posts.
  assert.equal(helpdeskSchema.safeParse({ ...valid, phone: '' }).success, false);
  assert.equal(helpdeskSchema.safeParse({ ...valid, company: '' }).success, false);
});

test('phone accepts the shapes Italians type, rejects free text', () => {
  for (const phone of ['3481234567', '+39 348 123 4567', '02/1234567', '(+39) 06-12345']) {
    assert.equal(helpdeskSchema.safeParse({ ...valid, phone }).success, true, phone);
  }
  // Letters would let a lead through with an unusable number.
  assert.equal(helpdeskSchema.safeParse({ ...valid, phone: 'chiamami' }).success, false);
  // Under 6 chars is not a number anybody can call back.
  assert.equal(helpdeskSchema.safeParse({ ...valid, phone: '12345' }).success, false);
});

test('company rejects CR/LF so it cannot be smuggled into a mail header', () => {
  const injected = { ...valid, company: 'ACME\r\nBcc: victim@example.com' };
  assert.equal(helpdeskSchema.safeParse(injected).success, false);
});

test('the email carries phone and company in both bodies', () => {
  const mail = buildHelpdeskMail(helpdeskSchema.parse(valid));

  assert.equal(mail.subject, '[SONOQUI] Richiesta demo');
  assert.equal(mail.replyTo, 'mario@acme.it');

  assert.match(mail.text, /^Phone: \+39 348 1234567$/m);
  assert.match(mail.text, /^Company: ACME S\.r\.l\.$/m);

  assert.match(mail.html, /<strong>Telefono:<\/strong> \+39 348 1234567/);
  assert.match(mail.html, /<strong>Azienda:<\/strong> ACME S\.r\.l\./);
});

test('the email escapes HTML in the company name', () => {
  const mail = buildHelpdeskMail(
    helpdeskSchema.parse({ ...valid, company: '<script>alert(1)</script>' })
  );
  assert.ok(!mail.html.includes('<script>'));
  assert.match(mail.html, /&lt;script&gt;/);
});
