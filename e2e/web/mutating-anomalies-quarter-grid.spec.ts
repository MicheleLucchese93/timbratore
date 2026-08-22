import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  adminRevokeLeave,
  apiGet,
  assignShift,
  createShiftTemplate,
  deleteShiftTemplate,
  listLeaves,
  loadHandleFromStorage,
  resolveDisplayName,
  type ApiHandle,
  type LeaveListRow,
} from '../fixtures/api-client';
import { romeWallClockISO } from '../fixtures/time';

// A giornata whose absence actions VANISH, and the page saying why.
//
// Shift-template slot times are free-form: the admin form is an
// <input type="time"> with no step (apps/web/src/pages/Shifts.tsx) and the API
// validates only HH:MM (apps/backend/src/routes/shifts.ts), so 09:00–13:20 +
// 14:00–17:40 is a perfectly legal orario. A leave request, on the other hand,
// must be a whole multiple of a quarter of an hour, and scheduledWindowParts
// snaps every part INWARD to that grid.
//
// So an absent day on this orario books 465 of its 480 minutes and leaves
// 13:15–13:20 and 17:30–17:40 uncovered. The next load raises missing_clock_in
// and missing_clock_out again over those two slivers — and neither is bookable,
// because neither holds a whole quarter. isGapRow() then rejects every row of
// the day, the giornata gets no DayCorrection, and "Inserisci ferie" and
// "Inserisci permesso" simply disappear from a day that still shows two red
// rows. Before this spec's fix nothing on screen said so; now the Correggi
// panel names the leftover minutes and points at the orario they come from.
//
// Day band: n=23 with valid_from n=26, deliberately older than every other
// mutating anomalies spec (they reach n=20, valid_from n=22). The web suite
// runs serially against ONE test user, so the days a spec owns must keep that
// spec's template.
const ENABLED = process.env.E2E_MUTATING === '1';

interface AnomalyLite {
  kind: string;
  date: string;
  work_intervals: { from: string; to: string }[] | null;
}

// The n-th most recent weekday before today (n=1 → yesterday-or-Friday).
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

