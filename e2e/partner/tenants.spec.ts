import { test, expect, type Page } from '@playwright/test';

// Partner-app admin flows. Inherently mutating (creates real child tenants on
// the LOCAL backend), so gated behind E2E_MUTATING. Fixtures use the e2e- name
// namespace and are purged at globalTeardown.
const ENABLED = process.env.E2E_MUTATING === '1';

const suffix = `${Date.now()}`;
const tenantName = `e2e-tenant-${suffix}`;
const adminEmail = `e2e-tadmin-${suffix}@e2e.local`;
const tenantNote = `promemoria ${suffix}`;

function row(page: Page, name: string) {
  return page.locator('.MuiDataGrid-row', { hasText: name });
}

test.describe('partner admin · tenants', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');

  test('create tenant, edit limits, suspend/resume', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Aziende|Companies/ })).toBeVisible();

    // --- create ---
    await page.getByTestId('new-tenant').click();
    await page.locator('input#t-ragione').fill(tenantName);
    await page.locator('input#t-email').fill(adminEmail);
    await page.locator('input#t-users').fill('15');
    await page.getByTestId('create-tenant-submit').click();
    await expect(page.getByText(/Azienda creata/)).toBeVisible({ timeout: 15_000 });
    await expect(row(page, tenantName)).toBeVisible();

    // usage/limit cell shows 1 admin / 15 users etc, and the admin email column.
    await expect(row(page, tenantName)).toContainText('1/15');
    await expect(row(page, tenantName)).toContainText(adminEmail);

    // --- edit limits + note ---
    await row(page, tenantName).getByRole('button', { name: /Modifica|Edit/ }).click();
    await page.locator('input#e-users').fill('25');
    await page.getByTestId('tenant-note').fill(tenantNote);
    await page.getByTestId('edit-limits-submit').click();
    await expect(page.getByText(/Limiti aggiornati|Limits updated/)).toBeVisible();
    await expect(row(page, tenantName)).toContainText('1/25');
    await expect(row(page, tenantName)).toContainText(tenantNote);

    // --- suspend (in-app confirm dialog) ---
    await row(page, tenantName).getByTestId('suspend').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByText(/Azienda sospesa|Company suspended/)).toBeVisible();
    await expect(row(page, tenantName)).toContainText(/Sospesa|Suspended/);

    // --- resume (in-app confirm) ---
    await row(page, tenantName).getByTestId('resume').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByText(/Azienda riattivata|Company resumed/)).toBeVisible();
    await expect(row(page, tenantName)).toContainText(/Attiva|Active/);
  });

  // The Delete action is super-user-only (SUPER_ADMIN_EMAIL). It's shown only
  // when the logged-in admin IS that user, so this auto-skips unless the partner
  // backend is run with SUPER_ADMIN_EMAIL set to the e2e admin email.
  test('super-user deletes a tenant (type-name confirm)', async ({ page }) => {
    const delName = `e2e-tenant-del-${Date.now()}`;
    await page.goto('/');
    await page.getByTestId('new-tenant').click();
    await page.locator('input#t-ragione').fill(delName);
    await page.locator('input#t-email').fill(`e2e-del-${Date.now()}@e2e.local`);
    await page.getByTestId('create-tenant-submit').click();
    await expect(row(page, delName)).toBeVisible({ timeout: 15_000 });

    const canDelete = await row(page, delName)
      .getByTestId('delete-tenant')
      .isVisible()
      .catch(() => false);
    test.skip(!canDelete, 'logged-in admin is not the configured SUPER_ADMIN_EMAIL');

    await row(page, delName).getByTestId('delete-tenant').click();
    // Submit stays disabled until the exact name is typed.
    await expect(page.getByTestId('delete-tenant-submit')).toBeDisabled();
    await page.getByTestId('delete-confirm-name').fill(delName);
    await page.getByTestId('delete-tenant-submit').click();

    await expect(page.getByText(/Azienda eliminata|Company deleted/)).toBeVisible();
    await expect(row(page, delName)).toHaveCount(0);
  });
});
