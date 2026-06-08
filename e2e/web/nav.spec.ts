import { test, expect } from '@playwright/test';

// Smoke-tests every sidebar link in adminNav. Each click must land on a
// reachable page (no blank-screen render error, no error boundary).
const ADMIN_PAGES: Array<{ label: string; url: RegExp; heading: RegExp | string }> = [
  { label: 'Dashboard', url: /\/$/, heading: 'Dashboard' },
  { label: 'Timbrature', url: /\/stamps$/, heading: /Timbrature/i },
  { label: 'Correzioni', url: /\/corrections$/, heading: /Correzioni/i },
  { label: 'Utenti', url: /\/users$/, heading: /Utenti/i },
  { label: 'Sedi', url: /\/branches$/, heading: /Sedi/i },
  { label: 'Orari', url: /\/shifts$/, heading: /Orari|Turni/i },
  { label: 'Anomalie', url: /\/anomalies$/, heading: /Anomalie/i },
  { label: 'Ferie & Permessi', url: /\/leaves$/, heading: /Ferie|Permessi/i },
  { label: 'Esportazioni', url: /\/exports$/, heading: /Esportazioni/i },
  { label: 'Impostazioni', url: /\/settings$/, heading: /Impostazioni/i },
];

test.describe('web — sidebar navigation', () => {
  for (const item of ADMIN_PAGES) {
    test(`navigates to ${item.label}`, async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: item.label, exact: true }).click();
      await expect(page).toHaveURL(item.url);
      await expect(page.getByRole('heading', { name: item.heading }).first()).toBeVisible({ timeout: 10_000 });
    });
  }
});
