import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  apiGet,
  apiPatch,
  apiPost,
  deleteStampAdmin,
  listStampsAdmin,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

// The contestation trail: an admin moves one punch and deletes another, and
// every surface that a dispute would be argued from must show it — the list
// badges, the per-stamp history modal, the day dossier, and the employee's own
// view of their stamps. Guards the promise that the value an employee stamped
// is never silently replaced.
const ENABLED = process.env.E2E_MUTATING === '1';

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localIso(dateIso: string, hh: number, mm: number): string {
  const [y, mo, da] = dateIso.split('-').map(Number) as [number, number, number];
  return new Date(y, mo - 1, da, hh, mm, 0, 0).toISOString();
}

interface StampRow {
  id: string;
  event_type: string;
  occurred_at: string;
  original_occurred_at: string | null;
  edit_count: number;
  deleted_at: string | null;
  edited_by_name: string | null;
  deleted_by_name: string | null;
}

test.describe('web — stamp trail / day dossier (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  const dateIso = todayLocal();
  let movedId = '';
  let deletedId = '';

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);

    const ci = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_in',
      occurred_at: localIso(dateIso, 8, 47),
      justification: 'e2e trail seed',
    });
    const co = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_out',
      occurred_at: localIso(dateIso, 17, 10),
      justification: 'e2e trail seed',
    });
    expect(ci.status).toBe(201);
    expect(co.status).toBe(201);
    movedId = ci.data!.id;
    deletedId = co.data!.id;

    // The two mutations the whole spec is about.
    await apiPatch(admin.token, `/api/v1/admin/stamps/${movedId}`, {
      occurred_at: localIso(dateIso, 9, 3),
      justification: 'e2e badge non funzionante',
    });
    await deleteStampAdmin(admin.token, deletedId);
  });

  test.afterAll(async () => {
    const rows = await listStampsAdmin(admin.token, {
      user_id: user.userId,
      from: dateIso,
      to: dateIso,
    }).catch(() => []);
    for (const r of rows) await deleteStampAdmin(admin.token, r.id).catch(() => {});
  });

  test('API keeps the original value and the append-only trail', async () => {
    const moved = await apiGet<{ stamp: StampRow; events: Array<{ kind: string; justification: string | null; changes: Array<{ field: string; before: string | null; after: string | null }> }> }>(
      admin.token,
      `/api/v1/stamps/${movedId}/history`,
    );
    expect(moved.stamp.edit_count).toBe(1);
    expect(moved.stamp.original_occurred_at).not.toBeNull();
    expect(new Date(moved.stamp.original_occurred_at!).toISOString()).toBe(localIso(dateIso, 8, 47));
    expect(new Date(moved.stamp.occurred_at).toISOString()).toBe(localIso(dateIso, 9, 3));

    const edit = moved.events.find((e) => e.kind === 'admin_edit');
    expect(edit, 'the admin edit is in the trail').toBeTruthy();
    expect(edit!.justification).toBe('e2e badge non funzionante');
    const when = edit!.changes.find((c) => c.field === 'occurred_at');
    expect(when, 'the trail names the field that changed').toBeTruthy();
    expect(new Date(when!.before!).toISOString()).toBe(localIso(dateIso, 8, 47));

    const removed = await apiGet<{ stamp: StampRow; events: Array<{ kind: string }> }>(
      admin.token,
      `/api/v1/stamps/${deletedId}/history`,
    );
    expect(removed.stamp.deleted_at).not.toBeNull();
    expect(removed.events.some((e) => e.kind === 'admin_delete')).toBe(true);
  });

  test('day dossier returns the deleted punch too', async () => {
    const dossier = await apiGet<{ stamps: StampRow[] }>(
      admin.token,
      `/api/v1/stamps/day-dossier?user_id=${user.userId}&date=${dateIso}`,
    );
    const ids = dossier.stamps.map((s) => s.id);
    expect(ids).toContain(movedId);
    expect(ids, 'a deleted punch is exactly what a dispute is about').toContain(deletedId);
    expect(dossier.stamps.find((s) => s.id === deletedId)!.deleted_at).not.toBeNull();
  });

  test('an employee cannot read another member\'s dossier', async () => {
    await expect(
      apiGet(user.token, `/api/v1/stamps/day-dossier?user_id=${admin.userId}&date=${dateIso}`),
    ).rejects.toThrow(/403/);
  });

  test('list shows the modified badge, the original time and the deleted row', async ({ page }) => {
    await page.goto(`/stamps?`);
    await expect(page.getByRole('heading', { name: /Timbrature/i })).toBeVisible({ timeout: 15_000 });

    // Default range is the last 90 days, so today's seeds are already in.
    const movedRow = page.locator('.MuiDataGrid-row').filter({ hasText: '09:03' }).first();
    await expect(movedRow).toBeVisible({ timeout: 15_000 });
    await expect(movedRow).toContainText('08:47');
    await expect(movedRow.getByTestId('edited-badge')).toBeVisible();

    // Deleted punches only on request.
    await expect(page.locator('.MuiDataGrid-row').filter({ hasText: '17:10' })).toHaveCount(0);
    await page.getByTestId('show-deleted').check();
    const deletedRow = page.locator('.MuiDataGrid-row').filter({ hasText: '17:10' }).first();
    await expect(deletedRow).toBeVisible({ timeout: 15_000 });
    await expect(deletedRow.getByTestId('deleted-badge')).toBeVisible();
  });

  test('history modal shows original vs current and the reason', async ({ page }) => {
    await page.goto('/stamps');
    const movedRow = page.locator('.MuiDataGrid-row').filter({ hasText: '09:03' }).first();
    await expect(movedRow).toBeVisible({ timeout: 15_000 });
    await movedRow.getByTestId('stamp-action-history').click();

    const modal = page.getByTestId('stamp-history-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('original-vs-current')).toContainText('08:47');
    await expect(modal.getByTestId('original-vs-current')).toContainText('09:03');
    await expect(modal.getByTestId('stamp-trail')).toContainText('e2e badge non funzionante');
  });

  test('day dossier modal lists every punch of the day, deleted included', async ({ page }) => {
    await page.goto('/stamps');
    const movedRow = page.locator('.MuiDataGrid-row').filter({ hasText: '09:03' }).first();
    await expect(movedRow).toBeVisible({ timeout: 15_000 });
    await movedRow.getByTestId('stamp-action-dossier').click();

    const dossier = page.getByTestId('day-dossier');
    await expect(dossier).toBeVisible();
    await expect(dossier.locator(`[data-dossier-stamp="${movedId}"]`)).toBeVisible();
    await expect(dossier.locator(`[data-dossier-stamp="${deletedId}"]`)).toBeVisible();
    await expect(dossier.locator(`[data-dossier-stamp="${deletedId}"]`).getByTestId('deleted-badge')).toBeVisible();
  });

  test('the dossier PDF downloads', async ({ page }) => {
    await page.goto('/stamps');
    const movedRow = page.locator('.MuiDataGrid-row').filter({ hasText: '09:03' }).first();
    await expect(movedRow).toBeVisible({ timeout: 15_000 });
    await movedRow.getByTestId('stamp-action-dossier').click();
    await expect(page.getByTestId('day-dossier')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.getByRole('button', { name: /Scarica PDF|Download PDF/ }).click(),
    ]);
    expect(download.suggestedFilename()).toContain(dateIso);
  });
});
