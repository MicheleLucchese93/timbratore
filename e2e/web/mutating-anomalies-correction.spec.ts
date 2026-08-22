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

// Exercises the "Correggi" menu on the Anomalie page end-to-end: each typical
// correction resolves the anomaly it targets (per apps/backend/src/routes/shifts.ts
// + admin-stamps.ts + leaves.ts). Recipe per test:
//   - Timbratura standard → POST /admin/stamps/fix-anomaly adds the missing
//     clock-out → `missing_clock_out` disappears.
//   - A day left on an open clock-in → `missing_clock_out` (not `early_clock_out`),
//     and Timbratura standard resolves it even though the day already holds the
//     lunch clock-out.
//   - A day with no punches at all → Timbratura standard inserts BOTH ends, and
//     re-running it on the now-closed day inserts nothing.
//   - Inserisci ferie → POST /leaves/admin-create full-day → `missing_clock_in`
//     disappears (leave covers the whole expected window).
//   - Inserisci permesso → POST /leaves/admin-create covering the late stretch
//     → `late_clock_in` disappears.
//   - Giustifica con nota (driven through the UI) → POST /shifts/anomalies/justify
//     → the row gains a justification_note (stays visible, annotated).
//
// All four call endpoints introduced with this feature, so they only pass once
// the backend carrying them is deployed to the e2e target (the suite hits the
// prod API). Gated behind E2E_MUTATING like the other mutating specs.
const ENABLED = process.env.E2E_MUTATING === '1';

interface AnomalyLite {
  kind: string;
  date: string;
  actual_end_at: string | null;
  justification_note: string | null;
}

