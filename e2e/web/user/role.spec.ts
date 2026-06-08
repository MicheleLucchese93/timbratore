import { test, expect } from '@playwright/test';

test.describe('web — employee role (test3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('sidebar shows only the 3 employee items', async ({ page }) => {
    // Must be present.
    for (const label of ['Dashboard', 'Le mie timbrature', 'Le mie richieste', 'Ferie & Permessi']) {
      await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    // Residui is no longer a sidebar entry — it moved into a tab of Ferie & Permessi.
    await expect(page.getByRole('link', { name: 'Residui', exact: true })).toHaveCount(0);
    // Must NOT be present.
    for (const adminOnly of ['Utenti', 'Sedi', 'Esportazioni', 'Impostazioni', 'Anomalie', 'Orari']) {
      await expect(page.getByRole('link', { name: adminOnly, exact: true })).toHaveCount(0);
    }
  });

  test('sidebar footer shows the Dipendente role label', async ({ page }) => {
    // sidebar-user-role <div> reads "Dipendente" for non-admins (vs
    // "Amministratore" for admins).
    await expect(page.getByText('Dipendente', { exact: true })).toBeVisible();
  });

  test('/ lands on MyDashboard with personalised greeting', async ({ page }) => {
    // Email prefix "test3" → "Ciao, test3" (no last_name fallback on backend).
    await expect(page.getByRole('heading', { name: /Ciao,/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ultime timbrature' })).toBeVisible();
  });

  test('admin-only nav links are absent from the sidebar', async ({ page }) => {
    // The strongest role-gating signal we can assert cheaply: the user-role
    // Layout never renders admin nav items. Routes themselves redirect via
    // the catch-all in App.tsx, but exercising that round-trip is fragile
    // because the bootstrap bounces through /login during the GoTrue
    // refresh — see the "session bootstrap" notes in summary.md.
    // NB: 'Ferie & Permessi' is NOT admin-only — employees have it on web
    // (self-request + own residuals via the Residui tab). Keep it out of this list.
    const adminOnly = ['Utenti', 'Sedi', 'Esportazioni', 'Impostazioni', 'Anomalie', 'Orari'];
    for (const label of adminOnly) {
      await expect(
        page.getByRole('link', { name: label, exact: true }),
      ).toHaveCount(0);
    }
  });
});
