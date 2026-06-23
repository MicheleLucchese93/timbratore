import { test, expect } from '@playwright/test';

const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('partner · profile', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');

  test('admin can edit own display name (shown bottom-left)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('heading', { name: /Aziende|Companies/ }).waitFor();

    await page.getByTestId('profile-open').click();
    const fn = `E2EName${Date.now() % 100000}`;
    await page.locator('#pf-first').fill(fn);
    await page.locator('#pf-last').fill('Reseller');
    await page.getByTestId('profile-submit').click();

    await expect(page.getByText(/Profilo aggiornato|Profile updated/)).toBeVisible();
    // The bottom-left user block reflects the new display name without reload.
    await expect(page.locator('.sidebar-user-name')).toContainText(fn);
  });
});
