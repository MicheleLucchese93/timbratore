import { test, expect, type Page } from '@playwright/test';
import { PARTNER_CREDS } from '../../fixtures/test-data';
import { devLogin, partnerApi } from '../../fixtures/partner-client';

const ENABLED = process.env.E2E_MUTATING === '1';

const suffix = `${Date.now()}`;
function row(page: Page, name: string) {
  return page.locator('.MuiDataGrid-row', { hasText: name });
}

test.describe('partner (reseller) · scope & caps', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (d) => d.accept());
  });

  test('no admin surface: Partners hidden + API forbidden', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Aziende|Companies/ })).toBeVisible();
    // The "Partner" management nav entry is admin-only.
    await expect(page.getByRole('link', { name: /Partner/ })).toHaveCount(0);

    // Direct navigation to the admin route bounces back to the tenants list.
    await page.goto('/partners');
    await expect(page.getByRole('heading', { name: /Aziende|Companies/ })).toBeVisible();

    // API: the partner role cannot list partners.
    const token = await devLogin(PARTNER_CREDS.partner.email);
    const res = await partnerApi(token, '/api/v1/partnership/partners');
    expect(res.status).toBe(403);
    expect(res.code).toBe('PARTNERSHIP_ADMIN_REQUIRED');
  });

  test('create within caps, cap enforced, own-only scope, suspend own', async ({ page }) => {
    const t1 = `e2e-ps1-${suffix}`;
    const t2 = `e2e-ps2-${suffix}`;
    const t3 = `e2e-ps3-${suffix}`;

    const createTenant = async (name: string) => {
      await page.getByTestId('new-tenant').click();
      await page.locator('input#t-ragione').fill(name);
      await page.locator('input#t-email').fill(`${name}-admin@e2e.local`);
      await page.getByTestId('create-tenant-submit').click();
    };

    await page.goto('/');
    // cap_tenants = 2 (see PARTNER_CAPS): first two succeed.
    await createTenant(t1);
    await expect(page.getByText(/Azienda creata/)).toBeVisible({ timeout: 15_000 });
    await expect(row(page, t1)).toBeVisible();

    await createTenant(t2);
    await expect(row(page, t2)).toBeVisible();

    // Third exceeds the partner's tenant cap → server rejects, modal shows error.
    await createTenant(t3);
    await expect(page.locator('.form-err')).toContainText(
      /numero massimo di aziende|maximum number of created companies/
    );
    await page.getByRole('button', { name: /Annulla|Cancel/ }).click();

    // Own-only scope: every tenant the partner sees is one they created.
    const token = await devLogin(PARTNER_CREDS.partner.email);
    const me = await partnerApi<{ user_id: string }>(token, '/api/v1/partnership/me');
    const list = await partnerApi<{ tenants: Array<{ created_by_partner: string | null }> }>(
      token,
      '/api/v1/partnership/tenants'
    );
    expect(list.data?.tenants.length).toBeGreaterThanOrEqual(2);
    for (const tn of list.data?.tenants ?? []) {
      expect(tn.created_by_partner).toBe(me.data?.user_id);
    }

    // Suspend a tenant the partner owns.
    await row(page, t1).getByTestId('suspend').click();
    await expect(page.getByText(/Azienda sospesa|Company suspended/)).toBeVisible();
    await expect(row(page, t1)).toContainText(/Sospesa|Suspended/);
  });
});
