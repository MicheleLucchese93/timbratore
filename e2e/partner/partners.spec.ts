import { test, expect, type Page } from '@playwright/test';

const ENABLED = process.env.E2E_MUTATING === '1';

const suffix = `${Date.now()}`;
const partnerEmail = `e2e-pp-${suffix}@e2e.local`;
const partnerName = `Ideal Copy ${suffix}`;
const partnerNote = `nota interna ${suffix}`;

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
    await page.getByTestId('partner-name').fill(partnerName);
    await page.getByTestId('cap-cap_tenants').fill('5');
    await page.getByTestId('cap-cap_users_per_tenant').fill('30');
    await page.getByTestId('create-partner-submit').click();
    await expect(page.getByText(/Partner creato/)).toBeVisible({ timeout: 15_000 });
    await expect(row(page, partnerEmail)).toBeVisible();
    await expect(row(page, partnerEmail)).toContainText('5'); // cap_tenants
    await expect(row(page, partnerEmail)).toContainText(partnerName); // reseller name column

    // --- resend invite ---
    await row(page, partnerEmail).getByTestId('resend').click();
    await expect(page.getByText(/Invito inviato a|Invite sent to/)).toBeVisible();

    // --- edit caps + note ---
    await row(page, partnerEmail).getByRole('button', { name: /Modifica|Edit/ }).click();
    await page.getByTestId('cap-cap_tenants').fill('8');
    await page.getByTestId('edit-partner-note').fill(partnerNote);
    await page.getByTestId('edit-caps-submit').click();
    await expect(page.getByText(/Limiti partner aggiornati|Partner caps updated/)).toBeVisible();
    await expect(row(page, partnerEmail)).toContainText('8');
    await expect(row(page, partnerEmail)).toContainText(partnerNote);

    // --- deactivate (in-app confirm) then activate ---
    await row(page, partnerEmail).getByTestId('deactivate').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByText(/Partner disattivato|Partner disabled/)).toBeVisible();
    await expect(row(page, partnerEmail)).toContainText(/Disattivato|Disabled/);

    await row(page, partnerEmail).getByTestId('activate').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByText(/Partner attivato|Partner activated/)).toBeVisible();
    await expect(row(page, partnerEmail)).toContainText(/Attivo|Active/);
  });

  test('create partner with auto-send OFF, then resend sends the invitation', async ({ page }) => {
    const email = `e2e-pp-noinvite-${suffix}@e2e.local`;
    await page.goto('/partners');
    await page.getByTestId('new-partner').click();
    await page.locator('input#p-email').fill(email);
    // Auto-send OFF → partner created with no email.
    await page.getByTestId('partner-send-invite').uncheck();
    await page.getByTestId('create-partner-submit').click();
    await expect(page.getByText(/Nessuna email inviata|No email sent/)).toBeVisible({ timeout: 15_000 });
    await expect(row(page, email)).toBeVisible();

    // Resend to the still-unconfirmed partner → an INVITATION (not a reset).
    await row(page, email).getByTestId('resend').click();
    await expect(page.getByText(/Invito inviato a|Invite sent to/)).toBeVisible();
  });
});