// Europe/Rome wall-clock of an instant — the schedule's own frame, so the
// assertions read as the fasce do and stay DST-proof.
function romeHHMM(iso: string): string {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

test.describe.serial('web — Anomalie on an off-grid orario (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let userName: string;
  let templateId: string | null = null;
  const leaveIds: string[] = [];

  // No stamps at all on this day: the whole turno is the unworked stretch.
  const day = nthWeekdayBack(23, 9, 0);
  const validFrom = nthWeekdayBack(26, 0, 0).date;

  // The fasce, and the two slivers the quarter grid leaves behind once the
  // bookable part of the day has been covered.
  const FASCE = ['09:00-13:20', '14:00-17:40'];
  const BOOKED = ['09:00-13:15', '14:00-17:30'];
  const SLIVERS = ['13:15-13:20', '17:30-17:40'];

  async function anomaliesOn(date: string): Promise<AnomalyLite[]> {
    const params = new URLSearchParams({ from: date, to: date, user_id: user.userId });
    return apiGet<AnomalyLite[]>(admin.token, `/api/v1/shifts/anomalies?${params}`);
  }

  async function permessiOn(date: string): Promise<LeaveListRow[]> {
    const rows = await listLeaves(admin.token, {
      scope: 'all',
      status: 'approved',
      user_id: user.userId,
      from: date,
      to: date,
    });
    return rows.filter((l) => l.type === 'permessi');
  }

  function windowsOf(rows: LeaveListRow[]): string[] {
    return rows
      .slice()
      .sort((a, b) => a.from_ts.localeCompare(b.from_ts))
      .map((l) => `${romeHHMM(l.from_ts)}-${romeHHMM(l.to_ts)}`);
  }

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    userName = await resolveDisplayName(admin.token, CREDS.user.email);

    // Two fasce whose ends sit OFF the quarter grid — the shape the page had no
    // answer for. Zero tolerance and no auto-lunch, like the split-shift spec.
    const tpl = await createShiftTemplate(admin.token, {
      name: `e2e-fuorigriglia-${Date.now()}`,
      slots: [1, 2, 3, 4, 5].flatMap((dow) => [
        { day_of_week: dow, start_time: '09:00', end_time: '13:20' },
        { day_of_week: dow, start_time: '14:00', end_time: '17:40' },
      ]),
      tolerance_in_min: 0,
      tolerance_out_min: 0,
    });
    templateId = tpl.id;
    await assignShift(admin.token, {
      user_id: user.userId,
      shift_template_id: templateId,
      valid_from: validFrom,
    });

    // A leave left behind by a previous run would already cover the fasce and
    // hand the first phase a day with nothing to book.
    const overlapping = await listLeaves(admin.token, {
      scope: 'all',
      status: 'approved',
      user_id: user.userId,
      from: day.date,
      to: day.date,
    });
    for (const lv of overlapping) {
      await adminRevokeLeave(admin.token, lv.id, 'e2e off-grid isolation').catch(() => {});
    }
  });

  test.afterAll(async () => {
    for (const id of leaveIds) {
      await adminRevokeLeave(admin.token, id, 'e2e off-grid cleanup').catch(() => {});
    }
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

  async function filterTo(page: import('@playwright/test').Page, date: string) {
    await page.goto('/anomalies');
    await expect(page.getByRole('heading', { name: /Anomalie orario/i })).toBeVisible({
      timeout: 15_000,
    });
    await page
      .waitForResponse((r) => r.url().includes('/api/v1/shifts/anomalies'), { timeout: 15_000 })
      .catch(() => {});
    await page.locator('input[type="date"]').first().fill(date);
    await page.locator('input[type="date"]').nth(1).fill(date);
    await page.locator('select').first().selectOption({ label: userName });
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/v1/shifts/anomalies') && r.url().includes(user.userId),
        { timeout: 15_000 }
      ),
      page.getByRole('button', { name: 'Aggiorna' }).click(),
    ]);
  }

  function missingInRow(page: import('@playwright/test').Page) {
    return page
      .locator('li')
      .filter({ hasText: 'Entrata mancante' })
      .filter({ hasText: userName })
      .first();
  }

  test('an absent day books the quarter-aligned part of the two fasce', async ({ page }) => {
    const before = await anomaliesOn(day.date);
    expect(
      before.map((a) => a.kind),
      `expected an unstamped day on ${day.date}, got ${JSON.stringify(before.map((a) => a.kind))}`
    ).toEqual(expect.arrayContaining(['missing_clock_in', 'missing_clock_out']));
    // The precondition that makes the rest of this spec mean anything: the
    // orario's fasce genuinely end off the quarter grid.
    expect(
      (before[0]?.work_intervals ?? []).map((w) => `${romeHHMM(w.from)}-${romeHHMM(w.to)}`),
      'the anomaly must carry the off-grid fasce'
    ).toEqual(FASCE);
    expect(await permessiOn(day.date), 'day must start with no permesso').toHaveLength(0);

    await filterTo(page, day.date);
    const row = missingInRow(page);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: /^Correggi/ }).click();
    await row.getByRole('combobox').selectOption({ label: 'Inserisci permesso' });

    // 465 of the 480 scheduled minutes: each fascia snapped inward to the grid.
    await expect(row.getByTestId('perm-duration')).toHaveText(/^7h 45m$/);
    const splitLine = row.getByTestId('perm-split-shift');
    await expect(splitLine).toBeVisible();
    await expect(splitLine).toContainText('13:15');
    await expect(splitLine).toContainText('17:30');

    await row.getByRole('button', { name: 'Conferma' }).click();
    await expect.poll(async () => (await permessiOn(day.date)).length, { timeout: 20_000 }).toBe(2);
    const created = await permessiOn(day.date);
    for (const lv of created) leaveIds.push(lv.id); // cleanup, pass or fail
    expect(windowsOf(created)).toEqual(BOOKED);
  });

  test('the leftover slivers explain themselves instead of removing the actions', async ({
    page,
  }) => {
    // The 15 minutes the grid could not take are still uncovered, so the day
    // keeps raising the same two anomalies — over stretches no absence can cover.
    const after = await anomaliesOn(day.date);
    expect(
      after.map((a) => a.kind),
      'the slivers must keep the day flagged at both ends'
    ).toEqual(expect.arrayContaining(['missing_clock_in', 'missing_clock_out']));
    expect(
      (after[0]?.work_intervals ?? []).map((w) => `${romeHHMM(w.from)}-${romeHHMM(w.to)}`),
      'what is left uncovered is two stretches shorter than a quarter of an hour'
    ).toEqual(SLIVERS);

    await filterTo(page, day.date);
    const row = missingInRow(page);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: /^Correggi/ }).click();

    // Both absences are genuinely gone — that part is correct, a 5-minute
    // permesso cannot be written.
    await expect(row.getByRole('option', { name: 'Inserisci permesso' })).toHaveCount(0);
    await expect(row.getByRole('option', { name: 'Inserisci ferie' })).toHaveCount(0);

    // …and THIS is the fix: the panel says why, and names the minutes. Without
    // it the admin sees a day that offered both actions on the previous visit
    // and offers neither now, with nothing on screen to explain the difference.
    const hint = row.getByTestId('perm-unbookable-hint');
    await expect(hint).toBeVisible();
    for (const t of ['13:15', '13:20', '17:30', '17:40']) await expect(hint).toContainText(t);
    // It has to point at the cause, not only at the symptom: the orario's own
    // slot times are what leave those minutes behind, every single day.
    await expect(hint).toContainText('Orari di lavoro');

    // The rows can still be closed the two ways that remain open.
    await expect(row.getByRole('option', { name: /^Timbratura standard/ })).toHaveCount(1);
    await expect(row.getByRole('option', { name: 'Giustifica con nota' })).toHaveCount(1);
    await row.getByRole('button', { name: 'Annulla' }).click();

    // The bulk bar carries the same explanation, for the same reason: with no
    // giornata able to take an absence, its dropdown would just be missing two
    // entries and the skip counter would have nothing to count.
    await page.locator('label').filter({ hasText: 'Seleziona tutte' }).getByRole('checkbox').check();
    const bar = page.locator('div.sticky');
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('bulk-unbookable')).toBeVisible();
    await bar.getByRole('button', { name: 'Deseleziona' }).click();
  });
});
