import { test as setup, expect } from '@playwright/test';
import { CREDS, STORAGE, URLS } from '../fixtures/test-data';
import { apiPatch, loginAs } from '../fixtures/api-client';
import { chooseTenantIfPrompted } from '../fixtures/choose-tenant';

// Runs once before the `web` project. Logs in via the real Login form and
// persists localStorage to STORAGE.webAuth so each spec can reuse the session
// without re-authenticating (faster + fewer GoTrue audit-log entries).
setup('authenticate web admin', async ({ page }) => {
  // Pin the account's UI language to Italian before capturing the session. The
  // per-user server preference is the source of truth (App.tsx →
  // applyServerLanguage overrides the local cache once /me resolves), so a stray
  // manual-testing switch to EN would otherwise render the whole Italian web
  // suite in English and fail every copy assertion. Runs before the UI login so
  // the language-sensitive assertions below hold regardless of prior drift.
  const handle = await loginAs(CREDS.admin.email, CREDS.admin.password);
  await apiPatch(handle.token, '/api/v1/me', { language: 'it' }).catch(() => {});

  await page.goto(`${URLS.web}/login`);
  await page.locator('input#email').fill(CREDS.admin.email);
  await page.locator('input#password').fill(CREDS.admin.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  // test1 is an admin on a second company too, so login stops on the company
  // chooser. Pick the fixture company before waiting for the Dashboard — the
  // choice is stored in localStorage, so storageState below carries it and
  // every spec reusing this session stays on the right company.
  const dashboard = page.getByRole('heading', { name: 'Dashboard' });
  await chooseTenantIfPrompted(page, dashboard, 15_000);
  await expect(dashboard).toBeVisible({ timeout: 15_000 });
  await page.context().storageState({ path: STORAGE.webAuth });
});
