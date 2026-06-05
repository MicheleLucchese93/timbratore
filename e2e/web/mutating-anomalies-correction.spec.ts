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
  type ApiHandle,
} from '../fixtures/api-client';

// Exercises the "Correggi" menu on the Anomalie page end-to-end: each typical
// correction resolves the anomaly it targets (per apps/backend/src/routes/shifts.ts
// + admin-stamps.ts + leaves.ts). Recipe per test:
//   - Timbratura standard → POST /admin/stamps/fix-anomaly adds the missing
//     clock-out → `missing_clock_out` disappears.
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
  d.setUTCHours(hour, minute, 0, 0);
  return { iso: d.toISOString(), date: d.toISOString().slice(0, 10) };
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

    rangeFrom = nthWeekdayBack(8, 0, 0).date;
    rangeTo = new Date().toISOString().slice(0, 10);
    validFrom = nthWeekdayBack(7, 0, 0).date;

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
    const day = nthWeekdayBack(1, 9, 0);
    const out = nthWeekdayBack(1, 17, 0);

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

  test('Inserisci ferie (full day) clears missing_clock_in', async () => {
    const start = nthWeekdayBack(2, 9, 0);
    const end = nthWeekdayBack(2, 17, 0);

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
    const late = nthWeekdayBack(3, 9, 30);
    const out = nthWeekdayBack(3, 17, 0);
    const expectedStart = nthWeekdayBack(3, 9, 0);

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
    const day = nthWeekdayBack(4, 9, 0);
    const out = nthWeekdayBack(4, 13, 0); // 4h worked vs 8h expected → short_hours

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

    // Isolate the seeded day + user in the UI so the row is unambiguous.
    await page.goto('/anomalies');
    await expect(page.getByRole('heading', { name: /Anomalie orario/i })).toBeVisible({ timeout: 15_000 });
    await page.locator('input[type="date"]').first().fill(day.date);
    await page.locator('input[type="date"]').nth(1).fill(day.date);
    await page.locator('select').first().selectOption({ label: CREDS.user.displayName });
    await page.getByRole('button', { name: 'Aggiorna' }).click();

    const row = page.locator('li', { hasText: 'Ore giornaliere insufficienti' }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: /Correggi/ }).click();
    await row.getByRole('combobox').selectOption({ label: 'Giustifica con nota' });
    await row.getByRole('textbox').fill('e2e giustifica da anomalia');
    await row.getByRole('button', { name: 'Conferma' }).click();

    await expect(row.getByText(/Giustificata:/)).toBeVisible({ timeout: 15_000 });

    // API confirms the note persisted on the right (day, kind).
    const after = await anomalies(day.date);
    const sh = after.find((a) => a.kind === 'short_hours');
    expect(sh?.justification_note).toBe('e2e giustifica da anomalia');
  });
});
