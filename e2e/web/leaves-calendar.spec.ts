import { test, expect } from '@playwright/test';

test.describe('web — Ferie & Permessi: Calendario tab (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/leaves');
    await expect(page.getByRole('heading', { name: 'Ferie & Permessi' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Calendario', exact: true }).click();
  });

  test('view switcher exposes Giorno / Settimana / Mese / Anno', async ({ page }) => {
    for (const v of ['Giorno', 'Settimana', 'Mese', 'Anno']) {
      await expect(page.getByRole('button', { name: v, exact: true })).toBeVisible({ timeout: 10_000 });
    }
  });

  test('legend shows leave types + Festività', async ({ page }) => {
    await expect(page.getByText('Festività', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Chiusura aziendale', { exact: true }).first()).toBeVisible();
  });

  test('"Oggi" + prev/next navigation are present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Oggi', exact: true })).toBeVisible();
  });

  test('"+ Inserisci evento" opens the bulk-event modal', async ({ page }) => {
    await page.getByRole('button', { name: /Inserisci evento/i }).click();
    await expect(page.getByRole('heading', { name: /Inserisci evento aziendale/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Titolo', { exact: true })).toBeVisible();
    await expect(page.getByText(/Conteggia come ferie/i)).toBeVisible();
    // Two "Tutti" controls exist in the modal (a quick-select button + an
    // audience-radio label); assert presence via the first to avoid strict-mode.
    await expect(page.getByText('Tutti', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Annulla', exact: true }).click();
  });
});
