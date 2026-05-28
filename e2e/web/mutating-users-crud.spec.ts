import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  apiPost,
  deleteUser,
  inviteUser,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('web — Utenti CRUD (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let createdUserId: string | null = null;
  let email: string;

  test.beforeEach(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    email = `e2e-${Date.now()}@e2e.local`;
    const u = await inviteUser(admin.token, {
      email,
      role: 'user',
      first_name: 'E2E',
      last_name: 'Test',
    });
    createdUserId = u.user_id;
  });

  test.afterEach(async () => {
    if (createdUserId) {
      await deleteUser(admin.token, createdUserId).catch((e: Error) => {
        // eslint-disable-next-line no-console
        console.warn(`[afterEach] deleteUser ${createdUserId} failed: ${e.message}`);
      });
    }
    createdUserId = null;
  });

  test('invited user appears in the Utenti DataGrid', async ({ page }) => {
    await page.goto('/users');
    await expect(page.locator('.MuiDataGrid-root')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(email).first()).toBeVisible({ timeout: 15_000 });
  });

  test('deactivate → reactivate round-trip', async ({ page }) => {
    await apiPost(admin.token, `/api/v1/users/${createdUserId}/deactivate`, {});
    await apiPost(admin.token, `/api/v1/users/${createdUserId}/reactivate`, {});
    // Both calls must succeed (200).
    await page.goto('/users');
    await expect(page.getByText(email).first()).toBeVisible({ timeout: 15_000 });
  });

  test('hard-deleted user is removed from the visible list', async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByText(email).first()).toBeVisible({ timeout: 15_000 });
    await deleteUser(admin.token, createdUserId!);
    createdUserId = null;
    await page.reload();
    await expect(page.getByText(email)).toHaveCount(0, { timeout: 10_000 });
  });
});
