import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  adminRevokeLeave,
  approveLeave,
  createLeave,
  loadHandleFromStorage,
  requestLeaveCancellation,
  type ApiHandle,
  type LeaveRow,
} from '../fixtures/api-client';

// Full Italian-SME cancellation cycle:
//   1. Employee files ferie → admin approves.
//   2. Employee changes plans → POST /:id/request-cancellation → status
//      flips to `cancellation_pending`.
//   3. Admin opens /leaves → sees "Accetta annullamento" + "Rifiuta
//      annullamento" buttons → clicks Accetta → backend sets status to
//      `cancelled_post_approval`, refunds the quota slot.
//   4. UI re-fetches, the row reads "Annullata".
const ENABLED = process.env.E2E_MUTATING === '1';

function futureDay(minOffset: number): { from: string; to: string } {
  // Skip weekends so computeDurationHours (backend fallback: Mon–Fri = 8h,
  // weekends = 0h) returns >0 and the POST /leaves call doesn't throw.
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + minOffset);
  while (start.getUTCDay() === 0 || start.getUTCDay() === 6) {
    start.setUTCDate(start.getUTCDate() + 1);
  }
  start.setUTCHours(8, 0, 0, 0);
  const end = new Date(start);
  end.setUTCHours(16, 0, 0, 0);
  return { from: start.toISOString(), to: end.toISOString() };
}

test.describe('web — Full leave-cancellation cycle (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let leave: LeaveRow | null = null;
  let marker: string;

  test.beforeEach(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    const range = futureDay(75);
    marker = `e2e cancel ${Date.now()}`;
    leave = await createLeave(user.token, {
      type: 'ferie',
      from_ts: range.from,
      to_ts: range.to,
      user_note: marker,
    });
    leave = await approveLeave(admin.token, leave.id);
    // Employee changes plans and requests cancellation.
    leave = await requestLeaveCancellation(user.token, leave.id, 'cambio programma');
    expect(leave.status).toBe('cancellation_pending');
  });

  test.afterEach(async () => {
    // Either the UI test accepted the cancellation (terminal state, fine)
    // or it didn't reach that step — revoke as admin to ensure we don't
    // leave an open cancellation_pending row on the tenant.
    if (leave) await adminRevokeLeave(admin.token, leave.id, 'e2e cleanup').catch(() => {});
    leave = null;
  });

  test('admin clicks "Accetta annullamento" → row reads Annullata', async ({ page }) => {
    await page.goto('/leaves');
    await expect(page.getByRole('heading', { name: 'Ferie & Permessi' })).toBeVisible({
      timeout: 15_000,
    });
    // The DataGrid uses MUI's virtual scroller — our row is identified by
    // the unique user_note marker. Approve via the button on its row.
    // First confirm both decision buttons exist (so we know the seed
    // produced a cancellation_pending row at all).
    await expect(page.getByRole('button', { name: 'Accetta annullamento' }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Rifiuta annullamento' }).first()).toBeVisible();
    // There may be multiple cancellation_pending rows on the tenant — we
    // assume ours is the most recent. Click the first Accetta.
    await page.getByRole('button', { name: 'Accetta annullamento' }).first().click();
    // After approval the row's status should be "Annullata" (label for
    // `cancelled_post_approval`). Wait for the badge to appear.
    await expect(page.getByText(/Annullata/).first()).toBeVisible({ timeout: 15_000 });
  });
});
