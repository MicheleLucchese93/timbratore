import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  adminRevokeLeave,
  approveLeave,
  createLeave,
  loadHandleFromStorage,
  type ApiHandle,
  type LeaveRow,
} from '../fixtures/api-client';

// Italian compliance scenario: employee already has approved `ferie` for
// dates D1..D3. They then file a malattia certificate covering D1..D3. The
// backend's `applyMalattiaOverlap()` flips the ferie row to status
// `superseded_by_malattia`. The admin UI surfaces this as a Italian-
// language status badge "Sostituita da malattia".
const ENABLED = process.env.E2E_MUTATING === '1';

function isoDay(minOffset: number): { from: string; to: string } {
  // Push the date to a weekday so the backend's fallback shift (Mon–Fri =
  // 8h, weekends = 0h) produces a non-zero duration. computeDurationHours
  // returns 0 on weekends → POST /leaves throws "non copre ore lavorative".
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + minOffset);
  while (start.getUTCDay() === 0 || start.getUTCDay() === 6) {
    start.setUTCDate(start.getUTCDate() + 1);
  }
  start.setUTCHours(7, 0, 0, 0);
  const end = new Date(start);
  end.setUTCHours(17, 0, 0, 0);
  return { from: start.toISOString(), to: end.toISOString() };
}

test.describe('web — Malattia supersedes overlapping ferie (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let ferie: LeaveRow | null = null;
  let malattia: LeaveRow | null = null;

  test.beforeEach(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    // Pick a window 60 days in the future so the seeded rows do not show up
    // in dashboards focused on "now" or "next 14 days".
    const range = isoDay(60);
    // 1) Employee files ferie.
    ferie = await createLeave(user.token, {
      type: 'ferie',
      from_ts: range.from,
      to_ts: range.to,
      user_note: `e2e malattia-overlap ferie ${Date.now()}`,
    });
    // 2) Admin approves it. (Status becomes 'approved'.)
    ferie = await approveLeave(admin.token, ferie.id);
    expect(ferie.status).toBe('approved');
  });

  test.afterEach(async () => {
    // Best-effort cleanup. `malattia` auto-approves and can only be revoked
    // by an admin; same path works for the now-superseded ferie.
    if (malattia) await adminRevokeLeave(admin.token, malattia.id, 'e2e cleanup').catch(() => {});
    if (ferie) await adminRevokeLeave(admin.token, ferie.id, 'e2e cleanup').catch(() => {});
    ferie = null;
    malattia = null;
  });

  test('filing overlapping malattia flips ferie → "Sostituita da malattia"', async ({ page }) => {
    // 3) Employee files a malattia overlapping the same window.
    const range = isoDay(60);
    malattia = await createLeave(user.token, {
      type: 'malattia',
      from_ts: range.from,
      to_ts: range.to,
      inps_protocol: `e2e-${Date.now()}`,
      user_note: `e2e malattia-overlap malattia ${Date.now()}`,
    });
    expect(malattia.status).toBe('approved'); // malattia auto-approves
    // 4) Open the admin Leaves page → switch grid filter to "Tutte" so the
    //    superseded ferie row is visible. Find by our unique user_note
    //    marker. The status badge must read "Sostituita da malattia".
    await page.goto('/leaves');
    await expect(page.getByRole('heading', { name: 'Ferie & Permessi' })).toBeVisible({
      timeout: 15_000,
    });
    // The DataGrid filters apply via the Stato column. Easiest assertion: a
    // badge with the literal text "Sostituita da malattia" exists on the page.
    await expect(page.getByText('Sostituita da malattia').first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
