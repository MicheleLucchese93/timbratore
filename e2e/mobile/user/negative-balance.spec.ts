import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../../fixtures/test-data';
import {
  assignQuota,
  closeAssignment,
  createQuotaTemplate,
  deleteQuotaTemplate,
  loadHandleFromStorage,
  type ApiHandle,
} from '../../fixtures/api-client';

// Real Italian-SME scenario: titolare grants an employee 8h of *anticipated*
// ferie. The accounting shows residual = -8h until accruals catch up. Tested
// here end-to-end:
//   1. As admin via API, create a ferie template + assign it to test3 with
//      initial_balance = -8.
//   2. Open the mobile Richieste tab as test3 — assert the quota card
//      surfaces a negative residual (`-8.00h`).
//   3. Cleanup: close the assignment + soft-delete the template.
//
// Gated by E2E_MUTATING=1 because it touches the live test tenant.
const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('mobile — Negative ferie balance (employee view)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let templateId: string | null = null;
  let assignmentId: string | null = null;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    const user = await loadHandleFromStorage(STORAGE.mobileUserAuth, CREDS.user);
    const tpl = await createQuotaTemplate(admin.token, {
      name: `e2e-ferie-${Date.now()}`,
      type: 'ferie',
      hours_default: 0,
      accrual_amount: 0,
      accrual_frequency: 'monthly',
      accrual_day_of_month: 1,
    });
    templateId = tpl.id;
    const assignment = await assignQuota(admin.token, {
      user_id: user.userId,
      template_id: templateId,
      initial_balance: -8,
    });
    assignmentId = assignment.id;
  });

  test.afterAll(async () => {
    if (assignmentId) await closeAssignment(admin.token, assignmentId).catch(() => {});
    if (templateId) await deleteQuotaTemplate(admin.token, templateId).catch(() => {});
  });

  test('quota card on /richieste shows -8.00h residual', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Richieste' }).click();
    // Quota card renders only on the "Le mie" tab (default).  The card shows
    // "Ferie" + "{residual_strict.toFixed(2)}h". With initial_balance=-8 and
    // no consumption, residual_strict should be exactly -8.00.
    // The string "-8.00h" renders twice on the quota card — the main value
    // and the "(… dopo richieste in attesa)" hint. .first() picks the main.
    await expect(page.getByText(/-8\.00h/).first()).toBeVisible({ timeout: 15_000 });
    // And the hint variant should be visible too.
    await expect(page.getByText(/\(-8\.00h dopo richieste in attesa\)/)).toBeVisible();
  });
});
