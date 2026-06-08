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

    // First fascia of an empty day defaults to 09:00–13:00 → already a 4h
    // day total, no override needed.
    const timeInputs = lun.locator('input[type="time"]');
    await timeInputs.nth(1).fill('13:00');

    // Per-day total appears on the same row.
    await expect(lun.getByText('4h 00m')).toBeVisible({ timeout: 5_000 });

    // Weekly footer reflects the same total (only Lun has a fascia). Match the
    // modal's footer label exactly — existing template cards on the page render
    // "Totale settimanale: <total>" (weeklyTotal), which would otherwise make
    // the locator ambiguous (strict-mode dup) whenever a card shares the total.
    const footer = page.getByText('Totale settimanale', { exact: true }).locator('xpath=..');
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

    const footer = page.getByText('Totale settimanale', { exact: true }).locator('xpath=..');
    await expect(footer.getByText('8h 00m')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Annulla' }).click();
  });

  test('adding a second fascia copies the previous one of that day', async ({ page }) => {
    await page.getByRole('button', { name: /Nuovo orario/i }).click();
    await expect(page.getByRole('heading', { name: 'Nuovo orario' })).toBeVisible({ timeout: 10_000 });

    const lun = dayRow(page, 'Lunedì');
    await lun.getByRole('button', { name: '+ fascia' }).click();

    // Edit the first fascia to distinctive times, then add a second one: the
    // new fascia copies the previous slot's times (see addSlot in
    // apps/web/src/pages/Shifts.tsx) so the user only tweaks it.
    const timeInputs = lun.locator('input[type="time"]');
    await timeInputs.nth(0).fill('08:00');
    await timeInputs.nth(1).fill('12:00');

    await lun.getByRole('button', { name: '+ fascia' }).click();

    // Second fascia mirrors the first (08:00–12:00), not the 09:00–13:00 default.
    await expect(timeInputs.nth(2)).toHaveValue('08:00');
    await expect(timeInputs.nth(3)).toHaveValue('12:00');

    // Two 4h fasce on the same day → 8h day total.
    await expect(lun.getByText('8h 00m')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Annulla' }).click();
  });
});
