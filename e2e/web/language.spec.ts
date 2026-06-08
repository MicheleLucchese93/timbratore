import { test, expect } from '@playwright/test';

// The language is a per-user preference persisted to the backend (PATCH /me).
// This test toggles to English and ALWAYS restores Italian in `finally`, so the
// shared test account is never left in English (which would poison other specs
// that assert Italian copy).
test.describe('web — language switcher', () => {
  test('sidebar toggle switches the UI to English and back to Italian', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /Impostazioni/i })).toBeVisible({ timeout: 15_000 });

    // Sidebar footer toggle (buttons, not the <select> on the Settings page).
    const enBtn = page.getByRole('button', { name: 'English', exact: true });
    const itBtn = page.getByRole('button', { name: 'Italiano', exact: true });
    await expect(enBtn).toBeVisible({ timeout: 10_000 });

    // The toggle fires a fire-and-forget PATCH /me to persist the choice. Two
    // rapid clicks (EN then IT) race: the test only asserts the instant local
    // UI, so it can pass while the slower-completing 'en' write lands last,
    // leaving the SHARED admin in English server-side → every later spec that
    // asserts Italian copy then fails. Await each PATCH so IT is strictly the
    // last server write.
    const isMePatch = (r: import('@playwright/test').Response) =>
      r.url().includes('/api/v1/me') && r.request().method() === 'PATCH';

    try {
      const patchEn = page.waitForResponse(isMePatch);
      await enBtn.click();
      await patchEn; // 'en' persisted before we toggle back
      // Nav labels localise live: "Impostazioni" → "Settings".
      await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    } finally {
      const patchIt = page.waitForResponse(isMePatch);
      await itBtn.click();
      await patchIt; // 'it' is now the last server write — admin restored
      await expect(page.getByRole('link', { name: 'Impostazioni' })).toBeVisible({ timeout: 10_000 });
    }
  });
});
