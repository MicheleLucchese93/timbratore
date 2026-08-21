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
  type LeaveListRow,
} from '../fixtures/api-client';
import { romeWallClockISO } from '../fixtures/time';

// Exercises the bulk multi-select correction on the Anomalie page (the "select
// similar anomalies → apply the same correction" flow added to Anomalies.tsx).
// UI-driven cases, each over its own narrow date band so "Seleziona tutte"
// selects exactly the seeded rows and nothing else:
//   - Timbratura standard in bulk → 3 seeded `missing_clock_out` days are all
//     resolved in one action (per-row it POSTs /admin/stamps/fix-anomaly).
//   - Giustifica con nota in bulk → seeded `short_hours` days all gain a
//     justification_note (per-row it POSTs /shifts/anomalies/justify).
//   - One day raising TWO anomalies collapses to a single giornata, and
//     "Inserisci permesso" is offered again for such a selection.
//   - "Inserisci ferie" over that same two-anomaly day inserts ONE 8h ferie,
//     not one per selected row. This is the Time System S.a.s regression
//     (prod, August 2026): apps/backend/src/routes/shifts.ts pushes
//     'early_clock_out' and 'short_hours' independently for the same day, the
//     bar fired one POST /leaves/admin-create per row in parallel via
//     mapLimit(), and the two transactions each read the pre-insert state, so
//     the per-day cap let both through — 16h of ferie on a single day in the
//     payroll export and a ferie residuo bitten twice. 14 duplicate (user,
//     day) pairs were found in prod, each pair ~125µs apart.
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
  // Two single-day bands for the day-collapse cases, seeded with the same
  // 09:00–13:00 short day: on a 09:00–17:00 template that is BOTH an
  // `early_clock_out` (4h early) and a `short_hours` (240' shortfall), i.e.
  // exactly the prod shape that produced the duplicate ferie. They get days of
  // their own — n=9 and n=13 — because no other mutating spec seeds those
  // weekdays for test3, and because `ferieDay` is mutated (a leave lands on it)
  // while `permDay` must stay correctable for the read-only bar assertions.
  const permDay = nthWeekdayBack(13, 9, 0);
  const ferieDay = nthWeekdayBack(9, 9, 0);

  async function anomaliesInRange(fromDate: string, toDate: string): Promise<AnomalyLite[]> {
    const params = new URLSearchParams({ from: fromDate, to: toDate, user_id: user.userId });
    return apiGet<AnomalyLite[]>(admin.token, `/api/v1/shifts/anomalies?${params}`);
  }

  // Approved ferie sitting on one day. The duplicate-insert regression is
  // counted here: the bug produced TWO rows for the same (user, day).
  async function ferieOn(date: string): Promise<LeaveListRow[]> {
    const rows = await listLeaves(admin.token, {
      scope: 'all',
      status: 'approved',
      user_id: user.userId,
      from: date,
      to: date,
    });
    return rows.filter((l) => l.type === 'ferie');
  }

  // 09:00 in / 13:00 out on the 09:00–17:00 template: 4h worked against 8h
  // expected, which the backend reports as early_clock_out AND short_hours.
  async function seedShortDay(day: { iso: string }, tag: string): Promise<void> {
    const outISO = romeWallClockISO(new Date(day.iso), 13, 0).iso;
    for (const [event_type, at] of [
      ['clock_in', day.iso],
      ['clock_out', outISO],
    ] as const) {
      const s = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
        user_id: user.userId,
        event_type,
        occurred_at: at,
        justification: `e2e bulk ${tag} seed`,
      });
      expect(s.status, `seed ${event_type} (${tag}): ${s.code ?? ''} ${s.message ?? ''}`).toBe(201);
      if (s.data) stampIds.push(s.data.id);
    }
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
    // expected anomalies (a sibling spec may leave one behind). The window
    // starts at permDay (n=13, the oldest band) — not at noteDays, which used
    // to be the oldest — otherwise a leftover leave on the collapse days would
    // fully cover them and suppress both anomalies we depend on.
    const overlapping = await listLeaves(admin.token, {
      scope: 'all',
      status: 'approved',
      user_id: user.userId,
      from: permDay.date,
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
    for (const day of noteDays) await seedShortDay(day, 'note');

    // Same recipe for the two single-day collapse bands. Both sit inside the
    // leave-isolation window above, so ferieDay starts with zero approved
    // ferie — without that, "exactly one ferie afterwards" could pass (or fail)
    // for a reason that has nothing to do with the bulk bar.
    await seedShortDay(permDay, 'permesso-offer');
    await seedShortDay(ferieDay, 'ferie-dedupe');
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

    // "Nascondi giustificate" is on by default, so once every row in the band
    // carries a note the list empties out with the dedicated message — not the
    // generic "no anomalies", which would read as if the days had been clean.
    await expect(page.getByText(/tutte quelle del periodo/i)).toBeVisible({ timeout: 20_000 });

    // Unchecking it brings the annotated rows back.
    await page.getByTestId('hide-justified').uncheck();
    await expect(page.getByText(/Giustificata: e2e giustifica in blocco/).first()).toBeVisible({
      timeout: 15_000,
    });

    const after = await anomaliesInRange(from, to);
    expect(after.every((a) => a.justification_note === 'e2e giustifica in blocco')).toBe(true);
  });

  // The two anomalies the collapse layer exists for. Asserted as an explicit
  // precondition in both tests below rather than assumed: if the backend ever
  // stops emitting the pair for a short day, these tests must FAIL loudly —
  // a single-anomaly day would make the "no duplicate" assertions trivially
  // true and the regression guard would quietly stop guarding anything.
  async function expectTwoAnomalies(date: string): Promise<void> {
    const kinds = (await anomaliesInRange(date, date)).map((a) => a.kind);
    expect(
      kinds,
      `expected early_clock_out + short_hours on ${date}, got ${JSON.stringify(kinds)}`,
    ).toEqual(expect.arrayContaining(['early_clock_out', 'short_hours']));
  }

  test('a day raising two anomalies collapses to one giornata and offers permesso', async ({
    page,
  }) => {
    await expectTwoAnomalies(permDay.date);

    await filterTo(page, permDay.date, permDay.date);
    await page.locator('label').filter({ hasText: 'Seleziona tutte' }).getByRole('checkbox').check();
    const bar = page.locator('div.sticky');
    await expect(bar).toBeVisible({ timeout: 10_000 });

    // The merge has to be visible BEFORE the click: the admin ticked N rows and
    // is about to send M corrections. Only showing it in the result recap would
    // be telling them after the fact.
    const merged = page.getByTestId('bulk-merged-notice');
    await expect(merged).toBeVisible({ timeout: 10_000 });
    await expect(merged).toContainText(/una sola volta per giornata/i);

    // 'permesso' used to be stripped from every bulk selection (one shared
    // window cannot fit several days). It is offered again now that each
    // giornata submits the window computed from its own schedule and punches.
    await expect(bar.getByRole('option', { name: 'Inserisci permesso' })).toHaveCount(1);
    await expect(bar.getByRole('option', { name: 'Inserisci ferie' })).toHaveCount(1);

    await bar.getByRole('combobox').selectOption({ label: 'Inserisci permesso' });
    // …and the bar says so, instead of offering a shared time stepper that
    // would silently apply one day's window to all of them.
    await expect(page.getByTestId('bulk-permesso-hint')).toBeVisible();

    // Read-only on purpose: nothing is applied, so the day stays a two-anomaly
    // day for anyone re-running the suite.
    await bar.getByRole('button', { name: 'Deseleziona' }).click();
    await expect(bar).toHaveCount(0, { timeout: 10_000 });
  });

  test('bulk Inserisci ferie on a two-anomaly day books 8h once, not 16h twice', async ({
    page,
  }) => {
    await expectTwoAnomalies(ferieDay.date);
    expect(await ferieOn(ferieDay.date), 'day must start with no ferie').toHaveLength(0);

    // Count the POSTs, not only the end state. The defect WAS the second
    // request: with the frontend collapse reverted this array holds 2 even
    // though the backend advisory lock now rejects one of them, so the count
    // pins the fix that belongs to this page rather than the safety net behind
    // it. Registered before any navigation so nothing is missed.
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/v1/leaves/admin-create')) {
        posts.push(r.url());
      }
    });

    await filterTo(page, ferieDay.date, ferieDay.date);
    await page.locator('label').filter({ hasText: 'Seleziona tutte' }).getByRole('checkbox').check();
    const bar = page.locator('div.sticky');
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('bulk-merged-notice')).toBeVisible({ timeout: 10_000 });
    await bar.getByRole('combobox').selectOption({ label: 'Inserisci ferie' });

    // Gate on the admin-create response, never on a toast (the bar has none,
    // and a detach on its own would not prove the insert was accepted).
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/v1/leaves/admin-create') && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      bar.getByRole('button', { name: /^Correggi/ }).click(),
    ]);
    expect(res.status(), 'admin-create must be accepted').toBe(201);

    // On full success the bar clears the selection and unmounts. apply() has
    // awaited every request it was going to fire by then, so `posts` is final.
    // A bar still on screen means at least one correction was refused — which
    // is exactly what a second, duplicate POST looks like now that the backend
    // per-day cap holds an advisory lock and rejects the loser of the race.
    await expect(
      bar,
      'bulk bar still visible → a correction failed (duplicate POST refused by the per-day cap?)',
    ).toHaveCount(0, { timeout: 20_000 });

    const created = await ferieOn(ferieDay.date);
    for (const lv of created) leaveIds.push(lv.id); // cleanup, pass or fail

    expect(posts, `one giornata → one POST, got ${posts.length}`).toHaveLength(1);
    expect(created, 'two anomalies must not become two ferie rows').toHaveLength(1);

    // The payroll-visible half of the incident: the export showed 16h of ferie
    // for a single day. One row spanning the whole scheduled day = 8h.
    const totalMin = created.reduce(
      (sum, l) =>
        sum + Math.round((new Date(l.to_ts).getTime() - new Date(l.from_ts).getTime()) / 60_000),
      0,
    );
    expect(totalMin, '8h of ferie on the day, not 16h').toBe(480);

    // And the day is now covered, so its anomalies are gone — the correction
    // actually corrected something.
    const after = await anomaliesInRange(ferieDay.date, ferieDay.date);
    expect(after.map((a) => a.kind)).not.toContain('short_hours');
  });
});
