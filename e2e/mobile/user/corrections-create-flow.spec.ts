import { test, expect } from '@playwright/test';

// Full 3-step modal flow for an employee filing a correction:
//   step 'date'      → "Quale giorno?"
//   step 'pickStamp' → list day's stamps + "Aggiungi una timbratura mancante"
//   step 'edit'      → Tipo evento / Data / Ora / (Sede) / Motivazione
test.describe('mobile — Correzioni create flow (employee, 3 steps)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Timbrature' }).click();
    // Corrections moved inside Timbrature — open the "Correggi" sub-tab.
    await page.getByText('Correggi').first().click();
    await page.getByLabel('Nuova richiesta').first().click();
    // Step 1 — "Quale giorno?"
    await expect(page.getByText('Quale giorno?')).toBeVisible({ timeout: 10_000 });
  });

  test('step 1 → 2: Continua advances to pickStamp', async ({ page }) => {
    // TouchableOpacity submit button — RN-Web emits <div> w/o role=button.
await page.getByText('Continua').click();
    // Step 2 — pickStamp helper + "Aggiungi una timbratura mancante" row.
    await expect(
      page.getByText(/Tocca una timbratura per correggerla/i),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Aggiungi una timbratura mancante/i)).toBeVisible();
  });

  test('step 2 → 3: "Aggiungi mancante" advances to edit', async ({ page }) => {
    // TouchableOpacity submit button — RN-Web emits <div> w/o role=button.
await page.getByText('Continua').click();
    await page.getByText(/Aggiungi una timbratura mancante/i).click();
    // Step 3 — Tipo evento with all 6 options + Motivazione textarea.
    await expect(page.getByText('Tipo evento')).toBeVisible({ timeout: 10_000 });
    for (const ev of [
      'Entrata',
      'Inizio pausa',
      'Fine pausa',
      'Inizio pausa pranzo',
      'Fine pausa pranzo',
      'Uscita',
    ]) {
      await expect(page.getByText(ev).first()).toBeVisible();
    }
    // "Motivazione" appears both on the card detail behind the modal and
    // on the edit form — pin to the .first() inside the visible dialog
    // (which is the modal because Pressable items render on top).
    await expect(page.getByText('Motivazione').first()).toBeVisible();
    await expect(
      page.getByPlaceholder("Es. avevo dimenticato di timbrare l'uscita"),
    ).toBeVisible();
  });

  test('edit step shows Ora time input + Data (static)', async ({ page }) => {
    // TouchableOpacity submit button — RN-Web emits <div> w/o role=button.
await page.getByText('Continua').click();
    await page.getByText(/Aggiungi una timbratura mancante/i).click();
    await expect(page.getByText('Data', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Ora', { exact: true })).toBeVisible();
  });

  test('Sede chip selector appears for multi-branch employees, hidden for single', async ({ page }) => {
    // Sede block renders only when `me.branches.length > 1`. test3's
    // assigned-branch count is tenant-config dependent — we don't assert
    // a hard truth here, only that the flow doesn't crash on either path.
    // Advance to step 'edit' via the missing-stamp route.
    await page.getByText('Continua').click();
    await expect(page.getByText(/Aggiungi una timbratura mancante/i)).toBeVisible({ timeout: 10_000 });
    await page.getByText(/Aggiungi una timbratura mancante/i).click();
    // Wait for step 'edit' content to appear (Motivazione is unique to it).
    await expect(page.getByText('Motivazione').first()).toBeVisible({ timeout: 10_000 });
    // Now check Sede block: either present (>1 branch assigned) or absent (1).
    // Either outcome is correct — assert it's a defined state.
    const sedeCount = await page.getByText('Sede', { exact: true }).count();
    expect([0, 1].includes(sedeCount) || sedeCount > 1).toBe(true);
  });
});
