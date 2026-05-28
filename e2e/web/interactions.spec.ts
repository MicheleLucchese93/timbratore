import { test, expect } from '@playwright/test';

// Non-mutating UI interactions — filter changes, autosave reads, etc.
test.describe('web — Stamps DataGrid filter + sort', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/stamps');
    await expect(page.locator('.MuiDataGrid-root')).toBeVisible({ timeout: 15_000 });
  });

  test('column header click triggers a sort (MUI DataGrid)', async ({ page }) => {
    // MUI DataGrid headers are `role=columnheader`. Click "Data" or similar
    // to trigger a sort indicator (aria-sort attribute appears).
    const header = page.locator('.MuiDataGrid-columnHeader').filter({ hasText: /Data|Quando|Ora/ }).first();
    if (!(await header.count())) test.skip(true, 'no date column in DataGrid');
    await header.click();
    await expect(header).toHaveAttribute('aria-sort', /ascending|descending/, { timeout: 5_000 });
  });
});

test.describe('web — Settings timezone autosave', () => {
  test('changing timezone persists across reload', async ({ page }) => {
    await page.goto('/settings');
    const tz = page.locator('select').filter({ has: page.locator('option', { hasText: 'Europe/Rome' }) }).first();
    await expect(tz).toBeVisible({ timeout: 10_000 });
    const initial = await tz.inputValue();
    // Pick a different timezone, wait for autosave toast, reload, re-read.
    const candidates = ['Europe/Paris', 'Europe/Madrid', 'UTC'];
    const next = candidates.find((c) => c !== initial) ?? 'UTC';
    await tz.selectOption(next);
    await expect(page.getByText(/Impostazione salvata/i)).toBeVisible({ timeout: 10_000 });
    await page.reload();
    const tz2 = page.locator('select').filter({ has: page.locator('option', { hasText: 'Europe/Rome' }) }).first();
    await expect(tz2).toHaveValue(next, { timeout: 10_000 });
    // Restore initial so the tenant config is unchanged.
    await tz2.selectOption(initial);
    await expect(page.getByText(/Impostazione salvata/i)).toBeVisible({ timeout: 10_000 });
  });
});

// Web has no notification bell — the admin Dashboard surfaces pending
// items via the "Da approvare" inbox section (already covered by
// dashboard.spec.ts). Mobile has the bell (covered in
// mobile/interactions.spec.ts).

test.describe('web — Anomalie date range filter', () => {
  test('changing "from" date triggers a refetch (no console errors)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/anomalies');
    await expect(page.getByRole('heading', { name: /Anomalie orario/i })).toBeVisible({ timeout: 15_000 });
    const fromInput = page.locator('input[type="date"]').first();
    await fromInput.fill('2025-01-01');
    await page.waitForTimeout(1_000); // give the fetch a moment
    const fatal = errors.filter((e) => !/Failed to load resource|favicon|404/i.test(e));
    expect(fatal, fatal.join('\n')).toHaveLength(0);
  });
});

test.describe('web — Branches form field interactions', () => {
  test('toggling "Smart working" hides the radius-and-policy block', async ({ page }) => {
    await page.goto('/branches');
    await page.getByRole('button', { name: /Nuova sede/i }).click();
    await expect(page.getByRole('heading', { name: 'Nuova sede' })).toBeVisible({ timeout: 10_000 });
    // Smart working switch (input#sw). Read initial state, toggle, verify
    // the radius slider visibility changes.
    const sw = page.locator('input#sw');
    const initiallyChecked = await sw.isChecked();
    if (initiallyChecked) {
      // already smart-working → toggle to in-sede, expect radius visible
      await sw.click({ force: true });
      await expect(page.locator('input[type="range"]')).toBeVisible({ timeout: 5_000 });
    } else {
      // in-sede → toggle to smart, expect radius hidden
      await sw.click({ force: true });
      await expect(page.locator('input[type="range"]')).toHaveCount(0, { timeout: 5_000 });
    }
    await page.getByRole('button', { name: 'Annulla' }).click();
  });
});
