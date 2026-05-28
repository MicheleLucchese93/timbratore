import { test, expect } from '@playwright/test';
import { CREDS, URLS } from '../fixtures/test-data';

// Fresh context — bypass the saved storageState so the form is exercised.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('mobile — login', () => {
  test('renders branding + form', async ({ page }) => {
    await page.goto(URLS.mobile);
    await expect(page.getByText('Il tempo che lavori, semplice come dirlo.')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByPlaceholder('email@azienda.it')).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accedi' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Password dimenticata/i })).toBeVisible();
  });

  test('toggling Mostra password swaps the toggle label', async ({ page }) => {
    await page.goto(URLS.mobile);
    await page.getByPlaceholder('••••••••').fill('secret');
    // RN-Web doesn't surface `type=password`; assert the toggle's aria-label
    // flips from "Mostra password" → "Nascondi password" instead.
    const toggle = page.getByRole('button', { name: 'Mostra password' });
    await toggle.click();
    await expect(page.getByRole('button', { name: 'Nascondi password' })).toBeVisible();
  });

  test('client-side validation blocks empty submit', async ({ page }) => {
    await page.goto(URLS.mobile);
    await page.getByRole('button', { name: 'Accedi' }).click();
    await expect(page.getByText(/Inserisci l'email/i)).toBeVisible({ timeout: 5_000 });
  });

  test('signs in and lands on Timbrature', async ({ page }) => {
    await page.goto(URLS.mobile);
    await page.getByPlaceholder('email@azienda.it').fill(CREDS.admin.email);
    await page.getByPlaceholder('••••••••').fill(CREDS.admin.password);
    await page.getByRole('button', { name: 'Accedi' }).click();
    await expect(page.getByText('Ore lavorate', { exact: false })).toBeVisible({ timeout: 30_000 });
  });
});
