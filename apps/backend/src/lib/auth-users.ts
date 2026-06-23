import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../env.js';
import { inviteUser } from './gotrue-admin.js';

export interface EnsureAuthUserParams {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  language?: 'it' | 'en';
}

export interface EnsureAuthUserResult {
  userId: string;
  // true → a GoTrue invite email was sent (a brand-new account in prod).
  invited: boolean;
  // true → a new auth_users mirror row was inserted (vs reused an existing one).
  created: boolean;
}

// Resolve a GoTrue user by email, creating one if needed. Shared by tenant
// provisioning (first admin) and partner onboarding (invite a brand-new partner).
//
// - Existing email → reuse the account, send nothing.
// - New email in PROD → GoTrue /invite (sends the set-password email in the
//   user's language) and mirror into auth_users.
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
    return { userId: existing.rows[0].id as string, invited: false, created: false };
  }

  let userId: string;
  let invited: boolean;
  if (env.DEV_AUTH_ENABLED) {
    userId = randomUUID();
    invited = false;
  } else {
    const g = await inviteUser(email, language);
    userId = g.id;
    invited = true;
  }
  await client.query(
    `INSERT INTO auth_users (id, email, first_name, last_name, display_name, created_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO NOTHING`,
    [userId, email, firstName, lastName, display]
  );
  return { userId, invited, created: true };
}
