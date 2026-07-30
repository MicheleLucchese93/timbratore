import { test, expect, request as pwRequest } from '@playwright/test';
import { CREDS, TENANT } from '../fixtures/test-data';
import { chooseTenantIfPrompted } from '../fixtures/choose-tenant';

/**
 * Read-only PRODUCTION smoke / synthetic monitor.
 *
 * Creates nothing, mutates nothing — safe to run against prod on a schedule
 * (cron / CI). It gives the "same environment as real users" signal that a
 * staging run cannot, without any data-write risk.
 *
 * Run:
 *   E2E_NO_WEBSERVER=1 E2E_SKIP_PURGE=1 npx playwright test --project=smoke
 *
 * Targets (override for staging):
 *   E2E_SMOKE_URL      web SPA   (default https://app-sonoqui.xdevapp.it)
 *   E2E_SMOKE_API_URL  backend   (default https://api-sonoqui.xdevapp.it)
 *
 * E2E_NO_WEBSERVER=1 stops Playwright from booting the local dev servers;
 * E2E_SKIP_PURGE=1 stops globalTeardown from running the fixture purge.
 */

const API_URL = process.env.E2E_SMOKE_API_URL ?? 'https://api-sonoqui.xdevapp.it';

test.describe('prod smoke (read-only)', () => {
  test('API /health responds ok', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${API_URL}/health`);
    expect(res.ok(), `GET ${API_URL}/health -> ${res.status()}`).toBeTruthy();
    const body = await res.json().catch(() => ({}));
    // Accept either the wrapped { ok, data:{status} } or a bare { status }.
    expect(body?.ok ?? body?.data?.status ?? body?.status).toBeTruthy();
    await ctx.dispose();
  });

  test('admin can log in and reach the dashboard', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 500) problems.push(`5xx: ${r.request().method()} ${r.url()} -> ${r.status()}`);
    });

    await page.goto('/login');
    await page.locator('input#email').fill(CREDS.admin.email);
    await page.locator('input#password').fill(CREDS.admin.password);
    await page.getByRole('button', { name: 'Accedi' }).click();

    // The admin fixture is a member of more than one company on the shared prod
    // tenant, so login stops on the "Scegli l'azienda" chooser. The helper races
    // the chooser against the Dashboard and only clicks when the chooser won, so
    // this stays correct if the account ever goes back to being single-company.
    // Read-only: picking a company only writes the choice to localStorage.
    const dashboard = page.getByRole('heading', { name: 'Dashboard' });
    await chooseTenantIfPrompted(page, dashboard, 20_000);
    // Dashboard rendering proves: web served, GoTrue auth, and the API data path.
    await expect(dashboard).toBeVisible({ timeout: 20_000 });

    expect(problems, problems.join('\n')).toEqual([]);
  });

  /**
   * Guards the multi-company trap documented on TENANT in fixtures/test-data.ts:
   * when a request carries no X-Tenant-Id the backend falls back to the
   * most-recent active membership (middleware/auth.ts → fetchMembership
   * `ORDER BY m.created_at DESC`). The admin fixture is a member of a second,
   * newer company, so a client that drops the header keeps returning 200 while
   * reading and writing the WRONG company — invisible to a test that only
   * asserts the Dashboard rendered.
   *
   * Still read-only: it observes the headers the SPA already sends and issues
   * two GETs of its own.
   */
  test('every API call is scoped to the chosen company', async ({ page }) => {
    // Scoped API traffic the SPA fires, with the company header it attached.
    // OPTIONS is excluded: a CORS preflight never carries custom headers.
    const calls: Array<{ method: string; path: string; tenant?: string }> = [];
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname;
      if (!path.startsWith('/api/v1') || r.method() === 'OPTIONS') return;
      calls.push({ method: r.method(), path, tenant: r.headers()['x-tenant-id'] });
    });

    await page.goto('/login');
    await page.locator('input#email').fill(CREDS.admin.email);
    await page.locator('input#password').fill(CREDS.admin.password);
    await page.getByRole('button', { name: 'Accedi' }).click();

    const dashboard = page.getByRole('heading', { name: 'Dashboard' });
    await chooseTenantIfPrompted(page, dashboard, 20_000);
    await expect(dashboard).toBeVisible({ timeout: 20_000 });

    // Independent oracle for "which company should be active": resolve it by
    // NAME from our own membership list, so the checks below can't be satisfied
    // by the app agreeing with itself about a wrong id. /me/tenants is the one
    // endpoint that is deliberately unpinned (web store/session.ts → noTenant),
    // which is exactly why it can answer this without a company already chosen.
    const token = await page.evaluate(() => localStorage.getItem('sonoqui.access_token'));
    expect(token, 'no access token in localStorage after login').toBeTruthy();
    const ctx = await pwRequest.newContext();
    const auth = { Authorization: `Bearer ${token}` };

    const listRes = await ctx.get(`${API_URL}/api/v1/me/tenants`, { headers: auth });
    expect(listRes.ok(), `GET /api/v1/me/tenants -> ${listRes.status()}`).toBeTruthy();
    const list = (await listRes.json()) as {
      data: { tenants: Array<{ tenant_id: string; ragione_sociale: string }> };
    };
    const tenants = list.data.tenants;
    // Same precedence as fixtures/api-client.ts resolveTenantId, so a
    // single-company stack needs no fixture change.
    const wanted =
      tenants.length === 1
        ? tenants[0]
        : TENANT.id
          ? tenants.find((t) => t.tenant_id === TENANT.id)
          : tenants.find((t) => t.ragione_sociale === TENANT.name);
    expect(
      wanted,
      `wanted ${TENANT.id ?? TENANT.name}, account has: ${tenants
        .map((t) => `${t.ragione_sociale} (${t.tenant_id})`)
        .join(', ') || 'none'}`,
    ).toBeTruthy();
    const wantedId = wanted!.tenant_id;

    // The company the SPA committed to, and the one it shows in the sidebar.
    expect(
      await page.evaluate(() => localStorage.getItem('sonoqui.tenant_id')),
      'the SPA stored a different company than the one chosen',
    ).toBe(wantedId);
    await expect(page.locator('.sidebar-brand-tenant')).toHaveText(wanted!.ragione_sociale);

    // And the backend resolves that id to the same company — catches an
    // id/name mismatch that a client-side-only check would miss.
    const meRes = await ctx.get(`${API_URL}/api/v1/me`, {
      headers: { ...auth, 'X-Tenant-Id': wantedId },
    });
    expect(meRes.ok(), `GET /api/v1/me -> ${meRes.status()}`).toBeTruthy();
    const me = (await meRes.json()) as { data: { tenant: { id: string; ragione_sociale: string } } };
    expect(me.data.tenant.id).toBe(wantedId);
    expect(me.data.tenant.ragione_sociale).toBe(wanted!.ragione_sociale);
    await ctx.dispose();

    // Re-measure the SPA's traffic with the company already chosen: the login
    // and chooser phase legitimately calls /me/tenants unpinned, so sampling
    // from page load would mix that in. A reload also proves the choice
    // survives a fresh boot of the app.
    calls.length = 0;
    await page.reload();
    await expect(dashboard).toBeVisible({ timeout: 20_000 });

    const scoped = calls.filter((c) => c.path !== '/api/v1/me/tenants');
    expect(scoped.length, 'the dashboard fired no scoped API call to inspect').toBeGreaterThan(0);
    const fmt = (c: (typeof scoped)[number]): string =>
      `${c.method} ${c.path} → X-Tenant-Id: ${c.tenant ?? '(absent)'}`;
    // Missing header → backend silently picks the most-recent membership.
    expect(
      scoped.filter((c) => !c.tenant).map(fmt),
      'these calls carried no X-Tenant-Id and resolve to whichever company is newest',
    ).toEqual([]);
    // Present but wrong → reading someone else's company outright.
    expect(
      scoped.filter((c) => c.tenant && c.tenant !== wantedId).map(fmt),
      `these calls were scoped to a company other than ${wanted!.ragione_sociale} (${wantedId})`,
    ).toEqual([]);
  });
});
