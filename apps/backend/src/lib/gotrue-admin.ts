import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { env } from '../env.js';
import { InvalidCurrentPasswordError } from '../errors/index.js';
import { buildMembershipAddedMail, sendMail } from './mailer.js';

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

// Per-audience routing for access emails. `app` picks which set-password copy
// the templates render (web employee vs partner console) and `redirectTo` is
// where the set-password page sends the user after success — so a partner
// invitee lands on partners.sonoqui.pro instead of the default web app.
export interface AccessEmailOptions {
  redirectTo?: string;
  app?: 'web' | 'partner';
}

export async function inviteUser(
  email: string,
  language: 'it' | 'en' = 'it',
  opts: AccessEmailOptions = {}
): Promise<GoTrueUser> {
  const jwt = await serviceRoleJwt();
  // redirect_to is validated by GoTrue against GOTRUE_URI_ALLOW_LIST and surfaced
  // to invite.html as `.RedirectTo`; `data.app` is exposed as `.Data.app` so the
  // template renders partner- vs web-flavoured copy (mirrors how `language` drives
  // the IT/EN branch).
  const url = new URL(`${env.GOTRUE_URL}/invite`);
  if (opts.redirectTo) url.searchParams.set('redirect_to', opts.redirectTo);
  const r = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ email, data: { language, app: opts.app ?? 'web' } }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GoTrue /invite ${r.status}: ${text}`);
  }
  return (await r.json()) as GoTrueUser;
}

// Create a GoTrue user WITHOUT sending any email. Unlike `inviteUser` (which
// fires the invite mail), this provisions the account silently. The account is
// left UNCONFIRMED (no `email_confirm`): an unconfirmed user has never set a
// first password, so a later `sendAccessEmail` sends them an INVITE (not a
// password reset). A throwaway random password is set just so the account is
// valid; it is unusable (the user never learns it) and is replaced when they
// follow the invite link.
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
    // invite/recovery mail renders in the member's language (see
    // gotrue-templates/{invite,recovery}.html). Without it the templates fall
    // back to English for every admin-created member.
    body: JSON.stringify({
      email,
      password: randomUUID(),
      user_metadata: { language },
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GoTrue POST /admin/users ${r.status}: ${text}`);
  }
  return (await r.json()) as GoTrueUser;
}

// Overwrite a GoTrue account's user_metadata (admin API). GoTrue exposes
// user_metadata as `.Data` in email templates, so this is how we persist the
// audience (`app`) and language that the invite template branches on. Required
// because our accounts are always pre-created (createUserSilently) and GoTrue's
// /invite does NOT update metadata for an already-existing user — without this
// the template falls back to the default web copy. Merges at the key level.
export async function updateUserMetadata(
  userId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const jwt = await serviceRoleJwt();
  const r = await fetch(`${env.GOTRUE_URL}/admin/users/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ user_metadata: metadata }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GoTrue PUT /admin/users/${userId} (metadata) ${r.status}: ${text}`);
  }
}

// Has this GoTrue account confirmed its email — i.e. followed an invite/recovery
// link and set a first password? Used to choose between an invitation email
// (never confirmed) and a password-reset email (already confirmed). Reads the
// admin view of the user by id. Throws on any non-2xx so callers can decide a
// safe default.
export async function isUserConfirmed(userId: string): Promise<boolean> {
  const jwt = await serviceRoleJwt();
  const r = await fetch(`${env.GOTRUE_URL}/admin/users/${userId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GoTrue GET /admin/users/${userId} ${r.status}: ${text}`);
  }
  const u = (await r.json()) as { confirmed_at?: string | null; email_confirmed_at?: string | null };
  return Boolean(u.confirmed_at || u.email_confirmed_at);
}

export type AccessEmailType = 'invite' | 'recovery' | 'none';

// sendTenantAccessEmail can additionally report that an existing confirmed user
// was simply told they were added to a company (no invite/reset).
export type TenantAccessEmailType = AccessEmailType | 'membership';

