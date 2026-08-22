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

// The permesso proposed by the Anomalie corrections on an ORARIO SPEZZATO.
//
// Customer shape (Time System S.a.s): "FULL TIME FLESSIBILE" 08:00–12:00 +
// 13:00–17:00 and "FULL TIME UFFICIO" 08:30–12:30 + 14:00–18:00. The anomaly
// payload's expected_start_at / expected_end_at are the FIRST slot's start and
// the LAST slot's end, so a window anchored on them spans the unpaid gap
// between the two fasce — an hour nobody is scheduled to work, and therefore an
// hour that is neither presence nor absence.
//
// Seeded here with 09:00–13:00 + 14:00–18:00, punched in at 09:00 and out at
// 12:00: the day is 300 minutes short (its own short_hours delta says so), and
// the naive proposal 12:00 → 18:00 is 360. The extra hour came off the
// employee's permessi residuo and landed in the payroll export's "Ore
// permessi".
//
// Both entry points are exercised on identically-seeded days, because they must
// propose the SAME window for a given giornata:
//   - the per-row Correggi panel  → 12:00–13:00 + 14:00–18:00, 5h
//   - the bulk correction bar     → the same two windows on its own day
//
// and they must BOOK it the same way: one POST /leaves/admin-create-day
// carrying both fasce, judged and written all-or-nothing. The loop over
// /admin-create this replaced could commit the morning fascia and have the
// afternoon one refused by the per-day cap, leaving a giornata half covered,
// its "assenza inserita" notification already sent, and a re-run refused as an
// overlap on the half that HAD landed.
//
// Frontend + payload change: the page reads the day's fasce from the anomaly
// (`work_intervals`, added to apps/backend/src/routes/shifts.ts), so this spec
// needs that backend deployed to the e2e target. Gated behind E2E_MUTATING like
// the other mutating specs.
const ENABLED = process.env.E2E_MUTATING === '1';

interface AnomalyLite {
  kind: string;
  date: string;
  delta_minutes: number | null;
  work_intervals: { from: string; to: string }[] | null;
}

// The n-th most recent weekday before today (n=1 → yesterday-or-Friday).
// Deliberately older than every other mutating anomalies spec's band (they
// reach n=17): the suite runs serially against one test user, and these days
// must keep the split-shift template of THIS spec.
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

function windowsOf(rows: LeaveListRow[]): string[] {
  return rows
    .slice()
    .sort((a, b) => a.from_ts.localeCompare(b.from_ts))
    .map((l) => `${romeHHMM(l.from_ts)}-${romeHHMM(l.to_ts)}`);
}

// Every leave write the page fires, path + body. The atomicity of a giornata is
// a property of the REQUESTS and not only of the rows that end up in the DB:
// two rows can be two calls that happened to both succeed, which is exactly the
// state this spec exists to refuse.
interface LeavePost {
  path: string;
  windows: number;
}

function recordLeavePosts(page: import('@playwright/test').Page): LeavePost[] {
  const posts: LeavePost[] = [];
  page.on('request', (r) => {
    // Substring, so the superseded /admin-create is caught too: a single call
    // to the wrong endpoint has to fail this spec, not slip past it.
    if (r.method() !== 'POST' || !r.url().includes('/api/v1/leaves/admin-create')) return;
    let windows = 0;
    try {
      const body = JSON.parse(r.postData() ?? '{}') as { windows?: unknown[] };
      windows = Array.isArray(body.windows) ? body.windows.length : 0;
    } catch {
      /* a body we cannot read is reported as 0 windows and fails the assertion */
    }
    posts.push({ path: new URL(r.url()).pathname, windows });
  });
  return posts;
}

// One request for the giornata, carrying both fasce.
function expectOneAtomicPost(posts: LeavePost[]): void {
  expect(
    posts.map((p) => p.path),
    `the giornata must be one atomic request, got ${JSON.stringify(posts)}`
  ).toEqual(['/api/v1/leaves/admin-create-day']);
  expect(posts[0]?.windows, 'both fasce must travel in the same request').toBe(2);
}

