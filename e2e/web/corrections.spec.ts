import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  createCorrection,
  deleteStampAdmin,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('web — Correzioni (admin) — static UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/corrections');
    await expect(page.getByRole('heading', { name: 'Correzioni' })).toBeVisible({ timeout: 10_000 });
  });

  test('page header copy is the admin variant', async ({ page }) => {
    await expect(
      page.getByText('Richieste dei dipendenti da approvare o rifiutare.'),
    ).toBeVisible();
  });

  test('status filter has "Solo in attesa" and "Tutte"', async ({ page }) => {
    const filter = page.locator('select').first();
    await expect(filter).toBeVisible();
    await expect(filter.locator('option', { hasText: 'Solo in attesa' })).toHaveCount(1);
    await expect(filter.locator('option', { hasText: 'Tutte' })).toHaveCount(1);
  });

  test('switching filter to Tutte does not throw', async ({ page }) => {
    await page.locator('select').first().selectOption({ label: 'Tutte' });
    await expect(page.getByRole('heading', { name: 'Correzioni' })).toBeVisible();
  });
});

test.describe('web — Correzioni (admin) — seeded pending row', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable seeded specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let marker: string;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
  });

  test.beforeEach(async () => {
    marker = `e2e-correction-${Date.now()}`;
    const branchId = admin.branches[0]?.id ?? null;
    await createCorrection(user.token, {
      original_stamp_id: null,
      claimed_event_type: 'clock_in',
      claimed_occurred_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
      claimed_branch_id: branchId,
      justification: `${marker}: avevo dimenticato di timbrare l'ingresso`,
    });
  });

  test.afterEach(async () => {
    // Best-effort: locate a stamp with our marker in notes (only present if
    // a previous run approved it). For a pending row, the seed remains as
    // 'pending' — admin-stamps DELETE is a no-op here; we leave the row
    // because there's no DELETE endpoint on correction_requests.
    try {
      const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const toDate = new Date().toISOString().slice(0, 10);
      const stamps = await fetch(
        `${process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it'}/api/v1/stamps?user_id=${user.userId}&from=${fromDate}&to=${toDate}`,
        { headers: { Authorization: `Bearer ${admin.token}` } },
      );
      const body = (await stamps.json()) as { data?: Array<{ id: string; notes?: string | null }> };
      const ours = body.data?.find((s) => (s.notes ?? '').includes(marker));
      if (ours) await deleteStampAdmin(admin.token, ours.id);
    } catch {
      /* best-effort */
    }
  });

  test('pending request card shows Approva and Rifiuta buttons', async ({ page }) => {
    await page.goto('/corrections');
    await expect(page.getByRole('heading', { name: 'Correzioni' })).toBeVisible({ timeout: 15_000 });
    const card = page.locator('.card', { hasText: marker }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByRole('button', { name: 'Approva' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Rifiuta' })).toBeVisible();
  });

  test('seeded request card has a Motivazione section', async ({ page }) => {
    await page.goto('/corrections');
    const card = page.locator('.card', { hasText: marker }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText('Motivazione', { exact: false })).toBeVisible();
  });
});
