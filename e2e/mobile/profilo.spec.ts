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
    // The admin's own email also renders in the Dashboard "Stato attuale"
    // list, which stays mounted behind the pushed Profilo screen (RN-Web
    // keeps prior routes in the DOM). Assert presence (count) rather than
    // strict visibility to avoid the duplicate-match — same idiom as the
    // Sede assertion below.
    await expect(page.getByText(CREDS.admin.email)).not.toHaveCount(0);
    // Admin role pill reads "Amministratore" (unique to the Profilo identity
    // card). The non-admin variant says "Dipendente".
    await expect(page.getByText('Amministratore').first()).toBeVisible({ timeout: 15_000 });
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

  test('Notifiche section has PUSH info', async ({ page }) => {
    await expect(page.getByText('Notifiche').first()).toBeVisible();
    await expect(page.getByText('PUSH').first()).toBeVisible();
    // Mobile Profilo manages PUSH only; email notification prefs live in web
    // Settings (mobile push is always on). No EMAIL switch here by design.
  });

  test('Sicurezza section shows the biometric login row', async ({ page }) => {
    await expect(page.getByText('Sicurezza').first()).toBeVisible();
    // The biometric prompt itself is a native module and can't be driven in
    // the RN-Web harness; here we only assert the row renders. On web there's
    // no biometric hardware, so it shows the generic label with a disabled
    // switch (real devices read "Accesso con Face ID/Touch ID/impronta").
    await expect(page.getByText('Accesso biometrico').first()).toBeVisible();
  });

  test('Esci button visible at the bottom', async ({ page }) => {
    await expect(page.getByText('Esci')).toBeVisible();
  });
});
