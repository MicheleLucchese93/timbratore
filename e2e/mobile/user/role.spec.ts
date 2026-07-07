import { test, expect } from '@playwright/test';

// Mobile is the same surface for admin and user — the role gates surface only
// inside individual screens (Corrections FAB, Richieste tabs).
test.describe('mobile — employee role (test3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
  });

  test('all bottom tabs still visible', async ({ page }) => {
    // Correzioni is no longer a bottom tab — merged into Timbrature.
    for (const label of ['Timbrature', 'Bacheca', 'Richieste', 'Documenti']) {
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Correzioni' })).toHaveCount(0);
  });

  test('Correzioni sub-tab shows the "Nuova richiesta" FAB for employees', async ({ page }) => {
    await page.getByRole('button', { name: 'Timbrature' }).click();
    await page.getByText('Correggi').first().click();
    // RN-Web TouchableOpacity emits `<div aria-label>` without role="button",
    // so `getByLabel` is the reliable locator — not `getByRole('button')`.
    await expect(page.getByLabel('Nuova richiesta').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Richieste shows quota summary (employee view)', async ({ page }) => {
    await page.getByRole('button', { name: 'Richieste' }).click();
    // Employee Richieste header shows "Ferie" + "Permessi" quota cards.
    await expect(page.getByText('Ferie', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });
});
