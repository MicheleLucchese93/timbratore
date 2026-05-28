import { test, expect } from '@playwright/test';
import { CREDS, URLS } from '../fixtures/test-data';

// Use a fresh context here — the project's saved storageState would skip the
// form entirely. We want to exercise the actual login flow.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('web — login', () => {
  test('renders branding + form', async ({ page }) => {
    await page.goto(`${URLS.web}/login`);
    await expect(page.getByRole('heading', { name: 'sonoQui' })).toBeVisible();
    await expect(page.locator('input#email')).toBeVisible();
    await expect(page.locator('input#password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accedi' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Password dimenticata?' })).toBeVisible();
  });

  test('rejects bad credentials', async ({ page }) => {
    await page.goto(`${URLS.web}/login`);
    await page.locator('input#email').fill('does-not-exist@example.com');
    await page.locator('input#password').fill('wrong-password');
    await page.getByRole('button', { name: 'Accedi' }).click();
    // Inline error banner — exact wording depends on GoTrue response; the
    // styled error <div> uses var(--color-error). Wait for any text in it.
    const errorBanner = page.locator('div[style*="color: var(--color-error)"]').first();
    await expect(errorBanner).toBeVisible({ timeout: 15_000 });
  });

  test('signs in admin and lands on Dashboard', async ({ page }) => {
    await page.goto(`${URLS.web}/login`);
    await page.locator('input#email').fill(CREDS.admin.email);
    await page.locator('input#password').fill(CREDS.admin.password);
    await page.getByRole('button', { name: 'Accedi' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
  });

  test('forgot password link routes to recovery page', async ({ page }) => {
    await page.goto(`${URLS.web}/login`);
    await page.getByRole('link', { name: 'Password dimenticata?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
  });
});
