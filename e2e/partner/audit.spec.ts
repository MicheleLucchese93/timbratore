import { test, expect } from '@playwright/test';

const ENABLED = process.env.E2E_MUTATING === '1';

const suffix = `${Date.now()}`;
const tenantName = `e2e-audit-${suffix}`;
const adminEmail = `e2e-aud-${suffix}@e2e.local`;

test.describe('partner admin · audit log', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');

  test('an operation is recorded in the activity log', async ({ page }) => {
    // Perform a mutation...
    await page.goto('/');
    await page.getByTestId('new-tenant').click();
    await page.locator('input#t-ragione').fill(tenantName);
    await page.locator('input#t-email').fill(adminEmail);
    await page.getByTestId('create-tenant-submit').click();
    await expect(page.getByText(/Azienda creata/)).toBeVisible({ timeout: 15_000 });

    // ...then verify it shows up in the audit log.
    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: /Registro attività|Activity log/ })).toBeVisible();
    const auditRow = page.locator('.MuiDataGrid-row', { hasText: tenantName });
    await expect(auditRow).toBeVisible({ timeout: 15_000 });
    await expect(auditRow).toContainText(/Azienda creata|Company created/);
  });
});
