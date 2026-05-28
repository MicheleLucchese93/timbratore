import { test, expect } from '@playwright/test';

test.describe('web — Sedi (Branches) page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/branches');
  });

  test('renders heading + at least one seeded branch ("Archiva" or "Casa")', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Sedi/i }).first()).toBeVisible({ timeout: 15_000 });
    // The ACME Srl tenant has two seeded branches: Archiva (real GPS) and
    // Casa (smart_working). At least one must render.
    await expect(page.getByText(/Archiva|Casa/).first()).toBeVisible();
  });

  test('"Nuova sede" opens the branch form with the geofence controls', async ({ page }) => {
    await page.getByRole('button', { name: /Nuova sede/i }).click();
    // Modal heading — Nuova sede.
    await expect(page.getByRole('heading', { name: 'Nuova sede' })).toBeVisible({ timeout: 10_000 });
    // The <label htmlFor="sw"> is the canonical "Smart working" toggle label
    // (the page also mentions Smart working in helper copy). Lock to the
    // form label, not the descriptive paragraph.
    await expect(page.locator('label[for="sw"]')).toBeVisible();
    await expect(page.locator('input[type="range"]')).toBeVisible();
    // Geofence policy select with lenient/strict options.
    const select = page.locator('select').first();
    await expect(select).toBeVisible();
    // Close without saving.
    const cancel = page.getByRole('button', { name: 'Annulla' });
    if (await cancel.count()) await cancel.click();
    else await page.keyboard.press('Escape');
  });
});
