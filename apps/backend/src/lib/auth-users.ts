import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../env.js';
import { createUserSilently } from './gotrue-admin.js';

export interface EnsureAuthUserParams {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  language?: 'it' | 'en';
}

export interface EnsureAuthUserResult {
  userId: string;
  // true → a new auth_users mirror row was inserted (vs reused an existing one).
  // In PROD this also means a new GoTrue account was created, so callers that
  // run outside a GoTrue transaction use it to clean up orphans on rollback.
  created: boolean;
}

// Resolve a GoTrue user by email, creating one (UNCONFIRMED, no email) if needed.
// Shared by tenant provisioning (first admin), partner onboarding, and adding a
// tenant admin. Sending the access email is the CALLER's job (sendAccessEmail),
// so the same flag/logic governs invite-vs-reset everywhere.
//
// - Existing email → reuse the account, create nothing.
// - New email in PROD → GoTrue silent create (unconfirmed, no email) + mirror.
// - New email in DEV (DEV_AUTH_ENABLED, no GoTrue instance) → mint a mirror-only
//   account with a random id; the dev-token shim resolves logins by
//   auth_users.email, so this is enough locally and never reaches a real GoTrue.
//
// Must run inside a transaction (caller's PoolClient) so the auth_users insert
// rolls back with the rest of the operation.
export async function ensureAuthUser(
  client: PoolClient,
  p: EnsureAuthUserParams
): Promise<EnsureAuthUserResult> {
  const email = p.email.trim().toLowerCase();
  const firstName = p.firstName ?? null;
  const lastName = p.lastName ?? null;
  const display = [firstName, lastName].map((s) => s ?? '').join(' ').trim() || null;
  const language = p.language ?? 'it';

  const existing = await client.query(`SELECT id FROM auth_users WHERE email = $1`, [email]);
  if (existing.rowCount && existing.rows[0]) {
    return { userId: existing.rows[0].id as string, created: false };
  }

  let userId: string;
  if (env.DEV_AUTH_ENABLED) {
    userId = randomUUID();
  } else {
    const g = await createUserSilently(email, language);
    userId = g.id;
  }
  await client.query(
    `INSERT INTO auth_users (id, email, first_name, last_name, display_name, created_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO NOTHING`,
    [userId, email, firstName, lastName, display]
  );
  return { userId, created: true };
}
