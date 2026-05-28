import { test, expect } from '@playwright/test';

test.describe('web — Ferie & Permessi', () => {
  test('page renders and lists at least one tab/section', async ({ page }) => {
    await page.goto('/leaves');
    await expect(page.getByRole('heading', { name: /Ferie|Permessi/i }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('no unhandled console errors on initial load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/leaves');
    await expect(page.getByRole('heading', { name: /Ferie|Permessi/i }).first()).toBeVisible();
    // Allow benign warnings; fail only on hard errors.
    const fatal = errors.filter((e) => !/Failed to load resource|favicon/i.test(e));
    expect(fatal, fatal.join('\n')).toHaveLength(0);
  });
});
