import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  createBulkEvent,
  loadHandleFromStorage,
  revokeBulkEvent,
  type ApiHandle,
} from '../fixtures/api-client';

// Admin pushes a company event ("chiusura aziendale") to one employee, then
// verifies the admin Calendario surfaces that employee in its per-user filter
// (proving the bulk endpoint wrote a row the calendar can see). Cleanup revokes
// the whole batch.
const ENABLED = process.env.E2E_MUTATING === '1';

function futureWeekday(offset: number): { from: string; to: string } {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + offset);
  while (start.getUTCDay() === 0 || start.getUTCDay() === 6) {
    start.setUTCDate(start.getUTCDate() + 1);
  }
  start.setUTCHours(8, 0, 0, 0);
  const end = new Date(start);
  end.setUTCHours(16, 0, 0, 0);
  return { from: start.toISOString(), to: end.toISOString() };
}

test.describe('web — Admin bulk company event (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let batchId: string | null = null;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    const range = futureWeekday(10);
    const marker = `e2e chiusura ${Date.now()}`;
    const res = await createBulkEvent(admin.token, {
      title: marker,
      from_ts: range.from,
      to_ts: range.to,
      deduct_ferie: false,
      user_ids: [user.userId],
      user_note: marker,
    });
    batchId = res.batch_id;
    expect(res.created_count).toBeGreaterThanOrEqual(1);
  });

  test.afterAll(async () => {
    if (batchId) await revokeBulkEvent(admin.token, batchId).catch(() => {});
  });

  test('seeded employee appears in the Calendario user filter', async ({ page }) => {
    await page.goto('/leaves');
    await expect(page.getByRole('heading', { name: 'Ferie & Permessi' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Calendario', exact: true }).click();
    // The filter chip renders the employee's display_name once the calendar
    // has loaded the current-year range that contains the seeded event.
    await expect(
      page.getByRole('button', { name: new RegExp(CREDS.user.displayName) }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
