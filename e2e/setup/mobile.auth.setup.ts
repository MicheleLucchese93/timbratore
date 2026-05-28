import { test as setup, expect } from '@playwright/test';
import { CREDS, STORAGE, URLS } from '../fixtures/test-data';

// Mobile Expo web uses react-native-web. Inputs map to native <input> with
// placeholder text we can target. Saves storage state for downstream specs.
setup('authenticate mobile user', async ({ page }) => {
  await page.goto(URLS.mobile);
  // Expo web bundler can be slow to first-paint — wait for the login surface.
  await expect(page.getByPlaceholder('email@azienda.it')).toBeVisible({ timeout: 60_000 });
  await page.getByPlaceholder('email@azienda.it').fill(CREDS.admin.email);
  await page.getByPlaceholder('••••••••').fill(CREDS.admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  // After login the Timbrature tab is the initial route.
  await expect(page.getByText('Ore lavorate')).toBeVisible({ timeout: 30_000 });
  await page.context().storageState({ path: STORAGE.mobileAuth });
});
