import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  adminRevokeLeave,
  apiGet,
  apiPost,
  assignShift,
  createShiftTemplate,
  deleteShiftTemplate,
  deleteStampAdmin,
  listLeaves,
  listStampsAdmin,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';
import { romeWallClockISO } from '../fixtures/time';

// Full-stack checks for orario flessibile (flextime), the flex lunch window and
// the per-weekday auto-deduct lunch. Seeds a template + assignment + stamps on a
// recent weekday and reads the anomalies the backend computes.
//
// NOTE: requires the backend deployed AND migration 039 applied on the target
// stack (new flex columns + shift_template_day_lunch). Gated like the other
// mutating specs.
const ENABLED = process.env.E2E_MUTATING === '1';
const API_BASE = process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it';
const WEEKDAYS = [1, 2, 3, 4, 5];

function lastWeekdayAt(hour: number, minute: number): { iso: string; date: string } {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  // Rome-local wall-clock: slot times are interpreted in the tenant timezone.
  return romeWallClockISO(d, hour, minute);
}

function flatSlots(start: string, end: string) {
  return WEEKDAYS.map((dow) => ({ day_of_week: dow, start_time: start, end_time: end }));
}

test.describe('web — Orario flessibile anomalies (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
  });

  async function anomalyKindsOn(date: string): Promise<string[]> {
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - 7);
    const params = new URLSearchParams({
      from: from.toISOString().slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
      user_id: user.userId,
    });
    const list = await apiGet<Array<{ kind: string; date: string }>>(
      admin.token,
      `/api/v1/shifts/anomalies?${params}`,
    );
    return list.filter((a) => a.date === date).map((a) => a.kind);
  }

  // Create template + assignment, seed stamps, run `assert(kinds)`, then clean
  // up everything regardless of the assertion outcome.
  async function withScenario(
    tplBody: Parameters<typeof createShiftTemplate>[1],
    validFrom: string,
    stamps: Array<{ event_type: string; occurred_at: string }>,
    assertKinds: (kinds: string[]) => void | Promise<void>,
  ): Promise<void> {
    // Isolation: approved leave on the seeded day suppresses presence anomalies.
    const overlapping = await listLeaves(admin.token, {
      scope: 'all',
      status: 'approved',
      user_id: user.userId,
      from: validFrom,
      to: validFrom,
    });
    for (const lv of overlapping) {
      await adminRevokeLeave(admin.token, lv.id, 'e2e flex isolation').catch(() => {});
    }

    // Isolation: clear any pre-existing stamps on the seeded day. Several other
    // mutating specs (mutating-anomalies-*) seed this same user on the same
    // "last weekday" and clean up best-effort (swallowed catch). A leftover
    // punch on this date would be re-evaluated under our template and surface
    // spurious late_clock_in / short_hours anomalies, so start the day empty.
    const staleStamps = await listStampsAdmin(admin.token, {
      user_id: user.userId,
      from: validFrom,
      to: validFrom,
    }).catch(() => [] as Awaited<ReturnType<typeof listStampsAdmin>>);
    for (const s of staleStamps) {
      await deleteStampAdmin(admin.token, s.id).catch(() => {});
    }

    const tpl = await createShiftTemplate(admin.token, tplBody);
    const stampIds: string[] = [];
    try {
      await assignShift(admin.token, {
        user_id: user.userId,
        shift_template_id: tpl.id,
        valid_from: validFrom,
      });
      for (const s of stamps) {
        const r = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
          user_id: user.userId,
          event_type: s.event_type,
          occurred_at: s.occurred_at,
          justification: 'e2e flex seed',
        });
        if (r.status !== 201 || !r.data) {
          throw new Error(`seed ${s.event_type} failed: ${r.status} ${r.code ?? ''}`);
        }
        stampIds.push(r.data.id);
      }
      await assertKinds(await anomalyKindsOn(validFrom));
    } finally {
      for (const id of stampIds) await deleteStampAdmin(admin.token, id).catch(() => {});
      await assignShift(admin.token, {
        user_id: user.userId,
        shift_template_id: null,
        valid_from: validFrom,
      }).catch(() => {});
      await deleteShiftTemplate(admin.token, tpl.id).catch(() => {});
    }
  }

  test('flextime: clock-in within the flex window is not late and not short', async () => {
    const din = lastWeekdayAt(9, 45);
    const out = lastWeekdayAt(17, 45);
    await withScenario(
      {
        name: `e2e-flex-in-${Date.now()}`,
        slots: flatSlots('09:00', '17:00'),
        flexible_enabled: true,
        flex_in_after_min: 60,
      },
      din.date,
      [
        { event_type: 'clock_in', occurred_at: din.iso },
        { event_type: 'clock_out', occurred_at: out.iso },
      ],
      (kinds) => {
        expect(kinds, `kinds=${kinds.join(',')}`).not.toContain('late_clock_in');
        expect(kinds, `kinds=${kinds.join(',')}`).not.toContain('short_hours');
      },
    );
  });

  test('flex lunch window: lunch stamped before the window is flagged', async () => {
    const ci = lastWeekdayAt(9, 0);
    const ls = lastWeekdayAt(11, 30);
    const le = lastWeekdayAt(12, 30);
    const co = lastWeekdayAt(18, 0);
    await withScenario(
      {
        name: `e2e-flex-lunch-${Date.now()}`,
        slots: WEEKDAYS.flatMap((dow) => [
          { day_of_week: dow, start_time: '09:00', end_time: '13:00' },
          { day_of_week: dow, start_time: '14:00', end_time: '18:00' },
        ]),
        flexible_enabled: true,
        flex_lunch_before_min: 30,
        flex_lunch_after_min: 30,
      },
      ci.date,
      [
        { event_type: 'clock_in', occurred_at: ci.iso },
        { event_type: 'lunch_start', occurred_at: ls.iso },
        { event_type: 'lunch_end', occurred_at: le.iso },
        { event_type: 'clock_out', occurred_at: co.iso },
      ],
      (kinds) => {
        expect(kinds, `kinds=${kinds.join(',')}`).toContain('lunch_outside_window');
      },
    );
  });

  test('auto-lunch: full presence minus the auto amount meets the target', async () => {
    const ci = lastWeekdayAt(9, 0);
    const co = lastWeekdayAt(17, 30);
    await withScenario(
      {
        name: `e2e-flex-autolunch-${Date.now()}`,
        slots: flatSlots('09:00', '17:30'),
        day_lunch: WEEKDAYS.map((dow) => ({ day_of_week: dow, lunch_min: 30 })),
      },
      ci.date,
      [
        { event_type: 'clock_in', occurred_at: ci.iso },
        { event_type: 'clock_out', occurred_at: co.iso },
      ],
      (kinds) => {
        expect(kinds, `kinds=${kinds.join(',')}`).not.toContain('short_hours');
      },
    );
  });
});
