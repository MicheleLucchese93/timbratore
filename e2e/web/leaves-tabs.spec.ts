import { test, expect } from '@playwright/test';

test.describe('web — Ferie & Permessi tabs (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/leaves');
    await expect(page.getByRole('heading', { name: 'Ferie & Permessi' })).toBeVisible({ timeout: 15_000 });
  });

  test('renders all five tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Richieste', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Calendario', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quote', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Modelli', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Residui', exact: true })).toBeVisible();
  });

  test('Residui tab shows the employee balances roster', async ({ page }) => {
    await page.getByRole('button', { name: 'Residui', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Residui dipendenti' })).toBeVisible({ timeout: 10_000 });
  });

  test('"+ Nuova richiesta" lets the admin file a self-request', async ({ page }) => {
    // Default tab is Richieste. The admin can submit their own leave, mirroring
    // the mobile flow — same modal the employee page uses.
    await page.getByRole('button', { name: /Nuova richiesta/i }).click();
    await expect(page.getByRole('heading', { name: 'Nuova richiesta' })).toBeVisible({ timeout: 10_000 });
    // "Invia richiesta" is unique to the modal ("Tipo" would also match the
    // Richieste DataGrid column header).
    await expect(page.getByRole('button', { name: 'Invia richiesta' })).toBeVisible();
    await page.getByRole('button', { name: 'Annulla', exact: true }).click();
  });

  test('Richieste DataGrid lists the expected columns', async ({ page }) => {
    // Default tab is "Richieste". Wait for the DataGrid to render.
    const grid = page.locator('.MuiDataGrid-root');
    await expect(grid).toBeVisible({ timeout: 15_000 });
    for (const col of ['Utente', 'Tipo', 'Periodo', 'Ore', 'Stato']) {
      await expect(grid.getByRole('columnheader', { name: col })).toBeVisible();
    }
  });

  test('Quote tab shows the quota grid with Saldo headers', async ({ page }) => {
    await page.getByRole('button', { name: 'Quote', exact: true }).click();
    // QuotaGrid header cells: "Saldo ferie", "Accredito ferie",
    // "Saldo permessi", "Accredito permessi".
    await expect(page.getByText('Saldo ferie', { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Saldo permessi', { exact: false })).toBeVisible();
  });

  test('Quote tab → single-row select reveals the bulk "Assegna quota" action', async ({ page }) => {
    await page.getByRole('button', { name: 'Quote', exact: true }).click();
    const grid = page.locator('.MuiDataGrid-root');
    await expect(grid).toBeVisible({ timeout: 15_000 });
    // Tick the first row's selection checkbox → the bulk bar appears.
    await grid.locator('.MuiDataGrid-row').first().getByRole('checkbox').check();
    const bulkAssign = page.getByRole('button', { name: 'Assegna quota', exact: true });
    await expect(bulkAssign).toBeVisible({ timeout: 10_000 });
    // The bulk dialog reuses the assign form fields (type + initial balance).
    await bulkAssign.click();
    await expect(page.getByText('Bilancio iniziale (ore)')).toBeVisible({ timeout: 10_000 });
    // Two "Annulla" buttons exist (bulk bar + modal); scope to the modal form.
    await page.locator('form').getByRole('button', { name: 'Annulla', exact: true }).click();
  });

  test('Quote tab → header "select all" also reveals the bulk action', async ({ page }) => {
    // Regression guard: MUI's header select-all returns an exclude-style model
    // ({type:'exclude', ids:∅}), so the bar must resolve selection against the
    // row list rather than trusting ids.size.
    await page.getByRole('button', { name: 'Quote', exact: true }).click();
    const grid = page.locator('.MuiDataGrid-root');
    await expect(grid).toBeVisible({ timeout: 15_000 });
    // The header checkbox input is tabindex=-1; click the MUI ButtonBase span.
    await grid.locator('.MuiDataGrid-columnHeaderCheckbox .MuiButtonBase-root').click();
    await expect(page.getByRole('button', { name: 'Assegna quota', exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('Modelli tab → Nuovo modello dialog has frequency radios', async ({ page }) => {
    await page.getByRole('button', { name: 'Modelli', exact: true }).click();
    await page.getByRole('button', { name: /Nuovo modello/i }).click();
    // The template dialog asks for accrual frequency: Mensile vs Annuale.
    await expect(page.getByText('Mensile')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Annuale')).toBeVisible();
  });
});

test.describe('web — Ferie & Permessi: negative quota policy', () => {
  test('quota-assign dialog shows the "Può essere negativo" helper', async ({ page }) => {
    // Open Quote tab and click any "Assegna" button to open the assign
    // dialog. Helper text "Può essere negativo." is the canonical signal
    // that employees can start in the red.
    await page.goto('/leaves');
    await page.getByRole('button', { name: 'Quote', exact: true }).click();
    const assegna = page.getByRole('button', { name: 'Assegna' }).first();
    await expect(assegna).toBeVisible({ timeout: 15_000 });
    await assegna.click();
    await expect(page.getByText('Bilancio iniziale (ore)')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Può essere negativo/i)).toBeVisible();
  });

  test('quota-assign accepts a negative initial balance value', async ({ page }) => {
    // The field is a plain <input type=number> with step="0.25" and no min,
    // so the browser will not reject "-8". Confirm the value persists
    // without submitting (no mutation against the test tenant).
    await page.goto('/leaves');
    await page.getByRole('button', { name: 'Quote', exact: true }).click();
    const assegna = page.getByRole('button', { name: 'Assegna' }).first();
    await expect(assegna).toBeVisible({ timeout: 15_000 });
    await assegna.click();
    const input = page.locator('input[type="number"]').first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('-8');
    await expect(input).toHaveValue('-8');
    await page.getByRole('button', { name: 'Annulla' }).click();
  });
});