// Send a member their access email, picking the right kind by confirmation
// state: an UNCONFIRMED user (never set a first password) gets an INVITATION;
// a CONFIRMED user gets a PASSWORD-RESET (recovery). This is the single entry
// point for both the optional auto-send on create and the manual "resend /
// reset password" buttons, across the web app and the partner console.
//
// Robust by design: if the confirmation lookup or the invite call fails, it
// falls back to recovery (which also creates no leak and works for any existing
// account) so a member always receives *some* access mail. Local dev has no
// GoTrue — returns 'none' without touching the network (mirrors triggerRecovery).
export async function sendAccessEmail(
  userId: string,
  email: string,
  language: 'it' | 'en' = 'it',
  opts: AccessEmailOptions = {}
): Promise<AccessEmailType> {
  if (env.DEV_AUTH_ENABLED) return 'none';
  let confirmed = false;
  try {
    confirmed = await isUserConfirmed(userId);
  } catch (err) {
    // Lookup failed — default to attempting an invite (correct for the common
    // brand-new case); the catch below falls back to recovery if that errors.
    // eslint-disable-next-line no-console
    console.warn('isUserConfirmed failed; assuming unconfirmed', (err as Error).message);
    confirmed = false;
  }
  if (!confirmed) {
    try {
      // The invitee was pre-created (createUserSilently), so GoTrue treats this
      // as a re-invite and will NOT apply the `data` payload to user_metadata.
      // Persist the audience first so invite.html renders the right branch
      // (`.Data.app`). Keep language in sync too. Best-effort: a metadata-update
      // failure shouldn't block the invite.
      if (opts.app) {
        try {
          await updateUserMetadata(userId, { language, app: opts.app });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('updateUserMetadata before invite failed', (err as Error).message);
        }
      }
      await inviteUser(email, language, opts);
      return 'invite';
    } catch (err) {
      // e.g. a race where the user confirmed between lookup and invite (GoTrue
      // rejects inviting an already-registered/confirmed user). Fall through to
      // a recovery email so the member is never left without access mail.
      // eslint-disable-next-line no-console
      console.warn('inviteUser failed; falling back to recovery', (err as Error).message);
    }
  }
  // Recovery doesn't carry the audience flag (the recovery template isn't
  // audience-specific) but still honours redirect_to so a confirmed partner
  // returning via "reset password" lands back on the partner console.
  await triggerRecovery(email, opts.redirectTo);
  return 'recovery';
}

// Access email for granting a user access to a TENANT (company). Unlike a bare
// resend, this is context-aware:
//   • brand-new / never-confirmed account → INVITATION (set first password),
//     falling back to recovery if the invite call fails (mirrors sendAccessEmail);
//   • already-CONFIRMED account → a "you've been added to <company>" email with a
//     web-app login link, NOT a password reset they never asked for (they already
//     have a password). Returns 'membership'.
// Tenant admins/users belong to the employee web app, so the web audience/login
// link is correct. Local dev has no GoTrue / SMTP — returns 'none'.
export async function sendTenantAccessEmail(args: {
  userId: string;
  email: string;
  companyName: string;
  role?: 'admin' | 'user';
  language?: 'it' | 'en';
}): Promise<TenantAccessEmailType> {
  const language = args.language ?? 'it';
  if (env.DEV_AUTH_ENABLED) return 'none';
  let confirmed = false;
  try {
    confirmed = await isUserConfirmed(args.userId);
  } catch (err) {
    // Lookup failed — treat as brand-new and attempt an invite (the invite
    // catch below falls back to recovery if that errors too).
    // eslint-disable-next-line no-console
    console.warn('isUserConfirmed failed; assuming unconfirmed', (err as Error).message);
    confirmed = false;
  }
  if (!confirmed) {
    try {
      await inviteUser(args.email, language);
      return 'invite';
    } catch (err) {
      // e.g. a race where the account confirmed between lookup and invite.
      // eslint-disable-next-line no-console
      console.warn('inviteUser failed; falling back to recovery', (err as Error).message);
      await triggerRecovery(args.email);
      return 'recovery';
    }
  }
  // Confirmed user → contextual "added to a company" email instead of a reset.
  const mail = buildMembershipAddedMail({
    companyName: args.companyName,
    role: args.role ?? 'admin',
    language,
  });
  const sent = await sendMail({ to: args.email, subject: mail.subject, text: mail.text, html: mail.html });
  // Be honest in the toast: if SMTP is unconfigured / the send failed, report
  // 'none' so the partner knows to resend rather than seeing a false success.
  return sent ? 'membership' : 'none';
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

// Re-authenticate a user against GoTrue's password grant to PROVE they know a
// given password, returning a fresh session access_token. Used to verify the
// CURRENT password before changing it — GoTrue's PUT /user takes only the new
// password and never checks the old one. Throws on bad credentials.
async function passwordGrant(email: string, password: string): Promise<string> {
  const r = await fetch(`${env.GOTRUE_URL}/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string };
  if (!r.ok || !j.access_token) {
    throw new Error('password grant failed');
  }
  return j.access_token;
}

// Change a logged-in user's password: verify the current one (re-auth), then set
// the new one on that fresh session. Throws InvalidCurrentPasswordError when the
// current password is wrong so the API maps it to a specific message. Local dev
// has no GoTrue — short-circuit to a no-op success (mirrors triggerRecovery) so
// the change-password UI stays exercisable without a real auth backend.
export async function changePassword(
  email: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (env.DEV_AUTH_ENABLED) return;
  let accessToken: string;
  try {
    accessToken = await passwordGrant(email, currentPassword);
  } catch {
    throw new InvalidCurrentPasswordError();
  }
  await updatePassword(accessToken, newPassword);
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
