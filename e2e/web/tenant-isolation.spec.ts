import { test, expect } from '@playwright/test';
import { loginAs, apiGet } from '../fixtures/api-client';
import { CREDS } from '../fixtures/test-data';

/**
 * Regression guard for the prod incident where the `app` Postgres role had
 * BYPASSRLS=true, silently disabling every tenant-isolation policy. Two
 * admins from different tenants must each only see their own tenant's stamps.
 *
 * Tenant A defaults to the test tenant (test1@test.it). Tenant B must be
 * provided via env vars — credentials live outside the repo:
 *
 *   E2E_TENANT_B_EMAIL=...
 *   E2E_TENANT_B_PASSWORD=...
 */

interface Stamp {
  id: string;
  tenant_id: string;
}

const tenantBEmail = process.env.E2E_TENANT_B_EMAIL;
const tenantBPassword = process.env.E2E_TENANT_B_PASSWORD;

test.describe('tenant isolation', () => {
  test.skip(
    !tenantBEmail || !tenantBPassword,
    'E2E_TENANT_B_EMAIL / E2E_TENANT_B_PASSWORD not set',
  );

  test('admins see only their own tenant in /api/v1/stamps', async () => {
    const aHandle = await loginAs(CREDS.admin.email, CREDS.admin.password);
    const bHandle = await loginAs(tenantBEmail!, tenantBPassword!);

    expect(aHandle.tenantId).not.toEqual(bHandle.tenantId);

    const aStamps = await apiGet<Stamp[]>(aHandle.token, '/api/v1/stamps?limit=200');
    const bStamps = await apiGet<Stamp[]>(bHandle.token, '/api/v1/stamps?limit=200');

    for (const s of aStamps) {
      expect(s.tenant_id, `tenant A leaked stamp from ${s.tenant_id}`).toEqual(aHandle.tenantId);
    }
    for (const s of bStamps) {
      expect(s.tenant_id, `tenant B leaked stamp from ${s.tenant_id}`).toEqual(bHandle.tenantId);
    }
  });
});
