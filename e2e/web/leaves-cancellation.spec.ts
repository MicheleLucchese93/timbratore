import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  adminRevokeLeave,
  approveLeave,
  createLeave,
  loadHandleFromStorage,
  requestLeaveCancellation,
  type ApiHandle,
  type LeaveRow,
} from '../fixtures/api-client';

// Each scenario seeds the exact leave row it asserts on (via the API),
// then exercises the admin UI, then cleans up via admin-revoke. Gated by
// E2E_MUTATING because we write rows to the live test tenant.
const ENABLED = process.env.E2E_MUTATING === '1';

function futureWeekday(minOffset: number): { from: string; to: string } {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + minOffset);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(8, 0, 0, 0);
  const end = new Date(d);
  end.setUTCHours(16, 0, 0, 0);
  return { from: d.toISOString(), to: end.toISOString() };
}

test.describe('web — Leaves cancellation flow (admin side)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable seeded leaves cancellation specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  const created: LeaveRow[] = [];

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
  });

  test.afterAll(async () => {
    for (const lv of created) {
      await adminRevokeLeave(admin.token, lv.id, 'e2e cleanup').catch(() => {});
    }
  });

  test('cancellation-pending row exposes "Accetta/Rifiuta annullamento"', async ({ page }) => {
    const range = futureWeekday(120);
    let lv = await createLeave(user.token, {
      type: 'ferie',
      from_ts: range.from,
      to_ts: range.to,
      user_note: `e2e cancel-pending ${Date.now()}`,
    });
    lv = await approveLeave(admin.token, lv.id);
    lv = await requestLeaveCancellation(user.token, lv.id, 'cambio piano');
    created.push(lv);
    await page.goto('/leaves');
    await expect(page.getByRole('heading', { name: 'Ferie & Permessi' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Accetta annullamento' }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Rifiuta annullamento' }).first()).toBeVisible();
  });

  test('approved row shows the "Revoca" admin action', async ({ page }) => {
    const range = futureWeekday(125);
    let lv = await createLeave(user.token, {
      type: 'ferie',
      from_ts: range.from,
      to_ts: range.to,
      user_note: `e2e revoca ${Date.now()}`,
    });
    lv = await approveLeave(admin.token, lv.id);
    created.push(lv);
    await page.goto('/leaves');
    await expect(page.getByRole('heading', { name: 'Ferie & Permessi' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Revoca' }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('revoke dialog asks for "Motivo della revoca"', async ({ page }) => {
    const range = futureWeekday(130);
    let lv = await createLeave(user.token, {
      type: 'ferie',
      from_ts: range.from,
      to_ts: range.to,
      user_note: `e2e revoca-dialog ${Date.now()}`,
    });
    lv = await approveLeave(admin.token, lv.id);
    created.push(lv);
    await page.goto('/leaves');
    await expect(page.getByRole('button', { name: 'Revoca' }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Revoca' }).first().click();
    await expect(page.getByRole('heading', { name: /Revoca richiesta approvata/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('Motivo della revoca')).toBeVisible();
    // `Annulla` matches `Annulla` button AND `Accetta annullamento` /
    // `Rifiuta annullamento` icon-button titles. Use exact match.
    await page.getByRole('button', { name: 'Annulla', exact: true }).click();
  });
});

test.describe('web — Leaves status badges (seeded)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable seeded specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  const created: LeaveRow[] = [];

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
  });

  test.afterAll(async () => {
    for (const lv of created) {
      await adminRevokeLeave(admin.token, lv.id, 'e2e cleanup').catch(() => {});
    }
  });

  test('STATUS_LABEL renders an "In attesa" badge for pending row', async ({ page }) => {
    const range = futureWeekday(135);
    const lv = await createLeave(user.token, {
      type: 'ferie',
      from_ts: range.from,
      to_ts: range.to,
      user_note: `e2e status-pending ${Date.now()}`,
    });
    created.push(lv);
    await page.goto('/leaves');
    await expect(page.getByText('In attesa').first()).toBeVisible({ timeout: 15_000 });
  });

  test('"Sostituita da malattia" badge appears after malattia overlap', async ({ page }) => {
    const range = futureWeekday(140);
    // 1) Seed ferie + approve.
    let ferie = await createLeave(user.token, {
      type: 'ferie',
      from_ts: range.from,
      to_ts: range.to,
      user_note: `e2e supersede-ferie ${Date.now()}`,
    });
    ferie = await approveLeave(admin.token, ferie.id);
    created.push(ferie);
    // 2) Seed malattia overlapping same window — triggers applyMalattiaOverlap.
    const malattia = await createLeave(user.token, {
      type: 'malattia',
      from_ts: range.from,
      to_ts: range.to,
      inps_protocol: `e2e-${Date.now()}`,
      user_note: `e2e supersede-malattia ${Date.now()}`,
    });
    created.push(malattia);
    await page.goto('/leaves');
    await expect(page.getByText('Sostituita da malattia').first()).toBeVisible({ timeout: 15_000 });
  });
});
