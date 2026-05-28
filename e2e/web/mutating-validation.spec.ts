import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import { apiPost, loadHandleFromStorage } from '../fixtures/api-client';

// Backend validation edge cases. All assert on the 4xx response; no UI.
// Gated behind E2E_MUTATING because the requests hit the live tenant.
const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('web — Backend validation edges (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  test('permessi NOT a 15-min multiple → 400 ValidationError', async () => {
    const user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    // 13-minute span — not a quarter-hour multiple.
    const from = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    // Push to weekday so computeDurationHours doesn't short-circuit on 0h.
    while (from.getUTCDay() === 0 || from.getUTCDay() === 6) {
      from.setUTCDate(from.getUTCDate() + 1);
    }
    from.setUTCHours(10, 0, 0, 0);
    const to = new Date(from);
    to.setUTCMinutes(to.getUTCMinutes() + 13);
    const r = await apiPost(user.token, '/api/v1/leaves', {
      type: 'permessi',
      from_ts: from.toISOString(),
      to_ts: to.toISOString(),
    });
    expect(r.status).toBe(400);
  });

  test('malattia missing inps_protocol → 400 ValidationError', async () => {
    const user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    const from = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
    while (from.getUTCDay() === 0 || from.getUTCDay() === 6) {
      from.setUTCDate(from.getUTCDate() + 1);
    }
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setUTCHours(23, 59, 0, 0);
    const r = await apiPost(user.token, '/api/v1/leaves', {
      type: 'malattia',
      from_ts: from.toISOString(),
      to_ts: to.toISOString(),
      // no inps_protocol
    });
    expect(r.status).toBe(400);
  });

  test('malattia inps_protocol > 100 chars → 400 ValidationError', async () => {
    const user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    const from = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    while (from.getUTCDay() === 0 || from.getUTCDay() === 6) {
      from.setUTCDate(from.getUTCDate() + 1);
    }
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setUTCHours(23, 59, 0, 0);
    const r = await apiPost(user.token, '/api/v1/leaves', {
      type: 'malattia',
      from_ts: from.toISOString(),
      to_ts: to.toISOString(),
      inps_protocol: 'X'.repeat(101),
    });
    expect(r.status).toBe(400);
  });

  test('leave with to_ts <= from_ts → 400 ValidationError', async () => {
    const user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    const t = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000).toISOString();
    const r = await apiPost(user.token, '/api/v1/leaves', {
      type: 'ferie',
      from_ts: t,
      to_ts: t, // equal — must be strictly less
    });
    expect(r.status).toBe(400);
  });

  test('correction with justification < 5 chars → 400 ValidationError', async () => {
    const user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    const r = await apiPost(user.token, '/api/v1/correction-requests', {
      original_stamp_id: null,
      claimed_event_type: 'clock_in',
      claimed_occurred_at: new Date().toISOString(),
      claimed_branch_id: null,
      justification: 'a', // too short
    });
    expect(r.status).toBe(400);
  });
});
