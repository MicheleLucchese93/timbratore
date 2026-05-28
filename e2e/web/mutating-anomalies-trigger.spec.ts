import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  apiPost,
  assignShift,
  createShiftTemplate,
  deleteShiftTemplate,
  deleteStampAdmin,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

// Seed a real `late_clock_in` anomaly so the Anomalie page renders the
// `Entrata in ritardo` KIND_LABEL. Recipe (per
// apps/backend/src/routes/shifts.ts:543-559):
//   1. Shift template Mon–Fri 09:00–17:00, tolerance_in_min: 0 (any
//      lateness counts).
//   2. Assign to test3 starting today.
//   3. Insert a clock_in stamp for last weekday at 09:30 via the admin
//      manual route. delta = 30 min > 0 → backend computes a
//      `late_clock_in` anomaly when /api/v1/shifts/anomalies is queried.
const ENABLED = process.env.E2E_MUTATING === '1';

function lastWeekdayISOAt(hour: number, minute: number): { iso: string; date: string } {
  // Use a date in the recent past (yesterday or earlier this week) so
  // the default 30-day Anomalie filter picks it up. Skip weekends.
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  d.setUTCHours(hour, minute, 0, 0);
  return { iso: d.toISOString(), date: d.toISOString().slice(0, 10) };
}

test.describe('web — Anomalie KIND_LABEL via seeded late clock-in (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let templateId: string | null = null;
  let stampId: string | null = null;
  let validFrom: string;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    // 1) Strict-tolerance Mon–Fri 09:00–17:00 template.
    const tpl = await createShiftTemplate(admin.token, {
      name: `e2e-anomaly-shift-${Date.now()}`,
      slots: [1, 2, 3, 4, 5].map((dow) => ({
        day_of_week: dow,
        start_time: '09:00',
        end_time: '17:00',
      })),
    });
    templateId = tpl.id;
    // Yesterday's date — assignment must be valid_from <= the stamp date.
    const target = lastWeekdayISOAt(9, 30);
    validFrom = target.date;
    await assignShift(admin.token, {
      user_id: user.userId,
      shift_template_id: templateId,
      valid_from: validFrom,
    });
    // 2) Late stamp at 09:30 last weekday.
    const r = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_in',
      occurred_at: target.iso,
      justification: 'e2e anomaly seed',
    });
    if (r.status === 201 && r.data) stampId = r.data.id;
  });

  test.afterAll(async () => {
    if (stampId) await deleteStampAdmin(admin.token, stampId).catch(() => {});
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

  test('Anomalie page renders the seeded late_clock_in label', async ({ page }) => {
    await page.goto('/anomalies');
    await expect(page.getByRole('heading', { name: /Anomalie orario/i })).toBeVisible({ timeout: 15_000 });
    // The Anomalie page lazy-loads from the default 30-day range, which
    // includes yesterday. Wait for the matching KIND_LABEL.
    await expect(page.getByText('Entrata in ritardo').first()).toBeVisible({ timeout: 15_000 });
  });
});
