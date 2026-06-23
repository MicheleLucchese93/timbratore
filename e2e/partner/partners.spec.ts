import { test, expect, type Page } from '@playwright/test';

const ENABLED = process.env.E2E_MUTATING === '1';

const suffix = `${Date.now()}`;
const partnerEmail = `e2e-pp-${suffix}@e2e.local`;

function row(page: Page, text: string) {
  return page.locator('.MuiDataGrid-row', { hasText: text });
}

test.describe('partner admin · partners', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');

  test('create partner with caps, edit caps, deactivate/activate', async ({ page }) => {
    await page.goto('/partners');
    await expect(page.getByRole('heading', { name: /Partner/ })).toBeVisible();

    // --- create with finite caps ---
    await page.getByTestId('new-partner').click();
    await page.locator('input#p-email').fill(partnerEmail);
    await page.getByTestId('cap-cap_tenants').fill('5');
    await page.getByTestId('cap-cap_users_per_tenant').fill('30');
    await page.getByTestId('create-partner-submit').click();
    await expect(page.getByText(/Partner creato/)).toBeVisible({ timeout: 15_000 });
    await expect(row(page, partnerEmail)).toBeVisible();
    await expect(row(page, partnerEmail)).toContainText('5'); // cap_tenants

    // --- resend invite ---
    await row(page, partnerEmail).getByTestId('resend').click();
    await expect(page.getByText(/Invito inviato a|Invite sent to/)).toBeVisible();

    // --- edit caps ---
    await row(page, partnerEmail).getByRole('button', { name: /Modifica|Edit/ }).click();
    await page.getByTestId('cap-cap_tenants').fill('8');
    await page.getByTestId('edit-caps-submit').click();
    await expect(page.getByText(/Limiti partner aggiornati|Partner caps updated/)).toBeVisible();
    await expect(row(page, partnerEmail)).toContainText('8');

    // --- deactivate (in-app confirm) then activate ---
    await row(page, partnerEmail).getByTestId('deactivate').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByText(/Partner disattivato|Partner disabled/)).toBeVisible();
    await expect(row(page, partnerEmail)).toContainText(/Disattivato|Disabled/);

    await row(page, partnerEmail).getByTestId('activate').click();
    await expect(page.getByText(/Partner attivato|Partner activated/)).toBeVisible();
    await expect(row(page, partnerEmail)).toContainText(/Attivo|Active/);
  });
});
