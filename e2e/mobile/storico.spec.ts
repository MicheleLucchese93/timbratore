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

  test('shows both ore lavorate and ore conteggiate per day', async ({ page }) => {
    // Summary + each day card surface both metrics (StoricoScreen.tsx).
    // "Conteggiate" is the timesheet-aware total (worked − breach deductions
    // + overtime, floored to 15 min); "Lavorate" is the raw sum.
    await expect(page.getByText('Totale conteggiato').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Lavorate').first()).toBeVisible();
    await expect(page.getByText('Conteggiate').first()).toBeVisible();
  });
});
