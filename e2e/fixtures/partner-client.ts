/**
 * API helpers for the partner-app e2e suite. Talks to the LOCAL backend
 * (DEV_AUTH_ENABLED) so nothing touches prod. Uses the bearer-guarded
 * /api/v1/_internal/e2e/* endpoints to seed partnership members + fixture users.
 */

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:4000';
const PURGE_SECRET = process.env.E2E_PURGE_SECRET ?? '';

export interface PartnerCapsInput {
  cap_tenants?: number | null;
  cap_users_per_tenant?: number | null;
  cap_admins_per_tenant?: number | null;
  cap_documentali_per_tenant?: number | null;
  cap_branches_per_tenant?: number | null;
}

// Seed (or update) a partnership member. role 'admin' | 'partner'.
export async function grantPartnership(opts: {
  email: string;
  role: 'admin' | 'partner';
  password?: string;
  caps?: PartnerCapsInput;
}): Promise<void> {
  if (!PURGE_SECRET) throw new Error('E2E_PURGE_SECRET is required to seed partnership fixtures');
  const r = await fetch(`${API_BASE}/api/v1/_internal/e2e/grant-partnership`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PURGE_SECRET}` },
    body: JSON.stringify({
      email: opts.email,
      role: opts.role,
      password: opts.password ?? 'Test123@!',
      ...(opts.caps ?? {}),
    }),
  });
  if (!r.ok) throw new Error(`grant-partnership ${r.status}: ${await r.text()}`);
}

// Create a plain (non-partnership) fixture user enrolled in the pinned test
// tenant — used by the authz specs to prove a normal user is rejected.
export async function createFixtureUser(email: string): Promise<void> {
  if (!PURGE_SECRET) throw new Error('E2E_PURGE_SECRET is required');
  const r = await fetch(`${API_BASE}/api/v1/_internal/e2e/create-fixture-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PURGE_SECRET}` },
    body: JSON.stringify({ email, password: 'Test123@!', role: 'user' }),
  });
  if (!r.ok) throw new Error(`create-fixture-user ${r.status}: ${await r.text()}`);
}

// Dev-token login (no GoTrue locally) → access token.
export async function devLogin(email: string): Promise<string> {
  const r = await fetch(`${API_BASE}/api/v1/auth/dev-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) throw new Error(`dev-token ${r.status}: ${await r.text()}`);
  const body = (await r.json()) as { data: { token: string } };
  return body.data.token;
}

export interface PartnerApiResult<T> {
  status: number;
  ok: boolean;
  data: T | null;
  code: string | null;
}

// Raw call to the partnership API as a given token. Never throws on HTTP error —
// returns status/code so authz specs can assert 403s.
export async function partnerApi<T = unknown>(
  token: string,
  path: string,
  init: { method?: string; json?: unknown } = {}
): Promise<PartnerApiResult<T>> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const body = (await r.json().catch(() => null)) as
    | { ok: boolean; data?: T; error?: { code?: string } }
    | null;
  return {
    status: r.status,
    ok: r.ok && body?.ok !== false,
    data: (body?.data ?? null) as T | null,
    code: body?.error?.code ?? null,
  };
}
