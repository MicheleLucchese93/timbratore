import { test, expect } from '@playwright/test';

const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('partner · manual', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');

  test('manual is reachable from the sidebar and renders', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('heading', { name: /Aziende|Companies/ }).waitFor();

    // Reach the manual from the sidebar nav link.
    await page.getByRole('link', { name: /^Manuale$|^Manual$/ }).click();
    await expect(page).toHaveURL(/\/manual$/);

    // The content body renders (first chapter) and the toolbar is present.
    await expect(page.getByRole('heading', { name: /Benvenuto|Welcome/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Cerca|Search/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Markdown/ })).toBeVisible();

    // The in-manual table-of-contents anchors jump to a section.
    await page.getByRole('link', { name: /Domande frequenti|FAQ/ }).click();
    await expect(page).toHaveURL(/#faq$/);
  });
});
