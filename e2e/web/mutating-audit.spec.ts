import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  apiPatch,
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

  // PATCH /users/:id snapshots the columns it is about to touch, so a user edit
  // reaches the Registro with both sides and renders as "prima → dopo". Without
  // the snapshot the row would show the new modes and nothing to compare them
  // against, which is exactly how this looked before.
  test('a user edit reaches the registro as a before → after diff', async ({ page }) => {
    const employee = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    // Force a known transition: settle on gps-only first, then add remote, so
    // the last entry always has two different sides regardless of prior state.
    await apiPatch(admin.token, `/api/v1/users/${employee.userId}`, { stamp_modes: ['gps'] });
    await apiPatch(admin.token, `/api/v1/users/${employee.userId}`, {
      stamp_modes: ['gps', 'remote'],
    });

    try {
      await page.goto('/audit');
      await page.locator('select').nth(2).selectOption('users');
      const row = page
        .getByRole('row')
        .filter({ hasText: 'Utente modificato' })
        .filter({ hasText: 'Modalità di timbratura' })
        .first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row).toContainText('GPS in sede → GPS in sede, Da remoto');
    } finally {
      // Restore the seeded default (gps-only) for every other spec.
      await apiPatch(admin.token, `/api/v1/users/${employee.userId}`, {
        stamp_modes: ['gps'],
      }).catch(() => {});
    }
  });
});
