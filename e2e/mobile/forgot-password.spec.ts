import { test, expect } from '@playwright/test';
import { URLS } from '../fixtures/test-data';

// Fresh context — bypass the saved admin storage.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('mobile — Forgot password', () => {
  test('login screen → tap "Password dimenticata?" → /forgot-password', async ({ page }) => {
    await page.goto(URLS.mobile);
    await expect(page.getByPlaceholder('email@azienda.it')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('link', { name: /Password dimenticata/i }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
  });

  test('form renders email input + send button', async ({ page }) => {
    await page.goto(`${URLS.mobile}/forgot-password`);
    // Reuses the same placeholder shape as login.
    await expect(page.getByPlaceholder('email@azienda.it')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Invia link di reset/i)).toBeVisible();
  });
});
