import { test, expect } from '@playwright/test';
import { CREDS } from '../../fixtures/test-data';

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

  test('display_name is rendered when set (test3 = Mario Rossi)', async ({ page }) => {
    // The seeded employee has a display_name; the screen prefers it over
    // the email-prefix fallback.
    await expect(page.getByText(CREDS.user.displayName)).toBeVisible();
  });
});
