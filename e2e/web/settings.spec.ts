import { test, expect } from '@playwright/test';

test.describe('web — Impostazioni (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /Impostazioni/i })).toBeVisible({ timeout: 15_000 });
  });

  test('Anagrafica: Ragione sociale read-only, Partita IVA editable by admin', async ({ page }) => {
    const ragione = page.locator('input').filter({ hasNot: page.locator('[type="checkbox"], [type="date"], [type="number"]') }).first();
    // The first text-like input is the Ragione sociale field; it's disabled.
    await expect(ragione).toBeDisabled();
    // P.IVA is now admin-editable (whole settings router is requireAdmin).
    await expect(page.getByLabel('Partita IVA')).toBeEditable();
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

  test('Notifiche email section lists the per-category toggles', async ({ page }) => {
    // The single master toggle was replaced by one switch per category,
    // mirroring the push split (migration 030).
    await expect(page.getByRole('heading', { name: /Notifiche email/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Esiti delle mie richieste/i)).toBeVisible();
    await expect(page.getByText(/Promemoria 24h prima/i)).toBeVisible();
    // Six category switches.
    await expect(page.locator('label.switch')).toHaveCount(6);
  });

  test('toggling an email category shows the saved toast', async ({ page }) => {
    // The <input> is visually hidden behind .switch-track / .switch-thumb, so
    // .click() must target the parent label with force. We flip one category
    // once — toggling twice in quick succession races the PATCH /api/v1/me.
    const switchLabel = page.locator('label.switch').first();
    await expect(switchLabel).toBeVisible({ timeout: 10_000 });
    await switchLabel.click({ force: true });
    await expect(page.getByText(/Preferenza salvata\./i)).toBeVisible({ timeout: 10_000 });
  });
});
