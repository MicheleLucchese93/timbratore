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

    test('"Le mie" shows the KPI summary tiles', async ({ page }) => {
      // KPI band: two tiles, Ferie + Permessi (residual hours). Their sub-line
      // also shows "In attesa: Xh" when that quota has pending hours. Scope to
      // the .stat-grid so the "Ferie"/"Permessi" labels don't collide with the
      // per-request rows below.
      const grid = page.locator('.stat-grid');
      await expect(grid).toBeVisible({ timeout: 10_000 });
      await expect(grid.getByText('Ferie', { exact: true })).toBeVisible();
      await expect(grid.getByText('Permessi', { exact: true })).toBeVisible();
    });

    test('"+ Nuova richiesta" opens a request form with a Tipo selector', async ({ page }) => {
      await page.getByRole('button', { name: /Nuova richiesta/i }).click();
      await expect(page.getByRole('heading', { name: 'Nuova richiesta' })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Tipo', { exact: true })).toBeVisible();
      // Scope to the modal card: a residue pending request on the mine list
      // renders its own "Annulla" (cancel) button, so a page-wide match is not
      // unique. The modal is the .card containing the "Nuova richiesta" heading.
      await page
        .locator('.card', { has: page.getByRole('heading', { name: 'Nuova richiesta' }) })
        .getByRole('button', { name: 'Annulla', exact: true })
        .click();
    });

    test('a timed Permesso splits date from time (Giorno + Dalle/Alle ore)', async ({ page }) => {
      await page.getByRole('button', { name: /Nuova richiesta/i }).click();
      await expect(page.getByRole('heading', { name: 'Nuova richiesta' })).toBeVisible({ timeout: 10_000 });

      // Permesso, all-day OFF → the single day picker + separate start/end time
      // fields appear (the "permesso orario" layout).
      await page.locator('select.input').first().selectOption('permessi');
      await page.getByRole('checkbox').first().uncheck();

      await expect(page.getByText('Giorno', { exact: true })).toBeVisible();
      await expect(page.getByText('Dalle ore', { exact: true })).toBeVisible();
      await expect(page.getByText('Alle ore', { exact: true })).toBeVisible();
      // One date input for the day + two time inputs for start/end.
      await expect(page.locator('input[type="date"]')).toHaveCount(1);
      await expect(page.locator('input[type="time"]')).toHaveCount(2);

      // Toggling "all day" back collapses to a Dal/Al date range (two dates).
      await page.getByRole('checkbox').first().check();
      await expect(page.locator('input[type="date"]')).toHaveCount(2);
      await expect(page.locator('input[type="time"]')).toHaveCount(0);

      // Scope to the modal card: a residue pending request on the mine list
      // renders its own "Annulla" (cancel) button, so a page-wide match is not
      // unique. The modal is the .card containing the "Nuova richiesta" heading.
      await page
        .locator('.card', { has: page.getByRole('heading', { name: 'Nuova richiesta' }) })
        .getByRole('button', { name: 'Annulla', exact: true })
        .click();
    });

    test('Calendario tab renders the view switcher', async ({ page }) => {
      await page.getByRole('button', { name: 'Calendario', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Mese', exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: 'Anno', exact: true })).toBeVisible();
    });
  });
});
