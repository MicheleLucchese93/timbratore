import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  createBranch,
  deleteBranch,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

// Full round-trip for the Sedi page: seed a branch via API, verify it shows
// up on the page, delete it via API, verify it disappears.
const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('web — Sedi CRUD (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let branchId: string | null = null;
  let name: string;

  test.beforeEach(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    name = `e2e-sede-${Date.now()}`;
    const b = await createBranch(admin.token, {
      name,
      radius_m: 200,
      smart_working: true, // skip GPS validation
    });
    branchId = b.id;
  });

  test.afterEach(async () => {
    if (branchId && admin) await deleteBranch(admin.token, branchId).catch(() => {});
    branchId = null;
  });

  test('newly-created branch appears on /branches', async ({ page }) => {
    await page.goto('/branches');
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  });

  test('soft-deleted branch is removed from the visible list', async ({ page }) => {
    await page.goto('/branches');
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
    await deleteBranch(admin.token, branchId!);
    branchId = null; // afterEach idempotent
    await page.reload();
    await expect(page.getByText(name)).toHaveCount(0, { timeout: 10_000 });
  });

  test('branch created with enforce_radius=false renders "senza raggio" badge', async ({ page }) => {
    // Clean up the smart_working seed from beforeEach — this test seeds its own.
    if (branchId) await deleteBranch(admin.token, branchId).catch(() => {});
    const noRadiusName = `e2e-sede-noradius-${Date.now()}`;
    const b = await createBranch(admin.token, {
      name: noRadiusName,
      latitude: 41.9028,
      longitude: 12.4964,
      radius_m: 300,
      enforce_radius: false,
      smart_working: false,
    });
    branchId = b.id;
    await page.goto('/branches');
    const card = page.locator('li.card', { hasText: noRadiusName });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText(/senza raggio/i)).toBeVisible();
  });
});