function totalMinutes(rows: LeaveListRow[]): number {
  return rows.reduce(
    (sum, l) =>
      sum + Math.round((new Date(l.to_ts).getTime() - new Date(l.from_ts).getTime()) / 60_000),
    0
  );
}

test.describe.serial('web — Anomalie permesso on a split shift (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let userName: string;
  let templateId: string | null = null;
  const stampIds: string[] = [];
  const leaveIds: string[] = [];

  // One day per entry point, both seeded identically so the two proposals can
  // be compared directly.
  const rowDay = nthWeekdayBack(19, 9, 0);
  const bulkDay = nthWeekdayBack(20, 9, 0);
  const validFrom = nthWeekdayBack(22, 0, 0).date;

  // The two fasce, and the unpaid hour between them that must never be booked.
  const EXPECTED_WINDOWS = ['12:00-13:00', '14:00-18:00'];

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

  // In at 09:00, out at 12:00 on the 09:00–13:00 + 14:00–18:00 template: three
  // hours worked against eight scheduled.
  async function seedShortMorning(day: { iso: string }, tag: string): Promise<void> {
    const outISO = romeWallClockISO(new Date(day.iso), 12, 0).iso;
    for (const [event_type, at] of [
      ['clock_in', day.iso],
      ['clock_out', outISO],
    ] as const) {
      const s = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
        user_id: user.userId,
        event_type,
        occurred_at: at,
        justification: `e2e split-shift ${tag} seed`,
      });
      expect(s.status, `seed ${event_type} (${tag}): ${s.code ?? ''} ${s.message ?? ''}`).toBe(201);
      if (s.data) stampIds.push(s.data.id);
    }
  }

  // Asserted as an explicit precondition, not assumed: the whole point is that
  // the day's own shortfall (300') and the naive window (360') disagree. If the
  // backend ever stopped raising the pair, the assertions below would be
  // trivially satisfiable and would stop guarding anything.
  async function expectSplitShiftDay(date: string): Promise<void> {
    const rows = await anomaliesOn(date);
    const kinds = rows.map((a) => a.kind);
    expect(
      kinds,
      `expected early_clock_out + short_hours on ${date}, got ${JSON.stringify(kinds)}`
    ).toEqual(expect.arrayContaining(['early_clock_out', 'short_hours']));
    const short = rows.find((a) => a.kind === 'short_hours');
    expect(short?.delta_minutes, 'the day is five hours short, not six').toBe(300);
    // The payload half of the fix: without the fasce the page cannot know where
    // the unpaid gap is.
    const early = rows.find((a) => a.kind === 'early_clock_out');
    expect(
      (early?.work_intervals ?? []).map((w) => `${romeHHMM(w.from)}-${romeHHMM(w.to)}`),
      'the anomaly must carry the day\'s two fasce'
    ).toEqual(['09:00-13:00', '14:00-18:00']);
  }

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    userName = await resolveDisplayName(admin.token, CREDS.user.email);

    // Two fasce per weekday with zero tolerance and no auto-lunch: the shape
    // the proposal was wrong on.
    const tpl = await createShiftTemplate(admin.token, {
      name: `e2e-spezzato-${Date.now()}`,
      slots: [1, 2, 3, 4, 5].flatMap((dow) => [
        { day_of_week: dow, start_time: '09:00', end_time: '13:00' },
        { day_of_week: dow, start_time: '14:00', end_time: '18:00' },
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

    // A leave left behind by a sibling spec would cover part of the fasce and
    // change both the anomalies and the proposal.
    const overlapping = await listLeaves(admin.token, {
      scope: 'all',
      status: 'approved',
      user_id: user.userId,
      from: bulkDay.date,
      to: rowDay.date,
    });
    for (const lv of overlapping) {
      await adminRevokeLeave(admin.token, lv.id, 'e2e split-shift isolation').catch(() => {});
    }

    await seedShortMorning(rowDay, 'row');
    await seedShortMorning(bulkDay, 'bulk');
  });

  test.afterAll(async () => {
    for (const id of stampIds) await deleteStampAdmin(admin.token, id).catch(() => {});
    for (const id of leaveIds) {
      await adminRevokeLeave(admin.token, id, 'e2e split-shift cleanup').catch(() => {});
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

  // Read-only, and declared BEFORE the test that books rowDay: describe.serial
  // runs in declaration order, so the day still carries no permesso here and the
  // panel opens on exactly the proposal the next test confirms.
  test('the Dalle stepper cannot leave the fasce, so the recap is what gets booked', async ({
    page,
  }) => {
    await expectSplitShiftDay(rowDay.date);
    await filterTo(page, rowDay.date);

    const row = page
      .locator('li')
      .filter({ hasText: 'Uscita anticipata' })
      .filter({ hasText: userName })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: /^Correggi/ }).click();
    await row.getByRole('combobox').selectOption({ label: 'Inserisci permesso' });

    const from = row.getByTestId('perm-from');
    const to = row.getByTestId('perm-to');
    const duration = row.getByTestId('perm-duration');
    await expect(from).toContainText('12:00');
    await expect(to).toContainText('18:00');
    await expect(duration).toHaveText(/^5h$/);

    // Inside a fascia the stepper moves one quarter at a time, and 12:45 is the
    // last instant "Dalle" may stop on in the morning one: permStepBounds('from')
    // reads floor15(fascia end) − one quarter, so wherever the window starts it
    // still holds a bookable quarter of the fascia it starts in.
    //
    // Asserted instant by instant rather than after a loop of N clicks: a
    // hard-coded click count is a second, silent statement about where the
    // clamp is, and when the two disagree the loop is what wins.
    const plus = from.getByRole('button', { name: '+' });
    for (const instant of ['12:15', '12:30', '12:45']) {
      await plus.click();
      await expect(from).toContainText(instant);
    }

    // The interesting half of the clamp. The next quarter is 13:00, which lies
    // inside no fascia, so the step does not stop there and does not refuse
    // either — it jumps the unpaid gap WHOLE and lands on the start of the
    // afternoon fascia.
    //
    // A free stepper stopped at 13:00, 13:15, 13:30… — instants nobody is
    // scheduled at — while permessoParts clipped the booking straight back to
    // 14:00. The recap then read "Dalle 13:30 · Alle 18:00 · Durata 4h": a four
    // and a half hour window against a four hour permesso, with the line that
    // explains a shorter duration switched OFF, because the clipped window holds
    // a single fascia. What the recap states is now what the booking does.
    await plus.click();
    await expect(from).toContainText('14:00');
    await expect(from, 'the window must never stop inside the unpaid gap').not.toContainText('13:');

    // One fascia now: 14:00–18:00 is four hours of window and four hours of
    // permesso, so the split-shift line is gone because there is nothing left
    // for it to explain.
    await expect(duration).toHaveText(/^4h$/);
    await expect(page.getByTestId('perm-split-shift')).toHaveCount(0);

    // The outer edge of the schedule: "Alle +" has nowhere to go past 18:00, and
    // says so instead of moving the window outside the turno.
    await expect(to.getByRole('button', { name: '+' })).toBeDisabled();

    // And the gap is jumped in BOTH directions: stepping back from 14:00 aims at
    // 13:45, which is inside no fascia either, so "Dalle −" returns to the
    // morning fascia's last instant instead of walking into the gap from the
    // other side. The window is two fasce again — 12:45–13:00 plus
    // 14:00–18:00, 4h 15m of the 5h 15m it spans — so the line that explains
    // the difference comes back with it.
    await from.getByRole('button', { name: '−' }).click();
    await expect(from).toContainText('12:45');
    await expect(duration).toHaveText(/^4h 15m$/);
    await expect(page.getByTestId('perm-split-shift')).toBeVisible();

    // Nothing applied: the next test needs this giornata still free of permessi.
    await row.getByRole('button', { name: 'Annulla' }).click();
    expect(await permessiOn(rowDay.date), 'the stepper test must book nothing').toHaveLength(0);
  });

  test('per-row Correggi proposes 5h over the two fasce, not 6h across the gap', async ({
    page,
  }) => {
    await expectSplitShiftDay(rowDay.date);
    expect(await permessiOn(rowDay.date), 'day must start with no permesso').toHaveLength(0);

    // Watch the requests, not only the end state: two leave ROWS are the fix,
    // one atomic REQUEST is what makes them arrive together, and a single row
    // spanning 12:00–18:00 was the original defect.
    const posts = recordLeavePosts(page);

    await filterTo(page, rowDay.date);

    const row = page
      .locator('li')
      .filter({ hasText: 'Uscita anticipata' })
      .filter({ hasText: userName })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: /^Correggi/ }).click();
    await row.getByRole('combobox').selectOption({ label: 'Inserisci permesso' });

    // The duration is the SUM OF THE FASCE, so it matches the day's shortfall.
    // "6h" here is the regression: it would mean the midday gap is being booked.
    await expect(row.getByText(/^5h$/)).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(/^6h$/)).toHaveCount(0);

    // …and the panel says why the duration is shorter than the window it shows,
    // naming both fasce.
    const splitLine = page.getByTestId('perm-split-shift');
    await expect(splitLine).toBeVisible();
    await expect(splitLine).toContainText('12:00');
    await expect(splitLine).toContainText('13:00');
    await expect(splitLine).toContainText('14:00');
    await expect(splitLine).toContainText('18:00');

    await row.getByRole('button', { name: 'Conferma' }).click();

    await expect
      .poll(async () => (await permessiOn(rowDay.date)).length, { timeout: 20_000 })
      .toBe(2);
    const created = await permessiOn(rowDay.date);
    for (const lv of created) leaveIds.push(lv.id); // cleanup, pass or fail

    expectOneAtomicPost(posts);
    expect(windowsOf(created)).toEqual(EXPECTED_WINDOWS);
    // The payroll-visible half: "Ore permessi" counts the windows themselves,
    // so 360 minutes here is an hour the employee never owed.
    expect(totalMinutes(created), '5h booked, not 6h').toBe(300);
    // Nothing may sit inside the unpaid gap.
    const gapFrom = romeWallClockISO(new Date(rowDay.iso), 13, 0).iso;
    const gapTo = romeWallClockISO(new Date(rowDay.iso), 14, 0).iso;
    for (const lv of created) {
      expect(
        lv.from_ts < gapTo && lv.to_ts > gapFrom,
        `permesso ${romeHHMM(lv.from_ts)}–${romeHHMM(lv.to_ts)} overlaps the unpaid gap`
      ).toBe(false);
    }

    // And the correction actually corrected: the day is covered exactly.
    const after = (await anomaliesOn(rowDay.date)).map((a) => a.kind);
    expect(after).not.toContain('short_hours');
    expect(after).not.toContain('early_clock_out');
  });

  test('the bulk bar proposes the same two windows for the same giornata', async ({ page }) => {
    await expectSplitShiftDay(bulkDay.date);
    expect(await permessiOn(bulkDay.date), 'day must start with no permesso').toHaveLength(0);

    const posts = recordLeavePosts(page);

    await filterTo(page, bulkDay.date);
    await page.locator('label').filter({ hasText: 'Seleziona tutte' }).getByRole('checkbox').check();
    const bar = page.locator('div.sticky');
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await bar.getByRole('combobox').selectOption({ label: 'Inserisci permesso' });

    // The giornata is corrected, not skipped — it simply takes one permesso per
    // fascia, and the bar says so before the click.
    await expect(page.getByTestId('bulk-permesso-split-shift')).toBeVisible();
    await expect(page.getByTestId('bulk-permesso-split')).toHaveCount(0);

    await bar.getByRole('button', { name: /^Correggi/ }).click();
    await expect(bar, 'a bar still on screen means a correction failed').toHaveCount(0, {
      timeout: 20_000,
    });

    const created = await permessiOn(bulkDay.date);
    for (const lv of created) leaveIds.push(lv.id);

    // The bar shares applyCorrection with the per-row panel, so it shares the
    // atomicity too — an invariant earlier rounds established, asserted rather
    // than assumed.
    expectOneAtomicPost(posts);
    // The requirement in one assertion: both entry points agree on the window.
    expect(windowsOf(created)).toEqual(EXPECTED_WINDOWS);
    expect(totalMinutes(created), '5h booked, not 6h').toBe(300);

    const after = (await anomaliesOn(bulkDay.date)).map((a) => a.kind);
    expect(after).not.toContain('short_hours');
  });
});
