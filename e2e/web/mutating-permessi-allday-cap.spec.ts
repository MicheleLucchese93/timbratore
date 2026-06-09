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

// The user's shift template caps how many hours a leave claims per day:
//  - an all-day permesso = the scheduled day length (8h here), NOT the ~24h
//    raw 00:00–23:59 span — and is exempt from the 15-min-multiple rule;
//  - a specific-time permesso is clipped but never exceeds the scheduled day;
//  - a request entirely outside the schedule (ferie on a Sunday) is rejected
//    because it covers 0 working hours.
//
// Proves end-to-end that the backend's computeDurationHours() caps permessi at
// the shift template and that all_day bypasses the 15-min validation.
const ENABLED = process.env.E2E_MUTATING === '1';
const API = process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it';

// Europe/Rome UTC offset ("+01:00"/"+02:00") for a YYYY-MM-DD, so we can pin
// 00:00–23:59 to a single Rome calendar day regardless of DST.
function romeOffset(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    timeZoneName: 'longOffset',
  }).format(d);
  return s.match(/GMT([+-]\d{2}:\d{2})/)?.[1] ?? '+01:00';
}

// A future date (≥ 8 days out) landing on the given ISO weekday (1=Mon..7=Sun).
function futureDow(targetDow: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 8);
  while ((d.getUTCDay() === 0 ? 7 : d.getUTCDay()) !== targetDow) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

async function durationOf(adminToken: string, userId: string, leaveId: string): Promise<number> {
  const r = await fetch(`${API}/api/v1/leaves?user_id=${userId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const body = (await r.json()) as {
    data?: Array<{ id: string; duration_hours: number | string }>;
  };
  const row = body.data?.find((x) => x.id === leaveId);
  expect(row, 'expected the seeded leave row to be listed').toBeDefined();
  return Number(row!.duration_hours);
}

test.describe('web — Permessi all-day cap + outside-schedule block (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let templateId: string | null = null;
  let valid_from: string;
  const leaveIds: string[] = [];

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);

    // Mon–Fri 09:00–17:00 (8h/day) shift template, assigned to test3 from today.
    const tpl = await createShiftTemplate(admin.token, {
      name: `e2e-allday-cap-${Date.now()}`,
      description: 'e2e permessi all-day cap test',
      slots: [1, 2, 3, 4, 5].map((dow) => ({
        day_of_week: dow,
        start_time: '09:00',
        end_time: '17:00',
      })),
    });
    templateId = tpl.id;
    valid_from = new Date().toISOString().slice(0, 10);
    await assignShift(admin.token, {
      user_id: user.userId,
      shift_template_id: templateId,
      valid_from,
    });
  });

  test.afterAll(async () => {
    for (const id of leaveIds) {
      await adminRevokeLeave(admin.token, id, 'e2e cleanup').catch(() => {});
    }
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

  test('all-day permesso on a working day = 8h (shift length), not the raw span', async () => {
    const day = futureDow(2); // a Tuesday
    const off = romeOffset(day);
    const created = await createLeave(user.token, {
      type: 'permessi',
      all_day: true,
      from_ts: `${day}T00:00:00${off}`,
      to_ts: `${day}T23:59:00${off}`,
      user_note: `e2e allday ${Date.now()}`,
    });
    leaveIds.push(created.id);
    const duration = await durationOf(admin.token, user.userId, created.id);
    expect(duration).toBe(8); // capped at the shift, NOT ~23.98h
  });

  test('specific-time permesso is capped at the scheduled day (9h asked → 8h)', async () => {
    const day = futureDow(3); // a Wednesday
    // 09:00–18:00 UTC sits inside one Rome day; a 9h, 15-min-aligned span on an
    // 8h shift → capped to 8h.
    const created = await createLeave(user.token, {
      type: 'permessi',
      all_day: false,
      from_ts: `${day}T09:00:00Z`,
      to_ts: `${day}T18:00:00Z`,
      user_note: `e2e clip-cap ${Date.now()}`,
    });
    leaveIds.push(created.id);
    const duration = await durationOf(admin.token, user.userId, created.id);
    expect(duration).toBe(8);
    expect(duration).not.toBe(9);
  });

  test('ferie entirely on a Sunday (non-working) is rejected — 0 working hours', async () => {
    const sunday = futureDow(7);
    const off = romeOffset(sunday);
    await expect(
      createLeave(user.token, {
        type: 'ferie',
        all_day: true,
        from_ts: `${sunday}T00:00:00${off}`,
        to_ts: `${sunday}T23:59:00${off}`,
        user_note: `e2e sunday ${Date.now()}`,
      }),
    ).rejects.toThrow(/lavorative/i);
  });
});
