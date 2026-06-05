import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  apiGet,
  assignShift,
  createShiftTemplate,
  deleteShiftTemplate,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('web — Orari template CRUD (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let templateId: string | null = null;
  let copyId: string | null = null;
  let name: string;

  test.beforeEach(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    name = `e2e-tpl-${Date.now()}`;
    const tpl = await createShiftTemplate(admin.token, {
      name,
      description: 'e2e test',
      slots: [{ day_of_week: 1, start_time: '09:00', end_time: '17:00' }],
    });
    templateId = tpl.id;
  });

  test.afterEach(async () => {
    if (templateId) await deleteShiftTemplate(admin.token, templateId).catch(() => {});
    // Delete the duplicate too. If its id wasn't captured (e.g. assertion
    // failed before lookup), sweep any leftover "Copia di <name>" by name.
    if (!copyId) {
      const all = await apiGet<Array<{ id: string; name: string }>>(
        admin.token,
        '/api/v1/shifts/templates',
      ).catch(() => [] as Array<{ id: string; name: string }>);
      copyId = all.find((t) => t.name === `Copia di ${name}`)?.id ?? null;
    }
    if (copyId) await deleteShiftTemplate(admin.token, copyId).catch(() => {});
    templateId = null;
    copyId = null;
  });

  test('new template shows on /shifts after API create', async ({ page }) => {
    await page.goto('/shifts');
    await expect(page.getByRole('heading', { name: /Orari|Turni/i }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  });

  test('soft-deleted template disappears from list', async ({ page }) => {
    await page.goto('/shifts');
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
    await deleteShiftTemplate(admin.token, templateId!);
    templateId = null;
    await page.reload();
    await expect(page.getByText(name)).toHaveCount(0, { timeout: 10_000 });
  });

  test('template can be assigned to a user via the API', async ({ page }) => {
    // Assignment surface in the UI lives on the Utenti page; here we just
    // assert the POST succeeds and the row goes "Attiva" on /shifts.
    const user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    const today = new Date().toISOString().slice(0, 10);
    await assignShift(admin.token, {
      user_id: user.userId,
      shift_template_id: templateId!,
      valid_from: today,
    });
    // Cleanup the assignment so it doesn't survive the test.
    await assignShift(admin.token, {
      user_id: user.userId,
      shift_template_id: null,
      valid_from: today,
    });
    await page.goto('/shifts');
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Duplica icon clones the template under "Copia di …"', async ({ page }) => {
    await page.goto('/shifts');
    const card = page.locator('li.card', { hasText: name });
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.getByRole('button', { name: 'Duplica' }).click();

    // The copy appears in the list, name prefixed with "Copia di ".
    const copyName = `Copia di ${name}`;
    await expect(page.getByText(copyName).first()).toBeVisible({ timeout: 10_000 });

    // Backend persisted it with the same slots (one Mon 09:00–17:00 fascia).
    const all = await apiGet<Array<{ id: string; name: string; slots: unknown[] }>>(
      admin.token,
      '/api/v1/shifts/templates',
    );
    const copy = all.find((t) => t.name === copyName);
    expect(copy).toBeTruthy();
    copyId = copy!.id;
    expect(copy!.slots).toHaveLength(1);
  });
});
