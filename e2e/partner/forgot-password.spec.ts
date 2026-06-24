import { test, expect } from '@playwright/test';

// Public flow — drop the partner auth storageState so the app renders the
// login/forgot routes instead of redirecting straight into the console.
test.use({ storageState: { cookies: [], origins: [] } });

const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('partner · forgot password', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');

  test('login links to reset; submit shows an enumeration-safe confirmation', async ({ page }) => {
    await page.goto('/login');

    // Reachable from the login screen.
    await page.getByRole('link', { name: /Password dimenticata|Forgot password/ }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByText(/Inserisci la tua email|Enter your email/)).toBeVisible();

    // A clearly non-existent address: the backend always returns 200 and the UI
    // always shows the same confirmation, so nothing leaks whether it is registered.
    await page.locator('#email').fill(`e2e-noexist-${Date.now()}@e2e.local`);
    await page.getByRole('button', { name: /Invia link di reset|Send reset link/ }).click();

    await expect(
      page.getByText(/Se esiste un account|If an account exists/)
    ).toBeVisible();

    // Back link returns to the sign-in screen.
    await page.getByRole('link', { name: /Torna all'accesso|Back to sign in/ }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
