import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  apiGet,
  apiPost,
  deleteStampAdmin,
  listStampsAdmin,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

// Regression: a future-dated clock_out must NOT define the live state.
//
// An admin can pre-enter a planned day (e.g. clock_in 09:00 + clock_out
// 18:00) before the exit has happened. Before the fix, computeCurrentState
// picked the row with the max occurred_at — the still-future clock_out — so
// the employee's button reported "off duty" and never flipped after a real
// clock_in, letting duplicate entrate pile up. computeCurrentState now filters
// `occurred_at <= now()`, so live state reflects only events that have already
// occurred. Pure API assertions; gated behind E2E_MUTATING (hits live tenant).
const ENABLED = process.env.E2E_MUTATING === '1';

interface CurrentState {
  state: 'nothing' | 'clocked_in' | 'on_break' | 'on_lunch';
  lastEvent: string | null;
}

test.describe('web — Future-dated clock_out vs current-state (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  const today = new Date().toISOString().slice(0, 10);
  const seeded: string[] = [];

  // Admin-manual stamps bypass geofence/mode/transition checks, so seeding the
  // scenario on the admin actor keeps the test self-contained — the subject is
  // also the caller of /me/current-state. Start from a clean "today" so the
  // assertion can't be tainted by leftover stamps from a prior run.
  async function clearToday() {
    const rows = await listStampsAdmin(admin.token, {
      user_id: admin.userId,
      from: today,
      to: today,
      limit: 1000,
    });
    for (const s of rows) await deleteStampAdmin(admin.token, s.id);
  }

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    await clearToday();
  });

  test.afterAll(async () => {
    for (const id of seeded) await deleteStampAdmin(admin.token, id);
    await clearToday();
  });

  test('future clock_out is persisted but does not flip live state', async () => {
    const now = Date.now();
    const pastIn = new Date(now - 5 * 60 * 1000).toISOString(); // 5 min ago
    const futureOut = new Date(now + 6 * 60 * 60 * 1000).toISOString(); // 6 h ahead

    const inRes = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: admin.userId,
      event_type: 'clock_in',
      occurred_at: pastIn,
      justification: 'e2e future-stamp regression',
    });
    expect(inRes.status).toBe(201);
    seeded.push(inRes.data!.id);

    const outRes = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: admin.userId,
      event_type: 'clock_out',
      occurred_at: futureOut,
      justification: 'e2e future-stamp regression',
    });
    expect(outRes.status).toBe(201);
    seeded.push(outRes.data!.id);

    // The future clock_out is genuinely stored (this is a state-derivation bug,
    // not a write that was rejected) — both rows come back from the admin list.
    const rows = await listStampsAdmin(admin.token, {
      user_id: admin.userId,
      from: today,
      to: today,
      limit: 1000,
    });
    expect(rows.map((r) => r.id).sort()).toEqual([inRes.data!.id, outRes.data!.id].sort());

    // ...yet live state reflects only the already-happened clock_in.
    const cs = await apiGet<CurrentState>(admin.token, '/api/v1/stamps/me/current-state');
    expect(cs.state).toBe('clocked_in');
    expect(cs.lastEvent).toBe('clock_in');
  });
});
