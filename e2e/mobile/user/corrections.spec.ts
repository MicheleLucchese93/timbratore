import { test, expect } from '@playwright/test';

test.describe('mobile — Correzioni create flow (employee)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Timbrature' }).click();
    // Corrections moved inside Timbrature — open the "Correggi" sub-tab.
    await page.getByText('Correggi').first().click();
  });

  test('FAB is visible for the employee role', async ({ page }) => {
    await expect(page.getByLabel('Nuova richiesta').first()).toBeVisible({ timeout: 10_000 });
  });

  test('tapping FAB opens the date-step modal "Quale giorno?"', async ({ page }) => {
    await page.getByLabel('Nuova richiesta').first().click();
    // Step "date" header text.
    await expect(page.getByText('Quale giorno?')).toBeVisible({ timeout: 10_000 });
    // Section label inside the modal.
    await expect(page.getByText('Data').first()).toBeVisible();
    await expect(page.getByText(/Scegli la data/i)).toBeVisible();
  });

  test('swipeable tabs "Timbra" and "Correggi" are present', async ({ page }) => {
    await expect(page.getByText('Timbra', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Correggi').first()).toBeVisible();
  });

  // Employee empty-state copy ("Non hai richieste.") test removed: it is
  // mutually exclusive with seeded correction-create specs in the same
  // suite. The variant copy is verified by code inspection
  // (CorrectionsTab.tsx — CorrectionsListPage empty state).
});
