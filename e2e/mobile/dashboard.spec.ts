import { test, expect } from '@playwright/test';

test.describe('mobile — Dashboard (admin)', () => {
  test('admin opens directly on the Dashboard recap', async ({ page }) => {
    await page.goto('/');
    // No tab click: landing straight on the recap proves the admin default
    // route is Dashboard (apps/mobile/src/app/(tabs)/_layout.tsx).
    await expect(page.getByText('Presenti ora').first()).toBeVisible({ timeout: 30_000 });
  });

  test('shows the Dashboard tab in the bottom bar', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible({ timeout: 30_000 });
  });

  test('shows the three recap stat cards', async ({ page }) => {
    // Recap was trimmed to three cards (DashboardScreen.tsx statGrid):
    // Presenti ora / In pausa / Assenti oggi. The former "Da approvare",
    // "Anomalie 7 gg" and "Sedi" cards were removed.
    await page.goto('/');
    await expect(page.getByText('Presenti ora').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('In pausa').first()).toBeVisible();
    await expect(page.getByText('Assenti oggi').first()).toBeVisible();
    await expect(page.getByText('Da approvare')).toHaveCount(0);
    await expect(page.getByText('Anomalie 7 gg')).toHaveCount(0);
  });

  test('lists employee presence under "Stato attuale"', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Stato attuale').first()).toBeVisible({ timeout: 30_000 });
    // At least one seeded test user surfaces in the presence list.
    await expect(page.locator('text=/@test\\.it/').first()).toBeVisible();
  });

  test('"Stato attuale" offers Elenco / Per sede grouping chips', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Stato attuale').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Elenco' })).toBeVisible();
    const perSede = page.getByRole('button', { name: 'Per sede' });
    await expect(perSede).toBeVisible();
    await perSede.click();
    // Grouped view still surfaces a seeded user (under a sede or "Fuori servizio").
    await expect(page.locator('text=/@test\\.it/').first()).toBeVisible();
  });

  test('"Assenti" offers Oggi / 7 gg / 14 gg horizon chips', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Assenti', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Oggi' })).toBeVisible();
    await expect(page.getByRole('button', { name: '7 gg' })).toBeVisible();
    const d14 = page.getByRole('button', { name: '14 gg' });
    await expect(d14).toBeVisible();
    // Switching horizon keeps the section rendered (list or empty state).
    await d14.click();
    await expect(page.getByText('Assenti', { exact: true }).first()).toBeVisible();
  });

  test('can navigate Dashboard → Timbrature → back to Dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Presenti ora').first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Timbrature' }).click();
    await expect(page.getByText('Ore lavorate').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Dashboard' }).click();
    await expect(page.getByText('Presenti ora').first()).toBeVisible({ timeout: 15_000 });
  });
});
