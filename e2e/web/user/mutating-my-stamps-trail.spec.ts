import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../../fixtures/test-data';
import {
  apiPatch,
  apiPost,
  deleteStampAdmin,
  listStampsAdmin,
  loadHandleFromStorage,
  type ApiHandle,
} from '../../fixtures/api-client';

// The employee half of the contestation trail. An admin moves one of their
// punches and deletes another; /me/stamps must say so — otherwise the employee
// cannot dispute a change they were never shown.
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

test.describe('web — my stamps show admin amendments (employee, mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  const dateIso = todayLocal();

  // Distinct from the admin-side trail spec's 08:47/09:03/17:10. Both run on the
  // same shared tenant and the same day, and soft-deleted leftovers stay
  // visible with include_deleted — a shared time would make the row locators
  // below latch onto the other spec's residue.
  const ORIG = { h: 7, m: 41 };
  const MOVED = { h: 7, m: 58 };
  const REMOVED = { h: 16, m: 22 };

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);

    const ci = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_in',
      occurred_at: localIso(dateIso, ORIG.h, ORIG.m),
      justification: 'e2e my-trail seed',
    });
    const co = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_out',
      occurred_at: localIso(dateIso, REMOVED.h, REMOVED.m),
      justification: 'e2e my-trail seed',
    });
    await apiPatch(admin.token, `/api/v1/admin/stamps/${ci.data!.id}`, {
      occurred_at: localIso(dateIso, MOVED.h, MOVED.m),
      justification: 'e2e rettifica orario',
    });
    await deleteStampAdmin(admin.token, co.data!.id);
  });

  test.afterAll(async () => {
    const rows = await listStampsAdmin(admin.token, {
      user_id: user.userId,
      from: dateIso,
      to: dateIso,
    }).catch(() => []);
    for (const r of rows) await deleteStampAdmin(admin.token, r.id).catch(() => {});
  });

  test('the employee sees the notice, the original time and the deleted punch', async ({ page }) => {
    await page.goto('/me/stamps');
    await expect(page.getByRole('heading', { name: /Le mie timbrature/i })).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByTestId('my-stamps-changed-notice')).toBeVisible({ timeout: 15_000 });

    const movedRow = page.locator('.MuiDataGrid-row').filter({ hasText: '07:58' }).first();
    await expect(movedRow).toBeVisible();
    await expect(movedRow, 'the employee is shown what they actually stamped').toContainText('07:41');
    await expect(movedRow.getByTestId('edited-badge')).toBeVisible();

    const deletedRow = page.locator('.MuiDataGrid-row').filter({ hasText: '16:22' }).first();
    await expect(deletedRow).toBeVisible();
    await expect(deletedRow.getByTestId('deleted-badge')).toBeVisible();
  });

  test('the employee can open the trail of their own punch', async ({ page }) => {
    await page.goto('/me/stamps');
    const movedRow = page.locator('.MuiDataGrid-row').filter({ hasText: '07:58' }).first();
    await expect(movedRow).toBeVisible({ timeout: 15_000 });
    await movedRow.getByRole('button', { name: /Storico timbratura|Stamp history/ }).click();

    const modal = page.getByTestId('stamp-history-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('stamp-trail')).toContainText('e2e rettifica orario');
  });
});
