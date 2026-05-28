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
    // Multiple "Permesso" text nodes may exist (leftover seeded leave notes
    // mention "permessi"). The modal chip is the LAST rendered one. Click
    // with `force: true` because sibling overlays (FAB, textarea) may
    // intercept pointer events.
    await page.getByText('Permesso', { exact: true }).last().click({ force: true });
    const approverLine = page.getByText(/^Approvatore: /);
    const fallback = page.getByText('Nessun approvatore configurato');
    await expect(approverLine.or(fallback).first()).toBeVisible({ timeout: 10_000 });
  });
});
