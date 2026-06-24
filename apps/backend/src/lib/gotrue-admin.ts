import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { env } from '../env.js';

const secret = new TextEncoder().encode(env.GOTRUE_JWT_SECRET);

export async function serviceRoleJwt(): Promise<string> {
  return await new SignJWT({ role: 'service_role' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(env.GOTRUE_JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret);
}

export interface GoTrueUser {
  id: string;
  email: string;
}

export async function inviteUser(email: string, language: 'it' | 'en' = 'it'): Promise<GoTrueUser> {
  const jwt = await serviceRoleJwt();
  const r = await fetch(`${env.GOTRUE_URL}/invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ email, data: { language } }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GoTrue /invite ${r.status}: ${text}`);
  }
  return (await r.json()) as GoTrueUser;
}

// Create a GoTrue user WITHOUT sending any email. Unlike `inviteUser` (which
// fires the invite/magic-link mail), this provisions the account silently: a
// throwaway random password is set and the email is marked confirmed so no
// confirmation mail goes out. The user has no usable password until an admin
// sends them a recovery (reset-password) email — that is now the only way the
// initial access mail reaches a newly-created member.
export async function createUserSilently(
  email: string,
  language: 'it' | 'en' = 'it'
): Promise<GoTrueUser> {
  const jwt = await serviceRoleJwt();
  const r = await fetch(`${env.GOTRUE_URL}/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    // user_metadata is what GoTrue exposes as `.Data` in email templates, so
    // recovery/confirmation mail renders in the member's language (see
    // gotrue-templates/recovery.html). Without it the templates fall back to
    // English for every admin-created member.
    body: JSON.stringify({
      email,
      password: randomUUID(),
      email_confirm: true,
      user_metadata: { language },
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GoTrue POST /admin/users ${r.status}: ${text}`);
  }
  return (await r.json()) as GoTrueUser;
}

// Update a GoTrue user's email (admin API). email_confirm so the new address is
// immediately usable. Caller must skip this in dev (no GoTrue) and update only
// the auth_users mirror.
export async function updateUserEmail(id: string, email: string): Promise<void> {
  const jwt = await serviceRoleJwt();
  const r = await fetch(`${env.GOTRUE_URL}/admin/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GoTrue PUT /admin/users ${r.status}: ${text}`);
  }
}

// Permanently delete a GoTrue user (admin API). Used only by the super-user
// tenant-delete flow to remove an orphaned member's login account. A 404 is
// treated as success — the account is already gone, which is the desired end
// state. Caller skips this in dev (no GoTrue) and deletes only the mirror row.
export async function deleteUser(id: string): Promise<void> {
  const jwt = await serviceRoleJwt();
  const r = await fetch(`${env.GOTRUE_URL}/admin/users/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok && r.status !== 404) {
    const text = await r.text();
    throw new Error(`GoTrue DELETE /admin/users ${r.status}: ${text}`);
  }
}

export async function triggerRecovery(email: string, redirectTo?: string): Promise<void> {
  // Local dev has no GoTrue instance — skip the call (it would only DNS-fail and
  // stall). Prod (DEV_AUTH_ENABLED=false) is unchanged.
  if (env.DEV_AUTH_ENABLED) return;
  try {
    // redirect_to is surfaced to the email template as `.RedirectTo` so the
    // set-password page can send the user back to the app that asked for the
    // reset (e.g. the partner console) instead of the default web app. GoTrue
    // validates it against GOTRUE_URI_ALLOW_LIST and ignores anything not listed.
    const url = new URL(`${env.GOTRUE_URL}/recover`);
    if (redirectTo) url.searchParams.set('redirect_to', redirectTo);
    const r = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!r.ok && r.status !== 200) {
      // eslint-disable-next-line no-console
      console.warn('GoTrue /recover failed', r.status);
    }
  } catch (err) {
    // Network/DNS failure (dev environment without real GoTrue). Swallow —
    // caller returns 200 to preserve enum protection regardless.
    // eslint-disable-next-line no-console
    console.warn('GoTrue /recover network error', (err as Error).message);
  }
}

export async function updatePassword(accessToken: string, password: string): Promise<void> {
  const r = await fetch(`${env.GOTRUE_URL}/user`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GoTrue PUT /user ${r.status}: ${text}`);
  }
}

// Exchange a single-use email-link OTP (token_hash from a recovery/invite link)
// for a session access_token. Done server-side so the browser never calls GoTrue
// cross-origin — the static set-password page can keep a tight `connect-src 'self'`
// CSP and just POST the token_hash here. The token is consumed by this call, so
// the caller must only invoke it when the user actually submits the form.
export async function verifyTokenHash(
  tokenHash: string,
  type: 'recovery' | 'invite' | 'signup' | 'email' = 'recovery'
): Promise<string> {
  const r = await fetch(`${env.GOTRUE_URL}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, token_hash: tokenHash }),
  });
  const j = (await r.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
    msg?: string;
  };
  if (!r.ok || !j.access_token) {
    throw new Error(j.error_description || j.msg || 'Link non valido o scaduto.');
  }
  return j.access_token;
}

// Admin-level create with a caller-chosen password. Used only by the e2e
// fixture-user endpoint — never exposed to regular admin flows, which go
// through `createUserSilently` (no email) and rely on the admin triggering a
// recovery email to hand the member their initial access link.
export async function createUserWithPassword(
  email: string,
  password: string,
): Promise<GoTrueUser> {
  const jwt = await serviceRoleJwt();
  const r = await fetch(`${env.GOTRUE_URL}/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GoTrue POST /admin/users ${r.status}: ${text}`);
  }
  return (await r.json()) as GoTrueUser;
}
