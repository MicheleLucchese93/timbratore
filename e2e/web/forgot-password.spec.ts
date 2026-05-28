import { test, expect } from '@playwright/test';
import { URLS } from '../fixtures/test-data';

// Fresh context — the saved admin storage would skip the form.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('web — Forgot password', () => {
  test('login page → click link → /forgot-password', async ({ page }) => {
    await page.goto(`${URLS.web}/login`);
    await page.getByRole('link', { name: 'Password dimenticata?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
  });

  test('form renders email input + submit button', async ({ page }) => {
    await page.goto(`${URLS.web}/forgot-password`);
    await expect(page.locator('input#email')).toBeVisible();
    await expect(page.getByRole('button', { name: /Invia link di reset/i })).toBeVisible();
  });

  test('submitting an unknown email never enumerates accounts', async ({ page }) => {
    // GoTrue intentionally returns 200 for any email to prevent account
    // enumeration. The UI shows a generic success banner regardless.
    await page.goto(`${URLS.web}/forgot-password`);
    await page.locator('input#email').fill(`unknown-${Date.now()}@example.com`);
    await page.getByRole('button', { name: /Invia link di reset/i }).click();
    // Generic success copy ("se l'email esiste, riceverai…"); be lenient
    // to wording changes — assert just on the absence of the form button.
    await expect(page.getByRole('button', { name: /Invia link di reset/i })).toBeHidden({ timeout: 10_000 });
  });
});