// The n-th most recent weekday before today (n=1 → yesterday-or-Friday), so
// each test gets its own day and they never collide on a compressed weekend.
function nthWeekdayBack(n: number, hour: number, minute: number): { iso: string; date: string } {
  const d = new Date();
  let count = 0;
  while (count < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  // Rome-local wall-clock: matches how the backend reads schedule slot times,
  // so the "Timbratura standard" correction inserts at the right expected times.
  return romeWallClockISO(d, hour, minute);
}

test.describe.serial('web — Anomalie Correggi menu resolves anomalies (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let templateId: string | null = null;
  let validFrom: string;
  let rangeFrom: string;
  let rangeTo: string;
  const stampIds: string[] = [];
  const leaveIds: string[] = [];

  async function anomalies(day: string): Promise<AnomalyLite[]> {
    const params = new URLSearchParams({ from: rangeFrom, to: rangeTo, user_id: user.userId });
    const all = await apiGet<AnomalyLite[]>(admin.token, `/api/v1/shifts/anomalies?${params}`);
    return all.filter((a) => a.date === day);
  }

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);

    // The band has to reach back past every day this file seeds. n=15 (the
    // open-session day) is the oldest, and n=9..14 are reserved by
    // mutating-anomalies-bulk.spec.ts — hence a shift valid from n=17 and a
    // query range from n=18.
    rangeFrom = nthWeekdayBack(18, 0, 0).date;
    rangeTo = new Date().toISOString().slice(0, 10);
    validFrom = nthWeekdayBack(17, 0, 0).date;

    const tpl = await createShiftTemplate(admin.token, {
      name: `e2e-correction-${Date.now()}`,
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

    // A sibling spec can leave an approved leave on test3 that legitimately
    // suppresses anomalies on our seeded days. Clear anything overlapping the
    // range so each test starts from a clean, leave-free day.
    const overlapping = await listLeaves(admin.token, {
      scope: 'all',
      status: 'approved',
      user_id: user.userId,
      from: rangeFrom,
      to: rangeTo,
    });
    for (const lv of overlapping) {
      await adminRevokeLeave(admin.token, lv.id, 'e2e correction isolation').catch(() => {});
    }
  });

  test.afterAll(async () => {
    for (const id of stampIds) await deleteStampAdmin(admin.token, id).catch(() => {});
    for (const id of leaveIds) {
      await adminRevokeLeave(admin.token, id, 'e2e correction cleanup').catch(() => {});
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

  test('Timbratura standard adds the missing clock-out and clears missing_clock_out', async () => {
    const day = nthWeekdayBack(5, 9, 0);
    const out = nthWeekdayBack(5, 17, 0);

    const seed = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_in',
      occurred_at: day.iso,
      justification: 'e2e standard seed',
    });
    expect(seed.status, `seed clock_in: ${seed.code ?? ''} ${seed.message ?? ''}`).toBe(201);
    if (seed.data) stampIds.push(seed.data.id);

    const before = await anomalies(day.date);
    expect(before.map((a) => a.kind)).toContain('missing_clock_out');

    const fix = await apiPost<{ results: Array<{ status: string; id?: string }> }>(
      admin.token,
      '/api/v1/admin/stamps/fix-anomaly',
      {
        user_id: user.userId,
        events: [{ event_type: 'clock_out', occurred_at: out.iso }],
        justification: 'e2e timbratura standard',
      },
    );
    expect(fix.status, `fix-anomaly: ${fix.code ?? ''} ${fix.message ?? ''}`).toBe(200);
    const created = fix.data?.results.find((r) => r.status === 'created');
    expect(created?.id).toBeTruthy();
    if (created?.id) stampIds.push(created.id);

    const after = await anomalies(day.date);
    expect(after.map((a) => a.kind)).not.toContain('missing_clock_out');
  });

  test('day left on an open session reports missing_clock_out, not early_clock_out', async () => {
    // in 09:00 → out 12:30 (lunch) → in 14:00 with no closing punch: the exit is
    // genuinely missing, so the lunch clock-out must not be read as the exit
    // (which would raise early_clock_out with a non-null actual_end_at and hide
    // the Timbratura standard action). Prod repro: Bruno Borroni, 2026-07-29.
    // n=15, not one of n=2..4: mutating-anomalies-bulk.spec.ts seeds those as its
    // standard-correction band and its bulk "Timbratura standard" leaves a live
    // clock_out behind, which would close this day before it is even seeded.
    const day = nthWeekdayBack(15, 9, 0);
    const lunchOut = nthWeekdayBack(15, 12, 30);
    const backIn = nthWeekdayBack(15, 14, 0);
    const out = nthWeekdayBack(15, 17, 0);

    for (const [event_type, at] of [
      ['clock_in', day],
      ['clock_out', lunchOut],
      ['clock_in', backIn],
    ] as const) {
      const seed = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
        user_id: user.userId,
        event_type,
        occurred_at: at.iso,
        justification: 'e2e open-session seed',
      });
      expect(seed.status, `seed ${event_type}: ${seed.code ?? ''} ${seed.message ?? ''}`).toBe(201);
      if (seed.data) stampIds.push(seed.data.id);
    }

    const before = await anomalies(day.date);
    expect(before.map((a) => a.kind)).toContain('missing_clock_out');
    expect(before.map((a) => a.kind)).not.toContain('early_clock_out');
    // Null actual_end_at is what makes "Timbratura standard" available in the UI.
    expect(before.find((a) => a.kind === 'missing_clock_out')?.actual_end_at).toBeNull();

    // And the standard correction resolves it, as for a plain missing exit.
    const fix = await apiPost<{ results: Array<{ status: string; id?: string }> }>(
      admin.token,
      '/api/v1/admin/stamps/fix-anomaly',
      {
        user_id: user.userId,
        events: [{ event_type: 'clock_out', occurred_at: out.iso }],
        justification: 'e2e timbratura standard su sessione aperta',
      },
    );
    expect(fix.status, `fix-anomaly: ${fix.code ?? ''} ${fix.message ?? ''}`).toBe(200);
    // The punch must really be inserted, not reported back as 'skipped': the
    // day already holds a clock_out (the 12:30 lunch), and the old "this type
    // is already present today" rule dropped the closing punch because of it.
    expect(fix.data?.results.map((r) => r.status)).toEqual(['created']);
    const created = fix.data?.results.find((r) => r.status === 'created');
    expect(created?.id).toBeTruthy();
    if (created?.id) stampIds.push(created.id);

    const after = await anomalies(day.date);
    expect(after.map((a) => a.kind)).not.toContain('missing_clock_out');
  });

  // Read-only, and declared before the test that fills n=16: describe.serial
  // runs in declaration order, so the day still has zero punches here.
  test('a day with no punches at all is ONE unworked window, not a split', async ({ page }) => {
    // A scheduled day with no stamps raises missing_clock_in AND
    // missing_clock_out, and buildAnomaly leaves both actual_* anchors null —
    // so proposeGap hands back the SAME expected_start→expected_end window for
    // each. Reading a leading row plus a trailing row as "two disjoint
    // stretches" classified a plain absence as a split day: "Inserisci
    // permesso" vanished from its rows, and because the bulk bar intersected
    // across the selection, from every other day selected with it.
    const day = nthWeekdayBack(16, 9, 0);
    const kinds = (await anomalies(day.date)).map((a) => a.kind);
    expect(kinds, 'precondition: the day must be flagged at both ends').toEqual(
      expect.arrayContaining(['missing_clock_in', 'missing_clock_out']),
    );

    const userName = await resolveDisplayName(admin.token, CREDS.user.email);
    await page.goto('/anomalies');
    await expect(page.getByRole('heading', { name: /Anomalie orario/i })).toBeVisible({
      timeout: 15_000,
    });
    await page
      .waitForResponse((r) => r.url().includes('/api/v1/shifts/anomalies'), { timeout: 15_000 })
      .catch(() => {});
    await page.locator('input[type="date"]').first().fill(day.date);
    await page.locator('input[type="date"]').nth(1).fill(day.date);
    await page.locator('select').first().selectOption({ label: userName });
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/v1/shifts/anomalies') && r.url().includes(user.userId),
        { timeout: 15_000 },
      ),
      page.getByRole('button', { name: 'Aggiorna' }).click(),
    ]);

    const row = page
      .locator('li')
      .filter({ hasText: 'Entrata mancante' })
      .filter({ hasText: userName })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: /Correggi/ }).click();

    // The whole giornata is the single unworked stretch, so the permesso is
    // offered and the split explanation must NOT be on screen.
    //
    // 'Entrata mancante' has no entry punch to anchor a window of its own, so it
    // now borrows the giornata's — which is what gives the assertion below its
    // teeth: the hint is suppressed because the day is genuinely not a split,
    // and no longer merely because the row was speaking for itself.
    await expect(row.getByRole('option', { name: 'Inserisci permesso' })).toHaveCount(1);
    await expect(row.getByRole('option', { name: 'Inserisci ferie' })).toHaveCount(1);
    await expect(page.getByTestId('perm-split-hint')).toHaveCount(0);

    // Both punches are missing, so the menu opens on the correction that adds
    // them — never on an absence.
    await expect(row.getByRole('combobox')).toHaveValue('standard');

    // Nothing applied: the next test needs this day still empty.
    await row.getByRole('button', { name: 'Annulla' }).click();
  });

  test('Timbratura standard fills a day with no punches at all, once', async () => {
    // Both ends missing: the correction sends clock_in + clock_out in the same
    // request, and both must land. The clock_out is judged against the day's
    // session state, so it is only insertable because the clock_in of the same
    // request went in first — the handler sorts the events chronologically for
    // exactly this reason.
    // n=16 is the last day free between the open-session day (n=15) and the
    // shift's valid_from (n=17).
    const day = nthWeekdayBack(16, 9, 0);
    const out = nthWeekdayBack(16, 17, 0);

    const before = (await anomalies(day.date)).map((a) => a.kind);
    expect(before).toContain('missing_clock_in');
    expect(before).toContain('missing_clock_out');

    const payload = {
      user_id: user.userId,
      events: [
        { event_type: 'clock_in', occurred_at: day.iso },
        { event_type: 'clock_out', occurred_at: out.iso },
      ],
      justification: 'e2e timbratura standard giornata vuota',
    };

    const fix = await apiPost<{ results: Array<{ status: string; id?: string }> }>(
      admin.token,
      '/api/v1/admin/stamps/fix-anomaly',
      payload,
    );
    expect(fix.status, `fix-anomaly: ${fix.code ?? ''} ${fix.message ?? ''}`).toBe(200);
    expect(fix.data?.results.map((r) => r.status)).toEqual(['created', 'created']);
    for (const r of fix.data?.results ?? []) if (r.id) stampIds.push(r.id);

    const after = (await anomalies(day.date)).map((a) => a.kind);
    expect(after).not.toContain('missing_clock_in');
    expect(after).not.toContain('missing_clock_out');

    // The day is now closed, so re-running the same correction — a double-click,
    // or the row re-selected in the bulk bar — must add nothing. Anything
    // created here would be a duplicate punch in the payroll export.
    const again = await apiPost<{ results: Array<{ status: string; id?: string }> }>(
      admin.token,
      '/api/v1/admin/stamps/fix-anomaly',
      payload,
    );
    expect(again.status, `fix-anomaly (2): ${again.code ?? ''} ${again.message ?? ''}`).toBe(200);
    expect(again.data?.results.map((r) => r.status)).toEqual(['skipped', 'skipped']);
    for (const r of again.data?.results ?? []) if (r.id) stampIds.push(r.id);
  });

  test('Inserisci ferie (full day) clears missing_clock_in', async () => {
    const start = nthWeekdayBack(6, 9, 0);
    const end = nthWeekdayBack(6, 17, 0);

    const before = await anomalies(start.date);
    expect(before.map((a) => a.kind)).toContain('missing_clock_in');

    const res = await apiPost<{ id: string }>(admin.token, '/api/v1/leaves/admin-create', {
      user_id: user.userId,
      type: 'ferie',
      from_ts: start.iso,
      to_ts: end.iso,
      user_note: 'e2e ferie da anomalia',
    });
    expect(res.status, `admin-create ferie: ${res.code ?? ''} ${res.message ?? ''}`).toBe(201);
    if (res.data) leaveIds.push(res.data.id);

    const leaves = await listLeaves(admin.token, {
      scope: 'all',
      user_id: user.userId,
      from: start.date,
      to: start.date,
    });
    expect(leaves.some((l) => l.id === res.data?.id && l.type === 'ferie')).toBe(true);

    const after = await anomalies(start.date);
    expect(after.map((a) => a.kind)).not.toContain('missing_clock_in');
  });

  test('Inserisci permesso (covers the late stretch) clears late_clock_in', async () => {
    const late = nthWeekdayBack(7, 9, 30);
    const out = nthWeekdayBack(7, 17, 0);
    const expectedStart = nthWeekdayBack(7, 9, 0);

    const seedIn = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_in',
      occurred_at: late.iso,
      justification: 'e2e permesso seed in',
    });
    expect(seedIn.status).toBe(201);
    if (seedIn.data) stampIds.push(seedIn.data.id);
    const seedOut = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_out',
      occurred_at: out.iso,
      justification: 'e2e permesso seed out',
    });
    expect(seedOut.status).toBe(201);
    if (seedOut.data) stampIds.push(seedOut.data.id);

    const before = await anomalies(late.date);
    expect(before.map((a) => a.kind)).toContain('late_clock_in');

    const res = await apiPost<{ id: string }>(admin.token, '/api/v1/leaves/admin-create', {
      user_id: user.userId,
      type: 'permessi',
      from_ts: expectedStart.iso,
      to_ts: late.iso,
      user_note: 'e2e permesso da anomalia',
    });
    expect(res.status, `admin-create permesso: ${res.code ?? ''} ${res.message ?? ''}`).toBe(201);
    if (res.data) leaveIds.push(res.data.id);

    const after = await anomalies(late.date);
    expect(after.map((a) => a.kind)).not.toContain('late_clock_in');
  });

  test('Giustifica con nota annotates the anomaly via the UI', async ({ page }) => {
    const day = nthWeekdayBack(8, 9, 0);
    const out = nthWeekdayBack(8, 13, 0); // 4h worked vs 8h expected → short_hours

    const seedIn = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_in',
      occurred_at: day.iso,
      justification: 'e2e giustifica seed in',
    });
    expect(seedIn.status).toBe(201);
    if (seedIn.data) stampIds.push(seedIn.data.id);
    const seedOut = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_out',
      occurred_at: out.iso,
      justification: 'e2e giustifica seed out',
    });
    expect(seedOut.status).toBe(201);
    if (seedOut.data) stampIds.push(seedOut.data.id);

    expect((await anomalies(day.date)).map((a) => a.kind)).toContain('short_hours');

    // Isolate the seeded day + user in the UI so the row is unambiguous. The
    // employee's display_name drifts on the shared tenant, so resolve the live
    // value rather than pinning a literal.
    const userName = await resolveDisplayName(admin.token, CREDS.user.email);
    await page.goto('/anomalies');
    await expect(page.getByRole('heading', { name: /Anomalie orario/i })).toBeVisible({ timeout: 15_000 });
    // Let the initial mount-load (all users, default range) finish before we
    // filter, so its response can't land late and revert our filtered list
    // mid-interaction (which would detach the open Correggi form).
    await page
      .waitForResponse((r) => r.url().includes('/api/v1/shifts/anomalies'), { timeout: 15_000 })
      .catch(() => {});
    await page.locator('input[type="date"]').first().fill(day.date);
    await page.locator('input[type="date"]').nth(1).fill(day.date);
    await page.locator('select').first().selectOption({ label: userName });
    // Couple the click with its response so the filtered (user + day) list is
    // fully settled before we touch a row — no pending load remains to re-render
    // the list while the Correggi form is open.
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/v1/shifts/anomalies') && r.url().includes(user.userId),
        { timeout: 15_000 },
      ),
      page.getByRole('button', { name: 'Aggiorna' }).click(),
    ]);

    // Scope the row to the seeded employee's name so we never act on another
    // user's row (a real anomaly elsewhere could otherwise sort first).
    const row = page
      .locator('li')
      .filter({ hasText: 'Ore giornaliere insufficienti' })
      .filter({ hasText: userName })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: /Correggi/ }).click();
    await row.getByRole('combobox').selectOption({ label: 'Giustifica con nota' });
    await row.getByRole('textbox').fill('e2e giustifica da anomalia');
    await row.getByRole('button', { name: 'Conferma' }).click();

    // Wait for the form to close (justify POST resolved), then re-apply the
    // filter via "Aggiorna" so the final list is the seeded user+day fetch — not
    // a late-resolving initial mount-load (all users / default range) that could
    // otherwise overwrite it. (Server-side merge is verified directly by the API
    // check just below.)
    await expect(row.getByRole('button', { name: 'Conferma' })).toHaveCount(0, { timeout: 10_000 });
    await page.getByRole('button', { name: 'Aggiorna' }).click();

    // "Nascondi giustificate" is on by default, so the row it just annotated
    // drops out of the list — that is the point of the filter.
    await expect(row).toHaveCount(0, { timeout: 15_000 });

    // Unchecking it brings the row back, now carrying its note.
    await page.getByTestId('hide-justified').uncheck();
    await expect(row.getByText(/Giustificata:/)).toBeVisible({ timeout: 15_000 });

    // API confirms the note persisted on the right (day, kind).
    const after = await anomalies(day.date);
    const sh = after.find((a) => a.kind === 'short_hours');
    expect(sh?.justification_note).toBe('e2e giustifica da anomalia');
  });
});
