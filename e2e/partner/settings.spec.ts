import { test, expect } from '@playwright/test';

const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('partner · settings', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');

  test('Impostazioni language selector switches the UI', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /Impostazioni|Settings/ })).toBeVisible();

    // Switch to English → headings + nav re-render.
    await page.getByTestId('lang-en').click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Companies' })).toBeVisible();

    // Switch back to Italian.
    await page.getByTestId('lang-it').click();
    await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Aziende' })).toBeVisible();
  });

  // Non-mutating: exercises the Sicurezza complexity checklist + submit gating.
  // Never clicks "Aggiorna password" — that would change a real console password.
  test('Sicurezza: i requisiti password si attivano e abilitano il submit', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('lang-it').click(); // deterministic Italian labels
    await expect(page.getByText('Sicurezza')).toBeVisible();

    // The form now lives in a modal opened by the "Cambia password" button.
    await page.getByRole('button', { name: 'Cambia password' }).click();

    const current = page.getByLabel('Password attuale', { exact: true });
    const next = page.getByLabel('Nuova password', { exact: true });
    const confirm = page.getByLabel('Conferma nuova password', { exact: true });
    const submit = page.getByRole('button', { name: 'Aggiorna password' });

    await expect(page.locator('.pw-requirements li')).toHaveCount(5);
    await expect(submit).toBeDisabled();

    await next.fill('weak');
    await expect(page.locator('.pw-requirements li.valid')).not.toHaveCount(5);
    await expect(submit).toBeDisabled();

    await next.fill('NewPass1!');
    await expect(page.locator('.pw-requirements li.valid')).toHaveCount(5);

    await confirm.fill('Different1!');
    await expect(page.getByText('Le password non coincidono.')).toBeVisible();
    await expect(submit).toBeDisabled();

    await confirm.fill('NewPass1!');
    await current.fill('whatever-current');
    await expect(submit).toBeEnabled();
  });
});
