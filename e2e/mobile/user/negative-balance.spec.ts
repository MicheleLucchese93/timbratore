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

  test('quota card on /richieste shows -8h residual', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Richieste' }).click();
    // Quota card renders only on the "Le mie" tab (default). The KPI shows
    // "Ferie" + fmtH(residual_strict); fmtH prints integers without decimals,
    // so initial_balance=-8 with no consumption renders "-8h". The "Residuo
    // dopo richieste in attesa" hint only renders when used_pending > 0; we
    // don't seed a pending request here, so it must be absent.
    await expect(page.getByText(/-8h/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/dopo richieste in attesa/i)).toHaveCount(0);
  });
});
