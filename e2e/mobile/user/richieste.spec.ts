import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../../fixtures/test-data';
import {
  assignQuota,
  closeAssignment,
  createQuotaTemplate,
  deleteQuotaTemplate,
  loadHandleFromStorage,
  type ApiHandle,
} from '../../fixtures/api-client';

const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('mobile — Richieste (employee, ferie/permessi/malattia)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Richieste' }).click();
  });

  test('shows both swipeable tabs: "Le mie" and "Da approvare"', async ({ page }) => {
    await expect(page.getByText('Le mie', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Da approvare/).first()).toBeVisible();
  });

  test('FAB opens the "Nuova richiesta" modal with Tipo / Dal / Al fields', async ({ page }) => {
    await page.getByLabel('Nuova richiesta').first().click();
    await expect(page.getByText('Nuova richiesta').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Tipo', { exact: true })).toBeVisible();
    await expect(page.getByText('Dal', { exact: true })).toBeVisible();
    await expect(page.getByText('Al', { exact: true })).toBeVisible();
  });

  test('Ferie + Permessi types show the "Durata" + "Tutto il giorno" widget', async ({ page }) => {
    await page.getByLabel('Nuova richiesta').first().click();
    await expect(page.getByText('Durata')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Tutto il giorno')).toBeVisible();
    await expect(page.getByText('Orario specifico')).toBeVisible();
  });

  test('Malattia type reveals the INPS protocol field and hides Durata', async ({ page }) => {
    await page.getByLabel('Nuova richiesta').first().click();
    await page.getByText('Malattia', { exact: true }).last().click();
    await expect(page.getByText('Numero protocollo INPS')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder('es. 1234567890')).toBeVisible();
    await expect(page.getByText('Durata')).toHaveCount(0);
  });

  test('submit button label tracks the selected type', async ({ page }) => {
    await page.getByLabel('Nuova richiesta').first().click();
    await expect(page.getByText('Invia richiesta')).toBeVisible({ timeout: 10_000 });
    await page.getByText('Malattia', { exact: true }).last().click();
    await expect(page.getByText('Invia segnalazione')).toBeVisible();
    await expect(page.getByText('Invia richiesta', { exact: true })).toHaveCount(0);
  });

  test('Assenza type marks Motivazione as optional (not "obbligatoria")', async ({ page }) => {
    // Motivazione for `assenza` is optional — neither label nor placeholder
    // should surface the "(obbligatoria)" marker, and the submit handler must
    // accept an empty note. Backend leaves.ts mirrors the same rule.
    await page.getByLabel('Nuova richiesta').first().click();
    await page.getByText('Assenza', { exact: true }).last().click();
    await expect(page.getByText('Motivazione (facoltativa)')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/\(obbligatoria\)/)).toHaveCount(0);
    await expect(page.getByPlaceholder(/Es\. funerale del nonno$/)).toBeVisible();
  });

  test('Assenza type reveals Tipologia + Retribuzione controls', async ({ page }) => {
    // Subtype picker + Retribuita/Non retribuita pair are the two required
    // choices left on assenza after motivazione became optional.
    await page.getByLabel('Nuova richiesta').first().click();
    await page.getByText('Assenza', { exact: true }).last().click();
    await expect(page.getByText('Tipologia di assenza')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Retribuzione', { exact: true })).toBeVisible();
    await expect(page.getByText('Retribuita', { exact: true })).toBeVisible();
    await expect(page.getByText('Non retribuita', { exact: true })).toBeVisible();
  });
});

// Quota-dependent assertions live here. We seed a known ferie quota
// assignment for test3 in beforeAll and clean it up in afterAll so the
// quota card + "Disponibili: …h" hint always have data to render.
test.describe('mobile — Richieste with seeded quota (employee)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable seeded specs');

  let admin: ApiHandle;
  let templateId: string | null = null;
  let assignmentId: string | null = null;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    const user = await loadHandleFromStorage(STORAGE.mobileUserAuth, CREDS.user);
    const tpl = await createQuotaTemplate(admin.token, {
      name: `e2e-quota-card-${Date.now()}`,
      type: 'ferie',
      hours_default: 0,
      accrual_amount: 0,
      accrual_frequency: 'monthly',
      accrual_day_of_month: 1,
    });
    templateId = tpl.id;
    const a = await assignQuota(admin.token, {
      user_id: user.userId,
      template_id: templateId,
      initial_balance: 40,
    });
    assignmentId = a.id;
  });

  test.afterAll(async () => {
    if (assignmentId) await closeAssignment(admin.token, assignmentId).catch(() => {});
    if (templateId) await deleteQuotaTemplate(admin.token, templateId).catch(() => {});
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbrature' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Richieste' }).click();
  });

  test('quota summary card lists Ferie + Permessi residuals', async ({ page }) => {
    // Card renders "Ferie" + "{residual_strict.toFixed(2)}h" after the
    // assignment we seeded. The "Residuo dopo richieste in attesa" hint
    // is opt-in on used_pending > 0 (RichiesteScreen.tsx:308) — we don't
    // seed a pending request, so just assert the main residual line.
    await expect(page.getByText('Ferie', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/40\.00h/).first()).toBeVisible();
  });

  test('quota hint surfaces "Disponibili: Xh" inside the new-request modal', async ({ page }) => {
    await page.getByLabel('Nuova richiesta').first().click();
    await expect(page.getByText(/Disponibili:.*h/)).toBeVisible({ timeout: 10_000 });
  });
});
