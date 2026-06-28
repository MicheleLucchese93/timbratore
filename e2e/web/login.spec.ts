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

  // Valid GoTrue credentials whose account has NO tenant membership (e.g. a
  // partner who hasn't assigned themselves to any company). The login resolves
  // no company, so the web app signs the session back out — but it MUST show an
  // error instead of silently bouncing to a blank login form. Regression: the
  // post-refresh setErr ran on a component the app-shell skeleton had already
  // remounted, so the message was lost; the error now comes from the session
  // store and survives the remount. Env-gated: set E2E_NO_TENANT_EMAIL /
  // E2E_NO_TENANT_PASSWORD to a real no-membership account to run it.
  test('valid login with no company shows an error (no silent refresh)', async ({ page }) => {
    const email = process.env.E2E_NO_TENANT_EMAIL;
    const password = process.env.E2E_NO_TENANT_PASSWORD;
    test.skip(!email || !password, 'set E2E_NO_TENANT_EMAIL/PASSWORD to run');
    await page.goto(`${URLS.web}/login`);
    await page.locator('input#email').fill(email!);
    await page.locator('input#password').fill(password!);
    await page.getByRole('button', { name: 'Accedi' }).click();
    // Inline error banner must appear (same styled <div> as the bad-creds case).
    const errorBanner = page.locator('div[style*="color: var(--color-error)"]').first();
    await expect(errorBanner).toBeVisible({ timeout: 15_000 });
    // And we stay on the login form — not authenticated, not a blank bounce.
    await expect(page.locator('input#email')).toBeVisible();
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
