import { test as setup, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CREDS, STORAGE, URLS } from '../fixtures/test-data';

const API_BASE = process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it';

// Runs once before the `web` project. Logs in via the real Login form and
// persists localStorage to STORAGE.webAuth so each spec can reuse the session
// without re-authenticating (faster + fewer GoTrue audit-log entries).
//
// Also provisions a per-run e2e fixture user (e2e-runner-*@e2e.local) and
// writes its credentials to STORAGE.userCreds. Mutating specs in the `web`
// project (which runs after this setup but before web-user-setup) read
// CREDS.user from that file so any leave_requests/correction_requests they
// create end up on the ephemeral fixture, not the persistent test3 QA
// account. The fixture user is purged at globalTeardown via the
// e2e-%@e2e.local email pattern.
setup('authenticate web admin + provision fixture user', async ({ page }) => {
  await page.goto(`${URLS.web}/login`);
  await page.locator('input#email').fill(CREDS.admin.email);
  await page.locator('input#password').fill(CREDS.admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
  await page.context().storageState({ path: STORAGE.webAuth });

  const purgeSecret = process.env.E2E_PURGE_SECRET;
  if (!purgeSecret) {
    // Without the secret we can't reach the internal endpoint. Skip
    // provisioning and let CREDS.user fall back to test3. Read-only specs
    // still work; mutating specs may leak rows onto test3 as before.
    // eslint-disable-next-line no-console
    console.warn('[web-setup] E2E_PURGE_SECRET not set — skipping fixture user provisioning');
    return;
  }

  const adminToken = await page.evaluate(() => localStorage.getItem('sonoqui.access_token'));
  if (!adminToken) throw new Error('admin access token missing from localStorage');

  const meRes = await fetch(`${API_BASE}/api/v1/me`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const meBody = (await meRes.json()) as { data: { tenant: { id: string } } };
  const tenantId = meBody.data?.tenant?.id;
  if (!tenantId) throw new Error('could not resolve tenant_id for fixture user');

  const email = `e2e-runner-${Date.now()}@e2e.local`;
  const password = 'E2eRunner123@!';
  const provisionRes = await fetch(`${API_BASE}/api/v1/_internal/e2e/create-fixture-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${purgeSecret}`,
    },
    body: JSON.stringify({
      email,
      password,
      tenant_id: tenantId,
      role: 'user',
      first_name: 'E2E',
      last_name: 'Runner',
    }),
  });
  if (!provisionRes.ok) {
    const text = await provisionRes.text();
    throw new Error(`create-fixture-user failed: ${provisionRes.status} ${text}`);
  }

  const credsPath = resolve(process.cwd(), STORAGE.userCreds);
  await mkdir(dirname(credsPath), { recursive: true });
  await writeFile(
    credsPath,
    JSON.stringify({ email, password, displayName: 'E2E Runner' }, null, 2),
    'utf8'
  );
});
