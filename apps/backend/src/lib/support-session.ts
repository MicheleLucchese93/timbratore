import { createHash, randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { adminPool } from './admin-db.js';
import { env } from '../env.js';

// Read-only support sessions: a partnership member opens a customer's tenant in
// the web app to SEE what the customer sees. The partner keeps their own user
// id — nothing here impersonates a customer account; the session grants tenant
// SCOPE, never an identity. See migrations/058_support_sessions.sql for the
// three enforcement layers.

const secret = new TextEncoder().encode(env.GOTRUE_JWT_SECRET);

/** Session lifetime. Short by design: reopening from the console is one click
 *  and each reopen is separately audited. */
export const SUPPORT_SESSION_TTL_SECONDS = 30 * 60;
/** Lifetime of the one-time handoff code carried in the URL fragment. */
export const SUPPORT_CODE_TTL_SECONDS = 120;

export interface SupportClaim {
  /** support_sessions.id */
  sid: string;
  /** Tenant the session is pinned to. Never read from a client header. */
  tid: string;
}

export interface SupportSession {
  id: string;
  partnerUserId: string;
  tenantId: string;
  expiresAt: Date;
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Create a pending session and return its one-time handoff code. The code is
 * stored hashed and the JWT is only minted when the code is redeemed, so the
 * token itself never travels in a URL (no referrer / history / proxy-log leak).
 */
export async function createSupportSession(opts: {
  partnerUserId: string;
  tenantId: string;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ sessionId: string; code: string; expiresAt: Date }> {
  const code = randomBytes(32).toString('base64url');
  const r = await adminPool.query(
    `INSERT INTO support_sessions
       (partner_user_id, tenant_id, exchange_code_hash, code_expires_at, expires_at, reason, ip, user_agent)
     VALUES ($1, $2, $3,
             now() + ($4 || ' seconds')::interval,
             now() + ($5 || ' seconds')::interval,
             $6, $7, $8)
     RETURNING id, expires_at`,
    [
      opts.partnerUserId,
      opts.tenantId,
      hashCode(code),
      String(SUPPORT_CODE_TTL_SECONDS),
      String(SUPPORT_SESSION_TTL_SECONDS),
      opts.reason ?? null,
      opts.ip ?? null,
      opts.userAgent ?? null,
    ]
  );
  return { sessionId: r.rows[0].id, code, expiresAt: r.rows[0].expires_at };
}

/**
 * Redeem a handoff code exactly once. Returns null when the code is unknown,
 * already redeemed, expired or revoked — the caller must not distinguish.
 */
export async function redeemSupportCode(
  code: string,
  ctx: { ip?: string | null; userAgent?: string | null }
): Promise<{ session: SupportSession; partnerEmail: string | null; tenantName: string } | null> {
  // Single-statement redeem: the UPDATE both clears the code and stamps the
  // start, so two concurrent redemptions cannot both win.
  const r = await adminPool.query(
    `UPDATE support_sessions s
        SET exchange_code_hash = NULL,
            started_at = now(),
            ip = COALESCE($2, s.ip),
            user_agent = COALESCE($3, s.user_agent)
      WHERE s.exchange_code_hash = $1
        AND s.code_expires_at > now()
        AND s.expires_at > now()
        AND s.revoked_at IS NULL
      RETURNING s.id, s.partner_user_id, s.tenant_id, s.expires_at`,
    [hashCode(code), ctx.ip ?? null, ctx.userAgent ?? null]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  const meta = await adminPool.query(
    `SELECT (SELECT email FROM auth_users WHERE id = $1) AS partner_email,
            (SELECT ragione_sociale FROM tenants WHERE id = $2) AS tenant_name`,
    [row.partner_user_id, row.tenant_id]
  );
  return {
    session: {
      id: row.id,
      partnerUserId: row.partner_user_id,
      tenantId: row.tenant_id,
      expiresAt: row.expires_at,
    },
    partnerEmail: meta.rows[0]?.partner_email ?? null,
    tenantName: meta.rows[0]?.tenant_name ?? '',
  };
}

/** Mint the session JWT. Same secret/issuer/audience as GoTrue so the normal
 *  verifyToken path accepts it; the `sq_support` claim is what marks it. */
export async function signSupportToken(opts: {
  partnerUserId: string;
  email: string | null;
  claim: SupportClaim;
  expiresAt: Date;
}): Promise<string> {
  let jwt = new SignJWT({
    ...(opts.email ? { email: opts.email } : {}),
    sq_support: opts.claim,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(env.GOTRUE_JWT_ISSUER)
    .setSubject(opts.partnerUserId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(opts.expiresAt.getTime() / 1000));
  if (env.GOTRUE_JWT_AUDIENCE) jwt = jwt.setAudience(env.GOTRUE_JWT_AUDIENCE);
  return await jwt.sign(secret);
}

export interface ResolvedSupportSession extends SupportSession {
  tenantName: string;
  cantieriEnabled: boolean;
  apiEnabled: boolean;
  suspended: boolean;
}

/**
 * Re-validate on EVERY request: a JWT alone cannot be revoked, so expiry,
 * revocation and tenant deletion are re-checked against the row. Deliberately
 * uncached so "Termina sessione" takes effect immediately.
 */
export async function resolveSupportSession(
  claim: SupportClaim,
  userId: string
): Promise<ResolvedSupportSession | null> {
  const r = await adminPool.query(
    `SELECT s.id, s.partner_user_id, s.tenant_id, s.expires_at,
            t.ragione_sociale, t.cantieri_enabled, t.api_enabled, t.suspended_at
       FROM support_sessions s
       JOIN tenants t ON t.id = s.tenant_id
      WHERE s.id = $1
        AND s.partner_user_id = $2
        AND s.tenant_id = $3
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND s.started_at IS NOT NULL
        AND t.deleted_at IS NULL`,
    [claim.sid, userId, claim.tid]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return {
    id: row.id,
    partnerUserId: row.partner_user_id,
    tenantId: row.tenant_id,
    expiresAt: row.expires_at,
    tenantName: row.ragione_sociale,
    cantieriEnabled: row.cantieri_enabled === true,
    apiEnabled: row.api_enabled === true,
    // A suspended tenant stays inspectable on purpose: "why can nobody log in?"
    // is exactly the question support access exists to answer.
    suspended: row.suspended_at !== null,
  };
}

/** End a session early. Idempotent; only the owning partner may revoke. */
export async function revokeSupportSession(sessionId: string, partnerUserId: string): Promise<boolean> {
  const r = await adminPool.query(
    `UPDATE support_sessions
        SET revoked_at = now()
      WHERE id = $1 AND partner_user_id = $2 AND revoked_at IS NULL`,
    [sessionId, partnerUserId]
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Paths a support session may never reach even with GET. Employee HR documents
 * are OTP-gated for the customer's own admins (see the Documentale capability),
 * and an export download hands over the tenant's whole payroll dataset — neither
 * belongs in a "look at the environment" session.
 */
const DENIED_PATH_RE = [
  /^\/api\/v1\/documents(\/|$)/,
  /^\/api\/v1\/exports\/[^/]+\/(download|raw)(\/|$)/,
];

export function isSupportDeniedPath(pathname: string): boolean {
  return DENIED_PATH_RE.some((re) => re.test(pathname));
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isReadMethod(method: string): boolean {
  return READ_METHODS.has(method.toUpperCase());
}
