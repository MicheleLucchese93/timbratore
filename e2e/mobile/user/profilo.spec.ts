import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../../fixtures/test-data';
import { loadHandleFromStorage, selfDisplayName } from '../../fixtures/api-client';

test.describe('mobile — Profilo screen (employee)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Profilo' }).click();
    await expect(page).toHaveURL(/\/profilo$/);
  });

  test('role pill shows "Dipendente" for non-admin', async ({ page }) => {
    await expect(page.getByText('Dipendente').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(CREDS.user.email)).toBeVisible();
  });

  test('display_name is rendered when set', async ({ page }) => {
    // The seeded employee has a display_name; the screen prefers it over the
    // email-prefix fallback. Its exact value drifts on the shared tenant, so
    // resolve the live value from /me instead of pinning a literal.
    const handle = await loadHandleFromStorage(STORAGE.mobileUserAuth, CREDS.user);
    const name = await selfDisplayName(handle.token, CREDS.user.email);
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  });

  test('notification settings include the 24h reminder toggle', async ({ page }) => {
    // The "Promemoria 24h prima" push toggle governs the server-sent
    // "tomorrow you have ferie" reminder (migration 030 / push_leave_reminders).
    await expect(page.getByText('Promemoria 24h prima', { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test('Sicurezza section exposes the biometric login toggle', async ({ page }) => {
    // Native biometric auth (expo-local-authentication) can't be exercised in
    // the RN-Web harness; assert the opt-in row is present. Web has no
    // biometric hardware so the row is disabled with the generic label.
    await expect(page.getByText('Sicurezza').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Accesso biometrico').first()).toBeVisible();
  });
});
