import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  apiGet,
  assignQuota,
  closeAssignment,
  createQuotaTemplate,
  deleteQuotaTemplate,
  listUserAccruals,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

const ENABLED = process.env.E2E_MUTATING === '1';

// Admin manual add/remove of leave hours, with the per-user audit log.
// Targets test2 (an admin teammate) instead of test3 so we never disturb the
// seeded employee quotas that the mobile-user specs assert against.
test.describe('web — Manual leave-quota adjustment + audit (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let targetUserId: string;
  let templateId: string | null = null;
  let assignmentId: string | null = null;

  test.beforeEach(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    const users = await apiGet<Array<{ user_id: string; email: string }>>(
      admin.token,
      '/api/v1/users',
    );
    const target = users.find((u) => u.email === 'test2@test.it');
    if (!target) throw new Error('test2@test.it not found on test tenant');
    targetUserId = target.user_id;

    const tpl = await createQuotaTemplate(admin.token, {
      name: `e2e-adjtpl-${Date.now()}`,
      type: 'ferie',
      hours_default: 0,
      accrual_amount: 0, // no auto-accrual noise in the ledger
      accrual_frequency: 'monthly',
      accrual_day_of_month: 1,
    });
    templateId = tpl.id;
    const a = await assignQuota(admin.token, {
      user_id: targetUserId,
      template_id: tpl.id,
      initial_balance: 0,
    });
    assignmentId = a.id;
  });

  test.afterEach(async () => {
    if (assignmentId) await closeAssignment(admin.token, assignmentId).catch(() => {});
    if (templateId) await deleteQuotaTemplate(admin.token, templateId).catch(() => {});
    assignmentId = null;
    templateId = null;
  });

  test('add then remove hours; both logged in the audit timeline', async ({ page }) => {
    await page.goto('/leaves');
    await page.getByRole('button', { name: 'Quote', exact: true }).click();

    const row = page.getByRole('row').filter({ hasText: 'test2@test.it' });
    await expect(row).toBeVisible({ timeout: 15_000 });
    // Fresh assignment starts at 0h.
    await expect(row.getByRole('button', { name: '0.00h' })).toBeVisible({ timeout: 10_000 });

    // --- Add 8h ---
    await row.getByRole('button', { name: 'Aggiungi/Rimuovi ore' }).click();
    await expect(page.getByRole('heading', { name: /Modifica manuale ore/ })).toBeVisible();
    await page.getByLabel('Ore').fill('8');
    await page.getByLabel('Nota').fill('e2e add');
    await page.getByRole('button', { name: 'Salva' }).click();
    await expect(page.getByRole('heading', { name: /Modifica manuale ore/ })).toBeHidden({
      timeout: 10_000,
    });
    await expect(row.getByRole('button', { name: '8.00h' })).toBeVisible({ timeout: 10_000 });

    // --- Remove 3h ---
    await row.getByRole('button', { name: 'Aggiungi/Rimuovi ore' }).click();
    await expect(page.getByRole('heading', { name: /Modifica manuale ore/ })).toBeVisible();
    await page.getByRole('radio', { name: 'Rimuovi' }).check();
    await page.getByLabel('Ore').fill('3');
    await page.getByRole('button', { name: 'Salva' }).click();
    await expect(page.getByRole('heading', { name: /Modifica manuale ore/ })).toBeHidden({
      timeout: 10_000,
    });
    await expect(row.getByRole('button', { name: '5.00h' })).toBeVisible({ timeout: 10_000 });

    // --- Audit log lists both operations with the acting admin ---
    await row.getByRole('button', { name: 'Storico modifiche manuali' }).click();
    await expect(page.getByRole('heading', { name: /Storico modifiche/ })).toBeVisible();
    await expect(page.getByText('+8.00h')).toBeVisible();
    await expect(page.getByText('-3.00h')).toBeVisible();
    await expect(page.getByText('e2e add')).toBeVisible();

    // Backend ledger confirms the two signed manual rows.
    const ledger = await listUserAccruals(admin.token, targetUserId);
    const mine = ledger.filter((l) => l.source === 'manual');
    expect(mine.some((l) => l.hours === 8)).toBeTruthy();
    expect(mine.some((l) => l.hours === -3)).toBeTruthy();
  });
});
