import { test as setup, expect } from '@playwright/test';
import { PARTNER_CAPS, PARTNER_CREDS, STORAGE, URLS } from '../fixtures/test-data';
import { grantPartnership } from '../fixtures/partner-client';

// Seed the reseller (partner role) with finite caps, then log in and persist
// storageState for the `partner-user` project.
setup('authenticate partner (reseller)', async ({ page }) => {
  await grantPartnership({ email: PARTNER_CREDS.partner.email, role: 'partner', caps: PARTNER_CAPS });

  await page.goto(`${URLS.partner}/login`);
  await page.locator('input#email').fill(PARTNER_CREDS.partner.email);
  await page.locator('input#password').fill(PARTNER_CREDS.partner.password);
  await page.getByRole('button', { name: /Accedi|Sign in/ }).click();

  await expect(page.getByRole('heading', { name: /Aziende|Companies/ })).toBeVisible({ timeout: 15_000 });
  await page.context().storageState({ path: STORAGE.partnerUserAuth });
});
