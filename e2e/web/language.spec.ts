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

    try {
      await enBtn.click();
      // Nav labels localise live: "Impostazioni" → "Settings".
      await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    } finally {
      await itBtn.click();
      await expect(page.getByRole('link', { name: 'Impostazioni' })).toBeVisible({ timeout: 10_000 });
    }
  });
});
