import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  createQuotaTemplate,
  deleteQuotaTemplate,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('web — Leave-quota templates CRUD (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let templateId: string | null = null;
  let name: string;

  test.beforeEach(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    name = `e2e-quota-${Date.now()}`;
    const tpl = await createQuotaTemplate(admin.token, {
      name,
      type: 'ferie',
      hours_default: 0,
      accrual_amount: 0,
      accrual_frequency: 'monthly',
      accrual_day_of_month: 1,
    });
    templateId = tpl.id;
  });

  test.afterEach(async () => {
    if (templateId) await deleteQuotaTemplate(admin.token, templateId).catch(() => {});
    templateId = null;
  });

  test('Modelli tab lists the new template', async ({ page }) => {
    await page.goto('/leaves');
    await page.getByRole('button', { name: 'Modelli', exact: true }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  });

  test('soft-deleted template disappears from Modelli tab', async ({ page }) => {
    await page.goto('/leaves');
    await page.getByRole('button', { name: 'Modelli', exact: true }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
    await deleteQuotaTemplate(admin.token, templateId!);
    templateId = null;
    await page.reload();
    await page.getByRole('button', { name: 'Modelli', exact: true }).click();
    await expect(page.getByText(name)).toHaveCount(0, { timeout: 10_000 });
  });
});
