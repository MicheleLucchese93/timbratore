import { test, expect } from '@playwright/test';

test.describe('web — Esportazioni (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/exports');
    await expect(page.getByRole('heading', { name: /Esportazioni/i })).toBeVisible({ timeout: 15_000 });
  });

  test('renders Dal / Al date inputs + Formato select + Genera button', async ({ page }) => {
    // Two date inputs (Dal + Al) — the page seeds them with prev month range.
    const dates = page.locator('input[type="date"]');
    await expect(dates).toHaveCount(2);
    // Format select: option labels are "XLSX (commercialista)" + "JSON",
    // values are 'xlsx' + 'json'.
    const formatSelect = page.locator('select').first();
    await expect(formatSelect).toBeVisible();
    await expect(formatSelect.locator('option', { hasText: /XLSX/ })).toHaveCount(1);
    await expect(formatSelect.locator('option', { hasText: 'JSON' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Genera/i })).toBeVisible();
  });

  test('format dropdown is switchable', async ({ page }) => {
    const formatSelect = page.locator('select').first();
    // selectOption matches by `value`, not by `label`, when given a string.
    await formatSelect.selectOption('json');
    await expect(formatSelect).toHaveValue('json');
    await formatSelect.selectOption('xlsx');
    await expect(formatSelect).toHaveValue('xlsx');
  });

  test('refresh button reloads the job list and stamps the time', async ({ page }) => {
    const refresh = page.getByTestId('exports-refresh');
    await expect(refresh).toBeVisible();

    const stamp = page.getByText(/Aggiornato alle/);
    await expect(stamp).toBeVisible({ timeout: 15_000 });
    const before = await stamp.textContent();

    // The list also polls every 2s, so wait for a value that differs from the
    // one captured above rather than asserting on a single tick.
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/v1/exports') && r.request().method() === 'GET',
      ),
      refresh.click(),
    ]);
    expect(res.ok()).toBe(true);
    await expect(stamp).not.toHaveText(before ?? '', { timeout: 10_000 });
  });
});
