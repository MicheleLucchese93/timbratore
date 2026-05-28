import { test, expect } from '@playwright/test';

test.describe('mobile — Storico tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Storico' }).click();
  });

  test('shows range filters (7 / 30 / 90 days)', async ({ page }) => {
    // RANGES = [7, 30, 90] from screens/StoricoScreen.tsx.
    await expect(page.getByText(/7/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/30/).first()).toBeVisible();
    await expect(page.getByText(/90/).first()).toBeVisible();
  });
});
