import { test, expect } from '@playwright/test';

const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('partner · settings', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');

  test('Impostazioni language selector switches the UI', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /Impostazioni|Settings/ })).toBeVisible();

    // Switch to English → headings + nav re-render.
    await page.getByTestId('lang-en').click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Companies' })).toBeVisible();

    // Switch back to Italian.
    await page.getByTestId('lang-it').click();
    await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Aziende' })).toBeVisible();
  });
});
