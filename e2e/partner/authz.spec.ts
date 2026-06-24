import { test, expect } from '@playwright/test';
import { createFixtureUser, devLogin, grantPartnership, partnerApi } from '../fixtures/partner-client';

const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('partner · authorization', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');

  test('a non-partnership user is refused by the partnership API', async () => {
    const email = `e2e-nonpartner-${Date.now()}@e2e.local`;
    await createFixtureUser(email);
    const token = await devLogin(email);

    const me = await partnerApi(token, '/api/v1/partnership/me');
    expect(me.status).toBe(403);
    expect(me.code).toBe('NOT_PARTNERSHIP_MEMBER');

    // ...and cannot read tenants either.
    const tenants = await partnerApi(token, '/api/v1/partnership/tenants');
    expect(tenants.status).toBe(403);
  });

  test('a platform admin who is not the super-user cannot delete a tenant', async () => {
    // requireSuperAdmin runs before the tenant lookup, so any id triggers the 403.
    const email = `e2e-padmin-nosuper-${Date.now()}@e2e.local`;
    await grantPartnership({ email, role: 'admin' });
    const token = await devLogin(email);

    const me = await partnerApi<{ is_super: boolean }>(token, '/api/v1/partnership/me');
    expect(me.data?.is_super).toBe(false);

    const res = await partnerApi(
      token,
      '/api/v1/partnership/tenants/00000000-0000-0000-0000-000000000000',
      { method: 'DELETE', json: { confirm_name: 'whatever' } }
    );
    expect(res.status).toBe(403);
    expect(res.code).toBe('SUPER_ADMIN_REQUIRED');
  });
});
