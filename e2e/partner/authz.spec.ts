import { test, expect } from '@playwright/test';
import { createFixtureUser, devLogin, partnerApi } from '../fixtures/partner-client';

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
});
