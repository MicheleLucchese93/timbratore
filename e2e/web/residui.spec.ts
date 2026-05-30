import { test, expect } from '@playwright/test';

// The "Residui" sidebar entry opens a read-only roster of every employee's
// residual ferie/permessi hours. Quota management still lives in the
// Ferie & Permessi → Quote tab.
test.describe('web — Residui (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/residui');
    await expect(page.getByRole('heading', { name: 'Residui dipendenti' })).toBeVisible({ timeout: 15_000 });
  });

  test('sidebar exposes the Residui entry', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Residui', exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test('renders the residual DataGrid with the expected columns', async ({ page }) => {
    const grid = page.locator('.MuiDataGrid-root');
    await expect(grid).toBeVisible({ timeout: 15_000 });
    for (const col of ['Utente', 'Tipo', 'Saldo iniziale', 'Maturato', 'In attesa']) {
      await expect(grid.getByRole('columnheader', { name: col })).toBeVisible();
    }
    // "Residuo" prefixes "Residuo con pending", so match it exactly.
    await expect(grid.getByRole('columnheader', { name: 'Residuo', exact: true })).toBeVisible();
  });

  test('roster lists every member, even without an assigned quota', async ({ page }) => {
    const grid = page.locator('.MuiDataGrid-root');
    await expect(grid).toBeVisible({ timeout: 15_000 });
    // The roster is the full membership list (not just users with a quota), so
    // at least the admin's own row renders even before any quota is assigned.
    await expect(grid.locator('.MuiDataGrid-row').first()).toBeVisible({ timeout: 15_000 });
  });
});
