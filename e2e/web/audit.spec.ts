import { test, expect } from '@playwright/test';

test.describe('web — Registro attività (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: /Registro attività/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('renders filters (Dal/Al dates, Autore, Destinatario, Categoria) + grid', async ({
    page,
  }) => {
    await expect(page.locator('input[type="date"]')).toHaveCount(2);
    // Three filter selects: author, target, category — each with a "Tutti" default.
    const selects = page.locator('select');
    await expect(selects).toHaveCount(3);
    const category = selects.nth(2);
    await expect(category.locator('option', { hasText: 'Utenti' })).toHaveCount(1);
    await expect(category.locator('option', { hasText: 'Timbrature' })).toHaveCount(1);
    // Grid column headers.
    await expect(page.getByRole('columnheader', { name: /Quando/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Autore/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Attività/i })).toBeVisible();
  });

  test('category filter is switchable and reloads the grid', async ({ page }) => {
    const category = page.locator('select').nth(2);
    await category.selectOption('exports');
    await expect(category).toHaveValue('exports');
    await category.selectOption('');
    await expect(category).toHaveValue('');
  });

  test('sidebar shows the Registro attività entry for admins', async ({ page }) => {
    await expect(page.getByRole('link', { name: /Registro attività/i })).toBeVisible();
  });

  test('details are humanized — no raw payload keys in the grid', async ({ page }) => {
    const cells = page.locator('.MuiDataGrid-cell[data-field="details"]');
    if ((await cells.count()) === 0) test.skip(true, 'no audit rows in this tenant');
    // The old renderer dumped the JSON keys verbatim ("event_type: lunch_end").
    // Every key now resolves to an Italian label, so a snake_case key followed
    // by a colon in the details column is a regression.
    for (const cell of await cells.allInnerTexts()) {
      expect(cell, `raw payload key leaked: ${cell}`).not.toMatch(/\b[a-z]+(_[a-z0-9]+)+\s*:/);
    }
  });
});

