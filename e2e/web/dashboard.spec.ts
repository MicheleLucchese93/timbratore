import { test, expect } from '@playwright/test';

test.describe('web — admin dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows the six dashboard stat cards', async ({ page }) => {
    // Dashboard refactor: container is `.dash-stat-grid` (not `.stat-grid`),
    // and the cards are: Presenti ora, In pausa, Assenti oggi, Da approvare,
    // Anomalie 7 gg, Sedi. Scope to the section because "Sedi" also exists
    // as a sidebar nav link.
    const grid = page.locator('.dash-stat-grid');
    await expect(grid.getByText('Presenti ora')).toBeVisible({ timeout: 15_000 });
    await expect(grid.getByText('In pausa')).toBeVisible();
    await expect(grid.getByText('Assenti oggi')).toBeVisible();
    await expect(grid.getByText('Da approvare')).toBeVisible();
    await expect(grid.getByText('Anomalie 7 gg')).toBeVisible();
    await expect(grid.getByText('Sedi')).toBeVisible();
  });

  test('Stato attuale section lists users with status', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Stato attuale' })).toBeVisible({ timeout: 15_000 });
    // At least one of the seeded test users should be visible.
    const anyUser = page.locator('text=/@test\\.it/').first();
    await expect(anyUser).toBeVisible();
  });

  test('"Da approvare" inbox surfaces all three tabs', async ({ page }) => {
    // The inbox section maps to the three approval workflows the admin
    // handles: Correzioni, Ferie/permessi/malattia, Revoche (cancellations).
    await expect(page.getByRole('heading', { name: 'Da approvare' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /^Correzioni\s+\d+$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Ferie \/ permessi \/ malattia\s+\d+/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Revoche\s+\d+$/ })).toBeVisible();
  });

  test('Aggiorna button reloads data without navigating away', async ({ page }) => {
    await page.getByRole('button', { name: 'Aggiorna' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});
