import { test, expect, type Locator, type Page } from '@playwright/test';

// Verifies the Settimana fieldset in the shift template editor renders
// per-day totals beside each day row and a weekly total footer. Read-only:
// opens "Nuovo orario", adds fasce, asserts totals match, then cancels.

function dayRow(page: Page, label: string): Locator {
  // The day label sits in a w-20 cell, which is the first child of the
  // outer flex row that holds the time inputs, "+ fascia" button, and
  // per-day total. Traverse from the label cell up one level.
  return page.getByText(label, { exact: true }).locator('xpath=..');
}

test.describe('web — Orari Settimana day & week totals', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/shifts');
  });

  test('renders per-day total and weekly total in the editor', async ({ page }) => {
    await page.getByRole('button', { name: /Nuovo orario/i }).click();
    await expect(page.getByRole('heading', { name: 'Nuovo orario' })).toBeVisible({ timeout: 10_000 });

    const lun = dayRow(page, 'Lunedì');
    await lun.getByRole('button', { name: '+ fascia' }).click();

    // Default new fascia is 09:00–17:00. Override end_time to 13:00 for a
    // deterministic 4h day total.
    const timeInputs = lun.locator('input[type="time"]');
    await timeInputs.nth(1).fill('13:00');

    // Per-day total appears on the same row.
    await expect(lun.getByText('4h 00m')).toBeVisible({ timeout: 5_000 });

    // Weekly footer reflects the same total (only Lun has a fascia).
    const footer = page.getByText('Totale settimanale').locator('xpath=..');
    await expect(footer.getByText('4h 00m')).toBeVisible();

    await page.getByRole('button', { name: 'Annulla' }).click();
  });

  test('weekly total updates as more days get fasce', async ({ page }) => {
    await page.getByRole('button', { name: /Nuovo orario/i }).click();
    await expect(page.getByRole('heading', { name: 'Nuovo orario' })).toBeVisible({ timeout: 10_000 });

    for (const label of ['Lunedì', 'Martedì']) {
      const row = dayRow(page, label);
      await row.getByRole('button', { name: '+ fascia' }).click();
      // Default new fascia is 09:00–13:00 (see addSlot in
      // apps/web/src/pages/Shifts.tsx) → 4h per day.
    }

    const footer = page.getByText('Totale settimanale').locator('xpath=..');
    await expect(footer.getByText('8h 00m')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Annulla' }).click();
  });
});
