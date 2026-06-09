import { test, expect } from '@playwright/test';

// A real two-company user can't be provisioned against the prod test stack, so
// this spec is self-contained: it injects a fake token (the chooser only needs
// *a* token present) and mocks GET /api/v1/me/tenants to return TWO companies —
// exactly the signal that triggers the post-login chooser. Every other
// /api/v1/** call is stubbed, so no real backend (or prod) is touched and the
// spec runs with `--no-deps`. The server-side access gate (X-Tenant-Id must
// match a real membership) is covered by the backend test
// apps/backend/src/__tests__/multi-tenant-membership.test.ts.
test.describe('web — tenant chooser (multi-company)', () => {
  // Start from a clean context (ignore the shared logged-in storageState); we
  // plant our own token below so this spec doesn't depend on web-setup.
  test.use({ storageState: { cookies: [], origins: [] } });

  const T1 = '11111111-1111-1111-1111-111111111111';
  const T2 = '22222222-2222-2222-2222-222222222222';

  const tenantsBody = {
    ok: true,
    data: {
      tenants: [
        { tenant_id: T1, ragione_sociale: 'Alpha Srl', role: 'admin' },
        { tenant_id: T2, ragione_sociale: 'Beta Spa', role: 'user' },
      ],
    },
  };

  function meStub(tenantId: string, ragione: string) {
    return {
      ok: true,
      data: {
        user: {
          id: 'u-multi',
          email: 'multi@test.it',
          role: 'admin',
          first_name: null,
          last_name: null,
          display_name: null,
          stamp_modes: ['gps'],
        },
        tenant: {
          id: tenantId,
          ragione_sociale: ragione,
          language: 'it',
          timezone: 'Europe/Rome',
          mock_location_action: 'flag',
          max_admins: 1,
          max_users: 5,
          max_branches: 1,
        },
        branches: [],
        preferences: {
          language: 'it',
          email_notifications_enabled: false,
          push_token_registered: false,
          notification_preferences: {},
        },
      },
    };
  }

  test.beforeEach(async ({ page }) => {
    // Pretend we're authenticated — the chooser only requires a token to exist;
    // all backend calls are mocked, so the token is never actually validated.
    await page.addInitScript(() => {
      localStorage.setItem('sonoqui.access_token', 'e2e-fake-token');
      localStorage.setItem('sonoqui.refresh_token', 'e2e-fake-refresh');
    });
    await page.route('**/api/v1/me/tenants', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tenantsBody) }),
    );
    // Stub everything else so post-choice screens never hit prod with a fake id.
    await page.route('**/api/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/me/tenants') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [] }) });
    });
  });

  test('shows both companies after login', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Scegli l'azienda/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Alpha Srl/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Beta Spa/ })).toBeVisible();
  });

  test('choosing a company sends its id as X-Tenant-Id on /me', async ({ page }) => {
    let sentTenant: string | null = null;
    // Highest-priority handler (registered last) — captures the header the
    // client attaches for the chosen company, then short-circuits /me.
    await page.route('**/api/v1/me', (route) => {
      sentTenant = route.request().headers()['x-tenant-id'] ?? null;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meStub(T2, 'Beta Spa')) });
    });

    await page.goto('/');
    await page.getByRole('button', { name: /Beta Spa/ }).click();

    await expect.poll(() => sentTenant, { timeout: 15_000 }).toBe(T2);
    // And we leave the chooser behind.
    await expect(page.getByRole('heading', { name: /Scegli l'azienda/i })).toBeHidden();
  });

  test('sidebar exposes a company switcher once inside the app', async ({ page }) => {
    // /me echoes whichever company the client selected, so switching round-trips.
    await page.route('**/api/v1/me', (route) => {
      const id = route.request().headers()['x-tenant-id'] === T2 ? T2 : T1;
      const ragione = id === T2 ? 'Beta Spa' : 'Alpha Srl';
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meStub(id, ragione)) });
    });

    await page.goto('/');
    await page.getByRole('button', { name: /Alpha Srl/ }).click();

    // Landed in the app — the brand carries a switcher showing the active company.
    const trigger = page.locator('.sidebar-tenant-trigger');
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await expect(trigger).toContainText('Alpha Srl');

    // Open it → both companies are listed as options.
    await trigger.click();
    const menu = page.getByRole('listbox');
    await expect(menu.getByRole('option', { name: /Alpha Srl/ })).toBeVisible();
    await expect(menu.getByRole('option', { name: /Beta Spa/ })).toBeVisible();

    // Switch to Beta → session reloads and the brand now reflects Beta Spa.
    await menu.getByRole('option', { name: /Beta Spa/ }).click();
    await expect(page.locator('.sidebar-tenant-trigger')).toContainText('Beta Spa', { timeout: 15_000 });
  });
});
