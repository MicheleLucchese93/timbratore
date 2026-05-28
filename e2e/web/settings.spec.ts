import { test, expect } from '@playwright/test';

test.describe('web — Impostazioni (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /Impostazioni/i })).toBeVisible({ timeout: 15_000 });
  });

  test('Anagrafica section renders read-only Ragione sociale + P.IVA', async ({ page }) => {
    const ragione = page.locator('input').filter({ hasNot: page.locator('[type="checkbox"], [type="date"], [type="number"]') }).first();
    // The first text-like input is the Ragione sociale field; it's disabled.
    await expect(ragione).toBeDisabled();
  });

  test('Timezone select has Europe/Rome + Europe/London + UTC options', async ({ page }) => {
    const tz = page.locator('select').filter({ has: page.locator('option', { hasText: 'Europe/Rome' }) }).first();
    await expect(tz).toBeVisible();
    await expect(tz.locator('option', { hasText: 'Europe/Rome' })).toHaveCount(1);
    await expect(tz.locator('option', { hasText: 'Europe/London' })).toHaveCount(1);
    await expect(tz.locator('option', { hasText: 'UTC' })).toHaveCount(1);
  });

  test('Lingua select has it + en', async ({ page }) => {
    const langSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Italiano' }) });
    await expect(langSelect).toBeVisible();
    await expect(langSelect.locator('option', { hasText: 'Italiano' })).toHaveCount(1);
    await expect(langSelect.locator('option', { hasText: 'English' })).toHaveCount(1);
  });

  test('Email-notifications switch is present and clickable', async ({ page }) => {
    // The switch is `<label class="switch"><input checked type="checkbox" />`.
    // The <input> is visually hidden behind .switch-track / .switch-thumb, so
    // .click() must target the parent label with force.
    const switchLabel = page.locator('label.switch').first();
    await expect(switchLabel).toBeVisible({ timeout: 10_000 });
    await switchLabel.click({ force: true });
    // Confirmation toast appears with the new state. We don't flip back —
    // toggling twice in quick succession races the PATCH /api/v1/me request
    // and leaves the input in a non-deterministic state. The test tenant
    // tolerates one preference flip per run.
    await expect(
      page.getByText(/Notifiche email (attivate|disattivate)\./i),
    ).toBeVisible({ timeout: 10_000 });
  });
});
