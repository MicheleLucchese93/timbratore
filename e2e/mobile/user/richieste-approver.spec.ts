import { test, expect } from '@playwright/test';

// Approver visibility from the requester's side: when a dipendente opens a
// new ferie/permessi request, the modal must tell them WHO will receive the
// approval task. The hint is:
//   - "Approvatore: <name>"                          (one or more configured)
//   - "Nessun approvatore configurato"               (admin fallback path)
// Both code paths are guarded — we assert the UI never goes silent.
test.describe('mobile — Approver hint on Ferie/Permessi modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Richieste' }).click();
    await page.getByLabel('Nuova richiesta').first().click();
    // Default type is `ferie`; assert we're on it.
    await expect(page.getByText('Tipo', { exact: true })).toBeVisible();
  });

  test('shows EITHER an "Approvatore: …" line OR the fallback warning', async ({ page }) => {
    const approverLine = page.getByText(/^Approvatore: /);
    const fallback = page.getByText('Nessun approvatore configurato');
    // One of the two must be rendered — never neither (the box is always
    // mounted for non-malattia types).
    await expect(approverLine.or(fallback).first()).toBeVisible({ timeout: 10_000 });
  });

  test('switching to Permesso preserves the approver-box hint', async ({ page }) => {
    // Multiple "Permesso" text nodes can exist (residue leave-request rows
    // in "Le mie" use the word too). Anchor on the unique "Tipo" label
    // above the modal's type-picker so we always target the chip and not
    // a leftover row label. scrollIntoView in case the modal is taller
    // than the viewport; force:true to bypass any pointer-intercept
    // animation from sibling overlays.
    const tipoLabel = page.getByText('Tipo', { exact: true });
    await tipoLabel.scrollIntoViewIfNeeded();
    const modal = tipoLabel.locator('xpath=ancestor::*[1]');
    const chip = modal.getByText('Permesso', { exact: true }).first();
    await chip.scrollIntoViewIfNeeded();
    await chip.click({ force: true });
    const approverLine = page.getByText(/^Approvatore: /);
    const fallback = page.getByText('Nessun approvatore configurato');
    await expect(approverLine.or(fallback).first()).toBeVisible({ timeout: 10_000 });
  });
});
