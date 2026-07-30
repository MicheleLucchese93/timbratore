import { test, expect } from '@playwright/test';

// Read-only coverage for the Cantieri tab's period filter (month / day / all
// time). The module is gated per tenant (tenants.cantieri_enabled) AND per user
// (memberships.cantieri_role), so the spec asserts whichever gated state it
// finds rather than assuming the tab is there.
//
// RN-web renders Pressable/TouchableOpacity without an implicit button role, so
// the controls are located by their accessibility label (getByLabel), the same
// convention as the other mobile specs.

test.describe('mobile — Cantieri period filter', () => {
  test('the period chip cycles Mese → Giorno → Tutto and swaps the arrows', async ({ page }) => {
    await page.goto('/');
    // Wait for the shell (tab bar) before probing for the module tab.
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });

    const tab = page.getByRole('button', { name: 'Cantieri' });
    test.skip((await tab.count()) === 0, 'cantieri module not enabled for this user');
    await tab.click();

    const chip = page.getByLabel('Cambia periodo: mese, giorno o tutto');
    await expect(chip).toBeVisible({ timeout: 15_000 });
    const prevMonth = page.getByLabel('Mese precedente');
    const prevDay = page.getByLabel('Giorno precedente');

    // Default period is the current month, with the month arrows.
    await expect(chip.getByText('Mese', { exact: true })).toBeVisible();
    await expect(prevMonth).toBeVisible();

    // → day: the day arrows replace the month ones.
    await chip.click();
    await expect(chip.getByText('Giorno', { exact: true })).toBeVisible();
    await expect(prevDay).toBeVisible();
    await expect(page.getByLabel('Giorno successivo')).toBeVisible();
    await expect(prevMonth).toHaveCount(0);

    // → all time: no arrows at all (the list is unbounded).
    await chip.click();
    await expect(chip.getByText('Tutto', { exact: true })).toBeVisible();
    await expect(prevDay).toHaveCount(0);
    await expect(prevMonth).toHaveCount(0);

    // → back to the month it started on.
    await chip.click();
    await expect(prevMonth).toBeVisible();
  });
});
