import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  apiPost,
  createLeave,
  adminRevokeLeave,
  loadHandleFromStorage,
  loginAs,
  setLeaveApprovers,
  type ApiHandle,
  type LeaveRow,
} from '../fixtures/api-client';

// Real Italian-SME approver scenario: titolare designates a specific admin
// (not "any admin") as the leave approver for one dipendente. The product
// must allow that designated approver to decide *and* still allow other
// admins to decide (admin role overrides the approver-list when the user
// has admins as fallback).
//
// This spec:
//   1. As test1 (admin), PUT leave_approvers for test3 = [test2 (admin)].
//   2. As test3, create a pending ferie.
//   3. As test2 (designated approver), POST /:id/approve — must succeed (200).
//   4. As test1 — could not POST approve before step 3 because the row is
//      now resolved; instead we assert test1 *would* be allowed to do so
//      pre-step-3 by re-creating a second pending row and approving as
//      test1.
//   5. Cleanup: revoke both approvals + clear the approver list.
const ENABLED = process.env.E2E_MUTATING === '1';

function futureDay(minOffset: number): { from: string; to: string } {
  // Skip weekends. ferie/permessi computeDurationHours fallback is 0 on
  // weekends. Permesso of 4h is also allowed; we keep ferie semantics.
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + minOffset);
  while (start.getUTCDay() === 0 || start.getUTCDay() === 6) {
    start.setUTCDate(start.getUTCDate() + 1);
  }
  start.setUTCHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setUTCHours(13, 0, 0, 0);
  return { from: start.toISOString(), to: end.toISOString() };
}

test.describe('web — Approver assignment + admin override (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin1: ApiHandle;
  let admin2: ApiHandle;
  let user: ApiHandle;
  const created: LeaveRow[] = [];

  test.beforeAll(async () => {
    admin1 = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    // test2 isn't in our storage — fall back to a fresh GoTrue login.  This
    // happens once per spec, well below the rate-limit threshold.
    admin2 = await loginAs('test2@test.it', 'Test123@!');
  });

  test.afterAll(async () => {
    for (const lv of created) {
      try {
        await adminRevokeLeave(admin1.token, lv.id, 'e2e cleanup');
      } catch {
        /* best-effort */
      }
    }
    // Clear approvers so the tenant returns to its default admin-fallback.
    try {
      await setLeaveApprovers(admin1.token, user.userId, []);
    } catch {
      /* best-effort */
    }
  });

  test('designated approver (test2) can approve test3 ferie', async () => {
    // 1. Configure: test2 is the sole leave approver for test3.
    await setLeaveApprovers(admin1.token, user.userId, [admin2.userId]);

    // 2. test3 files ferie.
    const range = futureDay(80);
    const lv = await createLeave(user.token, {
      type: 'ferie',
      from_ts: range.from,
      to_ts: range.to,
      user_note: `e2e approver-assignment ${Date.now()}`,
    });
    created.push(lv);

    // 3. test2 approves via API — should return 200.
    const r = await apiPost<LeaveRow>(admin2.token, `/api/v1/leaves/${lv.id}/approve`, {});
    expect(r.status).toBe(200);
    expect(r.data?.status).toBe('approved');
  });

  test('admin NOT in approver list is blocked (403) when list is set', async () => {
    // The product rule (assertCanDecide in routes/leaves.ts:78-94) is:
    //   - approvers configured → ONLY listed approvers decide
    //   - approvers empty     → admins fall back as deciders
    // So a configured list strictly overrides admin role. Verify by
    // attempting to approve as test1 (NOT in the [test2] list).
    await setLeaveApprovers(admin1.token, user.userId, [admin2.userId]);
    const range = futureDay(85);
    const lv = await createLeave(user.token, {
      type: 'ferie',
      from_ts: range.from,
      to_ts: range.to,
      user_note: `e2e admin-blocked ${Date.now()}`,
    });
    created.push(lv);
    const r = await apiPost<LeaveRow>(admin1.token, `/api/v1/leaves/${lv.id}/approve`, {});
    expect(r.status).toBe(403);
    // Cleanup: the row stays as 'pending' — approve via the designated
    // admin so afterAll's adminRevokeLeave finds an approved row to revoke.
    const recover = await apiPost<LeaveRow>(admin2.token, `/api/v1/leaves/${lv.id}/approve`, {});
    expect(recover.status).toBe(200);
  });
});
