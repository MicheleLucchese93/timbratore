import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  apiGet,
  apiPost,
  adminRevokeLeave,
  createLeave,
  deleteUser,
  inviteUser,
  loadHandleFromStorage,
  setLeaveApprovers,
  type ApiHandle,
  type LeaveRow,
} from '../fixtures/api-client';

// Regression for the "ghost approver" bug: when an admin who is the *sole*
// designated approver for an employee is deleted, the member-delete handler
// must cascade-remove their leave_approvers row. Before the fix the row was
// orphaned, so:
//   - GET /:id/approvers still returned a row (name null — deleted member),
//     i.e. the UI showed an "approver" no longer in the tenant; and
//   - assertCanDecide saw a non-empty configured list and 403'd every admin,
//     leaving pending requests un-approvable by anyone (the deleted approver
//     can't log in).
// After the fix the cascade empties the list, so admin-fallback is restored.
//
// This spec:
//   1. Invite a throw-away approver A.
//   2. Set A as test3's sole leave approver; assert the list has 1 entry.
//   3. test3 files ferie; an admin NOT in the list (test1) is blocked (403)
//      — the pre-delete precondition that made requests un-approvable.
//   4. Delete A.
//   5. Assert the approver list is now empty (cascade) — this is the bug.
//   6. The same admin (test1) can now approve the still-pending ferie (200)
//      — admin-fallback restored.
const ENABLED = process.env.E2E_MUTATING === '1';

function futureDay(minOffset: number): { from: string; to: string } {
  // Skip weekends (ferie computeDurationHours is 0 on weekends).
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

test.describe('web — Approver delete cascade (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let approverId: string | null = null;
  const created: LeaveRow[] = [];

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
  });

  test.afterAll(async () => {
    for (const lv of created) {
      await adminRevokeLeave(admin.token, lv.id, 'e2e cleanup').catch(() => {});
    }
    // Restore the tenant default (no configured approver → admin fallback).
    await setLeaveApprovers(admin.token, user.userId, []).catch(() => {});
    // The approver may already be gone (that is the point of the test); clean
    // up only if step 4 never ran.
    if (approverId) await deleteUser(admin.token, approverId).catch(() => {});
  });

  test('deleting the sole approver empties the list and restores admin-fallback', async () => {
    // 1. Throw-away approver.
    const a = await inviteUser(admin.token, {
      email: `e2e-approver-${Date.now()}@e2e.local`,
      role: 'user',
      first_name: 'E2E',
      last_name: 'Approver',
    });
    approverId = a.user_id;

    // 2. A is test3's sole leave approver.
    await setLeaveApprovers(admin.token, user.userId, [a.user_id]);
    const before = await apiGet<Array<{ user_id: string }>>(
      admin.token,
      `/api/v1/users/${user.userId}/approvers`
    );
    expect(before).toHaveLength(1);
    expect(before.map((x) => x.user_id)).toContain(a.user_id);

    // 3. test3 files ferie; test1 (admin, not in list) is blocked.
    const range = futureDay(90);
    const lv = await createLeave(user.token, {
      type: 'ferie',
      from_ts: range.from,
      to_ts: range.to,
      user_note: `e2e approver-delete-cascade ${Date.now()}`,
    });
    created.push(lv);
    const blocked = await apiPost<LeaveRow>(admin.token, `/api/v1/leaves/${lv.id}/approve`, {});
    expect(blocked.status).toBe(403);

    // 4. Delete the approver.
    await deleteUser(admin.token, a.user_id);
    approverId = null; // afterAll must not try to delete again.

    // 5. Cascade: the configured list is now empty.
    const after = await apiGet<Array<{ user_id: string }>>(
      admin.token,
      `/api/v1/users/${user.userId}/approvers`
    );
    expect(after).toHaveLength(0);

    // 6. Admin-fallback restored: the still-pending ferie is approvable.
    const ok = await apiPost<LeaveRow>(admin.token, `/api/v1/leaves/${lv.id}/approve`, {});
    expect(ok.status).toBe(200);
    expect(ok.data?.status).toBe('approved');
  });
});
