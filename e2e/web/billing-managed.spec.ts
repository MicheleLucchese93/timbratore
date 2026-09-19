import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import { apiFetch, loadHandleFromStorage } from '../fixtures/api-client';

/**
 * The fixture company (ACME) is PARTNER-MANAGED: its plan and modules are set
 * in the partner console, so the self-service billing surfaces must stay
 * read-only for it (Specs/SELF_SERVICE_BILLING.md §3.6, D14). Read-only spec.
 * Skips on a backend that does not serve /api/v1/billing yet.
 */
test.describe('web — billing for a partner-managed company', () => {
  test.beforeAll(async () => {
    const admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    const r = await apiFetch(admin.token, '/api/v1/billing');
    test.skip(r.status === 404, 'backend without self-service billing');
    const body = (await r.json()) as { data?: { billing_mode?: string } };
    test.skip(body.data?.billing_mode !== 'managed', 'fixture company is not partner-managed on this stack');
  });

  test('no "Passa a Premium" badge, no plan banners', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Dashboard/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('premium-badge')).toHaveCount(0);
    await expect(page.getByTestId('pending-plan-banner')).toHaveCount(0);
  });

  test('Impostazioni → Piano e moduli is read-only ("gestito dal tuo partner")', async ({ page }) => {
    await page.goto('/settings');
    const section = page.getByTestId('settings-plan-section');
    await expect(section).toBeVisible({ timeout: 15_000 });
    await expect(section.getByText(/gestiti dal tuo partner/i)).toBeVisible();
    await expect(section.getByTestId('module-activate-cantieri')).toHaveCount(0);
    await expect(section.getByTestId('module-activate-api')).toHaveCount(0);
  });

  test('the subscription page explains the partner manages it', async ({ page }) => {
    await page.goto('/settings/subscription');
    await expect(page.getByTestId('billing-managed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('plan-picker')).toHaveCount(0);
  });
});
