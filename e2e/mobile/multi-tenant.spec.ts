import { test, expect } from '@playwright/test';

// Mobile analog of e2e/web/multi-tenant.spec.ts. A real two-company user can't
// be provisioned against the prod test stack, so this spec is self-contained:
// it injects a fake token (Expo web stores tokens in localStorage, same keys as
// web) and mocks GET /api/v1/me/tenants to return TWO companies — the signal
// that makes index.tsx redirect to the /choose-tenant screen. All other
// /api/v1/** traffic is stubbed, so no real backend is touched and it runs with
// `--no-deps`. The server-side gate is covered by the backend test
// apps/backend/src/__tests__/multi-tenant-membership.test.ts.
test.describe('mobile — tenant chooser (multi-company)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const T1 = '11111111-1111-1111-1111-111111111111';
  const T2 = '22222222-2222-2222-2222-222222222222';

  const tenantsBody = {
    ok: true,
    data: {
      tenants: [
        { tenant_id: T1, ragione_sociale: 'Alfa Srl', role: 'admin' },
        { tenant_id: T2, ragione_sociale: 'Beta Spa', role: 'user' },
      ],
    },
  };

  function meStub(tenantId) {
    return {
      ok: true,
      data: {
        user: {
          id: 'u-multi', email: 'multi@test.it', role: 'user',
          first_name: null, last_name: null, display_name: null, stamp_modes: ['gps'],
        },
        tenant: { id: tenantId, ragione_sociale: 'Beta Spa', language: 'it' },
        branches: [],
        preferences: {
          language: 'it', email_notifications_enabled: false, push_token_registered: false,
          notification_preferences: {},
        },
      },
    };
  }

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('sonoqui.access_token', 'e2e-fake-token');
      localStorage.setItem('sonoqui.refresh_token', 'e2e-fake-refresh');
    });
    await page.route('**/api/v1/me/tenants', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tenantsBody) }),
    );
    await page.route('**/api/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/me/tenants') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [] }) });
    });
  });

  test('redirects to the chooser and shows both companies', async ({ page }) => {
    await page.goto('/');
    // Expo web first paint can be slow.
    await expect(page.getByText(/Scegli l'azienda/i)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Alfa Srl')).toBeVisible();
    await expect(page.getByText('Beta Spa')).toBeVisible();
  });

  test('choosing a company sends its id as X-Tenant-Id on /me', async ({ page }) => {
    let sentTenant: string | null = null;
    await page.route('**/api/v1/me', (route) => {
      sentTenant = route.request().headers()['x-tenant-id'] ?? null;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meStub(T2)) });
    });

    await page.goto('/');
    await expect(page.getByText(/Scegli l'azienda/i)).toBeVisible({ timeout: 60_000 });
    await page.getByText('Beta Spa').click();

    await expect.poll(() => sentTenant, { timeout: 20_000 }).toBe(T2);
  });
});
