import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../../fixtures/test-data';
import {
  apiFetch,
  apiGet,
  apiPatch,
  apiPost,
  assignShift,
  createShiftTemplate,
  deleteShiftTemplate,
  deleteStampAdmin,
  loadHandleFromStorage,
  rejectCorrection,
  type ApiHandle,
} from '../../fixtures/api-client';
import { romeWallClockISO } from '../../fixtures/time';

// Per-template pausa switch (shift_templates.break_enabled, migration 057).
//
// Assigns test3 a template with the pausa switched OFF, then asserts:
//   * the flag round-trips through the admin template endpoints,
//   * an employee break_start is refused server-side with BREAK_DISABLED,
//   * pausa pranzo is untouched (the switch is break-only),
//   * a correction request claiming a break is refused too, while a clock_in
//     correction still goes through,
//   * the employee dashboard drops the "Inizia pausa" button mid-shift,
//   * flipping the flag back on lifts the refusal.
//
// The gate runs before the geofence and before the state machine, so
// break_start is rejected whatever open shift test3 happens to be in — no stamp
// row is created by the refused calls. The one seeded clock_in (admin manual,
// which bypasses the gate on purpose) is deleted in afterAll.
const ENABLED = process.env.E2E_MUTATING === '1';

interface TemplateRow {
  id: string;
  name: string;
  break_enabled: boolean;
}

