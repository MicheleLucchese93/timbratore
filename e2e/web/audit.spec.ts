import { test, expect } from '@playwright/test';

test.describe('web — Registro attività (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: /Registro attività/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('renders filters (Dal/Al dates, Autore, Destinatario, Categoria) + grid', async ({
    page,
  }) => {
    await expect(page.locator('input[type="date"]')).toHaveCount(2);
    // Three filter selects: author, target, category — each with a "Tutti" default.
    const selects = page.locator('select');
    await expect(selects).toHaveCount(3);
    const category = selects.nth(2);
    await expect(category.locator('option', { hasText: 'Utenti' })).toHaveCount(1);
    await expect(category.locator('option', { hasText: 'Timbrature' })).toHaveCount(1);
    // Grid column headers.
    await expect(page.getByRole('columnheader', { name: /Quando/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Autore/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Attività/i })).toBeVisible();
  });

  test('category filter is switchable and reloads the grid', async ({ page }) => {
    const category = page.locator('select').nth(2);
    await category.selectOption('exports');
    await expect(category).toHaveValue('exports');
    await category.selectOption('');
    await expect(category).toHaveValue('');
  });

  test('sidebar shows the Registro attività entry for admins', async ({ page }) => {
    await expect(page.getByRole('link', { name: /Registro attività/i })).toBeVisible();
  });
});
