import { test, expect } from '@playwright/test';

// Smoke-test that each tab is reachable and renders its content.
const TABS: Array<{ label: string; landmark: RegExp }> = [
  // Correzioni is no longer a bottom tab — it was merged into Timbrature as
  // swipeable sub-tabs (Timbra / Correggi).
  { label: 'Timbrature', landmark: /Ore lavorate/i },
  { label: 'Richieste', landmark: /Richieste|Ferie|Permessi/i },
];

test.describe('mobile — bottom tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
  });

  for (const tab of TABS) {
    test(`navigates to ${tab.label}`, async ({ page }) => {
      await page.getByRole('button', { name: tab.label }).click();
      await expect(page.getByText(tab.landmark).first()).toBeVisible({ timeout: 15_000 });
    });
  }

  // Storico is no longer a bottom tab — it is the third Timbrature sub-tab
  // (Timbra / Correggi / Storico) since the tab-bar consolidation.
  test('navigates to Storico (Timbrature sub-tab)', async ({ page }) => {
    await page.getByRole('button', { name: 'Timbrature' }).click();
    await page.getByText('Storico', { exact: true }).first().click();
    await expect(page.getByText(/7 giorni|30 giorni|90 giorni/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
