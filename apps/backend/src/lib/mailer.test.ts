import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBulkEventMail } from './mailer.js';

// Regression: a company event entered as 17→21 Aug is stored as Rome wall-clock
// (from_ts = 16 Aug 22:00Z in summer, to_ts = 21 Aug 21:59Z). The prod server
// runs in UTC, so formatting the range without an explicit timeZone rendered the
// start as 16 Aug in the notice email while the calendar (Rome-aware) showed 17.
// fmtRange must pin Europe/Rome so the email matches the calendar. This assertion
// is only meaningful when the process TZ is not Rome — run the suite under TZ=UTC.
test('bulk event email renders the range in Europe/Rome, not the server TZ', () => {
  const mail = buildBulkEventMail({
    title: 'CHIUSURA AZIENDALE',
    from_ts: '2026-08-16T22:00:00.000Z',
    to_ts: '2026-08-21T21:59:00.000Z',
    deducts_ferie: true,
    language: 'it',
  });
  assert.match(mail.text, /17\/08\/2026 → 21\/08\/2026/);
  assert.match(mail.html, /17\/08\/2026 → 21\/08\/2026/);
  assert.doesNotMatch(mail.text, /16\/08\/2026/);
});
