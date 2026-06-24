import { test, expect, type Page } from '@playwright/test';
import { PARTNER_CREDS } from '../fixtures/test-data';
import { devLogin, partnerApi } from '../fixtures/partner-client';

const ENABLED = process.env.E2E_MUTATING === '1';

const suffix = `${Date.now()}`;
const tname = `e2e-assign-${suffix}`;
const ownerPartner = `e2e-ownerp-${suffix}@e2e.local`;

function row(page: Page, name: string) {
  return page.locator('.MuiDataGrid-row', { hasText: name });
}

test.describe('partner admin · assign tenant to a partner', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');

  test('admin reassigns a tenant from Piattaforma to a partner via the dropdown', async ({ page }) => {
    const adminTok = await devLogin(PARTNER_CREDS.admin.email);
    // Seed a partner + a platform-owned tenant via the API.
    await partnerApi(adminTok, '/api/v1/partnership/partners', { method: 'POST', json: { email: ownerPartner, cap_tenants: 10 } });
    const created = await partnerApi<{ tenant_id: string }>(adminTok, '/api/v1/partnership/tenants', {
      method: 'POST',
      json: { ragione_sociale: tname, admin_email: `${tname}-a@e2e.local`, max_users: 5, max_admins: 2, max_documentali: 1, max_branches: 3 },
    });
    expect(created.status).toBe(201);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Aziende|Companies/ })).toBeVisible();
    // Initially platform-owned.
    await expect(row(page, tname)).toContainText(/Piattaforma|Platform/);

    // Open Modifica → pick the partner in the owner dropdown → save.
    await row(page, tname).getByRole('button', { name: /Modifica|Edit/ }).click();
    await page.getByTestId('owner-select').selectOption({ label: ownerPartner });
    await page.getByTestId('edit-limits-submit').click();
    await expect(page.getByText(/Limiti aggiornati|Limits updated/)).toBeVisible();

    // The tenant's Partner column now shows the assigned partner.
    await expect(row(page, tname)).toContainText(ownerPartner);

    // API confirms ownership changed (so that partner now scopes to it).
    const list = await partnerApi<{ tenants: Array<{ ragione_sociale: string; owner_email: string | null }> }>(
      adminTok,
      '/api/v1/partnership/tenants'
    );
    const t = list.data?.tenants.find((x) => x.ragione_sociale === tname);
    expect(t?.owner_email).toBe(ownerPartner);
  });
});
