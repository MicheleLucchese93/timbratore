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

// Employees reach their balances from the "Residui" tab of Ferie & Permessi
// (no standalone sidebar entry). The admin roster stays gated to admins.
// These structural checks don't depend on any seeded quota.
test.describe('web — Residui (employee)', () => {
  test('no standalone Residui sidebar entry (merged into Ferie & Permessi)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Residui', exact: true })).toHaveCount(0);
  });

  test('Residui tab shows the personal view, not the admin roster', async ({ page }) => {
    await page.goto('/me/leaves');
    await page.getByRole('button', { name: 'Residui', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'I miei residui' })).toBeVisible({ timeout: 15_000 });
    // Role-branch guard: the admin roster ("Residui dipendenti") must never
    // render for an employee.
    await expect(page.getByRole('heading', { name: 'Residui dipendenti' })).toHaveCount(0);
  });
});

// Quota-dependent assertion: seed a known ferie quota for test3 so the residual
// card has data, then assert it renders. Mirrors the mobile negative-balance
// spec. Gated by E2E_MUTATING=1 because it touches the live test tenant.
const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('web — Residui card with seeded quota (employee)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let templateId: string | null = null;
  let assignmentId: string | null = null;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    const user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    const tpl = await createQuotaTemplate(admin.token, {
      name: `e2e-web-residui-${Date.now()}`,
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
      initial_balance: 80,
    });
    assignmentId = assignment.id;
  });

  test.afterAll(async () => {
    if (assignmentId) await closeAssignment(admin.token, assignmentId).catch(() => {});
    if (templateId) await deleteQuotaTemplate(admin.token, templateId).catch(() => {});
  });

  test('renders a Ferie residual card with the seeded balance', async ({ page }) => {
    await page.goto('/me/leaves');
    await page.getByRole('button', { name: 'Residui', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'I miei residui' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Ferie', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('residuo disponibile').first()).toBeVisible();
  });
});
