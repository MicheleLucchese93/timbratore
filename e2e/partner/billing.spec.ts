import { test, expect, type Page } from '@playwright/test';
import { devLogin, grantPartnership, partnerApi } from '../fixtures/partner-client';
import { PARTNER_CREDS } from '../fixtures/test-data';
import { toast } from '../fixtures/toast';
import { API_BASE, createSelfServiceCompany, registerSignup, uniqueEmail } from '../fixtures/signup';

// Super-user billing console (Specs/SELF_SERVICE_BILLING.md §3.7): the Aziende
// billing columns + Abbonamento dialog, Registrazioni and Pagamenti. LOCAL
// backend only, like the rest of the partner suite, and it also needs:
//  - SUPER_ADMIN_EMAIL set to the e2e partner admin (e2e-padmin@e2e.local),
//  - SIGNUP_ENABLED=true, because the fixtures register real self-service
//    companies ('e2e-…' names, e2e-*@e2e.local admins — swept by the purge).
// Each missing precondition skips the whole file.
const ENABLED = process.env.E2E_MUTATING === '1';

function row(page: Page, text: string) {
  return page.locator('.MuiDataGrid-row', { hasText: text });
}

interface BillingDetail {
  tenant: { max_users: number; max_branches: number; billing_mode: string; plan: string; entitlement_overrides: object };
}

interface SignupRow {
  id: string;
  email: string;
  status: string;
  ragione_sociale: string | null;
}

test.describe.configure({ mode: 'serial' });

