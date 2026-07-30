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
    await expect(page.getByTestId('hero-worked')).toBeVisible();
    await expect(page.getByTestId('hero-counted')).toBeVisible();
  });

  // Regression guard mirroring e2e/mobile/timbrature.spec.ts: "Ore conteggiate"
  // used to add the overtime blocks on top of a worked total that already
  // included them. test3 has no permanent assignment, so the value normally
  // reads "—"; the check applies whenever another spec left one seeded.
  test('ore conteggiate never exceed ore lavorate', async ({ page }) => {
    const parse = (s: string): number | null => {
      const m = s.match(/(\d+)h\s*(\d+)m/);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const worked = parse(await page.getByTestId('hero-worked').innerText());
    const counted = parse(await page.getByTestId('hero-counted').innerText());
    if (worked === null) throw new Error('hero-worked did not render a duration');
    if (counted === null) return;
    expect(counted).toBeLessThanOrEqual(worked);
  });

  test('gps-only employee sees the web-stamping-disabled notice, not the buttons', async ({ page }) => {
    await expect(page.getByText(/La timbratura da web non è abilitata/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Timbra ingresso' })).toHaveCount(0);
  });

  test('still lists recent stamps', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Ultime timbrature' })).toBeVisible();
  });
});
