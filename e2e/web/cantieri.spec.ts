import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import { loadHandleFromStorage, cantieriMe } from '../fixtures/api-client';

// Read-only coverage for the Cantieri module gating. The module sits behind a
// per-tenant partner flag (tenants.cantieri_enabled) + a per-user module role
// (memberships.cantieri_role), so the shared test tenant may legitimately have
// it on or off depending on prod provisioning — both states are asserted
// rather than assumed, keeping the suite green before and after enablement.

let moduleOn = false;

test.describe('web — Cantieri module gating', () => {
  test.beforeAll(async () => {
    const admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    const s = await cantieriMe(admin.token);
    moduleOn = s.enabled && s.role === 'admin';
  });

  test('sidebar group and routes match the /me module state', async ({ page }) => {
    await page.goto('/');
    // Wait for the admin shell to be up before asserting on nav content.
    await expect(page.getByRole('link', { name: 'Utenti' })).toBeVisible({ timeout: 15_000 });

    const group = page.getByRole('button', { name: 'Cantieri' });
    if (!moduleOn) {
      // Flag off (or admin lacks the module role): no menu, and the routes
      // bounce back to the dashboard.
      await expect(group).toHaveCount(0);
      await page.goto('/cantieri');
      await expect(page.getByRole('heading', { name: 'Cantieri', exact: true })).toHaveCount(0);
      return;
    }

    // Module on: the group expands into the three sub-entries.
    await expect(group).toBeVisible();
    if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click();
    await expect(page.getByRole('link', { name: 'Mezzi' })).toBeVisible();

    await page.goto('/cantieri');
    await expect(page.getByRole('heading', { name: 'Cantieri', exact: true })).toBeVisible();
    await page.goto('/cantieri/mezzi');
    await expect(page.getByRole('heading', { name: 'Mezzi', exact: true })).toBeVisible();
    await page.goto('/cantieri/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard cantieri' })).toBeVisible();
  });
});
