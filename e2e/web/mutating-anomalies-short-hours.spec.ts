import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  adminRevokeLeave,
  apiPost,
  assignShift,
  createShiftTemplate,
  deleteShiftTemplate,
  deleteStampAdmin,
  listLeaves,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

// Seed a real `short_hours` anomaly so the Anomalie page renders the
// "Ore giornaliere insufficienti" KIND_LABEL plus the Correggi menu.
// Recipe (per apps/backend/src/routes/shifts.ts):
//   1. Shift template Mon–Fri 09:00–17:00 → expectedMin = 480.
//   2. Assign to test3 starting on the seeded day.
//   3. Insert clock_in 09:00 + clock_out 13:00 yesterday → workedMin = 240.
//   4. Shortfall 240 > default tolerance_out 10 → backend computes
//      `short_hours` when /api/v1/shifts/anomalies is queried.
const ENABLED = process.env.E2E_MUTATING === '1';
const API_BASE = process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it';

function lastWeekdayISOAt(hour: number, minute: number): { iso: string; date: string } {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  d.setUTCHours(hour, minute, 0, 0);
  return { iso: d.toISOString(), date: d.toISOString().slice(0, 10) };
}

test.describe('web — Anomalie short_hours via seeded under-worked day (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let templateId: string | null = null;
  let clockInId: string | null = null;
  let clockOutId: string | null = null;
  let validFrom: string;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);

    const tpl = await createShiftTemplate(admin.token, {
      name: `e2e-short-hours-${Date.now()}`,
      slots: [1, 2, 3, 4, 5].map((dow) => ({
        day_of_week: dow,
        start_time: '09:00',
        end_time: '17:00',
      })),
    });
    templateId = tpl.id;

    const inStamp = lastWeekdayISOAt(9, 0);
    const outStamp = lastWeekdayISOAt(13, 0);
    validFrom = inStamp.date;

    // Isolation: a sibling spec (mutating-malattia-overlap) can leave an
    // approved leave on test3 covering recent days. Approved leave legitimately
    // suppresses short_hours (it covers the day's expected hours), which would
    // mask this spec's seeded under-worked day. Revoke anything overlapping the
    // seeded day so we measure a clean day, independent of run order.
    const overlapping = await listLeaves(admin.token, {
      scope: 'all',
      status: 'approved',
      user_id: user.userId,
      from: validFrom,
      to: validFrom,
    });
    for (const lv of overlapping) {
      await adminRevokeLeave(admin.token, lv.id, 'e2e short_hours isolation').catch(() => {});
    }

    await assignShift(admin.token, {
      user_id: user.userId,
      shift_template_id: templateId,
      valid_from: validFrom,
    });

    const a = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_in',
      occurred_at: inStamp.iso,
      justification: 'e2e short_hours seed',
    });
    if (a.status !== 201 || !a.data) {
      throw new Error(`seed clock_in failed: status=${a.status} code=${a.code ?? '-'}`);
    }
    clockInId = a.data.id;

    const b = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_out',
      occurred_at: outStamp.iso,
      justification: 'e2e short_hours seed',
    });
    if (b.status !== 201 || !b.data) {
      throw new Error(`seed clock_out failed: status=${b.status} code=${b.code ?? '-'}`);
    }
    clockOutId = b.data.id;
  });

  test.afterAll(async () => {
    if (clockInId) await deleteStampAdmin(admin.token, clockInId).catch(() => {});
    if (clockOutId) await deleteStampAdmin(admin.token, clockOutId).catch(() => {});
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
  });

  test('API returns short_hours for the seeded day', async ({ request }) => {
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - 7);
    const to = new Date();
    const params = new URLSearchParams({
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      user_id: user.userId,
    });
    const res = await request.get(`${API_BASE}/api/v1/shifts/anomalies?${params}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(res.status()).toBe(200);
    const json = (await res.json()) as { data: Array<{ kind: string; date: string }> };
    const list = Array.isArray(json) ? (json as unknown as Array<{ kind: string; date: string }>) : json.data;
    const dayList = list.filter((a) => a.date === validFrom);
    const match = dayList.find((a) => a.kind === 'short_hours');
    expect(
      match,
      `expected short_hours anomaly on ${validFrom}; got ${JSON.stringify(dayList.map((a) => a.kind))} (clock_in=${clockInId}, clock_out=${clockOutId})`,
    ).toBeDefined();
  });

  test('Anomalie page renders the short_hours label and a Correggi menu', async ({ page }) => {
    await page.goto('/anomalies');
    await expect(page.getByRole('heading', { name: /Anomalie orario/i })).toBeVisible({ timeout: 15_000 });
    const label = page.getByText('Ore giornaliere insufficienti').first();
    await expect(label).toBeVisible({ timeout: 15_000 });

    // The anomaly row is the <li> carrying the KIND_LABEL.
    const row = page.locator('li', { hasText: 'Ore giornaliere insufficienti' }).first();
    const correggi = row.getByRole('button', { name: /Correggi/ });
    await expect(correggi).toBeVisible();
    await correggi.click();

    // short_hours has both punches, so "Timbratura standard" is not offered;
    // the leave-based corrections + a note are.
    const select = row.getByRole('combobox');
    await expect(select).toBeVisible();
    await expect(row.getByRole('option', { name: 'Inserisci ferie' })).toHaveCount(1);
    await expect(row.getByRole('option', { name: 'Inserisci permesso' })).toHaveCount(1);
    await expect(row.getByRole('option', { name: 'Giustifica con nota' })).toHaveCount(1);
  });
});
