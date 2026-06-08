import { test, expect } from '@playwright/test';

// web-user project: storageState = test3 (the only non-admin on the test
// tenant). The seeded test3 is gps-only, so web stamping is blocked
// (WEB_CLOCK_IN_DISABLED) and the panel shows the "use the mobile app" notice
// instead of the action buttons. test3 also has no permanent shift assignment
// (other specs seed one on demand), so the today/weekly schedule section is
// absent by default. Both facts make this a stable, non-mutating render check
// of the StampPanel that now lives on MyDashboard.
test.describe('web (employee) — stamping panel on My Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Ciao,/ })).toBeVisible({ timeout: 15_000 });
  });

  test('renders the day summary card (worked + counted hours)', async ({ page }) => {
    await expect(page.getByText('Ore lavorate')).toBeVisible();
    await expect(page.getByText('Ore conteggiate')).toBeVisible();
  });

  test('gps-only employee sees the web-stamping-disabled notice, not the buttons', async ({ page }) => {
    await expect(page.getByText(/La timbratura da web non è abilitata/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Timbra ingresso' })).toHaveCount(0);
  });

  test('still lists recent stamps', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Ultime timbrature' })).toBeVisible();
  });
});
