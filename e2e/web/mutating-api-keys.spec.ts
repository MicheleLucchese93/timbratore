import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  createApiKey,
  listApiKeys,
  loadHandleFromStorage,
  publicApi,
  revokeApiKey,
  type ApiHandle,
  type ApiKeyCreatedRow,
} from '../fixtures/api-client';
import { toast } from '../fixtures/toast';

// The API module end to end: mint a key, use it on the public surface, watch the
// scope gate refuse what it was not granted, revoke it, watch it die.
//
// Mutating: real api_keys rows on the pinned test tenant, named 'e2e-…' so the
// purge endpoint sweeps them at globalTeardown. The token is captured from the
// CREATE response and never re-read — there is no endpoint that could hand it
// back, which is itself one of the things this spec asserts.
//
// Requires the API module to be ENABLED on the test tenant (partner console →
// Moduli → API). Every test skips loudly rather than failing when it is off, so
// a run against a tenant without the module reports "not enabled" instead of a
// wall of 403s.
const ENABLED = process.env.E2E_MUTATING === '1';

test.describe.configure({ mode: 'serial' });

test.describe('web — modulo API: keys, scopes, revocation', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let moduleOn = false;
  const created: string[] = [];

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    const probe = await createApiKey(admin.token, {
      name: `e2e-probe-${Date.now()}`,
      scopes: ['stamps:read'],
    });
    moduleOn = probe.status === 201;
    if (probe.key) created.push(probe.key.id);
  });

  test.afterAll(async () => {
    // Best-effort: a key left live on the test tenant is harmless, but leaving
    // one is still leaving a credential lying around.
    for (const id of created) {
      try {
        await revokeApiKey(admin.token, id);
      } catch {
        /* already gone */
      }
    }
  });

  test('API: create → call → scope refusal → revoke → dead', async () => {
    test.skip(!moduleOn, 'API module not enabled on the test tenant');

    const name = `e2e-key-${Date.now()}`;
    const res = await createApiKey(admin.token, {
      name,
      scopes: ['stamps:read'],
      rate_limit_per_min: 60,
    });
    expect(res.status).toBe(201);
    const key = res.key as ApiKeyCreatedRow;
    created.push(key.id);

    // The token is the whole point, and it is a token, not a hash.
    expect(key.token).toMatch(/^sq_live_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
    expect(key.token).toContain(key.key_id);

    // It authenticates, and reports back exactly what it was granted.
    const me = await publicApi(key.token, '/me');
    expect(me.status).toBe(200);
    const meData = (me.body as { data: { key: { name: string; scopes: string[] } } }).data;
    expect(meData.key.name).toBe(name);
    expect(meData.key.scopes).toEqual(['stamps:read']);

    // The granted scope works…
    const stamps = await publicApi(key.token, '/stamps?limit=1');
    expect(stamps.status).toBe(200);
    expect(stamps.body).toHaveProperty('page');

    // …and the same key in the other accepted header works identically.
    const viaHeader = await publicApi(key.token, '/stamps?limit=1', { header: 'x-api-key' });
    expect(viaHeader.status).toBe(200);

    // A punch response never carries coordinates. Migration 060 holds them NULL
    // and stampColumns() does not select them; this asserts the promise from
    // outside, where a customer would see it.
    const rows = (stamps.body as { data: Array<Record<string, unknown>> }).data;
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('latitude');
      expect(Object.keys(row)).not.toContain('longitude');
      expect(Object.keys(row)).not.toContain('gps_accuracy_m');
    }

    // A scope it does NOT hold is refused, with the scope named.
    const users = await publicApi(key.token, '/users');
    expect(users.status).toBe(403);
    expect((users.body as { error: { code: string } }).error.code).toBe('API_SCOPE_MISSING');

    // read does NOT imply write.
    const write = await publicApi(key.token, '/stamps', {
      method: 'POST',
      json: { user_id: admin.userId, event_type: 'clock_in', occurred_at: new Date().toISOString(), reason: 'e2e' },
    });
    expect(write.status).toBe(403);

    // HR documents are not on this surface at any scope.
    const docs = await publicApi(key.token, '/documents');
    expect(docs.status).toBe(404);

    // The list never carries the secret back — the token exists once, in the
    // create response, and nowhere else.
    const listed = await listApiKeys(admin.token);
    const row = listed.find((k) => k.id === key.id);
    expect(row).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(key.token.split('_').pop());
    expect(row).not.toHaveProperty('secret_hash');
    expect(row).not.toHaveProperty('token');

    // Revoking kills it on the very next request — no session to expire.
    expect(await revokeApiKey(admin.token, key.id)).toBe(200);
    const after = await publicApi(key.token, '/stamps?limit=1');
    expect(after.status).toBe(401);
  });

  test('API: write scope implies read, and a write lands in the Registro as the KEY', async () => {
    test.skip(!moduleOn, 'API module not enabled on the test tenant');

    const res = await createApiKey(admin.token, {
      name: `e2e-writer-${Date.now()}`,
      scopes: ['stamps:write', 'audit:read'],
    });
    expect(res.status).toBe(201);
    const key = res.key as ApiKeyCreatedRow;
    created.push(key.id);

    // stamps:write was granted; stamps:read was not, and must still work.
    const read = await publicApi(key.token, '/stamps?limit=1');
    expect(read.status).toBe(200);

    const occurredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const write = await publicApi(key.token, '/stamps', {
      method: 'POST',
      json: {
        user_id: admin.userId,
        event_type: 'clock_in',
        occurred_at: occurredAt,
        reason: 'e2e api badge read',
      },
    });
    expect(write.status).toBe(201);
    const punch = (write.body as { data: { id: string; source: string } }).data;
    // How a punch arrived is a fact about the system, not a field a caller sets.
    expect(punch.source).toBe('api');

    // The Registro attributes it to the KEY, not to a person — that is the
    // whole point of giving a key its own identity.
    const audit = await publicApi(key.token, '/audit?limit=10&action=stamp.admin_create');
    expect(audit.status).toBe(200);
    const entries = (audit.body as { data: Array<{ actor_name: string | null }> }).data;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.actor_name).toContain('API');

    // Clean the punch up through the same surface.
    const del = await publicApi(key.token, `/stamps/${punch.id}`, {
      method: 'DELETE',
      json: { reason: 'e2e cleanup' },
    });
    expect(del.status).toBe(200);
  });

  test('API: an Idempotency-Key makes a retried punch safe, and is scoped to the key', async () => {
    test.skip(!moduleOn, 'API module not enabled on the test tenant');

    const mk = async (name: string): Promise<ApiKeyCreatedRow> => {
      const r = await createApiKey(admin.token, { name, scopes: ['stamps:write'] });
      expect(r.status).toBe(201);
      created.push((r.key as ApiKeyCreatedRow).id);
      return r.key as ApiKeyCreatedRow;
    };
    const reader = await mk(`e2e-idem-a-${Date.now()}`);
    const other = await mk(`e2e-idem-b-${Date.now()}`);

    const idem = `e2e-badge-retry-${Date.now()}`;
    const body = {
      user_id: admin.userId,
      event_type: 'clock_in',
      occurred_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      reason: 'e2e badge read',
    };

    const first = await publicApi(reader.token, '/stamps', {
      method: 'POST',
      json: body,
      idempotencyKey: idem,
    });
    expect(first.status).toBe(201);
    const firstId = (first.body as { data: { id: string } }).data.id;

    // The retry a badge reader sends when the first attempt timed out: the same
    // answer comes back and no second punch is filed. A duplicate clock-in is
    // invisible to the employee, which is why this is the one endpoint that
    // offers the guarantee.
    const retry = await publicApi(reader.token, '/stamps', {
      method: 'POST',
      json: body,
      idempotencyKey: idem,
    });
    expect(retry.status).toBe(201);
    expect((retry.body as { data: { id: string } }).data.id).toBe(firstId);

    // The SAME Idempotency-Key from a DIFFERENT key is a different request.
    // Without per-key namespacing every machine client in every company would
    // share one bucket on a globally-readable table.
    const elsewhere = await publicApi(other.token, '/stamps', {
      method: 'POST',
      json: body,
      idempotencyKey: idem,
    });
    expect(elsewhere.status).toBe(201);
    const otherId = (elsewhere.body as { data: { id: string } }).data.id;
    expect(otherId).not.toBe(firstId);

    // Omitting the header is allowed — the guarantee is opt-in.
    const noHeader = await publicApi(reader.token, '/stamps', { method: 'POST', json: body });
    expect(noHeader.status).toBe(201);
    const noHeaderId = (noHeader.body as { data: { id: string } }).data.id;

    // A malformed key is refused rather than silently ignored.
    const bad = await publicApi(reader.token, '/stamps', {
      method: 'POST',
      json: body,
      idempotencyKey: 'short',
    });
    expect(bad.status).toBe(400);

    for (const id of [firstId, otherId, noHeaderId]) {
      await publicApi(reader.token, `/stamps/${id}`, {
        method: 'DELETE',
        json: { reason: 'e2e cleanup' },
      });
    }
  });

  test('UI: the API section lists keys, and creating one shows the token exactly once', async ({
    page,
  }) => {
    test.skip(!moduleOn, 'API module not enabled on the test tenant');

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /Impostazioni/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: /^API$/ })).toBeVisible();
    await expect(page.getByTestId('api-keys-table')).toBeVisible();

    // The contract link hands over a FILE, not a tab. `download` is the half a
    // regression would drop (re-adding target="_blank" is the obvious mistake),
    // and the href must stay real so Postman/Swagger can still import by URL.
    const docs = page.getByRole('link', {
      name: /Scarica la documentazione tecnica|Download the technical documentation/,
    });
    await expect(docs).toHaveAttribute('download', 'sonoqui-openapi.json');
    await expect(docs).toHaveAttribute('href', /\/api\/public\/v1\/openapi\.json$/);
    expect(await docs.getAttribute('target')).toBeNull();

    // Gate on the POST, not the toast: the Settings toast clears itself after
    // 3.5s, so waiting on it turns a slow response into "element not found".
    const posted = page.waitForResponse(
      (r) => r.url().includes('/api/v1/api-keys') && r.request().method() === 'POST',
    );
    await page.getByTestId('api-key-new').click();
    const name = `e2e-ui-${Date.now()}`;
    await page.getByLabel(/Nome|Name/).first().fill(name);
    await page.getByTestId('scope-stamps:read').check();
    await page.getByRole('button', { name: /Crea chiave|Create key/ }).click();
    expect((await posted).status()).toBe(201);

    // Shown once, in full, with the warning that says so.
    const token = page.getByTestId('api-key-token');
    await expect(token).toBeVisible();
    await expect(token).toHaveText(/^sq_live_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
    await expect(page.getByText(/unica volta|only time/i)).toBeVisible();

    await page.getByRole('button', { name: /Ho copiato la chiave|I have copied the key/ }).click();

    // And once the dialog is closed there is no way back to it: the row shows
    // only the public half.
    const row = page.getByTestId('api-keys-table').locator('tr', { hasText: name });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText(/_[A-Za-z0-9_-]{43}/);

    // Revoke through the UI and confirm the row says so.
    const revoked = page.waitForResponse(
      (r) => r.url().includes('/revoke') && r.request().method() === 'POST',
    );
    await row.getByRole('button', { name: /^Revoca$|^Revoke$/ }).click();
    await page.getByRole('button', { name: /^Revoca$|^Revoke$/ }).last().click();
    expect((await revoked).status()).toBe(200);
    await expect(toast(page, /^Chiave revocata|^Key revoked/)).toBeVisible();
    await expect(row).toContainText(/Revocata|Revoked/);
  });
});