test.describe('partner · super-user billing console', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');

  let adminToken = '';
  let company: Awaited<ReturnType<typeof createSelfServiceCompany>>;
  let pendingEmail = '';

  test.beforeAll(async () => {
    adminToken = await devLogin(PARTNER_CREDS.admin.email);
    const me = await partnerApi<{ is_super: boolean }>(adminToken, '/api/v1/partnership/me');
    test.skip(!me.data?.is_super, 'the e2e partner admin is not SUPER_ADMIN_EMAIL on this backend');
    const probe = await partnerApi(adminToken, '/api/v1/partnership/billing/signups?limit=1');
    test.skip(probe.status === 404, 'backend without self-service billing');
    const cfg = (await (await fetch(`${API_BASE}/api/v1/signup/config`)).json().catch(() => null)) as {
      data?: { enabled?: boolean };
    } | null;
    test.skip(cfg?.data?.enabled !== true, 'SIGNUP_ENABLED is off on this backend');

    company = await createSelfServiceCompany('pbill');
    pendingEmail = uniqueEmail('ppending');
    expect((await registerSignup({ email: pendingEmail })).status).toBe(202);
  });

  test('Aziende: the self-service filter lists the company with its origin and Free plan', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Aziende|Companies/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('nav-signups')).toBeVisible();
    await expect(page.getByTestId('nav-payments')).toBeVisible();

    await page.getByTestId('tenants-filter-self').click();
    await page.getByTestId('tenants-search').fill(company.ragioneSociale);
    const r = row(page, company.ragioneSociale);
    await expect(r).toBeVisible({ timeout: 15_000 });
    await expect(r.getByText('Self-service', { exact: true })).toBeVisible();
    await expect(r.getByText('Gratuito', { exact: true })).toBeVisible();
    await expect(r.getByText(company.partitaIva)).toBeVisible();

    // The same company is not a partner one.
    await page.getByTestId('tenants-filter-partner').click();
    await expect(row(page, company.ragioneSociale)).toHaveCount(0);
  });

  test('Abbonamento: an override lifts the Free caps, removing it restores them', async ({ page }) => {
    await page.goto(`/?q=${encodeURIComponent(company.ragioneSociale)}`);
    const r = row(page, company.ragioneSociale);
    await expect(r).toBeVisible({ timeout: 15_000 });
    await r.getByTestId('tenant-billing-action').click();

    const dlg = page.getByTestId('billing-dialog');
    await expect(dlg.getByTestId('billing-mode-current')).toHaveText(/Stripe/);
    await dlg.getByTestId('billing-override-max_users').fill('7');
    await dlg.getByTestId('billing-override-save').click();
    await expect(toast(page, /^Override salvati/)).toBeVisible();

    const url = `/api/v1/partnership/billing/tenants/${company.tenantId}`;
    let d = await partnerApi<BillingDetail>(adminToken, url);
    expect(d.data!.tenant).toMatchObject({ plan: 'free', max_users: 7, entitlement_overrides: { max_users: 7 } });

    await dlg.getByTestId('billing-override-clear').click();
    await page.getByTestId('confirm-ok').click();
    await expect(toast(page, /^Override rimossi/)).toBeVisible();
    d = await partnerApi<BillingDetail>(adminToken, url);
    expect(d.data!.tenant).toMatchObject({ plan: 'free', max_users: 3, max_branches: 1, entitlement_overrides: {} });
  });

  test('Registrazioni: the funnel and both requests show; rejecting the pending one closes it', async ({ page }) => {
    await page.goto('/signups');
    await expect(page.getByTestId('signups-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('signups-funnel')).toBeVisible();

    const find = async (email: string) =>
      (
        await partnerApi<{ items: SignupRow[] }>(
          adminToken,
          `/api/v1/partnership/billing/signups?q=${encodeURIComponent(email)}`
        )
      ).data!.items[0]!;
    const done = await find(company.email);
    expect(done).toMatchObject({ status: 'company_created', ragione_sociale: company.ragioneSociale });
    const pending = await find(pendingEmail);
    expect(pending.status).toBe('pending');

    await page.getByTestId('signups-search').fill(pendingEmail);
    await expect(page.getByTestId(`signup-reject-${pending.id}`)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`signup-reject-${pending.id}`).click();
    await page.getByTestId('signup-reject-reason').fill('e2e: registrazione di prova');
    await page.getByTestId('signup-reject-submit').click();
    await expect(toast(page, /^Registrazione di .+ rifiutata/)).toBeVisible();
    expect((await find(pendingEmail)).status).toBe('rejected');

    // A company that exists offers no rejection, only the way to it.
    await page.getByTestId('signups-search').fill(company.email);
    await expect(page.getByTestId(`signup-open-${done.id}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`signup-reject-${done.id}`)).toHaveCount(0);
  });

  test('Pagamenti: filters, totals and the CSV export', async ({ page }) => {
    await page.goto('/payments');
    await expect(page.getByTestId('payments-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('payments-totals')).toBeVisible();
    // The ledger only lists the current Stripe mode; on the sandbox it says so,
    // so nobody drafts a fattura for a test-card charge.
    const list = await partnerApi<{ stripe_mode: 'sandbox' | 'live' }>(adminToken, '/api/v1/partnership/billing/payments');
    await expect(page.getByTestId('payments-sandbox')).toHaveCount(list.data!.stripe_mode === 'sandbox' ? 1 : 0);
    await page.getByTestId('payments-filter-all').click();
    await page.getByTestId('payments-month').selectOption('');

    const download = page.waitForEvent('download');
    await page.getByTestId('payments-export').click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);

    // The file itself: BOM + semicolon header, the layout Excel opens on an
    // Italian locale.
    const r = await fetch(`${API_BASE}/api/v1/partnership/billing/payments/export.csv?status=all`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/csv/);
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toMatch(/^Data incasso;Ragione sociale;P\.IVA;/);
  });

  test('a platform admin who is not the super-user is refused (SUPER_ADMIN_REQUIRED)', async () => {
    const email = `e2e-padmin-nosuper-bill-${Date.now()}@e2e.local`;
    await grantPartnership({ email, role: 'admin' });
    const token = await devLogin(email);
    for (const path of [
      '/api/v1/partnership/billing/signups',
      '/api/v1/partnership/billing/payments',
      `/api/v1/partnership/billing/tenants/${company.tenantId}`,
    ]) {
      const res = await partnerApi(token, path);
      expect(res.status, path).toBe(403);
      expect(res.code, path).toBe('SUPER_ADMIN_REQUIRED');
    }
  });
});
