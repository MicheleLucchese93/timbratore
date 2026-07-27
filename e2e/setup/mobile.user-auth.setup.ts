import { test as setup, expect } from '@playwright/test';
import { CREDS, STORAGE, URLS } from '../fixtures/test-data';
import { chooseTenantIfPrompted } from '../fixtures/choose-tenant';

// Employee-role mobile session. Lands on /timbrature like the admin session;
// the role gate only affects screen-internal UI (e.g. Corrections FAB).
setup('authenticate mobile user', async ({ page }) => {
  await page.goto(URLS.mobile);
  await expect(page.getByPlaceholder('email@azienda.it')).toBeVisible({ timeout: 60_000 });
  await page.getByPlaceholder('email@azienda.it').fill(CREDS.user.email);
  await page.getByPlaceholder('••••••••').fill(CREDS.user.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  // No-op while test3 stays single-company (see web.user-auth.setup.ts).
  const home = page.getByText('Ore lavorate').first();
  await chooseTenantIfPrompted(page, home);
  await expect(home).toBeVisible({ timeout: 30_000 });
  await page.context().storageState({ path: STORAGE.mobileUserAuth });
});
