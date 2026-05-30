import { test, expect } from '@playwright/test';

// Employees now have a full Ferie & Permessi section on web (previously
// mobile-only): tabs "Le mie" + "Calendario", and a "+ Nuova richiesta" form.
test.describe('web — Ferie & Permessi (employee)', () => {
  test('sidebar exposes the Ferie & Permessi entry', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Ferie & Permessi' })).toBeVisible({ timeout: 15_000 });
  });

  test.describe('on /me/leaves', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/me/leaves');
      await expect(page.getByRole('heading', { name: 'Ferie & Permessi' })).toBeVisible({ timeout: 15_000 });
    });

    test('shows "Le mie" and "Calendario" tabs', async ({ page }) => {
      await expect(page.getByRole('button', { name: 'Le mie', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Calendario', exact: true })).toBeVisible();
    });

    test('"+ Nuova richiesta" opens a request form with a Tipo selector', async ({ page }) => {
      await page.getByRole('button', { name: /Nuova richiesta/i }).click();
      await expect(page.getByRole('heading', { name: 'Nuova richiesta' })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Tipo', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Annulla', exact: true }).click();
    });

    test('Calendario tab renders the view switcher', async ({ page }) => {
      await page.getByRole('button', { name: 'Calendario', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Mese', exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: 'Anno', exact: true })).toBeVisible();
    });
  });
});
