import { test as setup, expect } from '@playwright/test';
import { CREDS, STORAGE, URLS } from '../fixtures/test-data';

// Logs in as the per-run fixture user (provisioned by web.auth.setup.ts via
// the internal /create-fixture-user endpoint and persisted to
// STORAGE.userCreds, which CREDS.user reads at module load). Falls back to
// the legacy test3 QA account when the creds file is absent — e.g. the
// internal endpoint is unavailable. Persists the session to
// STORAGE.webUserAuth for the `web-user` project.
setup('authenticate web user', async ({ page }) => {
  await page.goto(`${URLS.web}/login`);
  await page.locator('input#email').fill(CREDS.user.email);
  await page.locator('input#password').fill(CREDS.user.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  // Employee lands on MyDashboard at /, which renders "Ciao, <email prefix>".
  await expect(page.getByRole('heading', { name: /Ciao,/ })).toBeVisible({ timeout: 15_000 });
  await page.context().storageState({ path: STORAGE.webUserAuth });
});
