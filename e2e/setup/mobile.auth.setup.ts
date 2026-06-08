import { test as setup, expect } from '@playwright/test';
import { CREDS, STORAGE, URLS } from '../fixtures/test-data';
import { ensureRecentAdminStorico, loadHandleFromStorage } from '../fixtures/api-client';

// Mobile Expo web uses react-native-web. Inputs map to native <input> with
// placeholder text we can target. Saves storage state for downstream specs.
setup('authenticate mobile user', async ({ page }) => {
  await page.goto(URLS.mobile);
  // Expo web bundler can be slow to first-paint — wait for the login surface.
  await expect(page.getByPlaceholder('email@azienda.it')).toBeVisible({ timeout: 60_000 });
  await page.getByPlaceholder('email@azienda.it').fill(CREDS.admin.email);
  await page.getByPlaceholder('••••••••').fill(CREDS.admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  // Admins land on the Dashboard recap (its first stat card is "Presenti ora").
  await expect(page.getByText('Presenti ora').first()).toBeVisible({ timeout: 30_000 });
  await page.context().storageState({ path: STORAGE.mobileAuth });

  // Guarantee the mobile admin has recent Storico data so storico.spec renders
  // its day cards regardless of tenant history. Idempotent + best-effort: only
  // seeds when test1 has no stamp in Storico's 30-day window, and never fails
  // the setup (non-prod / no-admin-access just skips). Reproducible replacement
  // for the prior one-off manual prod seed; survives the role-scoped purge.
  try {
    const admin = await loadHandleFromStorage(STORAGE.mobileAuth, CREDS.admin);
    const seeded = await ensureRecentAdminStorico(admin.token, admin.userId);
    if (seeded > 0) {
      // eslint-disable-next-line no-console
      console.log(`[mobile-setup] seeded ${seeded} admin Storico baseline day(s)`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[mobile-setup] Storico baseline seed skipped:', (err as Error).message);
  }
});
