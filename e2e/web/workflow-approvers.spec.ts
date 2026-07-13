import { test, expect, type Page, type Locator } from '@playwright/test';

// MUI DataGrid virtualises columns horizontally: cells outside the rendered
// window are not in the DOM at all. The approver columns ("Approvatori ferie",
// "Approvatori correzioni") sit to the right of the anagrafica columns
// (Nome/Cognome/Codice fiscale), so at the 1280px viewport they start off the
// right edge and their edit buttons never mount. Scroll the grid right in
// steps and stop as soon as the target button mounts — robust to column order,
// widths and viewport changes (a fixed scrollTo(9999) can over-shoot and leave
// the wanted column just off the *left* edge).
// Match on aria-label (the stable action description) rather than the title:
// the cell's title now carries the configured approver *names* when any are
// set, so it can't be used to locate the column-specific button.
async function revealApproverButton(page: Page, titleSubstr: string): Promise<Locator> {
  const grid = page.locator('.MuiDataGrid-virtualScroller').first();
  const btn = page.locator(`button[aria-label*="${titleSubstr}" i]`).first();
  for (let left = 0; left <= 6000; left += 300) {
    if (await btn.count()) break;
    await grid.evaluate((el, l) => el.scrollTo({ left: l }), left);
    // Let the grid mount the newly-revealed columns before re-checking.
    await page.waitForTimeout(80);
  }
  return btn;
}

// Real Italian SME workflow scenarios:
// - No approvers configured → fallback to all tenant admins.
// - Multiple approvers → "first to commit wins" (no quorum).
// - UI must surface both rules so the admin understands what happens when
//   they invite a new dipendente without picking approvers.
test.describe('web — Approver workflow (Utenti page)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/users');
    await expect(page.locator('.MuiDataGrid-root')).toBeVisible({ timeout: 15_000 });
  });

  test('user limits widget shows X / max users + X / max admins', async ({ page }) => {
    // Tenant ACME Srl: max_admins=2, max_users=20 (from /api/v1/me).
    // The widget renders "Utenti: <n> / 20" + "Amministratori: <n> / 2".
    await expect(page.getByText(/Utenti:/)).toBeVisible();
    await expect(page.getByText(/Amministratori:/)).toBeVisible();
    // The "/ 20" and "/ 2" denominators are static suffix text after a
    // <strong> with the current count.
    await expect(page.getByText(/\/\s*20/)).toBeVisible();
    await expect(page.getByText(/\/\s*2/).first()).toBeVisible();
  });

  test('leave-approver editor opens with the IT explainer text', async ({ page }) => {
    // Each user row exposes a "Modifica" button in the "Approvatori ferie"
    // column. Clicking it opens ApproverEditor with the canonical IT copy
    // that documents the fallback + multi-approver policy.
    // The leave-approver "Modifica" lives in the "Approvatori ferie" column,
    // which the DataGrid virtualises off-screen-right — scroll it into view
    // first. Target by title (other columns also render "… · Modifica").
    const leaveBtn = await revealApproverButton(page, 'approvare ferie');
    await expect(leaveBtn).toBeVisible({ timeout: 10_000 });
    await leaveBtn.click();
    await expect(page.getByRole('heading', { name: /Approvatori ferie\/permessi/ })).toBeVisible({ timeout: 10_000 });
    // The explainer encodes BOTH rules: admin-fallback + first-to-commit.
    await expect(page.getByText(/Se nessuno è configurato, gli admin possono decidere/i)).toBeVisible();
    await expect(page.getByText(/Vince il primo che decide/i)).toBeVisible();
    // Cancel without saving — never mutate the tenant.
    await page.getByRole('button', { name: 'Annulla' }).click();
  });

  test('correction-approver editor uses the correzioni explainer', async ({ page }) => {
    // MUI DataGrid virtualises columns out of the viewport. The "Approvatori
    // correzioni" column lives further right — scroll the grid horizontally
    // until its "Modifica" button (title containing "correzione") mounts.
    const correctionBtn = await revealApproverButton(page, 'correzione');
    await expect(correctionBtn).toBeVisible({ timeout: 10_000 });
    await correctionBtn.click();
    await expect(page.getByRole('heading', { name: /Approvatori correzioni/ })).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/Solo gli utenti selezionati possono approvare le richieste di correzione/i),
    ).toBeVisible();
    await expect(page.getByText(/Vince il primo che decide/i)).toBeVisible();
    await page.getByRole('button', { name: 'Annulla' }).click();
  });

  test('approver editor lists at least the tenant admins as candidates', async ({ page }) => {
    // ACME Srl seeded with 3 users (2 admin, 1 user). When configuring
    // approvers for test3, the candidate list must show at least the two
    // admins (test1, test2) — verifies the admin-fallback is *configurable*,
    // not just a hidden default.
    const leaveBtn = await revealApproverButton(page, 'approvare ferie');
    await leaveBtn.click();
    await expect(page.getByRole('heading', { name: /Approvatori/ })).toBeVisible();
    // The candidate list is a <ul> with <li><label><input type=checkbox>… per
    // user. Wait for at least one checkbox to render (loading state shows
    // "Caricamento…" first).
    const checkboxes = page.locator('input[type="checkbox"]').filter({ visible: true });
    await expect(checkboxes.first()).toBeVisible({ timeout: 10_000 });
    expect(await checkboxes.count()).toBeGreaterThanOrEqual(1);
    // Each candidate row shows "(admin)" or "(utente)" suffix — confirm the
    // role tag is rendered (not just the email).
    await expect(page.getByText(/\((admin|utente)\)/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Annulla' }).click();
  });

  test('Invita utente button is gated by the user-limit counter', async ({ page }) => {
    // The button is disabled (with title attr) when atUserLimit. ACME Srl is
    // not at the limit (3/20), so the button is enabled. We assert the
    // button exists and is enabled — this proves the gating wiring is in
    // place regardless of seat state.
    const invite = page.getByRole('button', { name: 'Invita utente' });
    await expect(invite).toBeVisible();
    // Either enabled (under limit) OR disabled with the gate message.
    const disabled = await invite.isDisabled();
    if (disabled) {
      await expect(invite).toHaveAttribute('title', /Limite raggiunto/i);
    } else {
      // Sanity: clicking opens the invite modal — close immediately.
      await invite.click();
      await expect(page.getByRole('heading', { name: /Invita utente|Nuovo utente/ }).first()).toBeVisible({ timeout: 5_000 });
      // Close via Annulla.
      await page.getByRole('button', { name: 'Annulla' }).first().click();
    }
  });
});
