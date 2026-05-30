import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import { apiGet, apiPatch, loadHandleFromStorage, type ApiHandle } from '../fixtures/api-client';

// Per-user stamp_modes: admin PATCH round-trip + server-side enforcement.
// Mutates test3's stamp_modes during the run and restores the seeded {gps}
// default in afterAll (best-effort, per the mutating-spec convention).
const ENABLED = process.env.E2E_MUTATING === '1';
const API_BASE = process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it';

interface UserRow {
  user_id: string;
  stamp_modes: string[];
}

async function modesOf(adminToken: string, userId: string): Promise<string[]> {
  const list = await apiGet<UserRow[]>(adminToken, '/api/v1/users');
  const row = list.find((u) => u.user_id === userId);
  if (!row) throw new Error(`user ${userId} not present in /api/v1/users`);
  return (row.stamp_modes ?? []).slice().sort();
}

// /api/v1/stamps requires an Idempotency-Key header (which api-client.apiPost
// does not set), so use a raw fetch and surface { status, code }.
async function tryStamp(
  token: string,
  platform: string
): Promise<{ status: number; code?: string }> {
  const r = await fetch(`${API_BASE}/api/v1/stamps`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `e2e-modes-${platform}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
    },
    body: JSON.stringify({
      event_type: 'clock_in',
      occurred_at: new Date().toISOString(),
      device_platform: platform,
    }),
  });
  let code: string | undefined;
  try {
    code = JSON.parse(await r.text())?.error?.code;
  } catch {
    /* non-JSON body */
  }
  return { status: r.status, code };
}

test.describe('web — per-user stamp_modes (mutating)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
  });

  test.afterAll(async () => {
    // Restore the seeded default so other specs see test3 as gps-only / web-blocked.
    if (admin && user) {
      await apiPatch(admin.token, `/api/v1/users/${user.userId}`, {
        stamp_modes: ['gps'],
      }).catch(() => {});
    }
  });

  test('PATCH stamp_modes round-trips through GET /users', async () => {
    for (const modes of [['gps'], ['remote'], ['gps', 'remote'], []] as const) {
      await apiPatch(admin.token, `/api/v1/users/${user.userId}`, { stamp_modes: modes });
      expect(await modesOf(admin.token, user.userId)).toEqual([...modes].sort());
    }
  });

  test('invalid mode (wifi, not yet implemented) is rejected with 400', async () => {
    const r = await fetch(`${API_BASE}/api/v1/users/${user.userId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stamp_modes: ['wifi'] }),
    });
    expect(r.status).toBe(400);
  });

  test('empty stamp_modes → stamping blocked (STAMPING_DISABLED)', async () => {
    await apiPatch(admin.token, `/api/v1/users/${user.userId}`, { stamp_modes: [] });
    const res = await tryStamp(user.token, 'web');
    expect(res.status).toBe(403);
    expect(res.code).toBe('STAMPING_DISABLED');
  });

  test('gps-only user → web stamp blocked (WEB_CLOCK_IN_DISABLED)', async () => {
    await apiPatch(admin.token, `/api/v1/users/${user.userId}`, { stamp_modes: ['gps'] });
    const res = await tryStamp(user.token, 'web');
    expect(res.status).toBe(403);
    expect(res.code).toBe('WEB_CLOCK_IN_DISABLED');
  });
});
