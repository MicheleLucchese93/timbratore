import { test, expect } from '@playwright/test';
import { CREDS } from '../fixtures/test-data';

test.describe('web — Utenti bulk bar (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: /Utenti/i })).toBeVisible({ timeout: 15_000 });
  });

  test("the admin's own role select is disabled (no self-demotion)", async ({ page }) => {
    // An admin must not be able to change their own role: demoting self to
    // Utente would strip admin access with no way back. The role select on the
    // logged-in admin's own row is therefore disabled (backend also rejects it
    // with 403 SELF_ROLE_CHANGE). test1 is the admin from web-setup.
    const grid = page.locator('.MuiDataGrid-root');
    await expect(grid).toBeVisible({ timeout: 15_000 });
    const selfRow = grid.locator('.MuiDataGrid-row', { hasText: CREDS.admin.email });
    await expect(selfRow).toBeVisible({ timeout: 10_000 });
    await expect(selfRow.locator('select').first()).toBeDisabled();
    // A different user's row keeps an enabled role select (test3 is a non-admin).
    const otherRow = grid.locator('.MuiDataGrid-row', { hasText: CREDS.user.email });
    if (await otherRow.count()) {
      await expect(otherRow.locator('select').first()).toBeEnabled();
    }
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
