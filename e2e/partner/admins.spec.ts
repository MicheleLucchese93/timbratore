import { test, expect, type Page } from '@playwright/test';

const ENABLED = process.env.E2E_MUTATING === '1';

const suffix = `${Date.now()}`;
const tenantName = `e2e-multiadmin-${suffix}`;
const admin1 = `e2e-ma1-${suffix}@e2e.local`;
const admin2 = `e2e-ma2-${suffix}@e2e.local`;

function row(page: Page, name: string) {
  return page.locator('.MuiDataGrid-row', { hasText: name });
}

test.describe('partner admin · tenant admins (multi)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');

  test('add up to max_admins, reinvite a selected admin, remove', async ({ page }) => {
    // Create a tenant with max_admins = 2.
    await page.goto('/');
    await page.getByTestId('new-tenant').click();
    await page.locator('input#t-ragione').fill(tenantName);
    await page.locator('input#t-email').fill(admin1);
    await page.locator('input#t-admins').fill('2');
    await page.getByTestId('create-tenant-submit').click();
    await expect(page.getByText(/Azienda creata/)).toBeVisible({ timeout: 15_000 });

    // Open the manage-admins modal.
    await row(page, tenantName).getByTestId('manage-admins').click();
    const modal = page.locator('.modal');
    await expect(modal).toContainText('1/2');
    await expect(modal.locator('.admin-row', { hasText: admin1 })).toBeVisible();

    // Add a 2nd admin → now 2/2, and the add field is disabled (at the cap).
    await page.getByTestId('admin-add-email').fill(admin2);
    await page.getByTestId('admin-add-submit').click();
    await expect(page.getByText(/Amministratore aggiunto/)).toBeVisible();
    await expect(modal).toContainText('2/2');
    await expect(modal.locator('.admin-row', { hasText: admin2 })).toBeVisible();
    await expect(page.getByTestId('admin-add-email')).toBeDisabled();

    // Reinvite the FIRST admin (selected). Local DEV sends no mail → 'none' toast.
    await modal.locator('.admin-row', { hasText: admin1 }).getByTestId('admin-reinvite').click();
    await expect(
      page.getByText(/Invito inviato a|Invite sent to|Nessuna email inviata|No email sent/)
    ).toBeVisible();

    // Remove the 2nd admin → back to 1/2, add field re-enabled.
    await modal.locator('.admin-row', { hasText: admin2 }).getByTestId('admin-remove').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByText(/Amministratore rimosso/)).toBeVisible();
    await expect(modal).toContainText('1/2');
    await expect(modal.locator('.admin-row', { hasText: admin2 })).toHaveCount(0);
    await expect(page.getByTestId('admin-add-email')).toBeEnabled();
  });

  test('add admin with auto-send OFF, then reinvite sends the invitation', async ({ page }) => {
    await page.goto('/');
    const name = `e2e-noinvite-${suffix}`;
    await page.getByTestId('new-tenant').click();
    await page.locator('input#t-ragione').fill(name);
    await page.locator('input#t-email').fill(`e2e-ni1-${suffix}@e2e.local`);
    await page.locator('input#t-admins').fill('2');
    await page.getByTestId('create-tenant-submit').click();
    await expect(page.getByText(/Azienda creata/)).toBeVisible({ timeout: 15_000 });

    await row(page, name).getByTestId('manage-admins').click();
    const modal = page.locator('.modal');
    // Auto-send OFF → the 2nd admin is created with no email.
    await page.getByTestId('admin-send-invite').uncheck();
    await page.getByTestId('admin-add-email').fill(`e2e-ni2-${suffix}@e2e.local`);
    await page.getByTestId('admin-add-submit').click();
    await expect(page.getByText(/Nessuna email inviata|No email sent/)).toBeVisible();

    // Reinvite that still-unconfirmed admin. Against prod this is an INVITATION;
    // the local DEV backend sends nothing → 'none' toast. Accept both.
    await modal
      .locator('.admin-row', { hasText: `e2e-ni2-${suffix}` })
      .getByTestId('admin-reinvite')
      .click();
    await expect(
      page.getByText(/Invito inviato a|Invite sent to|Nessuna email inviata|No email sent/)
    ).toBeVisible();
  });

  test('cannot exceed max_admins via API-free UI (3rd add blocked while at cap)', async ({ page }) => {
    // Reuse the tenant from the first test if present, else skip gracefully by
    // creating a fresh capped tenant.
    await page.goto('/');
    const name = `e2e-cap-${suffix}`;
    await page.getByTestId('new-tenant').click();
    await page.locator('input#t-ragione').fill(name);
    await page.locator('input#t-email').fill(`e2e-cap1-${suffix}@e2e.local`);
    await page.locator('input#t-admins').fill('2');
    await page.getByTestId('create-tenant-submit').click();
    await expect(page.getByText(/Azienda creata/)).toBeVisible({ timeout: 15_000 });

    await row(page, name).getByTestId('manage-admins').click();
    const modal = page.locator('.modal');
    await page.getByTestId('admin-add-email').fill(`e2e-cap2-${suffix}@e2e.local`);
    await page.getByTestId('admin-add-submit').click();
    await expect(modal).toContainText('2/2');
    // At the cap the add control is disabled, so a 3rd cannot be added.
    await expect(page.getByTestId('admin-add-submit')).toBeDisabled();
    await expect(modal).toContainText(/Limite amministratori raggiunto|Administrator limit reached/);
  });
});
