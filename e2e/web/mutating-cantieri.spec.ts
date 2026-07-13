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
  getCantieriFields,
  createCantiereEntry,
  tryCreateCantiereEntry,
  deleteCantiereEntry,
  getCantieriDashboard,
  getCantiereReportPdf,
  sendCantiereReportEmail,
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

// Placeholder value for a required custom field, per its type. Lets the seed
// satisfy any required field defs the tenant already carries (e.g. a "Descrizione"
// mezzo field left over from manual testing) instead of failing 400 VALIDATION.
function placeholderFieldValue(f: CantieriFieldDefRecord): unknown {
  switch (f.field_type) {
    case 'number':
      return 1;
    case 'date':
      return localDate();
    case 'time':
      return '08:00';
    case 'boolean':
      return true;
    case 'select':
      return f.options?.[0] ?? 'e2e';
    default:
      return 'e2e';
  }
}

// custom_values covering every required field for a given scope, so a create
// does not depend on the tenant having zero required custom fields.
async function requiredFieldValues(
  token: string,
  scope: 'entry' | 'mezzo',
): Promise<Record<string, unknown>> {
  const { fields } = await getCantieriFields(token, scope);
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.required) values[f.key] = placeholderFieldValue(f);
  }
  return values;
}

test.describe.configure({ mode: 'serial' });

test.describe('web — Cantieri: seed, UI, dashboard, PDF', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let ready = false;
  let site: CantiereSiteRecord | null = null;
  let site2: CantiereSiteRecord | null = null;
  let uiSiteName: string | null = null;
  let mezzo: CantiereMezzoRecord | null = null;
  let field: CantieriFieldDefRecord | null = null;
  let field2: CantieriFieldDefRecord | null = null;
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
    if (field2) await deleteCantieriField(admin.token, field2.id).catch(() => {});
    if (mezzo) await deleteCantiereMezzo(admin.token, mezzo.id).catch(() => {});
    if (site) await deleteCantiereSite(admin.token, site.id).catch(() => {});
    if (site2) await deleteCantiereSite(admin.token, site2.id).catch(() => {});
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

    // Fill any required mezzo-scoped custom fields the tenant already carries
    // (manual-testing drift) so the create is not tenant-config-dependent.
    const mezzoFieldValues = await requiredFieldValues(admin.token, 'mezzo');
    mezzo = await createCantiereMezzo(admin.token, {
      name: `e2e-mezzo-${stamp}`,
      custom_values: mezzoFieldValues,
    });

    await setCantiereAssignments(admin.token, site.id, [admin.userId]);
    await setMezzoAssignments(admin.token, mezzo.id, [admin.userId]);
  });

  test('UI: seeded site and mezzo are listed; modal creates a second site', async ({ page }) => {
    test.skip(!ready, 'cantieri module not provisioned on the test tenant yet');

    // Sites list now lives at /cantieri/sites; /cantieri itself redirects to the
    // Dashboard tab (the module overview).
    await page.goto('/cantieri/sites');
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

    const entryFieldValues = await requiredFieldValues(admin.token, 'entry');
    const entry = await createCantiereEntry(admin.token, {
      cantiere_id: site!.id,
      entry_date: localDate(),
      travel_start: '08:00',
      travel_end: '08:30',
      activity_start: '08:30',
      activity_end: '12:30',
      activity_text: 'e2e-attività di prova',
      mezzo_id: mezzo!.id,
      custom_values: { ...entryFieldValues, [field!.key]: 'valore di prova' },
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
    // The site name also appears as an <option> in the "Filtra per cantiere"
    // select, so target the dashboard row button to avoid a strict-mode clash.
    await expect(page.getByRole('button', { name: site!.name })).toBeVisible();

    const pdf = await getCantiereReportPdf(admin.token, site!.id, month);
    expect(pdf.status).toBe(200);
    expect(pdf.contentType).toContain('application/pdf');
    expect(pdf.magic).toBe('%PDF-');
  });

  test('per-cantiere field scoping + report email with CC/BCC/note', async () => {
    test.skip(!ready, 'cantieri module not provisioned on the test tenant yet');
    const stamp = Date.now();

    // A second site with a custom field associated ONLY to it.
    site2 = await createCantiereSite(admin.token, { name: `e2e-cantiere2-${stamp}` });
    await setCantiereAssignments(admin.token, site2.id, [admin.userId]);
    field2 = await createCantieriField(admin.token, {
      scope: 'entry',
      label: `e2e-campo2-${stamp}`,
      field_type: 'text',
      cantiere_ids: [site2.id],
    });
    expect(field2.cantiere_ids).toEqual([site2.id]);

    // GET /fields echoes the association set.
    const { fields } = await getCantieriFields(admin.token, 'entry');
    expect(fields.find((f) => f.id === field2!.id)?.cantiere_ids).toEqual([site2!.id]);

    // The site2-only field is rejected on the FIRST site (not associated there)…
    const bad = await tryCreateCantiereEntry(admin.token, {
      cantiere_id: site!.id,
      entry_date: localDate(),
      custom_values: { [field2!.key]: 'x' },
    });
    expect(bad.status).toBe(400);

    // …but accepted on its own site.
    const okEntry = await createCantiereEntry(admin.token, {
      cantiere_id: site2!.id,
      entry_date: localDate(),
      custom_values: { [field2!.key]: 'y' },
    });
    entries.push(okEntry.id);

    // Report email with To/CC/BCC + an HTML note returns 200 (delivery to the
    // example.com sink is best-effort; the endpoint reports the send outcome).
    const res = await sendCantiereReportEmail(admin.token, site2!.id, {
      month: localMonth(),
      to: ['e2e-report@example.com'],
      cc: ['e2e-cc@example.com'],
      bcc: ['e2e-bcc@example.com'],
      note: '<p>e2e <strong>nota</strong> di prova</p>',
    });
    expect(res.status).toBe(200);
  });
});
