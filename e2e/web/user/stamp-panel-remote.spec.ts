import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../../fixtures/test-data';
import { apiPatch, loadHandleFromStorage, type ApiHandle } from '../../fixtures/api-client';

// Flips test3 to remote-capable so the web stamping buttons render, then
// restores the seeded gps-only default in afterAll (best-effort, per the
// mutating-spec convention). Does NOT click the action buttons / create real
// stamps — that would leave stamp residue on the test tenant — it only asserts
// the remote-enabled UI appears.
const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('web (employee) — remote stamping enabled (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');
  test.describe.configure({ mode: 'serial' });

  let admin: ApiHandle;
  let user: ApiHandle;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    await apiPatch(admin.token, `/api/v1/users/${user.userId}`, {
      stamp_modes: ['gps', 'remote'],
    });
  });

  test.afterAll(async () => {
    if (admin && user) {
      await apiPatch(admin.token, `/api/v1/users/${user.userId}`, {
        stamp_modes: ['gps'],
      }).catch(() => {});
    }
  });

  test('shows a stamping action button and hides the disabled notice', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Ciao,/ })).toBeVisible({ timeout: 15_000 });
    // State-dependent label (clocked-out → "Timbra ingresso", mid-shift →
    // "Timbra uscita"/"Termina pausa", …) — match any stamping action so the
    // assertion is robust to test3's current open/closed state.
    await expect(
      page.getByRole('button', { name: /Timbra|Termina|Inizia/ }).first()
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/La timbratura da web non è abilitata/)).toHaveCount(0);
  });
});
