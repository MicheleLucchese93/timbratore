import { test as setup, expect } from '@playwright/test';
import { CREDS, STORAGE, URLS } from '../fixtures/test-data';

// Logs in test3 (the only non-admin on the test tenant) and persists the
// session to STORAGE.webUserAuth. Used by the `web-user` project for
// employee-role coverage.
setup('authenticate web user', async ({ page }) => {
  await page.goto(`${URLS.web}/login`);
  await page.locator('input#email').fill(CREDS.user.email);
  await page.locator('input#password').fill(CREDS.user.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  // Employee lands on MyDashboard at /, which renders "Ciao, <email prefix>".
  await expect(page.getByRole('heading', { name: /Ciao,/ })).toBeVisible({ timeout: 15_000 });
  await page.context().storageState({ path: STORAGE.webUserAuth });
});
