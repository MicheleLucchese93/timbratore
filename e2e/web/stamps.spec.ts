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
    // The Evento <select> contains the four event types — use that as the
    // disambiguating signal (avoids collision with the DataGrid column menu).
    await expect(page.locator('option', { hasText: 'Inizio pausa' })).toHaveCount(1);
  });
});
