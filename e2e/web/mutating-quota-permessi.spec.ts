import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  adminRevokeLeave,
  approveLeave,
  assignQuota,
  assignShift,
  closeAssignment,
  createLeave,
  createQuotaTemplate,
  createShiftTemplate,
  decideLeaveCancellation,
  deleteQuotaTemplate,
  deleteShiftTemplate,
  getMyQuotaSummary,
  loadHandleFromStorage,
  requestLeaveCancellation,
  type ApiHandle,
  type LeaveRow,
} from '../fixtures/api-client';

// permessi-quota coverage. The ferie path is exercised by
// mutating-cancellation-reject-and-refund + the residui specs, but nothing
// drives a *permessi* quota. This locks down the behaviour unique to having two
// quota types active at once: consumption is type-matched (backend filters
// `lr.type = a.type` in lib/leave-quota.ts), so a permesso must draw down the
// permessi quota and leave the ferie quota untouched. Also covers the
// pending → approved → refund arithmetic for permessi.
//
// Pure API (no UI) so the numbers stay deterministic on the shared test tenant.
// permessi hours = clipped (to − from) within the Europe/Rome day
// (computeHoursPerDay), so a 09:00–11:00Z window is exactly 2.00h regardless of
// DST. test3 still gets a Mon–Fri 8h shift so the per-day cap admits the 2h
// permesso. Gated behind E2E_MUTATING like the other mutating specs.
const ENABLED = process.env.E2E_MUTATING === '1';

// The offset-th weekday in the future, with a fixed mid-day 2-hour UTC window.
// Counting weekdays (not calendar days) keeps the permesso on a working day;
// the far offset avoids colliding with the other leave specs' test3 seeds.
function futureWeekdayWindow(offset: number): { from: string; to: string } {
  const d = new Date();
  let count = 0;
  while (count < offset) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  const from = new Date(d);
  from.setUTCHours(9, 0, 0, 0);
  const to = new Date(d);
  to.setUTCHours(11, 0, 0, 0); // 2.00h permesso (15-min multiple)
  return { from: from.toISOString(), to: to.toISOString() };
}

test.describe('web — permessi quota: deduct + refund + type isolation (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let shiftId: string | null = null;
  let ferieTplId: string | null = null;
  let ferieAssignId: string | null = null;
  let permTplId: string | null = null;
  let permAssignId: string | null = null;
  let leave: LeaveRow | null = null;
  let validFrom: string;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);

    // Known Mon–Fri 8h shift so the per-day cap admits the 2h permesso.
    const shift = await createShiftTemplate(admin.token, {
      name: `e2e-perm-shift-${Date.now()}`,
      slots: [1, 2, 3, 4, 5].map((dow) => ({ day_of_week: dow, start_time: '09:00', end_time: '17:00' })),
    });
    shiftId = shift.id;
    validFrom = new Date().toISOString().slice(0, 10);
    await assignShift(admin.token, { user_id: user.userId, shift_template_id: shiftId, valid_from: validFrom });

    // Two active quotas: ferie (the control that must stay untouched) and
    // permessi (under test). Both start with no auto-accrual noise.
    const ferieTpl = await createQuotaTemplate(admin.token, {
      name: `e2e-perm-ferie-${Date.now()}`,
      type: 'ferie',
      hours_default: 0,
      accrual_amount: 0,
      accrual_frequency: 'monthly',
      accrual_day_of_month: 1,
    });
    ferieTplId = ferieTpl.id;
    ferieAssignId = (
      await assignQuota(admin.token, { user_id: user.userId, template_id: ferieTplId, initial_balance: 40 })
    ).id;

    const permTpl = await createQuotaTemplate(admin.token, {
      name: `e2e-perm-quota-${Date.now()}`,
      type: 'permessi',
      hours_default: 0,
      accrual_amount: 0,
      accrual_frequency: 'monthly',
      accrual_day_of_month: 1,
    });
    permTplId = permTpl.id;
    permAssignId = (
      await assignQuota(admin.token, { user_id: user.userId, template_id: permTplId, initial_balance: 8 })
    ).id;
  });

  test.afterAll(async () => {
    if (leave) await adminRevokeLeave(admin.token, leave.id, 'e2e cleanup').catch(() => {});
    if (permAssignId) await closeAssignment(admin.token, permAssignId).catch(() => {});
    if (ferieAssignId) await closeAssignment(admin.token, ferieAssignId).catch(() => {});
    if (permTplId) await deleteQuotaTemplate(admin.token, permTplId).catch(() => {});
    if (ferieTplId) await deleteQuotaTemplate(admin.token, ferieTplId).catch(() => {});
    if (shiftId) {
      await assignShift(admin.token, {
        user_id: user.userId,
        shift_template_id: null,
        valid_from: validFrom,
      }).catch(() => {});
      await deleteShiftTemplate(admin.token, shiftId).catch(() => {});
    }
  });

  test('a permesso draws down permessi only; cancellation refunds it', async () => {
    const win = futureWeekdayWindow(60);

    // Baseline: ferie 40, permessi 8.
    const before = await getMyQuotaSummary(user.token);
    expect(before.find((q) => q.type === 'ferie')?.residual_strict).toBe(40);
    expect(before.find((q) => q.type === 'permessi')?.residual_strict).toBe(8);

    // Pending 2h permesso → strict still 8, residual_with_pending drops to 6.
    leave = await createLeave(user.token, {
      type: 'permessi',
      from_ts: win.from,
      to_ts: win.to,
      user_note: `e2e permessi quota ${Date.now()}`,
    });
    const afterPending = await getMyQuotaSummary(user.token);
    const permPending = afterPending.find((q) => q.type === 'permessi');
    expect(permPending?.residual_strict).toBe(8);
    expect(permPending?.residual_with_pending).toBe(6);

    // Approve → permessi strict 6; ferie strict UNCHANGED at 40 (type isolation).
    leave = await approveLeave(admin.token, leave.id);
    const afterApprove = await getMyQuotaSummary(user.token);
    expect(afterApprove.find((q) => q.type === 'permessi')?.residual_strict).toBe(6);
    expect(afterApprove.find((q) => q.type === 'ferie')?.residual_strict).toBe(40);

    // Employee requests cancellation, admin accepts → permessi strict back to 8.
    leave = await requestLeaveCancellation(user.token, leave.id, 'e2e cambio piano');
    const decided = await decideLeaveCancellation(admin.token, leave.id, true, 'ok');
    expect(decided.status).toBe('cancelled_post_approval');
    leave = decided;
    const afterRefund = await getMyQuotaSummary(user.token);
    expect(afterRefund.find((q) => q.type === 'permessi')?.residual_strict).toBe(8);
  });
});
