import { test, expect } from '@playwright/test';

// The Richieste screen gained a third swipeable tab, "Calendario", between
// "Le mie" and "Da approvare". It renders a custom day/week/month/year
// calendar with the festività legend.
test.describe('mobile — Richieste Calendario tab (employee)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Richieste' }).click();
  });

  test('shows the Calendario tab alongside Le mie / Da approvare', async ({ page }) => {
    await expect(page.getByText('Le mie', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Calendario', { exact: true }).first()).toBeVisible();
  });

  test('tapping Calendario reveals the view switcher and legend', async ({ page }) => {
    await page.getByText('Calendario', { exact: true }).first().click();
    await expect(page.getByText('Mese', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Anno', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Festività', { exact: true }).first()).toBeVisible();
  });
});
