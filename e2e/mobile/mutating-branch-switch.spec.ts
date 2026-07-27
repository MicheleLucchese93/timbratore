import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  apiPost,
  deleteStampAdmin,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

// The sede picker used to freeze as soon as a shift was open ("Bloccata fino
// all'uscita"), so a worker could only ever clock out on the sede they entered
// on. It is switchable mid-shift now — entering at one sede and leaving from
// another is the supported flow (apps/backend/src/services/stamp-service.ts
// gates only clock_in on the geofence).
//
// Seeds an open shift for the admin fixture (assigned to >1 branch) via the
// admin stamps route, then drives the picker in the mobile app.
const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('mobile — sede switchable mid-shift (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');
  test.describe.configure({ mode: 'serial' });

  let admin: ApiHandle;
  let stampId: string | null = null;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.mobileAuth, CREDS.admin);
    test.skip(admin.branches.length < 2, 'fixture admin must be assigned to >1 branch');
    const r = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: admin.userId,
      event_type: 'clock_in',
      occurred_at: new Date(Date.now() - 60 * 60_000).toISOString(),
      branch_id: admin.branches[0]!.id,
      justification: 'e2e open shift for sede switch',
    });
    if (r.status === 201 && r.data) stampId = r.data.id;
    expect(stampId, 'seeded open shift').not.toBeNull();
  });

  test.afterAll(async () => {
    if (stampId) await deleteStampAdmin(admin.token, stampId).catch(() => {});
  });

  test('with a shift open the picker stays switchable and shows no lock', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Timbrature' }).click();
    await expect(page.getByText('Sede', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    // The old lock hint must be gone whatever the current state.
    await expect(page.getByText(/Bloccata fino all'uscita/)).toHaveCount(0);

    // Pick the sede that is NOT the one the shift was opened on and select it:
    // under the old lock the chip was `disabled` and the tap did nothing.
    const other = admin.branches.find((b) => b.id !== admin.branches[0]!.id)!;
    const chip = page.getByText(other.name, { exact: true }).first();
    await expect(chip).toBeVisible({ timeout: 15_000 });
    const pressable = chip.locator('xpath=..');
    await chip.click();
    // Selected chip paints with the brand primary (#15569e).
    await expect(pressable).toHaveCSS('background-color', 'rgb(21, 86, 158)', { timeout: 5_000 });
  });
});
