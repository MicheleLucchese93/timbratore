import { test as setup, expect } from '@playwright/test';
import { PARTNER_CREDS, STORAGE, URLS } from '../fixtures/test-data';
import { grantPartnership } from '../fixtures/partner-client';

// Seed the platform-admin partnership member, then log in via the real partner
// Login form (dev-token in local dev) and persist storageState for the `partner`
// project. Runs against the LOCAL backend only.
setup('authenticate partner admin', async ({ page }) => {
  await grantPartnership({ email: PARTNER_CREDS.admin.email, role: 'admin' });

  await page.goto(`${URLS.partner}/login`);
  await page.locator('input#email').fill(PARTNER_CREDS.admin.email);
  await page.locator('input#password').fill(PARTNER_CREDS.admin.password);
  await page.getByRole('button', { name: /Accedi|Sign in/ }).click();

  await expect(page.getByRole('heading', { name: /Aziende|Companies/ })).toBeVisible({ timeout: 15_000 });
  await page.context().storageState({ path: STORAGE.partnerAuth });
});
