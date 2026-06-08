import { test, expect } from '@playwright/test';

test.describe('web — Utenti bulk bar (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: /Utenti/i })).toBeVisible({ timeout: 15_000 });
  });

  test('single-row select reveals the bulk action bar', async ({ page }) => {
    const grid = page.locator('.MuiDataGrid-root');
    await expect(grid).toBeVisible({ timeout: 15_000 });
    // Tick the first row's selection checkbox → the bulk bar appears.
    await grid.locator('.MuiDataGrid-row').first().getByRole('checkbox').check();
    const bar = page.locator('.bulk-bar');
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await expect(bar.getByRole('button', { name: 'Assegna sedi', exact: true })).toBeVisible();
  });

  test('header "select all" also reveals the bulk bar with every action', async ({ page }) => {
    // Regression guard: MUI's header select-all returns an exclude-style model
    // ({type:'exclude', ids:∅}), so the bar must resolve selection against the
    // row list rather than trusting ids.size — otherwise it stays hidden and
    // every bulk endpoint would act on zero users. Scope assertions to the
    // .bulk-bar so a same-named button elsewhere can't mask a regression.
    const grid = page.locator('.MuiDataGrid-root');
    await expect(grid).toBeVisible({ timeout: 15_000 });
    // The header checkbox input is tabindex=-1; click the MUI ButtonBase span.
    await grid.locator('.MuiDataGrid-columnHeaderCheckbox .MuiButtonBase-root').click();
    const bar = page.locator('.bulk-bar');
    await expect(bar).toBeVisible({ timeout: 10_000 });
    // The full action set the bulk bar exposes when ≥1 user is selected.
    for (const action of [
      'Assegna sedi',
      'Rimuovi sedi',
      'Assegna orario',
      'Timbratura',
      'Approvatori ferie',
      'Approvatori correzioni',
      'Invia reset password',
    ]) {
      await expect(bar.getByRole('button', { name: action, exact: true })).toBeVisible();
    }
  });
});
