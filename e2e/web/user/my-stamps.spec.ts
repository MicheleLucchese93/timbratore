import { test, expect } from '@playwright/test';

test.describe('web — Le mie timbrature (employee)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/me/stamps');
  });

  test('renders the personal title and helper text', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Le mie timbrature' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText('Storico delle tue timbrature. Vedi solo le tue.'),
    ).toBeVisible();
  });

  test('renders a DataGrid (own stamps only)', async ({ page }) => {
    await expect(page.locator('.MuiDataGrid-root')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('web — Le mie richieste (employee)', () => {
  test('renders the corrections page in employee mode', async ({ page }) => {
    await page.goto('/me/corrections');
    await expect(page.getByRole('heading', { name: 'Correzioni' })).toBeVisible({ timeout: 10_000 });
    // The component is shared with the admin route, but visiting under
    // /me/corrections is allowed for employees.
  });
});
