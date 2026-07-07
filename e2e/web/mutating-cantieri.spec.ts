import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  loadHandleFromStorage,
  cantieriMe,
  createCantiereSite,
  deleteCantiereSite,
  setCantiereAssignments,
  createCantiereMezzo,
  deleteCantiereMezzo,
  setMezzoAssignments,
  createCantieriField,
  deleteCantieriField,
  createCantiereEntry,
  deleteCantiereEntry,
  getCantieriDashboard,
  getCantiereReportPdf,
  type ApiHandle,
  type CantiereSiteRecord,
  type CantiereMezzoRecord,
  type CantieriFieldDefRecord,
} from '../fixtures/api-client';

// Mutating coverage for the Cantieri module: seed sites/mezzi/custom fields via
// the API, log an activity entry, assert the admin UI + dashboard aggregates +
// PDF report, then delete everything created. Seeds are 'e2e-'-prefixed; the
// purge-fixtures endpoint wipes any residue at globalTeardown.
//
// The module must be provisioned on the test tenant (tenants.cantieri_enabled +
// cantieri_role='admin' on the admin test user). Until that happens on prod the
// suite skips itself instead of failing.
const ENABLED = process.env.E2E_MUTATING === '1';

// Local (Europe/Rome runner) calendar day/month, not UTC.
function localDate(): string {
  return new Date().toLocaleDateString('sv-SE');
}
function localMonth(): string {
  return localDate().slice(0, 7);
}

test.describe.configure({ mode: 'serial' });

test.describe('web — Cantieri: seed, UI, dashboard, PDF', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let ready = false;
  let site: CantiereSiteRecord | null = null;
  let uiSiteName: string | null = null;
  let mezzo: CantiereMezzoRecord | null = null;
  let field: CantieriFieldDefRecord | null = null;
  const entries: string[] = [];

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    const s = await cantieriMe(admin.token);
    ready = s.enabled && s.role === 'admin';
  });

  test.afterAll(async () => {
    if (!admin) return;
    for (const id of entries.splice(0)) {
      await deleteCantiereEntry(admin.token, id).catch(() => {});
    }
    if (field) await deleteCantieriField(admin.token, field.id).catch(() => {});
    if (mezzo) await deleteCantiereMezzo(admin.token, mezzo.id).catch(() => {});
    if (site) await deleteCantiereSite(admin.token, site.id).catch(() => {});
    if (uiSiteName) {
      // The UI-created site is looked up by name (the modal gives no id back).
      const { apiGet } = await import('../fixtures/api-client');
      const list = await apiGet<{ sites: Array<{ id: string; name: string }> }>(
        admin.token,
        '/api/v1/cantieri/sites',
      ).catch(() => ({ sites: [] as Array<{ id: string; name: string }> }));
      for (const s of list.sites.filter((x) => x.name === uiSiteName)) {
        await deleteCantiereSite(admin.token, s.id).catch(() => {});
      }
    }
  });

  test('API seed: site + entry custom field + mezzo + assignments', async () => {
    test.skip(!ready, 'cantieri module not provisioned on the test tenant yet');
    const stamp = Date.now();

    site = await createCantiereSite(admin.token, {
      name: `e2e-cantiere-${stamp}`,
      address: 'Via di Prova 1, Milano',
    });
    expect(site.status).toBe('open');

    field = await createCantieriField(admin.token, {
      scope: 'entry',
      label: `e2e-campo-${stamp}`,
      field_type: 'text',
    });
    expect(field.scope).toBe('entry');

    mezzo = await createCantiereMezzo(admin.token, { name: `e2e-mezzo-${stamp}` });

    await setCantiereAssignments(admin.token, site.id, [admin.userId]);
    await setMezzoAssignments(admin.token, mezzo.id, [admin.userId]);
  });

  test('UI: seeded site and mezzo are listed; modal creates a second site', async ({ page }) => {
    test.skip(!ready, 'cantieri module not provisioned on the test tenant yet');

    await page.goto('/cantieri');
    await expect(page.getByRole('heading', { name: 'Cantieri', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(site!.name)).toBeVisible();

    // Create a second site through the modal.
    uiSiteName = `e2e-cantiere-ui-${Date.now()}`;
    await page.getByRole('button', { name: 'Nuovo cantiere' }).click();
    await page.locator('form .input').first().fill(uiSiteName);
    await page.getByRole('button', { name: 'Salva' }).click();
    await expect(page.getByText(uiSiteName)).toBeVisible({ timeout: 10_000 });

    await page.goto('/cantieri/mezzi');
    await expect(page.getByText(mezzo!.name)).toBeVisible({ timeout: 10_000 });
  });

  test('entry feeds the dashboard aggregates and the PDF report', async ({ page }) => {
    test.skip(!ready, 'cantieri module not provisioned on the test tenant yet');
    const month = localMonth();

    const entry = await createCantiereEntry(admin.token, {
      cantiere_id: site!.id,
      entry_date: localDate(),
      travel_start: '08:00',
      travel_end: '08:30',
      activity_start: '08:30',
      activity_end: '12:30',
      activity_text: 'e2e-attività di prova',
      mezzo_id: mezzo!.id,
      custom_values: { [field!.key]: 'valore di prova' },
    });
    entries.push(entry.id);

    const dash = await getCantieriDashboard(admin.token, month);
    const row = dash.sites.find((s) => s.id === site!.id);
    expect(row, 'seeded site on the dashboard').toBeTruthy();
    expect(row!.entries_count).toBeGreaterThanOrEqual(1);
    expect(row!.travel_minutes).toBeGreaterThanOrEqual(30);
    expect(row!.activity_minutes).toBeGreaterThanOrEqual(240);

    await page.goto('/cantieri/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard cantieri' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(site!.name)).toBeVisible();

    const pdf = await getCantiereReportPdf(admin.token, site!.id, month);
    expect(pdf.status).toBe(200);
    expect(pdf.contentType).toContain('application/pdf');
    expect(pdf.magic).toBe('%PDF-');
  });
});
