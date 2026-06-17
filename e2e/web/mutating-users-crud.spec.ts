import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  apiGet,
  apiPost,
  deleteUser,
  inviteUser,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('web — Utenti CRUD (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let createdUserId: string | null = null;
  let email: string;

  test.beforeEach(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    email = `e2e-${Date.now()}@e2e.local`;
    const u = await inviteUser(admin.token, {
      email,
      role: 'user',
      first_name: 'E2E',
      last_name: 'Test',
    });
    createdUserId = u.user_id;
  });

  test.afterEach(async () => {
    if (createdUserId) {
      await deleteUser(admin.token, createdUserId).catch((e: Error) => {
        // eslint-disable-next-line no-console
        console.warn(`[afterEach] deleteUser ${createdUserId} failed: ${e.message}`);
      });
    }
    createdUserId = null;
  });

  test('invited user appears in the Utenti DataGrid', async ({ page }) => {
    await page.goto('/users');
    await expect(page.locator('.MuiDataGrid-root')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(email).first()).toBeVisible({ timeout: 15_000 });
  });

  test('deactivate → reactivate round-trip', async ({ page }) => {
    await apiPost(admin.token, `/api/v1/users/${createdUserId}/deactivate`, {});
    await apiPost(admin.token, `/api/v1/users/${createdUserId}/reactivate`, {});
    // Both calls must succeed (200).
    await page.goto('/users');
    await expect(page.getByText(email).first()).toBeVisible({ timeout: 15_000 });
  });

  test('invite with send_reset_email=false does not report a sent email', async () => {
    // The beforeEach invite omits the flag, so the helper default (false) applies.
    const u = await inviteUser(admin.token, {
      email: `e2e-nomail-${Date.now()}@e2e.local`,
      role: 'user',
    });
    try {
      expect(u.email_sent).toBe(false);
    } finally {
      await deleteUser(admin.token, u.user_id).catch(() => {});
    }
  });

  test('invite with send_reset_email=true reports the email was sent', async () => {
    const u = await inviteUser(admin.token, {
      email: `e2e-mail-${Date.now()}@e2e.local`,
      role: 'user',
      send_reset_email: true,
    });
    try {
      expect(u.email_sent).toBe(true);
    } finally {
      await deleteUser(admin.token, u.user_id).catch(() => {});
    }
  });

  test('reset-password endpoint returns 200 for a tenant member', async () => {
    const r = await apiPost(admin.token, `/api/v1/users/${createdUserId}/reset-password`, {});
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ sent: true, email });
  });

  test('reset-password action shows a confirmation in the Utenti grid', async ({ page }) => {
    await page.goto('/users');
    await expect(page.locator('.MuiDataGrid-root')).toBeVisible({ timeout: 15_000 });
    // Locate by data-id (stable under column virtualisation — the email cell
    // unrenders once we scroll right). The Utenti grid is wide (shift/approvers/
    // stamp-mode/branch columns), so the actions column is virtualised off the
    // right edge; scroll the body fully right to render the row's action
    // buttons before clicking reset-password.
    const row = page.locator(`.MuiDataGrid-row[data-id="${createdUserId}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.scrollIntoViewIfNeeded();
    await page
      .locator('.MuiDataGrid-virtualScroller')
      .evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
    const resetBtn = row.getByRole('button', {
      name: 'Invia email per reimpostare la password',
    });
    await resetBtn.scrollIntoViewIfNeeded();
    await resetBtn.click();
    await expect(
      page.getByText(`Email per reimpostare la password inviata a ${email}.`)
    ).toBeVisible({ timeout: 10_000 });
  });

  test('invite persists anagrafica (codice fiscale + matricola) and it round-trips', async () => {
    const cfEmail = `e2e-cf-${Date.now()}@e2e.local`;
    const cf = 'RSSMRA80A01H501U';
    const u = await inviteUser(admin.token, {
      email: cfEmail,
      role: 'user',
      first_name: 'CF',
      last_name: 'Test',
      codice_fiscale: cf,
      matricola: '0042',
    });
    try {
      const rows = await apiGet<
        Array<{ user_id: string; codice_fiscale: string | null; matricola: string | null }>
      >(admin.token, '/api/v1/users');
      const row = rows.find((r) => r.user_id === u.user_id);
      expect(row?.codice_fiscale).toBe(cf);
      expect(row?.matricola).toBe('0042');
    } finally {
      await deleteUser(admin.token, u.user_id).catch(() => {});
    }
  });

  test('hard-deleted user is removed from the visible list', async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByText(email).first()).toBeVisible({ timeout: 15_000 });
    await deleteUser(admin.token, createdUserId!);
    createdUserId = null;
    await page.reload();
    await expect(page.getByText(email)).toHaveCount(0, { timeout: 10_000 });
  });
});
