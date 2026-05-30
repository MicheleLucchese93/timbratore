import { test, expect } from '@playwright/test';

// Visual regression baselines. First run records the baselines under
// e2e/web/visual.spec.ts-snapshots/. Subsequent runs compare against the
// recorded image and fail on visible diffs.
//
// Update baselines with: `npx playwright test e2e/web/visual.spec.ts
// --update-snapshots`. Keep diffs intentional — review every regenerated
// baseline before committing.
test.describe('web — Visual regression baselines', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Dashboard layout', async ({ page }) => {
    await page.goto('/');
    const statGrid = page.locator('.dash-stat-grid');
    await expect(statGrid).toBeVisible({ timeout: 15_000 });
    // Screenshot only the fixed 6-card stat grid, NOT fullPage: the "Da
    // approvare" inbox and "Stato attuale" sections vary in height with
    // pending/user counts, which changed the full-page image dimensions
    // run-to-run (1114↔1171px) — the same instability that got the Utenti
    // baseline removed below. Card values are still masked.
    await expect(statGrid).toHaveScreenshot('dashboard.png', {
      mask: [page.locator('.stat-card-value')],
      maxDiffPixelRatio: 0.02,
    });
  });

  // Utenti DataGrid visual baseline removed — row count + content mutates
  // across runs (mutating CRUD specs invite/delete users), and even with
  // row masking the row-count delta produces a layout diff. The shape of
  // the page is exercised by `e2e/web/nav.spec.ts` and the a11y suite.
});

test.describe('web — Login visual baseline', () => {
  test.use({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1280, height: 800 },
  });

  test('login screen layout', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Accedi' })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveScreenshot('login.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});
