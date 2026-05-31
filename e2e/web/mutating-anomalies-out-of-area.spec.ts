import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  apiPost,
  deleteStampAdmin,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

// Seed a clock_out flagged `out_of_geofence` via the admin manual route, then
// assert the Anomalie page renders the `Uscita fuori area` KIND_LABEL. The
// anomaly is template-independent (apps/backend/src/routes/shifts.ts — emitted
// before the `shift_template_id` gate), so no shift assignment is needed.
const ENABLED = process.env.E2E_MUTATING === '1';

function yesterdayISOAt(hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

test.describe('web — Anomalie out-of-area clock-out (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  let stampId: string | null = null;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    const r = await apiPost<{ id: string }>(admin.token, '/api/v1/admin/stamps', {
      user_id: user.userId,
      event_type: 'clock_out',
      occurred_at: yesterdayISOAt(18),
      out_of_geofence: true,
      justification: 'e2e out-of-area seed',
    });
    if (r.status === 201 && r.data) stampId = r.data.id;
  });

  test.afterAll(async () => {
    if (stampId) await deleteStampAdmin(admin.token, stampId).catch(() => {});
  });

  test('Anomalie page renders the seeded Uscita fuori area label', async ({ page }) => {
    await page.goto('/anomalies');
    await expect(page.getByRole('heading', { name: /Anomalie orario/i })).toBeVisible({ timeout: 15_000 });
    // Default 30-day range includes yesterday — wait for the matching KIND_LABEL.
    await expect(page.getByText('Uscita fuori area').first()).toBeVisible({ timeout: 15_000 });
  });
});
