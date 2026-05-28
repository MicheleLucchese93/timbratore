import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  adminRevokeLeave,
  assignShift,
  createLeave,
  createShiftTemplate,
  deleteShiftTemplate,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

// Italian CCNL practice: ferie are counted in *giorni lavorativi*, NOT
// calendar days. If a dipendente works Mon–Fri and requests ferie Mon→Mon
// (8 calendar days), only the 6 working days (Mon×2 + Tue + Wed + Thu +
// Fri) should be deducted from the quota. Saturday and Sunday have zero
// hours assigned in the shift template, so they must contribute 0h.
//
// This spec proves end-to-end that the backend's `computeDurationHours()`
// honours the user's shift template: 48h (= 6 × 8h), not 64h (= 8 × 8h).
const ENABLED = process.env.E2E_MUTATING === '1';

function nextMonday(): Date {
  const d = new Date();
  // ISO weekday: 1=Mon ... 7=Sun. Push forward to the *following* Monday
  // (>= 7 days out) so the test never clashes with today's date and
  // produces a stable 8-calendar-day Mon→Mon range.
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const daysToMon = ((8 - dow) % 7) || 7; // strictly > 0
  d.setUTCDate(d.getUTCDate() + daysToMon + 7); // push another week out
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

test.describe('web — Ferie weekend-skip via shift template (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let templateId: string | null = null;
  let leaveId: string | null = null;
  let valid_from: string;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);

    // 1) Create a Mon–Fri 09:00–17:00 (8h/day) shift template.
    const tpl = await createShiftTemplate(admin.token, {
      name: `e2e-mon-fri-${Date.now()}`,
      description: 'e2e weekend-skip test',
      slots: [1, 2, 3, 4, 5].map((dow) => ({
        day_of_week: dow,
        start_time: '09:00',
        end_time: '17:00',
      })),
    });
    templateId = tpl.id;

    // 2) Assign it to test3 starting today.
    valid_from = new Date().toISOString().slice(0, 10);
    await assignShift(admin.token, {
      user_id: user.userId,
      shift_template_id: templateId,
      valid_from,
    });
  });

  test.afterAll(async () => {
    if (leaveId) await adminRevokeLeave(admin.token, leaveId, 'e2e cleanup').catch(() => {});
    // Unassign the template from test3 (clears the active row).
    try {
      await assignShift(admin.token, {
        user_id: user.userId,
        shift_template_id: null,
        valid_from,
      });
    } catch {
      /* best-effort */
    }
    if (templateId) await deleteShiftTemplate(admin.token, templateId).catch(() => {});
  });

  test('Mon→Mon ferie on a Mon–Fri shift = 48h, NOT 64h', async () => {
    // Pick a Monday two weeks out, request ferie through to the following
    // Monday inclusive — 8 calendar days, 6 of them working days.
    const mon = nextMonday();
    const followingMon = new Date(mon);
    followingMon.setUTCDate(followingMon.getUTCDate() + 7);
    // Times-of-day are not material to ferie duration math — the backend
    // walks day-by-day. Use 00:00 → 23:59 to span both endpoints.
    const from = new Date(mon);
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(followingMon);
    to.setUTCHours(23, 59, 0, 0);

    const created = await createLeave(user.token, {
      type: 'ferie',
      from_ts: from.toISOString(),
      to_ts: to.toISOString(),
      user_note: `e2e weekend-skip ${Date.now()}`,
    });
    leaveId = created.id;

    // Re-fetch the row via the admin list endpoint to read the persisted
    // duration_hours value (not always echoed in the create response).
    const r = await fetch(
      `${process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it'}/api/v1/leaves?user_id=${user.userId}`,
      { headers: { Authorization: `Bearer ${admin.token}` } },
    );
    const body = (await r.json()) as { data?: Array<{ id: string; duration_hours: number | string }> };
    const ours = body.data?.find((row) => row.id === leaveId);
    expect(ours, 'expected the seeded leave row to be listed').toBeDefined();
    const duration = Number(ours!.duration_hours);
    expect(duration).toBe(48);
    // Negative assertion: ensure we did NOT accidentally count weekend days.
    expect(duration).not.toBe(64); // 8 × 8h
    expect(duration).not.toBe(56); // 7 × 8h
  });
});
