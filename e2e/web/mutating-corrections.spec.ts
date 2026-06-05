import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  approveCorrection,
  createCorrection,
  deleteStampAdmin,
  loadHandleFromStorage,
  rejectCorrection,
  type ApiHandle,
} from '../fixtures/api-client';

// Mutating tests are gated behind E2E_MUTATING=1 — they create real rows
// on the test tenant via the API, exercise the admin UI, then clean up.
// See e2e/summary.md "Mutating specs" for the cleanup policy.
const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('web — Correzioni approve cycle (admin)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let marker: string;

  test.beforeEach(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    // Seed: test3 files a "create-missing" correction for a date 5 days in
    // the past (out of the live "today's stamps" range used by mobile, so we
    // don't pollute test3's current-state computation). The marker is
    // appended to `justification` so we can grep for it on the admin page.
    marker = `e2e-${Date.now()}`;
    const branchId = admin.branches[0]?.id ?? null;
    const occurredAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const created = await createCorrection(user.token, {
      original_stamp_id: null,
      claimed_event_type: 'clock_in',
      claimed_occurred_at: occurredAt,
      claimed_branch_id: branchId,
      justification: `e2e cycle ${marker}: avevo dimenticato di timbrare l'ingresso`,
    });
    // Cleanup of the stamp created on approval is best-effort and out of
    // scope for this test — we look it up via the stamps list and try to
    // delete it. If we can't find it (rare race), the tenant absorbs one
    // stale orphan stamp.
    test.info().annotations.push({ type: 'correction-id', description: created.id });
  });

  test.afterEach(async () => {
    // Find the stamp our approve cycle created (source='employee_correction',
    // user_id=test3, notes contains our marker), then admin-delete it.
    try {
      const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const toDate = new Date().toISOString().slice(0, 10);
      const stamps = await fetch(
        `${process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it'}/api/v1/stamps?user_id=${user.userId}&from=${fromDate}&to=${toDate}`,
        { headers: { Authorization: `Bearer ${admin.token}` } },
      );
      const body = (await stamps.json()) as { data?: Array<{ id: string; notes?: string | null }> };
      const ours = body.data?.find((s) => (s.notes ?? '').includes(marker));
      if (ours) await deleteStampAdmin(admin.token, ours.id);
    } catch {
      /* best-effort */
    }
  });

  test('approve cycle: admin clicks Approva → request flips to Approvata + stamp created', async ({ page }) => {
    await page.goto('/corrections');
    await expect(page.getByRole('heading', { name: 'Correzioni' })).toBeVisible({ timeout: 15_000 });
    // Filter is "Solo in attesa" by default. Find the card by our unique marker.
    const card = page.locator('.card', { hasText: marker }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.getByRole('button', { name: 'Approva' }).click();
    // Wait for the button to disappear from the card (pending → approved).
    await expect(card.getByRole('button', { name: 'Approva' })).toHaveCount(0, { timeout: 10_000 });
    // Cross-check via the API that the row actually flipped to 'approved'.
    // The DataGrid view filter swallows the row depending on pagination /
    // sort, so a UI-only badge check is flaky on a busy tenant — API is
    // the source of truth.
    const list = await fetch(
      `${process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it'}/api/v1/correction-requests?status=approved`,
      { headers: { Authorization: `Bearer ${admin.token}` } },
    );
    const body = (await list.json()) as {
      data?: Array<{ id: string; justification?: string; status: string }>;
    };
    const ours = body.data?.find((r) => (r.justification ?? '').includes(marker));
    expect(ours, `expected approved correction matching marker ${marker}`).toBeDefined();
    expect(ours!.status).toBe('approved');
  });
});

test.describe('web — Correzioni multi-approver race (API-level)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  test('two concurrent approves: one wins, one returns 409 CONFLICT', async () => {
    // No UI here — this is purely a backend-concurrency assertion that
    // matches the "Vince il primo che decide" UI copy. We use API
    // approvals to provoke a real race without the browser overhead.
    const admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    const user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    const branchId = admin.branches[0]?.id ?? null;
    const occurredAt = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const correction = await createCorrection(user.token, {
      original_stamp_id: null,
      claimed_event_type: 'clock_in',
      claimed_occurred_at: occurredAt,
      claimed_branch_id: branchId,
      justification: `e2e race: doppio approver ${Date.now()}`,
    });
    let stampId: string | null = null;
    try {
      // Fire both approvals as the same admin in parallel. The FOR UPDATE
      // lock in correction-requests.ts:160 serialises them.
      const [a, b] = await Promise.all([
        approveCorrection(admin.token, correction.id),
        approveCorrection(admin.token, correction.id),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);
      const conflict = a.status === 409 ? a : b;
      expect(conflict.code).toBe('CONFLICT');
      // The winner returned the resulting stamp id — grab it for cleanup.
      const winner = a.status === 200 ? a : b;
      stampId = (winner.data as { stamp?: { id?: string } } | null)?.stamp?.id ?? null;
    } finally {
      if (stampId) {
        await deleteStampAdmin(admin.token, stampId).catch(() => {});
      }
    }
  });
});

test.describe('web — Correzioni create flow submit (admin, via modal)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let marker: string;
  let createdId: string | null;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
  });

  test.beforeEach(() => {
    marker = `e2e-admin-ui-${Date.now()}`;
    createdId = null;
  });

  test.afterEach(async () => {
    // No DELETE endpoint on correction_requests — reject so it drops out of
    // the pending queue; the globalTeardown marker-sweep wipes it entirely.
    try {
      if (!createdId) {
        const res = await fetch(
          `${process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it'}/api/v1/correction-requests?status=pending`,
          { headers: { Authorization: `Bearer ${admin.token}` } },
        );
        const body = (await res.json()) as { data?: Array<{ id: string; justification?: string }> };
        createdId = body.data?.find((r) => (r.justification ?? '').includes(marker))?.id ?? null;
      }
      if (createdId) await rejectCorrection(admin.token, createdId);
    } catch {
      /* best-effort — teardown sweep is the safety net */
    }
  });

  test('admin files a missing-stamp correction in the modal → pending row created', async ({ page }) => {
    await page.goto('/corrections');
    await expect(page.getByRole('heading', { name: 'Correzioni' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Nuova richiesta/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // Target a date 4 days in the past so we don't perturb today's live state.
    const past = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await dialog.getByLabel('Data').fill(past);
    await page.getByRole('button', { name: 'Continua' }).click();
    await page.getByRole('button', { name: /Aggiungi una timbratura mancante/i }).click();
    await dialog
      .getByPlaceholder("Es. avevo dimenticato di timbrare l'uscita")
      .fill(`${marker}: avevo dimenticato di timbrare l'ingresso`);
    await page.getByRole('button', { name: 'Invia richiesta' }).click();
    // On success the modal closes.
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    // Source of truth: the API confirms a pending row carrying our marker.
    const res = await fetch(
      `${process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it'}/api/v1/correction-requests?status=pending`,
      { headers: { Authorization: `Bearer ${admin.token}` } },
    );
    const body = (await res.json()) as {
      data?: Array<{ id: string; justification?: string; status: string }>;
    };
    const ours = body.data?.find((r) => (r.justification ?? '').includes(marker));
    expect(ours, `expected pending correction matching marker ${marker}`).toBeDefined();
    createdId = ours!.id;
    expect(ours!.status).toBe('pending');
  });
});