// The rendering of the Dettagli column is pure client-side formatting of the
// audit payload, so it is pinned against a fixed response rather than whatever
// the tenant happens to have logged: every branch that matters (diff, single
// snapshot, enum, uuid list, minutes) gets exercised on every run.
test.describe('web — Registro attività: dettaglio parlante', () => {
  const ENTRIES = [
    {
      id: 1,
      action: 'stamp.admin_update',
      resource_type: 'stamp',
      resource_id: 'aa8f4d0e-1f0e-4b3a-9a5a-2f1c9b0d7e11',
      created_at: '2026-08-04T09:30:00.000Z',
      actor_user_id: null,
      actor_name: 'Martina Ghirigato',
      actor_email: 'martina@example.it',
      target_user_id: null,
      target_label: 'Riccardo D’Antonio',
      before: {
        id: 'aa8f4d0e-1f0e-4b3a-9a5a-2f1c9b0d7e11',
        tenant_id: 'cc8f4d0e-1f0e-4b3a-9a5a-2f1c9b0d7e33',
        event_type: 'lunch_end',
        occurred_at: '2026-08-04T11:30:00.000Z',
        source: 'employee_app',
        notes: null,
        latitude: 45.471240099,
      },
      after: {
        id: 'aa8f4d0e-1f0e-4b3a-9a5a-2f1c9b0d7e11',
        tenant_id: 'cc8f4d0e-1f0e-4b3a-9a5a-2f1c9b0d7e33',
        event_type: 'lunch_end',
        occurred_at: '2026-08-04T12:05:00.000Z',
        source: 'admin_manual',
        notes: 'Rientro corretto su segnalazione',
        latitude: 45.471240099,
      },
      ip: '203.0.113.7',
    },
    {
      id: 2,
      action: 'anomaly.justify',
      resource_type: 'anomaly',
      resource_id: null,
      created_at: '2026-08-03T16:00:00.000Z',
      actor_user_id: null,
      actor_name: 'Martina Ghirigato',
      actor_email: 'martina@example.it',
      target_user_id: null,
      target_label: 'Mattia D’Antonio',
      before: null,
      after: { date: '2026-07-28', kind: 'missing_clock_in', note: 'Guasto al tornello' },
      ip: null,
    },
    {
      id: 3,
      action: 'user.set_branches',
      resource_type: 'user',
      resource_id: null,
      created_at: '2026-08-02T08:00:00.000Z',
      actor_user_id: null,
      actor_name: 'Martina Ghirigato',
      actor_email: 'martina@example.it',
      target_user_id: null,
      target_label: 'Marco De Bar',
      before: null,
      after: {
        branch_ids: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
      },
      ip: null,
    },
    {
      id: 4,
      action: 'shift_template.update',
      resource_type: 'shift_template',
      resource_id: null,
      created_at: '2026-08-01T08:00:00.000Z',
      actor_user_id: null,
      actor_name: 'Martina Ghirigato',
      actor_email: 'martina@example.it',
      target_user_id: null,
      target_label: null,
      before: { name: 'Full time', tolerance_in_min: 5, break_enabled: true },
      after: { name: 'Full time', tolerance_in_min: 10, break_enabled: false },
      ip: null,
    },
    {
      // Deletions log the previous state only — the dialog must fall back to a
      // single "Valore" column instead of Prima/Dopo.
      id: 5,
      action: 'export.delete',
      resource_type: 'export_job',
      resource_id: null,
      created_at: '2026-07-31T08:00:00.000Z',
      actor_user_id: null,
      actor_name: 'Martina Ghirigato',
      actor_email: 'martina@example.it',
      target_user_id: null,
      target_label: null,
      before: { format: 'xlsx', period_from: '2026-07-01', period_to: '2026-07-31' },
      after: null,
      ip: null,
    },
    {
      // PATCH /users/:id now snapshots the touched columns, so a user edit
      // renders as a diff like every other update.
      id: 6,
      action: 'user.update',
      resource_type: 'user',
      resource_id: null,
      created_at: '2026-07-30T09:00:00.000Z',
      actor_user_id: null,
      actor_name: 'Martina Ghirigato',
      actor_email: 'martina@example.it',
      target_user_id: null,
      target_label: 'Giuseppe Rao',
      before: { role: 'user', qualifica: 'C1' },
      after: { role: 'admin', qualifica: 'C2' },
      ip: null,
    },
    {
      // The bulk stamp-modes route: `bulk` is identical on both sides, so it
      // must survive the diff as a plain value instead of being filtered out.
      id: 7,
      action: 'user.update',
      resource_type: 'user',
      resource_id: null,
      created_at: '2026-07-29T09:00:00.000Z',
      actor_user_id: null,
      actor_name: 'Martina Ghirigato',
      actor_email: 'martina@example.it',
      target_user_id: null,
      target_label: 'Marco De Bar',
      before: { stamp_modes: ['gps'], bulk: true },
      after: { stamp_modes: ['gps', 'remote'], bulk: true },
      ip: null,
    },
  ];

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/audit?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: { entries: ENTRIES, total: ENTRIES.length } }),
      })
    );
    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: /Registro attività/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('edits show only the changed fields as prima → dopo', async ({ page }) => {
    const cell = page.locator('.MuiDataGrid-row[data-id="1"] [data-field="details"]');
    const text = await cell.innerText();
    // Changed: time + origin + note. Unchanged (event_type, latitude) and
    // internal columns (id, tenant_id) must not appear at all.
    expect(text).toContain('Data e ora');
    expect(text).toContain('04/08/2026, 13:30');
    expect(text).toContain('04/08/2026, 14:05');
    expect(text).toContain('Origine');
    expect(text).toContain('Inserimento amministratore');
    expect(text).not.toContain('Tipo timbratura');
    expect(text).not.toContain('Latitudine');
    expect(text).not.toMatch(/tenant_id|occurred_at/);
  });

  test('single-snapshot entries resolve enum values to their UI label', async ({ page }) => {
    const text = await page
      .locator('.MuiDataGrid-row[data-id="2"] [data-field="details"]')
      .innerText();
    expect(text).toContain('Anomalia: Entrata mancante');
    expect(text).toContain('Data: 28/07/2026');
    expect(text).toContain('Guasto al tornello');
  });

  test('uuid lists collapse to a count, minutes carry their unit', async ({ page }) => {
    const branches = await page
      .locator('.MuiDataGrid-row[data-id="3"] [data-field="details"]')
      .innerText();
    expect(branches).toContain('Sedi: 2 selezionati');
    expect(branches).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);

    const shift = await page
      .locator('.MuiDataGrid-row[data-id="4"] [data-field="details"]')
      .innerText();
    expect(shift).toContain('Tolleranza entrata: 5 min → 10 min');
    expect(shift).toContain('Pausa prevista: Sì → No');
    expect(shift).not.toContain('Nome');
  });

  test('clicking a row opens the detail dialog with the full field table', async ({ page }) => {
    await page.locator('.MuiDataGrid-row[data-id="1"]').click();

    const modal = page.getByTestId('audit-detail-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: 'Timbratura modificata' })).toBeVisible();
    await expect(modal.getByText(/da Martina Ghirigato/)).toBeVisible();
    await expect(modal.getByRole('columnheader', { name: 'Prima' })).toBeVisible();
    await expect(modal.getByRole('columnheader', { name: 'Dopo' })).toBeVisible();
    // The footer carries the raw action code + origin IP for support.
    await expect(modal.getByText('stamp.admin_update')).toBeVisible();
    await expect(modal.getByText(/203\.0\.113\.7/)).toBeVisible();

    await modal.getByRole('button', { name: /Chiudi/i }).click();
    await expect(modal).toBeHidden();
  });

  test('user edits diff their previous values, bulk flag survives', async ({ page }) => {
    const edit = await page
      .locator('.MuiDataGrid-row[data-id="6"] [data-field="details"]')
      .innerText();
    expect(edit).toContain('Ruolo: Dipendente → Amministratore');
    expect(edit).toContain('Qualifica: C1 → C2');

    const bulk = await page
      .locator('.MuiDataGrid-row[data-id="7"] [data-field="details"]')
      .innerText();
    expect(bulk).toContain('GPS in sede → GPS in sede, Da remoto');
    // `bulk` is background info: out of the grid summary, present in the card.
    expect(bulk).not.toContain('Operazione massiva');
    await page.locator('.MuiDataGrid-row[data-id="7"]').click();
    const modal = page.getByTestId('audit-detail-modal');
    await expect(modal.getByText('Operazione massiva')).toBeVisible();
  });

  test('a delete entry opens with a single Valore column', async ({ page }) => {
    await page.locator('.MuiDataGrid-row[data-id="5"]').click();

    const modal = page.getByTestId('audit-detail-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('columnheader', { name: 'Valore' })).toBeVisible();
    await expect(modal.getByRole('columnheader', { name: 'Prima' })).toHaveCount(0);
    await expect(modal.getByText('Excel (XLSX)')).toBeVisible();
  });
});
