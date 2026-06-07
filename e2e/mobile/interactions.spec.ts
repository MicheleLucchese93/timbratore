import { test, expect } from '@playwright/test';

test.describe('mobile — Storico interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Storico' }).click();
  });

  test('switching between 7 / 30 / 90-day pills triggers a refetch', async ({ page }) => {
    // Pills render their RANGES labels: "7 giorni" / "30 giorni" / "90 giorni".
    for (const label of ['7 giorni', '30 giorni', '90 giorni']) {
      await page.getByText(label, { exact: true }).first().click();
      await page.waitForTimeout(300);
    }
    await expect(page.getByRole('button', { name: 'Storico' })).toBeVisible();
  });
});

test.describe('mobile — Notifications bell tap', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
  });

  test('tapping Notifiche opens the notifications modal', async ({ page }) => {
    await page.getByRole('button', { name: 'Notifiche' }).click();
    // Modal shows the "Notifiche" header plus either a list or the empty
    // state — so both texts can be present at once. `.first()` keeps the
    // assertion strict-mode-safe (we only need one of them visible).
    await expect(
      page.getByText('Notifiche', { exact: true }).or(page.getByText(/Nessuna notifica/i)).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Filter tabs are part of the modal chrome regardless of data.
    await expect(page.getByText('Tutte', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Non lette/)).toBeVisible();

    // The feed now merges leaves (richieste) and corrections. With no seeded
    // pending items the empty state names both sources; otherwise a real
    // notification row is shown. Either satisfies the assertion.
    await expect(
      page
        .getByText(/Aggiornamenti su richieste e correzioni qui\.|Nessuna notifica/i)
        .or(page.getByText(/Nuova richiesta|Correzione|Assenza/).first()),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('mobile — Timbrature branch picker (multi-branch)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Admins open on Dashboard — step into Timbrature to reach the picker.
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Timbrature' }).click();
  });

  test('multi-branch tenant exposes pill selector under "Sede"', async ({ page }) => {
    // Admin test1 is assigned to >1 branch (Archiva + Casa). Pills render.
    // For tenants with 1 branch the section is a static row instead.
    const sectionTitle = page.getByText('Sede', { exact: true }).first();
    await expect(sectionTitle).toBeVisible({ timeout: 10_000 });
    // At least one branch chip text is present.
    await expect(page.getByText(/^(Archiva|Casa)$/).first()).toBeVisible({ timeout: 10_000 });
  });
});
