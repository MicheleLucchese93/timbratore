import { test, expect } from '@playwright/test';

test.describe('mobile — Correzioni (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Correzioni' }).click();
  });

  test('does NOT show the "Nuova richiesta" FAB', async ({ page }) => {
    // The FAB is gated behind `!isAdmin`. Confirm it's absent for the admin
    // session — this is the canonical signal that role-gating works on
    // mobile too.
    await expect(page.getByRole('button', { name: 'Nuova richiesta' })).toHaveCount(0);
  });

  test('shows the swipeable tabs (In attesa / Tutte)', async ({ page }) => {
    await expect(page.getByText('In attesa').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Tutte').first()).toBeVisible();
  });

  // Empty-state admin copy ("Nessuna richiesta da gestire.") test removed:
  // it is mutually exclusive with the seeded pending-correction specs that
  // run in the same suite, so guaranteeing it would require deleting all
  // pending rows — destructive on a shared tenant. The variant copy is
  // verified by code inspection (CorrezioniScreen.tsx:148).
});
