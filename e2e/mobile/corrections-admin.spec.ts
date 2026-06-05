import { test, expect } from '@playwright/test';

test.describe('mobile — Correzioni (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Correzioni' }).click();
  });

  test('shows the "Nuova richiesta" FAB (admins can request too)', async ({ page }) => {
    // The FAB is no longer role-gated — admins file correction requests for
    // their own stamps to get a request→approve audit trail.
    await expect(page.getByLabel('Nuova richiesta').first()).toBeVisible({ timeout: 10_000 });
  });

  test('shows the swipeable tabs (In attesa / Tutte)', async ({ page }) => {
    await expect(page.getByText('In attesa').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Tutte').first()).toBeVisible();
  });
});

// Admin walks the same 3-step create modal as employees. No row is written —
// the walk stops at the edit form (it never taps "Invia richiesta").
test.describe('mobile — Correzioni create flow (admin, 3 steps)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Correzioni' }).click();
    await page.getByLabel('Nuova richiesta').first().click();
    await expect(page.getByText('Quale giorno?')).toBeVisible({ timeout: 10_000 });
  });

  test('step 1 → 2: Continua advances to pickStamp', async ({ page }) => {
    // TouchableOpacity submit button — RN-Web emits <div> w/o role=button.
    await page.getByText('Continua').click();
    await expect(page.getByText(/Tocca una timbratura per correggerla/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Aggiungi una timbratura mancante/i)).toBeVisible();
  });

  test('step 2 → 3: "Aggiungi mancante" advances to edit form', async ({ page }) => {
    await page.getByText('Continua').click();
    await page.getByText(/Aggiungi una timbratura mancante/i).click();
    await expect(page.getByText('Tipo evento')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Motivazione').first()).toBeVisible();
    await expect(
      page.getByPlaceholder("Es. avevo dimenticato di timbrare l'uscita"),
    ).toBeVisible();
  });
});
