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
});
