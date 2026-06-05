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

  test('renders the "Sedi" usage counter (active / max_branches)', async ({ page }) => {
    // Tenant ACME Srl has 2 seeded branches; max_branches defaults to 3 (migration 036).
    // The widget renders "Sedi: <n> / 3".
    const counter = page.getByText(/Sedi:\s*\d+\s*\/\s*\d+/);
    await expect(counter).toBeVisible({ timeout: 15_000 });
    await expect(counter).toContainText('/ 3');
  });

  test('"Nuova sede" opens the branch form with the geofence controls', async ({ page }) => {
    await page.getByRole('button', { name: /Nuova sede/i }).click();
    // Modal heading — Nuova sede.
    await expect(page.getByRole('heading', { name: 'Nuova sede' })).toBeVisible({ timeout: 10_000 });
    // The <label htmlFor="sw"> is the canonical "Fuori sede" toggle label
    // (the page also mentions Fuori sede in helper copy). Lock to the
    // form label, not the descriptive paragraph.
    await expect(page.locator('label[for="sw"]')).toBeVisible();
    // Enforce-radius toggle is ON by default → radius slider visible.
    const enforceToggle = page.locator('input#er');
    await expect(enforceToggle).toBeVisible();
    await expect(enforceToggle).toBeChecked();
    await expect(page.locator('input[type="range"]')).toBeVisible();
    // Close without saving.
    const cancel = page.getByRole('button', { name: 'Annulla' });
    if (await cancel.count()) await cancel.click();
    else await page.keyboard.press('Escape');
  });

  test('disabling "Limita timbratura entro un raggio" hides the radius controls', async ({ page }) => {
    await page.getByRole('button', { name: /Nuova sede/i }).click();
    await expect(page.getByRole('heading', { name: 'Nuova sede' })).toBeVisible({ timeout: 10_000 });
    const enforceToggle = page.locator('input#er');
    await expect(enforceToggle).toBeChecked();
    await expect(page.locator('input[type="range"]')).toBeVisible();
    await enforceToggle.uncheck();
    await expect(page.locator('input[type="range"]')).toHaveCount(0);
    // The explanatory caption is rendered.
    await expect(page.getByText(/GPS viene comunque registrato/i)).toBeVisible();
    const cancel = page.getByRole('button', { name: 'Annulla' });
    if (await cancel.count()) await cancel.click();
    else await page.keyboard.press('Escape');
  });
});
