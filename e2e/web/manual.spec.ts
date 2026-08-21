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

  // What the app does with an employee's position is the first thing a customer
  // (or their DPO) asks about, and the answer changed: coordinates are used for
  // the area check and then discarded. The manual is the artifact that answer
  // gets read from, so it has to keep saying it.
  test('documents that coordinates are not retained', async ({ page }) => {
    await expect(page.getByText('Cosa viene conservato').first()).toBeVisible();
    await expect(page.getByText(/le coordinate vengono scartate/i).first()).toBeVisible();
    await expect(page.getByText(/non c.è alcun tracciamento continuo/i).first()).toBeVisible();
  });

  // A shared device is the normal case in the target market (a tablet at the
  // entrance), so "whose punch is this" is a question the manual has to answer.
  test('documents who a queued offline stamp belongs to', async ({ page }) => {
    await expect(page.getByText('A chi appartiene una timbratura in coda').first()).toBeVisible();
    await expect(page.getByText(/dispositivo condiviso/i).first()).toBeVisible();
    await expect(page.getByText(/30 giorni/).first()).toBeVisible();
  });
});
