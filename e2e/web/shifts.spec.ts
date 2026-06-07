import { test, expect } from '@playwright/test';

test.describe('web — Orari (Shifts) page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/shifts');
  });

  test('renders the page heading and "Nuovo orario" CTA', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Orari|Turni/i }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Nuovo orario/i })).toBeVisible();
  });

  test('opens the template creation modal with name + description inputs', async ({ page }) => {
    await page.getByRole('button', { name: /Nuovo orario/i }).click();
    // Inputs are wrapped in <label><span>Nome</span><input/></label> — no id.
    // Locate by the visible label text.
    await expect(page.getByRole('heading', { name: 'Nuovo orario' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Nome', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Descrizione/).first()).toBeVisible();
    // Close without saving via Annulla (if present) or Escape.
    const cancel = page.getByRole('button', { name: 'Annulla' });
    if (await cancel.count()) await cancel.click();
    else await page.keyboard.press('Escape');
  });

  test('modal exposes both pausa and pausa pranzo min/max thresholds', async ({ page }) => {
    await page.getByRole('button', { name: /Nuovo orario/i }).click();
    await expect(page.getByRole('heading', { name: 'Nuovo orario' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Pausa min', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Pausa max', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Pausa pranzo min', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Pausa pranzo max', { exact: true }).first()).toBeVisible();
    const cancel = page.getByRole('button', { name: 'Annulla' });
    if (await cancel.count()) await cancel.click();
    else await page.keyboard.press('Escape');
  });

  test('Orario flessibile section reveals the prima/dopo flex windows', async ({ page }) => {
    await page.getByRole('button', { name: /Nuovo orario/i }).click();
    await expect(page.getByRole('heading', { name: 'Nuovo orario' })).toBeVisible({ timeout: 10_000 });
    // Flex inputs appear only after enabling the flexible-schedule toggle.
    await page.getByRole('checkbox', { name: /Abilita orario flessibile/i }).check();
    await expect(page.getByText('Entrata: prima (min)', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Uscita: dopo (min)', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Pausa pranzo: prima (min)', { exact: true }).first()).toBeVisible();
    const cancel = page.getByRole('button', { name: 'Annulla' });
    if (await cancel.count()) await cancel.click();
    else await page.keyboard.press('Escape');
  });

  test('overtime block selector offers 15/30/60-minute blocks', async ({ page }) => {
    await page.getByRole('button', { name: /Nuovo orario/i }).click();
    await expect(page.getByRole('heading', { name: 'Nuovo orario' })).toBeVisible({ timeout: 10_000 });
    // The block selector is revealed only once overtime counting is enabled.
    await page.getByRole('checkbox', { name: /Considera le ore straordinarie/i }).check();
    await expect(page.getByText('Conteggio straordinario a blocchi di', { exact: true })).toBeVisible();
    // Scope to the Straordinario block's own label — the three penalty selects
    // also expose a 60-minute option, so a global option[value=60] filter is
    // ambiguous (matches 4 selects).
    const block = page.locator('label.block', { hasText: 'Conteggio straordinario a blocchi di' });
    await expect(block.locator('select option')).toHaveText(['15 minuti', '30 minuti', '60 minuti']);
    const cancel = page.getByRole('button', { name: 'Annulla' });
    if (await cancel.count()) await cancel.click();
    else await page.keyboard.press('Escape');
  });
});
