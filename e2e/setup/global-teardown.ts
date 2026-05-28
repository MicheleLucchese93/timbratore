/**
 * Playwright globalTeardown — purges any leftover e2e-*@e2e.local fixtures
 * after the full suite finishes (regardless of pass/fail). Belt-and-braces
 * over each spec's afterAll: if a spec crashes mid-run, this still cleans up.
 *
 * No-op when E2E_PURGE_SECRET is not set (CI without prod purge access,
 * local runs against a disposable DB). Logs but never throws — teardown
 * failure must not mask test failures.
 */

const API_BASE = process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it';

export default async function globalTeardown(): Promise<void> {
  const secret = process.env.E2E_PURGE_SECRET;
  if (!secret) {
    // eslint-disable-next-line no-console
    console.log('[teardown] E2E_PURGE_SECRET unset — skipping fixture purge');
    return;
  }
  try {
    const r = await fetch(`${API_BASE}/api/v1/_internal/e2e/purge-fixtures`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = (await r.json().catch(() => null)) as
      | { ok: boolean; data?: { memberships_deleted: number; auth_users_deleted: number; gotrue_users_deleted: number } }
      | null;
    if (!r.ok || !body?.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[teardown] purge failed: ${r.status} ${JSON.stringify(body)}`);
      return;
    }
    const d = body.data!;
    // eslint-disable-next-line no-console
    console.log(
      `[teardown] purged ${d.memberships_deleted} memberships, ${d.auth_users_deleted} auth_users, ${d.gotrue_users_deleted} gotrue users`
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[teardown] purge error', (err as Error).message);
  }
}
