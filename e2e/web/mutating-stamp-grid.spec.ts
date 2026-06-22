import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  apiPost,
  deleteStampAdmin,
  listStampsAdmin,
  loadHandleFromStorage,
  resolveDisplayName,
  type ApiHandle,
} from '../fixtures/api-client';

// Admin opens the monthly grid (Timbrature → "Griglia mensile"), and from a
// single user×day cell adds, edits and deletes that employee's punches. We seed
// a clock-in/clock-out for the e2e user TODAY (so the cell lands in the default
// current-month view), drive the cell editor through the UI, and verify each
// mutation landed via the admin stamps API. Cleanup wipes the day; global
// teardown also purges all test-tenant stamps.
const ENABLED = process.env.E2E_MUTATING === '1';

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// Build an absolute instant from local date + hour/minute, matching how the
// grid buckets stamps by their local calendar day.
function localIso(dateIso: string, hh: number, mm: number): string {
  const [y, mo, da] = dateIso.split('-').map(Number) as [number, number, number];
  return new Date(y, mo - 1, da, hh, mm, 0, 0).toISOString();
}

test.describe('web — Timbrature monthly grid (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  const dateIso = todayLocal();
  let ciId = '';
  let coId = '';

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    const ci = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_in',
      occurred_at: localIso(dateIso, 10, 0),
      justification: 'e2e grid seed',
    });
    const co = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_out',
      occurred_at: localIso(dateIso, 17, 0),
      justification: 'e2e grid seed',
    });
    expect(ci.status).toBe(201);
    expect(co.status).toBe(201);
    ciId = ci.data!.id;
    coId = co.data!.id;
  });

  test.afterAll(async () => {
    // Best-effort: remove every stamp this run left on the e2e user today
    // (seeded pair + the break added through the UI). Teardown purges anyway.
    const rows = await listStampsAdmin(admin.token, { user_id: user.userId, from: dateIso, to: dateIso }).catch(
      () => [],
    );
    for (const r of rows) await deleteStampAdmin(admin.token, r.id).catch(() => {});
  });

  test('cell shows seeded punches and supports add / edit / delete', async ({ page }) => {
    await page.goto('/stamps');
    await page.getByRole('tab', { name: 'Griglia mensile' }).click();
    const grid = page.getByTestId('stamp-grid');
    await expect(grid).toBeVisible({ timeout: 15_000 });

    // The e2e user is a column in the matrix. Its display_name drifts on the
    // shared tenant, so resolve the live value rather than pinning a literal.
    const userName = await resolveDisplayName(admin.token, CREDS.user.email);
    await expect(grid.getByText(userName).first()).toBeVisible();

    // Its today cell shows the seeded clock-in time; click to open the editor.
    const cell = page.locator(`[data-cell="${user.userId}:${dateIso}"]`);
    await expect(cell).toContainText('10:00');
    await cell.click();

    const editor = page.getByTestId('day-editor');
    await expect(editor).toBeVisible();
    await expect(editor.getByText(userName).first()).toBeVisible();

    // --- ADD: a break_start at 12:30 via the add form. ---
    const addForm = editor.getByTestId('add-stamp-form');
    await addForm.getByRole('combobox').first().selectOption('break_start');
    await addForm.locator('input[type="time"]').fill('12:30');
    await addForm.getByRole('button', { name: 'Aggiungi' }).click();
    await expect
      .poll(
        async () => {
          const rows = await listStampsAdmin(admin.token, { user_id: user.userId, from: dateIso, to: dateIso });
          return rows.some(
            (r) =>
              r.event_type === 'break_start' &&
              new Date(r.occurred_at).getTime() === new Date(localIso(dateIso, 12, 30)).getTime(),
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // --- EDIT: move the seeded clock-out from 17:00 to 18:00. ---
    const coRow = editor.locator(`form[data-stamp-id="${coId}"]`);
    await coRow.locator('input[type="time"]').fill('18:00');
    await coRow.getByRole('button', { name: 'Salva' }).click();
    await expect
      .poll(
        async () => {
          const rows = await listStampsAdmin(admin.token, { user_id: user.userId, from: dateIso, to: dateIso });
          const co = rows.find((r) => r.id === coId);
          return co ? new Date(co.occurred_at).getTime() === new Date(localIso(dateIso, 18, 0)).getTime() : false;
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // --- DELETE: remove the seeded clock-in. ---
    const ciRow = editor.locator(`form[data-stamp-id="${ciId}"]`);
    await ciRow.getByRole('button', { name: 'Elimina timbratura' }).click();
    await expect
      .poll(
        async () => {
          const rows = await listStampsAdmin(admin.token, { user_id: user.userId, from: dateIso, to: dateIso });
          return rows.some((r) => r.id === ciId);
        },
        { timeout: 15_000 },
      )
      .toBe(false);
  });
});
