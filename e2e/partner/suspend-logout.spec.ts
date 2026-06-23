import { test, expect } from '@playwright/test';
import { PARTNER_CREDS } from '../fixtures/test-data';
import { grantPartnership, devLogin, partnerApi } from '../fixtures/partner-client';

const ENABLED = process.env.E2E_MUTATING === '1';

// Proves the server side of "deactivating a tenant logs its users out": after a
// suspend, the member's very next request is rejected (cache evicted), with the
// code the web + mobile clients treat as session-invalid → logout.
test.describe('partner · suspend forces member logout', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');

  test('suspended tenant → member 403 NO_ACTIVE_TENANT on next request', async () => {
    await grantPartnership({ email: PARTNER_CREDS.admin.email, role: 'admin' });
    const adminTok = await devLogin(PARTNER_CREDS.admin.email);
    const ts = Date.now();
    const memberEmail = `e2e-suspmember-${ts}@e2e.local`;

    const created = await partnerApi<{ tenant_id: string }>(adminTok, '/api/v1/partnership/tenants', {
      method: 'POST',
      json: {
        ragione_sociale: `e2e-susplogout-${ts}`,
        admin_email: memberEmail,
        max_users: 5,
        max_admins: 2,
        max_documentali: 1,
        max_branches: 3,
      },
    });
    expect(created.status).toBe(201);
    const tenantId = created.data!.tenant_id;

    // Member resolves a session fine before suspend.
    const memberTok = await devLogin(memberEmail);
    const before = await partnerApi(memberTok, '/api/v1/me');
    expect(before.status).toBe(200);

    // Suspend → membership cache evicted server-side.
    const susp = await partnerApi(adminTok, `/api/v1/partnership/tenants/${tenantId}/suspend`, { method: 'POST' });
    expect(susp.status).toBe(200);

    // Member's next request is refused immediately with the logout code.
    const after = await partnerApi(memberTok, '/api/v1/me');
    expect(after.status).toBe(403);
    expect(after.code).toBe('NO_ACTIVE_TENANT');
  });
});
