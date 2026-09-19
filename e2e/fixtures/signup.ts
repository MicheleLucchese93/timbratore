/**
 * Helpers for the self-service signup specs (e2e/signup/*.spec.ts).
 *
 * These specs create REAL companies and accounts, so they run against a LOCAL
 * stack only (DEV_AUTH_ENABLED backend + SIGNUP_ENABLED, see the spec header).
 * Every fixture follows the purge namespaces: admin emails e2e-*@e2e.local and
 * company names 'e2e-…', both swept by /_internal/e2e/purge-fixtures.
 */

export const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:4200';
const PURGE_SECRET = process.env.E2E_PURGE_SECRET ?? '';

/** A random Partita IVA with a valid check digit (almost surely not on VIES). */
export function randomPartitaIva(): string {
  const body = Array.from({ length: 10 }, (_, i) => (i === 0 ? 1 + Math.floor(Math.random() * 9) : Math.floor(Math.random() * 10)));
  let sum = 0;
  body.forEach((d, i) => {
    if (i % 2 === 0) sum += d;
    else sum += d * 2 > 9 ? d * 2 - 9 : d * 2;
  });
  return body.join('') + String((10 - (sum % 10)) % 10);
}

export function uniqueEmail(tag: string): string {
  return `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@e2e.local`;
}

async function json(r: Response): Promise<any> {
  const text = await r.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

/** Step 1 — the website form. Always 202 by design. */
export async function registerSignup(body: {
  email: string;
  first_name?: string;
  last_name?: string;
  plan?: 'free' | 'piccola' | 'media';
}): Promise<{ status: number; body: any }> {
  const r = await fetch(`${API_BASE}/api/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      first_name: body.first_name ?? 'E2E',
      last_name: body.last_name ?? 'Fixture',
      email: body.email,
      plan: body.plan ?? 'free',
      language: 'it',
      accept_tos: true,
      accept_privacy: true,
      marketing: false,
    }),
  });
  return { status: r.status, body: await json(r) };
}

/** The raw token the confirmation email would carry (fixture emails only). */
export async function signupToken(email: string): Promise<{ token: string; mode: 'new' | 'existing' }> {
  const r = await fetch(`${API_BASE}/api/v1/_internal/e2e/signup-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PURGE_SECRET}` },
    body: JSON.stringify({ email }),
  });
  const b = await json(r);
  if (!r.ok) throw new Error(`signup-token ${r.status}: ${JSON.stringify(b)}`);
  return b.data;
}

/** Step 2 over the API (UI specs use the real page instead). */
export async function confirmSignup(token: string, password = 'E2e#Signup1'): Promise<void> {
  const r = await fetch(`${API_BASE}/api/v1/signup/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
  if (!r.ok) throw new Error(`confirm ${r.status}: ${JSON.stringify(await json(r))}`);
}

/** Dev-shim login (DEV_AUTH_ENABLED): any password, token minted by email. */
export async function devLogin(email: string): Promise<string> {
  const r = await fetch(`${API_BASE}/api/v1/auth/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'dev' }),
  });
  const b = await json(r);
  if (!r.ok || !b?.access_token) throw new Error(`dev login ${r.status}: ${JSON.stringify(b)}`);
  return b.access_token as string;
}

export async function call(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  tenantId?: string
): Promise<{ status: number; body: any }> {
  const r = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await json(r) };
}

/** Steps 1–3 over the API: returns a signed-in admin of a fresh Free company. */
export async function createSelfServiceCompany(tag: string, plan: 'free' | 'piccola' | 'media' = 'free'): Promise<{
  email: string;
  token: string;
  tenantId: string;
  partitaIva: string;
  ragioneSociale: string;
}> {
  const email = uniqueEmail(tag);
  await registerSignup({ email, plan });
  const { token: signup } = await signupToken(email);
  await confirmSignup(signup);
  const token = await devLogin(email);
  const partitaIva = randomPartitaIva();
  const ragioneSociale = `e2e-${tag}-${Date.now()} Srl`;
  const r = await call(token, 'POST', '/api/v1/onboarding/company', {
    partita_iva: partitaIva,
    ragione_sociale: ragioneSociale,
    address: 'Via Roma 1',
    cap: '37121',
    city: 'Verona',
    province: 'VR',
    accept_dpa: true,
    accept_art1341: true,
    accept_powers: true,
  });
  if (r.status !== 201) throw new Error(`company ${r.status}: ${JSON.stringify(r.body)}`);
  return { email, token, tenantId: r.body.data.tenant_id, partitaIva, ragioneSociale };
}
