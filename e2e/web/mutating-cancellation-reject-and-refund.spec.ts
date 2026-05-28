import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  adminRevokeLeave,
  apiPost,
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

const ENABLED = process.env.E2E_MUTATING === '1';

function futureWeekday(offset: number): { from: string; to: string } {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(8, 0, 0, 0);
  const end = new Date(d);
  end.setUTCHours(16, 0, 0, 0);
  return { from: d.toISOString(), to: end.toISOString() };
}

test.describe('web — Cancellation reject path (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let leave: LeaveRow | null = null;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
  });

  test.afterEach(async () => {
    if (leave) await adminRevokeLeave(admin.token, leave.id, 'e2e cleanup').catch(() => {});
    leave = null;
  });

  test('admin Rifiuta annullamento → status back to approved', async () => {
    const range = futureWeekday(95);
    leave = await createLeave(user.token, {
      type: 'ferie',
      from_ts: range.from,
      to_ts: range.to,
      user_note: `e2e cancel-reject ${Date.now()}`,
    });
    leave = await approveLeave(admin.token, leave.id);
    leave = await requestLeaveCancellation(user.token, leave.id, 'cambio idea');
    expect(leave.status).toBe('cancellation_pending');
    const result = await decideLeaveCancellation(admin.token, leave.id, false, 'no');
    expect(result.status).toBe('approved');
    leave = result;
  });
});

test.describe('web — Quota refund on cancellation accept (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let templateId: string | null = null;
  let assignmentId: string | null = null;
  let shiftId: string | null = null;
  let leave: LeaveRow | null = null;
  let validFrom: string;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    // 1) Give test3 a known shift (Mon–Fri 8h) so duration_hours is
    //    deterministic.
    const shift = await createShiftTemplate(admin.token, {
      name: `e2e-refund-shift-${Date.now()}`,
      slots: [1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, start_time: '09:00', end_time: '17:00' })),
    });
    shiftId = shift.id;
    validFrom = new Date().toISOString().slice(0, 10);
    await assignShift(admin.token, {
      user_id: user.userId,
      shift_template_id: shiftId,
      valid_from: validFrom,
    });
    // 2) Give test3 a known ferie quota with initial_balance=40h.
    const tpl = await createQuotaTemplate(admin.token, {
      name: `e2e-refund-quota-${Date.now()}`,
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
    if (leave) await adminRevokeLeave(admin.token, leave.id, 'e2e cleanup').catch(() => {});
    if (assignmentId) await closeAssignment(admin.token, assignmentId).catch(() => {});
    if (templateId) await deleteQuotaTemplate(admin.token, templateId).catch(() => {});
    if (shiftId) {
      await assignShift(admin.token, {
        user_id: user.userId,
        shift_template_id: null,
        valid_from: validFrom,
      }).catch(() => {});
      await deleteShiftTemplate(admin.token, shiftId).catch(() => {});
    }
  });

  test('residual jumps back to pre-leave value after Accetta annullamento', async () => {
    // Initial residual = 40h.
    const before = await getMyQuotaSummary(user.token);
    const ferieBefore = before.find((q) => q.type === 'ferie');
    expect(ferieBefore?.residual_strict).toBe(40);

    // Approve a 1-day ferie (8h) → residual 32h.
    const range = futureWeekday(40);
    leave = await createLeave(user.token, {
      type: 'ferie',
      from_ts: range.from,
      to_ts: range.to,
      user_note: `e2e refund ${Date.now()}`,
    });
    leave = await approveLeave(admin.token, leave.id);
    const afterApprove = await getMyQuotaSummary(user.token);
    expect(afterApprove.find((q) => q.type === 'ferie')?.residual_strict).toBe(32);

    // Employee requests cancellation, admin accepts → residual back to 40h.
    leave = await requestLeaveCancellation(user.token, leave.id, 'cambio piano');
    const decided = await decideLeaveCancellation(admin.token, leave.id, true, 'ok');
    expect(decided.status).toBe('cancelled_post_approval');
    leave = decided;
    const afterRefund = await getMyQuotaSummary(user.token);
    expect(afterRefund.find((q) => q.type === 'ferie')?.residual_strict).toBe(40);
  });
});
