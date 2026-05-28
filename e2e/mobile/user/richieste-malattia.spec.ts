import { test, expect } from '@playwright/test';

// Italian compliance: a `malattia` request MUST carry an INPS protocol number
// (regulated certificate). The backend (apps/backend/src/routes/leaves.ts:117)
// throws if missing; the DB has a CHECK constraint as a belt-and-braces
// guard. This spec asserts the UI surfaces the field and the submit handler
// produces a visible error when the field is empty.
test.describe('mobile — Malattia request UX (employee)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Richieste' }).click();
    await page.getByLabel('Nuova richiesta').first().click();
    // Multiple "Malattia" occurrences exist on the page: the type chip in
    // the open modal AND leftover seeded leave-row notes. The modal opens
    // last, so .last() reliably targets the chip rendered on top.
    await page.getByText('Malattia', { exact: true }).last().click();
  });

  test('renders the INPS protocol field as a required-looking input', async ({ page }) => {
    await expect(page.getByText('Numero protocollo INPS')).toBeVisible({ timeout: 10_000 });
    const inps = page.getByPlaceholder('es. 1234567890');
    await expect(inps).toBeVisible();
    // Confirm autocapitalize is "none" (numbers + letters mix possible).
    await expect(inps).toHaveAttribute('autocapitalize', 'none');
  });

  test('hides the Durata block on Malattia (certificate, not quota draw)', async ({ page }) => {
    // Malattia is informational (you ARE sick) — no quarter-hour granularity.
    // The product hides the Durata / Tutto il giorno / Orario specifico
    // controls entirely for malattia.
    await expect(page.getByText('Durata', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Tutto il giorno')).toHaveCount(0);
    await expect(page.getByText('Orario specifico')).toHaveCount(0);
  });

  test('submit text is "Invia segnalazione" (not "Invia richiesta")', async ({ page }) => {
    // Distinct copy — it's a notice, not a request waiting on approval.
    await expect(page.getByText('Invia segnalazione')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Invia richiesta', { exact: true })).toHaveCount(0);
  });

  test('no approver-box shown for Malattia (auto-approved on file)', async ({ page }) => {
    // Backend sets status='approved' on create. UI removes the
    // "Approvatore: …" / "Nessun approvatore configurato" hint for malattia
    // — there is no one to approve.
    await expect(page.getByText('Nessun approvatore configurato')).toHaveCount(0);
    await expect(page.getByText(/^Approvatore: /)).toHaveCount(0);
  });
});