async function stampAs(
  token: string,
  eventType: string
): Promise<{ status: number; code?: string; id?: string }> {
  const r = await apiFetch(token, '/api/v1/stamps', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The middleware only accepts [a-zA-Z0-9-], so the event's underscore
      // has to go or the request dies at 400 before reaching the pausa gate.
      'Idempotency-Key': `e2e-break-${eventType.replace(/_/g, '-')}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
    },
    body: JSON.stringify({
      event_type: eventType,
      occurred_at: new Date().toISOString(),
      // 'mobile', not 'web': test3 is seeded gps-only, and a web platform would
      // trip WEB_CLOCK_IN_DISABLED before the pausa gate is even reached.
      device_platform: 'mobile',
    }),
  });
  let code: string | undefined;
  let id: string | undefined;
  try {
    const body = JSON.parse(await r.text());
    code = body?.error?.code;
    id = body?.data?.id;
  } catch {
    /* non-JSON body */
  }
  return { status: r.status, code, id };
}

test.describe('web (employee) — pausa disabilitata sull\'orario (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');
  test.describe.configure({ mode: 'serial' });

  let admin: ApiHandle;
  let user: ApiHandle;
  let templateId: string | null = null;
  let seededClockInId: string | null = null;
  const strayStampIds: string[] = [];
  let validFrom: string;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);

    const tpl = await createShiftTemplate(admin.token, {
      name: `e2e-no-break-${Date.now()}`,
      description: 'e2e pausa disabilitata',
      break_enabled: false,
      slots: [1, 2, 3, 4, 5, 6, 7].map((dow) => ({
        day_of_week: dow,
        start_time: '09:00',
        end_time: '17:00',
      })),
    });
    templateId = tpl.id;

    validFrom = romeWallClockISO(new Date(), 12).date;
    await assignShift(admin.token, {
      user_id: user.userId,
      shift_template_id: templateId,
      valid_from: validFrom,
    });
    // Remote too, so the employee dashboard renders the stamping buttons.
    await apiPatch(admin.token, `/api/v1/users/${user.userId}`, {
      stamp_modes: ['gps', 'remote'],
    });
  });

  test.afterAll(async () => {
    if (!admin) return;
    for (const id of [seededClockInId, ...strayStampIds]) {
      if (id) await deleteStampAdmin(admin.token, id).catch(() => {});
    }
    await assignShift(admin.token, {
      user_id: user.userId,
      shift_template_id: null,
      valid_from: validFrom,
    }).catch(() => {});
    if (templateId) await deleteShiftTemplate(admin.token, templateId).catch(() => {});
    await apiPatch(admin.token, `/api/v1/users/${user.userId}`, {
      stamp_modes: ['gps'],
    }).catch(() => {});
  });

  test('break_enabled=false round-trips through the template endpoints', async () => {
    const list = await apiGet<TemplateRow[]>(admin.token, '/api/v1/shifts/templates');
    expect(list.find((t) => t.id === templateId)?.break_enabled).toBe(false);

    const one = await apiGet<TemplateRow>(
      admin.token,
      `/api/v1/shifts/templates/${templateId}`
    );
    expect(one.break_enabled).toBe(false);
  });

  test('the assignment the employee reads carries the flag', async () => {
    const a = await apiGet<{ shift_template_id: string; break_enabled: boolean } | null>(
      user.token,
      '/api/v1/shifts/assignments/me'
    );
    expect(a?.shift_template_id).toBe(templateId);
    expect(a?.break_enabled).toBe(false);
  });

  test('employee break_start is refused with BREAK_DISABLED', async () => {
    const r = await stampAs(user.token, 'break_start');
    if (r.id) strayStampIds.push(r.id); // never expected — swept if the gate regresses
    expect(r.status).toBe(403);
    expect(r.code).toBe('BREAK_DISABLED');
  });

  test('pausa pranzo is not gated by the pausa switch', async () => {
    const r = await stampAs(user.token, 'lunch_start');
    // Whatever the current shift state produces (201, or a transition/geofence
    // refusal), it must never be the pausa refusal — lunch is a separate event.
    expect(r.code).not.toBe('BREAK_DISABLED');
    // Undo straight away, not in afterAll: if test3 was mid-shift this lands a
    // real lunch_start and leaves the account `on_lunch`, which would change
    // which buttons the dashboard test below finds on screen.
    if (r.id) await deleteStampAdmin(admin.token, r.id).catch(() => strayStampIds.push(r.id!));
  });

  test('a correction request claiming a break is refused, clock_in is not', async () => {
    const at = romeWallClockISO(new Date(), 10, 30).iso;
    const bad = await apiPost(user.token, '/api/v1/correction-requests', {
      original_stamp_id: null,
      claimed_event_type: 'break_start',
      claimed_occurred_at: at,
      claimed_branch_id: null,
      justification: 'e2e pausa disabilitata',
    });
    expect(bad.status).toBe(403);
    expect(bad.code).toBe('BREAK_DISABLED');

    const good = await apiPost<{ id: string }>(user.token, '/api/v1/correction-requests', {
      original_stamp_id: null,
      claimed_event_type: 'clock_in',
      claimed_occurred_at: at,
      claimed_branch_id: null,
      justification: 'e2e pausa disabilitata — controllo',
    });
    expect(good.status).toBe(201);
    if (good.data?.id) {
      await rejectCorrection(admin.token, good.data.id, 'e2e cleanup').catch(() => {});
    }
  });

  test('the employee dashboard drops "Inizia pausa" mid-shift', async ({ page }) => {
    // Seed an open shift so the mid-shift buttons are the ones on screen.
    // Admin manual entry bypasses the pausa gate by design.
    // `now`, not a fixed 09:00: the state machine reads the LATEST event, so an
    // earlier timestamp would be shadowed by whatever test3 already has today.
    const seed = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_in',
      occurred_at: new Date().toISOString(),
      justification: 'e2e pausa disabilitata seed',
    });
    expect(seed.status).toBe(201);
    seededClockInId = seed.data!.id;

    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Timbra uscita' })).toBeVisible({
      timeout: 15_000,
    });
    // `exact` matters: "Inizia pausa" is a substring of "Inizia pausa pranzo",
    // and the default substring match would find the lunch button instead.
    await expect(page.getByRole('button', { name: 'Inizia pausa', exact: true })).toHaveCount(0);
    // Positive control — the switch is break-only, pausa pranzo stays offered.
    await expect(
      page.getByRole('button', { name: 'Inizia pausa pranzo', exact: true })
    ).toBeVisible();
  });

  test('re-enabling the pausa lifts the refusal and restores the button', async ({ page }) => {
    await apiPatch(admin.token, `/api/v1/shifts/templates/${templateId}`, {
      break_enabled: true,
    });
    const a = await apiGet<{ break_enabled: boolean } | null>(
      user.token,
      '/api/v1/shifts/assignments/me'
    );
    expect(a?.break_enabled).toBe(true);

    const r = await stampAs(user.token, 'break_start');
    if (r.id) strayStampIds.push(r.id);
    expect(r.code).not.toBe('BREAK_DISABLED');

    await page.goto('/');
    await expect(page.getByRole('button', { name: /Timbra|Termina|Inizia/ }).first()).toBeVisible({
      timeout: 15_000,
    });
    // Either the shift is still open (→ "Inizia pausa") or the break_start above
    // landed (→ "Termina pausa"); with the switch back on, one of them shows.
    await expect(
      page.getByRole('button', { name: /^(Inizia|Termina) pausa$/ }).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
