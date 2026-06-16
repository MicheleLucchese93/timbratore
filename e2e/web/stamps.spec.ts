import { test, expect } from '@playwright/test';

test.describe('web — Timbrature (admin stamps)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/stamps');
  });

  test('list page renders DataGrid + create button', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Timbrature/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Nuova timbratura/i })).toBeVisible();
    // MUI DataGrid root.
    await expect(page.locator('.MuiDataGrid-root')).toBeVisible({ timeout: 15_000 });
  });

  test('opens the create-stamp modal', async ({ page }) => {
    await page.getByRole('button', { name: /Nuova timbratura/i }).click();
    // Custom overlay (not a real <dialog>): fixed-position card with the
    // "Nuova timbratura" heading and selects with localized option labels.
    await expect(page.getByRole('heading', { name: 'Nuova timbratura' })).toBeVisible();
    // The Evento <select> contains the six event types — use that as the
    // disambiguating signal (avoids collision with the DataGrid column menu).
    // Anchor 'Inizio pausa' with regex so the substring of 'Inizio pausa pranzo' doesn't double-match.
    await expect(page.locator('option', { hasText: /^Inizio pausa$/ })).toHaveCount(1);
    await expect(page.locator('option', { hasText: /^Inizio pausa pranzo$/ })).toHaveCount(1);
  });

  test('switches to the monthly grid view and back', async ({ page }) => {
    await expect(page.locator('.MuiDataGrid-root')).toBeVisible({ timeout: 15_000 });
    // List/Grid segmented toggle.
    await page.getByRole('tab', { name: 'Griglia mensile' }).click();
    // The employees × days matrix renders; the list DataGrid is hidden.
    await expect(page.getByTestId('stamp-grid')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Oggi' })).toBeVisible();
    await expect(page.locator('.MuiDataGrid-root')).toHaveCount(0);
    // Pivot flips the axes without losing the grid.
    await page.getByRole('button', { name: /Inverti righe\/colonne/i }).click();
    await expect(page.getByTestId('stamp-grid')).toBeVisible();
    // Back to the list.
    await page.getByRole('tab', { name: 'Lista' }).click();
    await expect(page.locator('.MuiDataGrid-root')).toBeVisible();
  });
});
