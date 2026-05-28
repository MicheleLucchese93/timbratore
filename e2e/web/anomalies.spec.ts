import { test, expect } from '@playwright/test';

// The 7 anomaly kinds match Italian compliance signals tracked by the
// Timbratore product. Default range is 30 days. The page may render a
// "not deployed" notice if the shift-anomaly worker hasn't been provisioned
// on the tenant — we tolerate that path.
test.describe('web — Anomalie page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/anomalies');
  });

  test('renders the page heading and a date range filter', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Anomalie orario/i })).toBeVisible({ timeout: 15_000 });
    // The "from" date input is the first <input type="date"> on the page.
    await expect(page.locator('input[type="date"]').first()).toBeVisible();
  });

  // Content-dependent KIND_LABEL assertion moved to
  // e2e/web/mutating-anomalies-trigger.spec.ts, which seeds a real
  // late_clock_in row so the test is deterministic.
});
