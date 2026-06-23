import { test, expect, type Page } from '@playwright/test';

// Partner-app admin flows. Inherently mutating (creates real child tenants on
// the LOCAL backend), so gated behind E2E_MUTATING. Fixtures use the e2e- name
// namespace and are purged at globalTeardown.
const ENABLED = process.env.E2E_MUTATING === '1';

const suffix = `${Date.now()}`;
const tenantName = `e2e-tenant-${suffix}`;
const adminEmail = `e2e-tadmin-${suffix}@e2e.local`;

function row(page: Page, name: string) {
  return page.locator('.MuiDataGrid-row', { hasText: name });
}

test.describe('partner admin · tenants', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');
  // The suspend/deactivate actions use window.confirm — auto-accept.
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (d) => d.accept());
  });

  test('create tenant, edit limits, suspend/resume, re-invite admin', async ({ page }) => {
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

    // usage/limit cell shows 1 admin / 15 users etc.
    await expect(row(page, tenantName)).toContainText('1/15');

    // --- edit limits ---
    await row(page, tenantName).getByRole('button', { name: /Modifica|Edit/ }).click();
    await page.locator('input#e-users').fill('25');
    await page.getByTestId('edit-limits-submit').click();
    await expect(page.getByText(/Limiti aggiornati|Limits updated/)).toBeVisible();
    await expect(row(page, tenantName)).toContainText('1/25');

    // --- suspend ---
    await row(page, tenantName).getByTestId('suspend').click();
    await expect(page.getByText(/Azienda sospesa|Company suspended/)).toBeVisible();
    await expect(row(page, tenantName)).toContainText(/Sospesa|Suspended/);

    // --- resume ---
    await row(page, tenantName).getByTestId('resume').click();
    await expect(page.getByText(/Azienda riattivata|Company resumed/)).toBeVisible();
    await expect(row(page, tenantName)).toContainText(/Attiva|Active/);

    // --- re-invite admin ---
    await row(page, tenantName).getByRole('button', { name: /Reinvita|Re-invite/ }).click();
    await expect(page.getByText(/Email di accesso inviata|Access email sent/)).toBeVisible();
  });
});
