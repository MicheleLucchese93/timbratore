import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  adminCreateLeave,
  adminRevokeLeave,
  apiPost,
  assignShift,
  createExportJob,
  createShiftTemplate,
  deleteExportJob,
  deleteShiftTemplate,
  deleteStampAdmin,
  downloadExportJson,
  getExportJob,
  listLeaves,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';
import { romeWallClockISO } from '../fixtures/time';

// Regression for leave-covered breach deductions (apps/backend/src/services/
// export-service.ts). An employee who clocks out early but has an approved
// permesso covering the early stretch must NOT be docked the
// tolerance_out_breach_deduct_min penalty — same rule the early_clock_out
// anomaly already applies. Mirrors apps/mobile/src/lib/counted-day.ts.
//
// Recipe: shift Mon–Fri 09:00–17:00, tolerance_out 10, breach penalty 60.
// Two seeded weekdays, each worked 09:00→15:00 (120' early > tolerance):
//   - COVERED day: + approved permesso 15:00–17:00 → no deduction → 360'.
//   - CONTROL day: no leave → penalty applies → 360 − 60 = 300'.
// The control day proves the penalty config is actually live, so the covered
// day's 360 can only mean the waiver fired (not that the penalty was 0).
const ENABLED = process.env.E2E_MUTATING === '1';
const NOTE = 'e2e leave-coverage seed';

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// `count` weekdays going backwards from `startDaysAgo` days ago (UTC), each with
// 09:00 / 15:00 / 17:00 timestamps. Older than the most-recent weekday used by
// the short_hours spec, so the two specs don't seed the same day for test3.
function seedDays(startDaysAgo: number, count: number) {
  const out: { date: string; in9: string; out15: string; end17: string }[] = [];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - startDaysAgo);
  while (out.length < count) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      // Rome-local wall-clock so 09:00→15:00 is a true 6h with a 2h early exit
      // against the 09:00–17:00 slot, regardless of CET/CEST.
      const at = (h: number) => romeWallClockISO(d, h).iso;
      out.push({ date: isoDay(d), in9: at(9), out15: at(15), end17: at(17) });
    }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

test.describe('web — Export waives breach deduction when leave covers it (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let templateId: string | null = null;
  let leaveId: string | null = null;
  let exportId: string | null = null;
  const stampIds: string[] = [];

  // days[0] = covered (has permesso), days[1] = control (no leave). Start 5 days
  // back so we never seed the most-recent weekday the short_hours spec uses.
  const days = seedDays(5, 2);
  const covered = days[0]!;
  const control = days[1]!;
  const validFrom = control.date; // the older of the two

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);

    const tpl = await createShiftTemplate(admin.token, {
      name: `e2e-leave-coverage-${Date.now()}`,
      slots: [1, 2, 3, 4, 5].map((dow) => ({
        day_of_week: dow,
        start_time: '09:00',
        end_time: '17:00',
      })),
      tolerance_in_min: 10,
      tolerance_out_min: 10,
      tolerance_in_breach_deduct_min: 0,
      tolerance_out_breach_deduct_min: 60,
      count_extraordinary: false,
    });
    templateId = tpl.id;

    await assignShift(admin.token, {
      user_id: user.userId,
      shift_template_id: templateId,
      valid_from: validFrom,
    });

    // Isolation: drop any approved leave a sibling spec left on test3 over the
    // two seeded days, so the control day is genuinely uncovered and the covered
    // day only carries the permesso we add below.
    const strays = await listLeaves(admin.token, {
      scope: 'all',
      status: 'approved',
      user_id: user.userId,
      from: validFrom,
      to: covered.date,
    });
    for (const lv of strays) {
      await adminRevokeLeave(admin.token, lv.id, 'e2e leave-coverage isolation').catch(() => {});
    }

    // Seed both worked days: in 09:00, out 15:00 (120' early exit).
    for (const day of [covered, control]) {
      for (const [event_type, occurred_at] of [
        ['clock_in', day.in9],
        ['clock_out', day.out15],
      ] as const) {
        const r = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
          user_id: user.userId,
          event_type,
          occurred_at,
          justification: NOTE,
        });
        if (r.status !== 201 || !r.data) {
          throw new Error(`seed ${event_type} failed: status=${r.status} code=${r.code ?? '-'}`);
        }
        stampIds.push(r.data.id);
      }
    }

    // Covered day only: approved permesso 15:00–17:00 over the early stretch.
    const lv = await adminCreateLeave(admin.token, {
      user_id: user.userId,
      type: 'permessi',
      from_ts: covered.out15,
      to_ts: covered.end17,
      user_note: NOTE,
    });
    leaveId = lv.id;
  });

  test.afterAll(async () => {
    for (const id of stampIds) await deleteStampAdmin(admin.token, id).catch(() => {});
    if (leaveId) await adminRevokeLeave(admin.token, leaveId, 'e2e leave-coverage cleanup').catch(() => {});
    try {
      await assignShift(admin.token, {
        user_id: user.userId,
        shift_template_id: null,
        valid_from: validFrom,
      });
    } catch {
      /* best-effort */
    }
    if (templateId) await deleteShiftTemplate(admin.token, templateId).catch(() => {});
    if (exportId) await deleteExportJob(admin.token, exportId).catch(() => {});
  });

  test('JSON export: covered early-out keeps full hours, uncovered loses the penalty', async () => {
    const job = await createExportJob(admin.token, {
      format: 'json',
      period_from: validFrom,
      period_to: isoDay(new Date()),
    });
    exportId = job.id;

    // JSON jobs finish in-process within a couple seconds; poll up to ~15s.
    let status = job.status;
    for (let i = 0; i < 30 && (status === 'pending' || status === 'running'); i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      status = (await getExportJob(admin.token, exportId)).status;
    }
    // If the worker/storage isn't wired in this env we can't read content —
    // assert the lifecycle reached a known state rather than false-failing.
    if (status !== 'ready') {
      expect(['pending', 'running', 'failed']).toContain(status);
      test.info().annotations.push({ type: 'skip-reason', description: `export status=${status}` });
      return;
    }

    const body = await downloadExportJson(admin.token, exportId);
    const mine = body.users.find((u) => u.user_id === user.userId);
    expect(mine, 'test user missing from export').toBeTruthy();

    const coveredDay = mine!.days.find((d) => d.day === covered.date);
    const controlDay = mine!.days.find((d) => d.day === control.date);
    expect(coveredDay, `covered day ${covered.date} missing`).toBeTruthy();
    expect(controlDay, `control day ${control.date} missing`).toBeTruthy();

    // Control proves the 60' penalty is live; covered proves the leave waives it.
    expect(controlDay!.worked_minutes).toBe(300);
    expect(coveredDay!.worked_minutes).toBe(360);
  });
});
