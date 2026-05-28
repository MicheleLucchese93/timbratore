import { test, expect } from '@playwright/test';
import { CREDS } from '../fixtures/test-data';

test.describe('mobile — Profilo screen (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Profilo' }).click();
    await expect(page).toHaveURL(/\/profilo$/);
  });

  test('shows the user identity (email + role badge)', async ({ page }) => {
    await expect(page.getByText(CREDS.admin.email)).toBeVisible({ timeout: 15_000 });
    // Admin role pill reads "Amministratore". The non-admin variant says
    // "Dipendente" — verified by the employee-role spec below.
    await expect(page.getByText('Amministratore').first()).toBeVisible();
  });

  test('Azienda section lists the tenant name', async ({ page }) => {
    await expect(page.getByText('Azienda').first()).toBeVisible();
    await expect(page.getByText('Ragione sociale').first()).toBeVisible();
    await expect(page.getByText('ACME Srl').first()).toBeVisible();
  });

  test('Sede/Sedi section lists at least one branch', async ({ page }) => {
    // The ProfiloScreen always renders Sedi card with branch rows. RN-Web
    // mounts the entire ScrollView content even when off-screen, so
    // assert on DOM presence (count) rather than viewport visibility —
    // the latter races with the Pixel 5 viewport's clipping.
    await expect(page.getByText('Sedi').or(page.getByText('Sede', { exact: true }))).not.toHaveCount(0);
    const branchHits = await page.getByText(/Archiva|Casa/).count();
    expect(branchHits, 'expected at least one branch name in the Sedi card').toBeGreaterThan(0);
  });

  test('Notifiche section has PUSH info + EMAIL switch', async ({ page }) => {
    await expect(page.getByText('Notifiche').first()).toBeVisible();
    await expect(page.getByText('PUSH').first()).toBeVisible();
    await expect(page.getByText('EMAIL').first()).toBeVisible();
  });

  test('Esci button visible at the bottom', async ({ page }) => {
    await expect(page.getByText('Esci')).toBeVisible();
  });
});
