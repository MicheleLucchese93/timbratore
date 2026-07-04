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
  loadHandleFromStorage,
  resolveDisplayName,
  type ApiHandle,
} from '../fixtures/api-client';
import { romeWallClockISO } from '../fixtures/time';

// Exercises the bulk multi-select correction on the Anomalie page (the "select
// similar anomalies → apply the same correction" flow added to Anomalies.tsx).
// Two UI-driven cases, each over its own narrow date band so "Seleziona tutte"
// selects exactly the seeded rows and nothing else:
//   - Timbratura standard in bulk → 3 seeded `missing_clock_out` days are all
//     resolved in one action (per-row it POSTs /admin/stamps/fix-anomaly).
//   - Giustifica con nota in bulk → seeded `short_hours` days all gain a
//     justification_note (per-row it POSTs /shifts/anomalies/justify).
//
// Frontend-only feature: the endpoints already exist, so unlike a new-endpoint
// spec this passes against the current prod API without a backend deploy.
// Gated behind E2E_MUTATING like the other mutating specs.
const ENABLED = process.env.E2E_MUTATING === '1';

interface AnomalyLite {
  kind: string;
  date: string;
  justification_note: string | null;
}

// The n-th most recent weekday before today (n=1 → yesterday-or-Friday), so a
// band of consecutive n's is a run of weekdays that never straddles a weekend
// with extra working days in between.
function nthWeekdayBack(n: number, hour: number, minute: number): { iso: string; date: string } {
  const d = new Date();
  let count = 0;
  while (count < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return romeWallClockISO(d, hour, minute);
}

test.describe.serial('web — Anomalie bulk correction (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let userName: string;
  let templateId: string | null = null;
  const stampIds: string[] = [];
  const leaveIds: string[] = [];

  // Standard-correction band: 3 consecutive weekdays, each seeded with a
  // clock-in only → a single `missing_clock_out` per day.
  const stdDays = [nthWeekdayBack(2, 9, 0), nthWeekdayBack(3, 9, 0), nthWeekdayBack(4, 9, 0)];
  // Note-justification band: 3 older consecutive weekdays, each with a short
  // day (09:00–13:00) → `short_hours` (and an early clock-out).
  const noteDays = [nthWeekdayBack(10, 9, 0), nthWeekdayBack(11, 9, 0), nthWeekdayBack(12, 9, 0)];

  async function anomaliesInRange(fromDate: string, toDate: string): Promise<AnomalyLite[]> {
    const params = new URLSearchParams({ from: fromDate, to: toDate, user_id: user.userId });
    return apiGet<AnomalyLite[]>(admin.token, `/api/v1/shifts/anomalies?${params}`);
  }

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    userName = await resolveDisplayName(admin.token, CREDS.user.email);

    const validFrom = nthWeekdayBack(14, 0, 0).date;
    const tpl = await createShiftTemplate(admin.token, {
      name: `e2e-bulk-${Date.now()}`,
      slots: [1, 2, 3, 4, 5].map((dow) => ({
        day_of_week: dow,
        start_time: '09:00',
        end_time: '17:00',
      })),
    });
    templateId = tpl.id;
    await assignShift(admin.token, {
      user_id: user.userId,
      shift_template_id: templateId,
      valid_from: validFrom,
    });

    // Clear any approved leave overlapping our bands so seeded days surface the
    // expected anomalies (a sibling spec may leave one behind).
    const overlapping = await listLeaves(admin.token, {
      scope: 'all',
      status: 'approved',
      user_id: user.userId,
      from: noteDays[2]!.date,
      to: stdDays[0]!.date,
    });
    for (const lv of overlapping) {
      await adminRevokeLeave(admin.token, lv.id, 'e2e bulk isolation').catch(() => {});
    }

    // Seed the standard band: clock-in only → missing_clock_out.
    for (const day of stdDays) {
      const seed = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
        user_id: user.userId,
        event_type: 'clock_in',
        occurred_at: day.iso,
        justification: 'e2e bulk standard seed',
      });
      expect(seed.status, `seed clock_in: ${seed.code ?? ''} ${seed.message ?? ''}`).toBe(201);
      if (seed.data) stampIds.push(seed.data.id);
    }

    // Seed the note band: clock-in 09:00 + clock-out 13:00 → short_hours.
    for (const day of noteDays) {
      const inISO = day.iso;
      const outISO = romeWallClockISO(new Date(day.iso), 13, 0).iso;
      const sIn = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
        user_id: user.userId,
        event_type: 'clock_in',
        occurred_at: inISO,
        justification: 'e2e bulk note seed in',
      });
      expect(sIn.status).toBe(201);
      if (sIn.data) stampIds.push(sIn.data.id);
      const sOut = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
        user_id: user.userId,
        event_type: 'clock_out',
        occurred_at: outISO,
        justification: 'e2e bulk note seed out',
      });
      expect(sOut.status).toBe(201);
      if (sOut.data) stampIds.push(sOut.data.id);
    }
  });

  test.afterAll(async () => {
    for (const id of stampIds) await deleteStampAdmin(admin.token, id).catch(() => {});
    for (const id of leaveIds) {
      await adminRevokeLeave(admin.token, id, 'e2e bulk cleanup').catch(() => {});
    }
    try {
      await assignShift(admin.token, {
        user_id: user.userId,
        shift_template_id: null,
        valid_from: nthWeekdayBack(14, 0, 0).date,
      });
    } catch {
      /* best-effort */
    }
    if (templateId) await deleteShiftTemplate(admin.token, templateId).catch(() => {});
  });

  // Filter the page to `user` over [from,to] and wait for the settled fetch, so
  // no late-resolving mount-load reverts the filtered list mid-interaction.
  async function filterTo(page: import('@playwright/test').Page, from: string, to: string) {
    await page.goto('/anomalies');
    await expect(page.getByRole('heading', { name: /Anomalie orario/i })).toBeVisible({
      timeout: 15_000,
    });
    await page
      .waitForResponse((r) => r.url().includes('/api/v1/shifts/anomalies'), { timeout: 15_000 })
      .catch(() => {});
    await page.locator('input[type="date"]').first().fill(from);
    await page.locator('input[type="date"]').nth(1).fill(to);
    await page.locator('select').first().selectOption({ label: userName });
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/v1/shifts/anomalies') && r.url().includes(user.userId),
        { timeout: 15_000 },
      ),
      page.getByRole('button', { name: 'Aggiorna' }).click(),
    ]);
  }

  test('bulk Timbratura standard resolves all selected missing_clock_out', async ({ page }) => {
    const from = stdDays[2]!.date; // oldest
    const to = stdDays[0]!.date; // newest

    const before = await anomaliesInRange(from, to);
    expect(before.filter((a) => a.kind === 'missing_clock_out').length).toBe(3);

    await filterTo(page, from, to);

    // Select every visible row, then bulk-apply Timbratura standard.
    await page.locator('label').filter({ hasText: 'Seleziona tutte' }).getByRole('checkbox').check();
    const bar = page.locator('div.sticky');
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await bar.getByRole('combobox').selectOption({ label: 'Timbratura standard (orari del giorno)' });
    // On full success the bar clears the selection and unmounts (resolved rows
    // also drop from the list); wait for that detach as the success signal.
    await bar.getByRole('button', { name: /^Correggi/ }).click();
    await expect(bar).toHaveCount(0, { timeout: 20_000 });

    const after = await anomaliesInRange(from, to);
    expect(after.filter((a) => a.kind === 'missing_clock_out').length).toBe(0);
    // Record the inserted clock-outs so afterAll removes them.
    for (const day of stdDays) {
      const stamps = await apiGet<Array<{ id: string; event_type: string; occurred_at: string }>>(
        admin.token,
        `/api/v1/admin/stamps?user_id=${user.userId}&from=${day.date}&to=${day.date}`,
      ).catch(() => [] as Array<{ id: string; event_type: string; occurred_at: string }>);
      for (const s of stamps) if (s.event_type === 'clock_out') stampIds.push(s.id);
    }
  });

  test('bulk Giustifica con nota annotates all selected anomalies', async ({ page }) => {
    const from = noteDays[2]!.date;
    const to = noteDays[0]!.date;

    const before = await anomaliesInRange(from, to);
    expect(before.some((a) => a.kind === 'short_hours')).toBe(true);

    await filterTo(page, from, to);

    await page.locator('label').filter({ hasText: 'Seleziona tutte' }).getByRole('checkbox').check();
    const bar = page.locator('div.sticky');
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await bar.getByRole('combobox').selectOption({ label: 'Giustifica con nota' });
    await bar.getByRole('textbox').fill('e2e giustifica in blocco');
    await bar.getByRole('button', { name: /^Correggi/ }).click();
    await expect(bar).toHaveCount(0, { timeout: 20_000 });

    const after = await anomaliesInRange(from, to);
    expect(after.every((a) => a.justification_note === 'e2e giustifica in blocco')).toBe(true);
  });
});
