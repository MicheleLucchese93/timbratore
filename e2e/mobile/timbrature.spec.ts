import { test, expect } from '@playwright/test';

test.describe('mobile — Timbrature tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Admins now open on the Dashboard tab — step into Timbrature first.
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Timbrature' }).click();
    // Ensure the home-tab content (hero card) is visible before each assertion.
    await expect(page.getByText('Ore lavorate').first()).toBeVisible({ timeout: 30_000 });
  });

  test('shows hero stats: ore lavorate, ore conteggiate, entrata, pause, uscita', async ({ page }) => {
    // Strict mode would fire on "Uscita" / "Pause" because action labels also
    // contain them ("Timbra uscita", "Inizia pausa"). Pin to the first match
    // — the hero card renders them before the action buttons.
    await expect(page.getByText('Ore lavorate').first()).toBeVisible();
    // "Ore conteggiate" floors to 15-min blocks (apps/mobile/src/lib/counted-day.ts).
    await expect(page.getByText('Ore conteggiate').first()).toBeVisible();
    await expect(page.getByText('Entrata').first()).toBeVisible();
    await expect(page.getByText('Pause').first()).toBeVisible();
    await expect(page.getByText('Uscita').first()).toBeVisible();
  });

  test('shows the bottom tab bar with the admin tabs (incl. Dashboard)', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Richieste' })).toBeVisible();
    // Storico is a Timbrature sub-tab (Timbra / Correggi / Storico), not a
    // bottom tab.
    await expect(page.getByRole('button', { name: 'Storico' })).toHaveCount(0);
    await expect(page.getByText('Storico', { exact: true }).first()).toBeVisible();
    // Correzioni is no longer a bottom tab — it lives inside Timbrature now.
    await expect(page.getByRole('button', { name: 'Correzioni' })).toHaveCount(0);
  });

  test('exposes Timbra / Correggi sub-tabs', async ({ page }) => {
    await expect(page.getByText('Timbra', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Correggi').first()).toBeVisible();
  });

  test('shows at least one stamp action button matching current state', async ({ page }) => {
    // State chip is one of: Al lavoro / In pausa / In pausa pranzo / Fuori servizio.
    // Each state surfaces 1-3 action buttons. Assert at least one of the expected
    // labels is on screen rather than coupling the test to a specific state.
    const anyAction = page.getByText(
      /Timbra ingresso|Timbra uscita|Inizia pausa|Termina pausa|Inizia pausa pranzo|Termina pausa pranzo/
    );
    await expect(anyAction.first()).toBeVisible();
  });

  test('shows today schedule (Orario di oggi) for the assigned shift', async ({ page }) => {
    // The seeded admin has the "Ufficio 9-18" shift, so the section renders
    // (TimbratureScreen.tsx: {assignment && …}). Auto-wait for it — the
    // assignment is fetched async, so a one-shot check would race the render.
    await expect(page.getByText('Orario di oggi')).toBeVisible({ timeout: 15_000 });
    // Either scheduled slots (with a "Totale …" expected-hours label) on a work
    // day, or the rest-day copy when today has no slot.
    await expect(page.getByText(/Totale \d+h|giorno di riposo/).first()).toBeVisible();
  });

  test('opens profile screen from header avatar', async ({ page }) => {
    await page.getByRole('button', { name: 'Profilo' }).click();
    // Profilo screen shows email + logout option somewhere; just assert URL.
    await expect(page).toHaveURL(/\/profilo$/);
  });
});
