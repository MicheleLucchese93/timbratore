import { test, expect } from '@playwright/test';

test.describe('mobile — Dashboard gating (employee)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Employees keep the Timbrature landing (like before the Dashboard feature).
    await expect(page.getByText('Ore lavorate').first()).toBeVisible({ timeout: 30_000 });
  });

  test('does NOT show the Dashboard tab', async ({ page }) => {
    // Dashboard is admin-only; the tab is filtered out of CustomTabBar for
    // employees (apps/mobile/src/components/CustomTabBar.tsx).
    await expect(page.getByRole('button', { name: 'Dashboard' })).toHaveCount(0);
  });

  test('still shows the employee tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Storico' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Richieste' })).toBeVisible();
    // Correzioni is no longer a bottom tab — merged into Timbrature.
    await expect(page.getByRole('button', { name: 'Correzioni' })).toHaveCount(0);
  });
});
