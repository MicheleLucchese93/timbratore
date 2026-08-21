import { test, expect } from '@playwright/test';

// Toolbar over the manual content column: search + PDF + Markdown download.
test.describe('web — manuale utente toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/manual');
    await expect(page.getByRole('heading', { name: /Benvenuto/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('shows search, PDF and Markdown actions with LLM hint', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Cerca nel manuale' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Scarica PDF' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Scarica Markdown' })).toBeVisible();
    await expect(page.getByText('Caricalo nel tuo LLM preferito, come ChatGPT')).toBeVisible();
  });

  test('search highlights matches and reports a count', async ({ page }) => {
    await page.getByRole('button', { name: 'Cerca nel manuale' }).click();
    const input = page.getByRole('searchbox', { name: 'Cerca nel manuale' });
    await input.fill('timbratura');

    const hits = page.locator('.manuale-root mark.manual-search-hl');
    await expect(hits.first()).toBeVisible();
    expect(await hits.count()).toBeGreaterThan(0);
    await expect(page.locator('.manuale-root .tb-count')).toContainText('/');

    // Closing search removes the highlights.
    await page.getByRole('button', { name: 'Chiudi ricerca' }).click();
    await expect(hits).toHaveCount(0);
  });

  test('Markdown button downloads a .md file', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Scarica Markdown' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('sonoqui-manuale.md');
  });

  test('documents the anomaly correction menu', async ({ page }) => {
    await expect(page.getByText("Correggere un'anomalia").first()).toBeVisible();
    await expect(page.getByText('Tracciabilità nelle esportazioni').first()).toBeVisible();
  });

  // Both halves of the Time System S.a.s incident (prod, August 2026) are
  // user-facing and changed how the admin has to read what they see, so the
  // manual carries them and this pins that it keeps doing so:
  //   - the bulk bar merges a day's several anomalies into ONE correction, so
  //     "selezionate: 6" can legitimately produce 3 interventions;
  //   - the export gained "Ore ordinarie", a THEORETICAL figure that on purpose
  //     does not reconcile with "Ore lavorate" — the single question the column
  //     would otherwise generate for support on every payroll run.
  test('documents the per-day bulk merge and the Ore ordinarie column', async ({ page }) => {
    await expect(page.getByText('Un intervento per giornata').first()).toBeVisible();
    await expect(page.getByText('16 ore di ferie in una giornata').first()).toBeVisible();
    await expect(page.getByText('Ore ordinarie').first()).toBeVisible();
    await expect(page.getByText('non quadrano').first()).toBeVisible();
  });

});
