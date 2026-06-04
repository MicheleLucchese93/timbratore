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

  test('shows the six recap stat cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Presenti ora').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('In pausa').first()).toBeVisible();
    await expect(page.getByText('Assenti oggi').first()).toBeVisible();
    await expect(page.getByText('Da approvare').first()).toBeVisible();
    await expect(page.getByText('Anomalie 7 gg').first()).toBeVisible();
    await expect(page.getByText('Sedi').first()).toBeVisible();
  });

  test('lists employee presence under "Stato attuale"', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Stato attuale').first()).toBeVisible({ timeout: 30_000 });
    // At least one seeded test user surfaces in the presence list.
    await expect(page.locator('text=/@test\\.it/').first()).toBeVisible();
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
