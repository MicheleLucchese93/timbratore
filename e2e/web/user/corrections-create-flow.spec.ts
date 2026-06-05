import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../../fixtures/test-data';
import {
  createCorrection,
  loadHandleFromStorage,
  rejectCorrection,
  type ApiHandle,
} from '../../fixtures/api-client';

const ENABLED = process.env.E2E_MUTATING === '1';

// Web parity with the mobile employee flow: an employee files a correction
// from /me/corrections. Walk the 3-step modal without submitting (no row).
test.describe('web — Correzioni create flow (employee, 3 steps)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/me/corrections');
    await expect(page.getByRole('heading', { name: 'Correzioni' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Nuova richiesta/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
  });

  test('step 1: modal opens on "Quale giorno?"', async ({ page }) => {
    await expect(page.getByRole('dialog').getByText('Quale giorno?')).toBeVisible();
  });

  test('step 1 → 2: Continua advances to the stamp picker', async ({ page }) => {
    await page.getByRole('button', { name: 'Continua' }).click();
    await expect(page.getByText(/Seleziona una timbratura da correggere/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole('button', { name: /Aggiungi una timbratura mancante/i }),
    ).toBeVisible();
  });

  test('step 2 → 3: "Aggiungi mancante" advances to the edit form', async ({ page }) => {
    await page.getByRole('button', { name: 'Continua' }).click();
    await page.getByRole('button', { name: /Aggiungi una timbratura mancante/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Tipo evento')).toBeVisible({ timeout: 10_000 });
    await expect(
      dialog.getByPlaceholder("Es. avevo dimenticato di timbrare l'uscita"),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Invia richiesta' })).toBeVisible();
  });
});

test.describe('web — Correzioni create flow submit (employee, via modal)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let marker: string;
  let createdId: string | null;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
  });

  test.beforeEach(() => {
    marker = `e2e-user-ui-${Date.now()}`;
    createdId = null;
  });

  test.afterEach(async () => {
    // Reject (admin) so the seeded row leaves the pending queue; teardown
    // marker-sweep wipes it. No DELETE endpoint exists for corrections.
    try {
      if (!createdId) {
        const list = await fetch(
          `${process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it'}/api/v1/correction-requests?status=pending`,
          { headers: { Authorization: `Bearer ${admin.token}` } },
        );
        const body = (await list.json()) as { data?: Array<{ id: string; justification?: string }> };
        createdId = body.data?.find((r) => (r.justification ?? '').includes(marker))?.id ?? null;
      }
      if (createdId) await rejectCorrection(admin.token, createdId);
    } catch {
      /* best-effort */
    }
  });

  test('employee submits a missing-stamp correction → pending row created', async ({ page }) => {
    await page.goto('/me/corrections');
    await expect(page.getByRole('heading', { name: 'Correzioni' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Nuova richiesta/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    const past = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await dialog.getByLabel('Data').fill(past);
    await page.getByRole('button', { name: 'Continua' }).click();
    await page.getByRole('button', { name: /Aggiungi una timbratura mancante/i }).click();
    await dialog
      .getByPlaceholder("Es. avevo dimenticato di timbrare l'uscita")
      .fill(`${marker}: ho dimenticato di timbrare`);
    await page.getByRole('button', { name: 'Invia richiesta' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    // The employee can see their own request via the list endpoint.
    const list = await fetch(
      `${process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it'}/api/v1/correction-requests?status=pending`,
      { headers: { Authorization: `Bearer ${user.token}` } },
    );
    const body = (await list.json()) as {
      data?: Array<{ id: string; justification?: string; status: string }>;
    };
    const ours = body.data?.find((r) => (r.justification ?? '').includes(marker));
    expect(ours, `expected pending correction matching marker ${marker}`).toBeDefined();
    createdId = ours!.id;
    expect(ours!.status).toBe('pending');
  });

  test('employee does NOT see Approva/Rifiuta on their own pending request', async ({ page }) => {
    // Seed a pending request owned by the employee, via the API.
    const branchId = user.branches[0]?.id ?? null;
    const row = await createCorrection(user.token, {
      original_stamp_id: null,
      claimed_event_type: 'clock_in',
      claimed_occurred_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      claimed_branch_id: branchId,
      justification: `${marker}: richiesta propria`,
    });
    createdId = row.id;
    await page.goto('/me/corrections');
    await expect(page.getByRole('heading', { name: 'Correzioni' })).toBeVisible({ timeout: 15_000 });
    const card = page.locator('.card', { hasText: marker }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    // You never decide your own request — no action buttons, just a status badge.
    await expect(card.getByRole('button', { name: 'Approva' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Rifiuta' })).toHaveCount(0);
    await expect(card.getByText('In attesa')).toBeVisible();
  });
});
