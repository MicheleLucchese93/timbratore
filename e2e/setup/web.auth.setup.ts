import { test as setup, expect } from '@playwright/test';
import { CREDS, STORAGE, URLS } from '../fixtures/test-data';

// Runs once before the `web` project. Logs in via the real Login form and
// persists localStorage to STORAGE.webAuth so each spec can reuse the session
// without re-authenticating (faster + fewer GoTrue audit-log entries).
setup('authenticate web admin', async ({ page }) => {
  await page.goto(`${URLS.web}/login`);
  await page.locator('input#email').fill(CREDS.admin.email);
  await page.locator('input#password').fill(CREDS.admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
  await page.context().storageState({ path: STORAGE.webAuth });
});
