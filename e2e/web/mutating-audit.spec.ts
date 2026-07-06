import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  createBranch,
  deleteBranch,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

// Registro attività round-trip: perform an audited admin mutation (branch
// create + delete via API) and verify both entries surface on /audit with
// the translated action labels and the acting admin as author.
const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('web — Registro attività entries (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let branchId: string | null = null;
  let name: string;

  test.beforeEach(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    name = `e2e-audit-sede-${Date.now()}`;
    const b = await createBranch(admin.token, {
      name,
      radius_m: 200,
      smart_working: true,
    });
    branchId = b.id;
  });

  test.afterEach(async () => {
    if (branchId && admin) await deleteBranch(admin.token, branchId).catch(() => {});
    branchId = null;
  });

  test('branch create + delete both appear in the registro with target label', async ({
    page,
  }) => {
    await deleteBranch(admin.token, branchId!);
    branchId = null;

    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: /Registro attività/i })).toBeVisible({
      timeout: 15_000,
    });
    // Narrow to the Sedi category so unrelated rows from parallel specs can't
    // push ours past the first page.
    await page.locator('select').nth(2).selectOption('branches');
    await expect(
      page.getByRole('row').filter({ hasText: 'Sede creata' }).filter({ hasText: name }).first()
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('row').filter({ hasText: 'Sede eliminata' }).filter({ hasText: name }).first()
    ).toBeVisible();
  });
});
