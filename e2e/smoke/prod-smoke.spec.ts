import { test, expect, request as pwRequest } from '@playwright/test';
import { CREDS } from '../fixtures/test-data';

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

    // Dashboard rendering proves: web served, GoTrue auth, and the API data path.
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });

    expect(problems, problems.join('\n')).toEqual([]);
  });
});
