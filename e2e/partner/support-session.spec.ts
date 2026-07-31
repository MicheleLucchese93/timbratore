import { test, expect, type Page } from '@playwright/test';
import { devLogin, partnerApi } from '../fixtures/partner-client';
import { PARTNER_CREDS, URLS } from '../fixtures/test-data';

// Read-only support sessions: a partnership member opens a customer's
// environment in the web app and can look at everything without changing
// anything. Mutating (it creates support_sessions rows + audit entries), so it
// is gated behind E2E_MUTATING like the rest of the partner admin suite.
const ENABLED = process.env.E2E_MUTATING === '1';

interface TenantRow {
  id: string;
  ragione_sociale: string;
}

interface SessionResp {
  session_id: string;
  tenant_id: string;
  ragione_sociale: string;
  expires_at: string;
  url: string;
}

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:4000';

async function exchange(code: string): Promise<{ status: number; token: string | null; code: string | null }> {
  const r = await fetch(`${API_BASE}/api/v1/auth/support/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const body = (await r.json().catch(() => null)) as
    | { data?: { access_token: string }; error?: { code?: string } }
    | null;
  return { status: r.status, token: body?.data?.access_token ?? null, code: body?.error?.code ?? null };
}

// Plain call to the TENANT api (not the partnership one) as a support token.
async function asSupport(
  token: string,
  path: string,
  method = 'GET'
): Promise<{ status: number; code: string | null; body: Record<string, unknown> | null }> {
  const r = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: '{}' }),
  });
  const body = (await r.json().catch(() => null)) as
    | { data?: Record<string, unknown>; error?: { code?: string } }
    | null;
  return { status: r.status, code: body?.error?.code ?? null, body: body?.data ?? null };
}

test.describe('partner admin · read-only support session', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');

  test('session grants admin-scoped reads and refuses every write', async () => {
    const token = await devLogin(PARTNER_CREDS.admin.email);
    const tenants = await partnerApi<{ tenants: TenantRow[] }>(token, '/api/v1/partnership/tenants');
    expect(tenants.ok).toBe(true);
    const tenant = tenants.data?.tenants[0];
    expect(tenant, 'expected at least one tenant in the console').toBeTruthy();

    const opened = await partnerApi<SessionResp>(
      token,
      `/api/v1/partnership/tenants/${tenant!.id}/support-session`,
      { method: 'POST', json: { reason: 'e2e' } }
    );
    expect(opened.status).toBe(201);
    const url = opened.data!.url;
    expect(url).toContain('/support#c=');

    // The token only exists after redeeming the one-time code.
    const code = new URL(url).hash.replace(/^#/, '').replace(/^c=/, '');
    const first = await exchange(code);
    expect(first.status).toBe(200);
    expect(first.token).toBeTruthy();
    const support = first.token!;

    // Reused code is dead.
    const second = await exchange(code);
    expect(second.status).toBe(401);
    expect(second.code).toBe('SUPPORT_CODE_INVALID');

    // Reads: /me reports the session, role admin, and the pinned tenant.
    const me = await asSupport(support, '/api/v1/me');
    expect(me.status).toBe(200);
    expect((me.body?.support as { active?: boolean } | undefined)?.active).toBe(true);
    expect((me.body?.user as { role?: string } | undefined)?.role).toBe('admin');
    expect((me.body?.tenant as { id?: string } | undefined)?.id).toBe(tenant!.id);

    // Admin-scoped read works despite the partner having no membership.
    const users = await asSupport(support, '/api/v1/users');
    expect(users.status).toBe(200);

    // The session must leave NO trace in the customer's own Registro attività:
    // support access is audited platform-side only (partnership_audit_log).
    // Read it through the support token itself, which is exactly the view a
    // tenant admin gets.
    const audit = await asSupport(support, '/api/v1/audit?limit=200');
    expect(audit.status).toBe(200);
    const actions = ((audit.body?.entries as { action: string }[] | undefined) ?? []).map(
      (e) => e.action
    );
    expect(actions.filter((a) => a.startsWith('support.'))).toEqual([]);

    // Writes are refused at the HTTP layer, before any handler runs.
    const write = await asSupport(support, '/api/v1/me', 'PATCH');
    expect(write.status).toBe(403);
    expect(write.code).toBe('SUPPORT_READ_ONLY');

    // Employee documents stay closed even for GET.
    const docs = await asSupport(support, '/api/v1/documents/me');
    expect(docs.status).toBe(403);
    expect(docs.code).toBe('SUPPORT_READ_ONLY');

    // A cross-tenant header is ignored: the tenant comes from the token.
    const other = tenants.data?.tenants.find((x) => x.id !== tenant!.id);
    if (other) {
      const r = await fetch(`${API_BASE}/api/v1/me`, {
        headers: { Authorization: `Bearer ${support}`, 'X-Tenant-Id': other.id },
      });
      const body = (await r.json()) as { data?: { tenant?: { id?: string } } };
      expect(body.data?.tenant?.id).toBe(tenant!.id);
    }

    // Revoking from the console kills the session on the very next request.
    const revoked = await partnerApi(
      token,
      `/api/v1/partnership/tenants/${tenant!.id}/support-session/${opened.data!.session_id}`,
      { method: 'DELETE' }
    );
    expect(revoked.ok).toBe(true);
    const afterRevoke = await asSupport(support, '/api/v1/me');
    expect(afterRevoke.status).toBe(401);
    expect(afterRevoke.code).toBe('SUPPORT_SESSION_INVALID');
  });

  test('console opens the customer environment with a read-only banner', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Aziende|Companies/ })).toBeVisible();

    const firstRow = page.locator('.MuiDataGrid-row').first();
    await firstRow.getByTestId('support-access').click();
    await page.getByTestId('support-reason').fill('e2e ui');

    const [opened] = await Promise.all([
      context.waitForEvent('page'),
      page.getByTestId('support-open').click(),
    ]);
    await assertReadOnlyBanner(opened);
  });
});

async function assertReadOnlyBanner(opened: Page): Promise<void> {
  await opened.waitForLoadState('domcontentloaded');
  // The handoff strips the code and redirects to the dashboard.
  await expect(opened).toHaveURL(new RegExp(`^${URLS.web.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`));
  await expect(opened.locator('.support-banner')).toBeVisible({ timeout: 15_000 });
  await expect(opened.locator('.support-banner-badge')).toHaveText(/Sola lettura|Read-only/);
  // Write affordances are inert; the sidebar drops exports + documents.
  await expect(opened.locator('.app-shell.readonly-session')).toBeVisible();
  await expect(opened.getByRole('link', { name: /Esportazioni|Exports/ })).toHaveCount(0);
}
