import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LEGAL_VERSIONS } from '@sonoqui/shared';
import { env } from '../env.js';
import { adminPool } from '../lib/admin-db.js';
import { ok } from '../lib/api-response.js';
import { asyncHandler } from '../lib/route-helpers.js';
import { AppError, ConflictError, ValidationError } from '../errors/index.js';
import { verifyTurnstile } from '../lib/turnstile.js';
import { passwordSchema } from '../lib/password.js';
import { createConfirmedUser, isUserConfirmed, setPasswordAndConfirm } from '../lib/gotrue-admin.js';
import { sendMail } from '../lib/mailer.js';
import { buildSignupConfirmMail, signupConfirmUrl } from '../lib/billing-mail.js';
import { createLogger } from '../lib/logger.js';

// Self-service registration, step 1 (website form) and step 2 (email
// confirmation + password). Specs/SELF_SERVICE_BILLING.md §3.2.
//
// Nothing but a signup_requests row exists until the email is confirmed: no
// GoTrue account, no tenant. Step 3 (the company) lives in routes/onboarding.ts
// behind an authenticated account.

const logger = createLogger('signup');

export const signupRouter = Router();

const RATE_LIMITED = { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } };

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.NODE_ENV === 'development' ? 50 : 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: RATE_LIMITED,
});

const tokenLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.NODE_ENV === 'development' ? 200 : 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: RATE_LIMITED,
});

/** Max live (pending, unexpired) requests per email before we stop sending. */
const MAX_PENDING_PER_EMAIL = 3;
/** Minimum spacing between two sends for the same request. */
const RESEND_SPACING_MS = 2 * 60 * 1000;

export function hashSignupToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashSignupToken(token) };
}

function requireEnabled(): void {
  if (!env.SIGNUP_ENABLED) {
    throw new AppError({ status: 503, code: 'SIGNUP_DISABLED', message: 'Self-service signup is not open' });
  }
}

async function requireHuman(req: Request, token: string | undefined): Promise<void> {
  const outcome = await verifyTurnstile(token, req.ip);
  if (outcome === 'ok' || outcome === 'disabled') return;
  if (outcome === 'error') {
    throw new AppError({ status: 503, code: 'CAPTCHA_UNAVAILABLE', message: 'CAPTCHA verification unavailable' });
  }
  throw new AppError({ status: 400, code: outcome === 'missing' ? 'CAPTCHA_REQUIRED' : 'CAPTCHA_FAILED', message: 'CAPTCHA verification failed' });
}

const noNewlines = /^[^\r\n<>]*$/;

const Register = z.object({
  first_name: z.string().trim().min(1).max(80).regex(noNewlines),
  last_name: z.string().trim().min(1).max(80).regex(noNewlines),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+()./\s-]*$/)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  plan: z.enum(['free', 'piccola', 'media']).optional(),
  language: z.enum(['it', 'en']).default('it'),
  accept_tos: z.literal(true),
  accept_privacy: z.literal(true),
  marketing: z.boolean().default(false),
  utm: z.record(z.string().max(40), z.string().max(200)).optional(),
  turnstileToken: z.string().min(1).max(4096).optional(),
  // Honeypot: a hidden field real browsers leave empty.
  company_website: z.string().max(200).optional(),
});

/**
 * Which confirmation path an address gets. 'existing' = a CONFIRMED account
 * already exists: that person logs in with their current password and the
 * signup never touches credentials. Any doubt (GoTrue unreachable) resolves to
 * 'existing' for the same reason.
 */
async function modeFor(email: string): Promise<'new' | 'existing'> {
  const r = await adminPool.query(`SELECT id FROM auth_users WHERE email = $1`, [email]);
  if (!r.rowCount) return 'new';
  if (env.DEV_AUTH_ENABLED) return 'existing';
  try {
    return (await isUserConfirmed(r.rows[0].id as string)) ? 'existing' : 'new';
  } catch (err) {
    logger.warn({ err }, 'confirmation lookup failed; treating signup email as existing');
    return 'existing';
  }
}

// GET /api/v1/signup/config — lets the website's registration page and the web
// login link know whether to offer the form at all. The feature ships dark, and
// a visitor should meet "coming soon" rather than a form that answers 503.
signupRouter.get('/config', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  ok(res, { enabled: env.SIGNUP_ENABLED });
});

// POST /api/v1/signup — step 1. ALWAYS answers 202 with the same body: whether
// the address is new, already has an account, or is being throttled is told
// only to the mailbox owner, never to whoever submitted the form.
signupRouter.post(
  '/',
  registerLimiter,
  asyncHandler(async (req, res) => {
    requireEnabled();
    const parse = Register.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    await requireHuman(req, b.turnstileToken);
    if (b.company_website) {
      logger.warn({ ip: req.ip }, 'signup honeypot filled — dropped');
      return ok(res, { sent: true }, 202);
    }

    const live = await adminPool.query(
      `SELECT count(*)::int AS n FROM signup_requests
        WHERE lower(email) = $1 AND status = 'pending' AND expires_at > now()`,
      [b.email]
    );
    if ((live.rows[0]?.n ?? 0) >= MAX_PENDING_PER_EMAIL) {
      logger.warn({ email: b.email }, 'signup throttled: too many pending requests for this email');
      return ok(res, { sent: true }, 202);
    }

    const mode = await modeFor(b.email);
    const { token, hash } = newToken();
    const planHint = b.plan === 'piccola' || b.plan === 'media' ? b.plan : null;
    await adminPool.query(
      `INSERT INTO signup_requests
         (token_hash, mode, email, first_name, last_name, phone, plan_hint, utm, consents,
          language, ip, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12,
               now() + make_interval(hours => $13))`,
      [
        hash,
        mode,
        b.email,
        b.first_name,
        b.last_name,
        b.phone,
        planHint,
        b.utm ? JSON.stringify(b.utm) : null,
        JSON.stringify({
          tos: { accepted: true, version: LEGAL_VERSIONS.tos },
          privacy_ack: { accepted: true, version: LEGAL_VERSIONS.privacy_ack },
          marketing: { accepted: b.marketing, version: LEGAL_VERSIONS.marketing },
        }),
        b.language,
        req.ip ?? null,
        req.header('user-agent')?.slice(0, 400) ?? null,
        env.SIGNUP_TOKEN_TTL_HOURS,
      ]
    );
    const mail = buildSignupConfirmMail({
      firstName: b.first_name,
      token,
      mode,
      ttlHours: env.SIGNUP_TOKEN_TTL_HOURS,
      language: b.language,
    });
    const sent = await sendMail({ to: b.email, ...mail });
    logger.info({ email: b.email, mode, sent }, 'signup requested');
    // Local dev has no SMTP: print the link so the flow can be walked by hand.
    // DEV_AUTH_ENABLED can never be on in production (env.ts refuses to boot).
    if (env.DEV_AUTH_ENABLED) logger.info({ confirm_url: signupConfirmUrl(token) }, 'DEV signup link');
    ok(res, { sent: true }, 202);
  })
);

const Resend = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  turnstileToken: z.string().min(1).max(4096).optional(),
});

// POST /api/v1/signup/resend — same 202 whatever happens. Rotates the token so
// only the newest email's link works.
signupRouter.post(
  '/resend',
  registerLimiter,
  asyncHandler(async (req, res) => {
    requireEnabled();
    const parse = Resend.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    await requireHuman(req, parse.data.turnstileToken);
    const r = await adminPool.query(
      `SELECT id, mode, first_name, language, last_sent_at FROM signup_requests
        WHERE lower(email) = $1 AND status = 'pending' AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`,
      [parse.data.email]
    );
    const row = r.rows[0];
    if (!row || Date.now() - new Date(row.last_sent_at).getTime() < RESEND_SPACING_MS) {
      return ok(res, { sent: true }, 202);
    }
    const { token, hash } = newToken();
    await adminPool.query(
      `UPDATE signup_requests
          SET token_hash = $2, last_sent_at = now(), send_count = send_count + 1,
              expires_at = now() + make_interval(hours => $3)
        WHERE id = $1`,
      [row.id, hash, env.SIGNUP_TOKEN_TTL_HOURS]
    );
    const mail = buildSignupConfirmMail({
      firstName: row.first_name,
      token,
      mode: row.mode,
      ttlHours: env.SIGNUP_TOKEN_TTL_HOURS,
      language: row.language,
    });
    await sendMail({ to: parse.data.email, ...mail });
    ok(res, { sent: true }, 202);
  })
);

const TokenBody = z.object({ token: z.string().min(20).max(200) });

class SignupTokenError extends AppError {
  constructor(code: 'SIGNUP_TOKEN_INVALID' | 'SIGNUP_TOKEN_USED') {
    super({
      status: 410,
      code,
      message: code === 'SIGNUP_TOKEN_USED' ? 'Email already confirmed' : 'Link expired or invalid',
    });
  }
}

// POST /api/v1/signup/preview — what the confirmation page shows before the
// user picks a password (or logs in, for an existing account).
signupRouter.post(
  '/preview',
  tokenLimiter,
  asyncHandler(async (req, res) => {
    requireEnabled();
    const parse = TokenBody.safeParse(req.body);
    if (!parse.success) throw new SignupTokenError('SIGNUP_TOKEN_INVALID');
    const r = await adminPool.query(
      `SELECT email, first_name, mode, plan_hint, language, status, expires_at > now() AS live
         FROM signup_requests WHERE token_hash = $1`,
      [hashSignupToken(parse.data.token)]
    );
    const row = r.rows[0];
    if (!row) throw new SignupTokenError('SIGNUP_TOKEN_INVALID');
    if (row.status === 'email_confirmed' || row.status === 'company_created') {
      throw new SignupTokenError('SIGNUP_TOKEN_USED');
    }
    if (row.status !== 'pending' || !row.live) throw new SignupTokenError('SIGNUP_TOKEN_INVALID');
    ok(res, {
      email: row.email,
      first_name: row.first_name,
      mode: row.mode,
      plan_hint: row.plan_hint,
      language: row.language,
    });
  })
);

const Confirm = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

// POST /api/v1/signup/confirm — step 2 for a NEW account: the token proves the
// mailbox, the password becomes the account's first password, and the account
// is created already confirmed. Existing confirmed accounts are refused here
// (USE_LOGIN): they log in and claim the request via /onboarding/claim.
signupRouter.post(
  '/confirm',
  tokenLimiter,
  asyncHandler(async (req, res) => {
    requireEnabled();
    const parse = Confirm.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const hash = hashSignupToken(parse.data.token);

    const client = await adminPool.connect();
    let createdGoTrueId: string | null = null;
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `SELECT id, email, first_name, last_name, mode, language, status, consents,
                ip, user_agent, created_at, expires_at > now() AS live
           FROM signup_requests WHERE token_hash = $1 FOR UPDATE`,
        [hash]
      );
      const row = r.rows[0];
      if (!row) throw new SignupTokenError('SIGNUP_TOKEN_INVALID');
      if (row.status === 'email_confirmed' || row.status === 'company_created') {
        throw new SignupTokenError('SIGNUP_TOKEN_USED');
      }
      if (row.status !== 'pending' || !row.live) throw new SignupTokenError('SIGNUP_TOKEN_INVALID');
      if (row.mode === 'existing') {
        throw new ConflictError('This email already has an account: sign in to continue', 'USE_LOGIN');
      }

      const email = String(row.email).toLowerCase();
      const display = `${row.first_name} ${row.last_name}`.trim();
      const existing = await client.query(`SELECT id FROM auth_users WHERE email = $1`, [email]);
      let userId: string;
      if (existing.rowCount) {
        userId = existing.rows[0].id as string;
        if (!env.DEV_AUTH_ENABLED) {
          // Re-check at confirm time: the account may have been activated since
          // the request was made. A confirmed account's password is never set here.
          if (await isUserConfirmed(userId)) {
            throw new ConflictError('This email already has an account: sign in to continue', 'USE_LOGIN');
          }
          await setPasswordAndConfirm(userId, parse.data.password);
        }
        await client.query(
          `UPDATE auth_users
              SET first_name = COALESCE(first_name, $2), last_name = COALESCE(last_name, $3),
                  display_name = COALESCE(display_name, $4)
            WHERE id = $1`,
          [userId, row.first_name, row.last_name, display]
        );
      } else {
        if (env.DEV_AUTH_ENABLED) {
          userId = randomUUID(); // no GoTrue locally: the dev token shim logs in by email
        } else {
          const u = await createConfirmedUser(email, parse.data.password, {
            language: row.language,
            first_name: row.first_name,
            last_name: row.last_name,
          });
          userId = u.id;
          createdGoTrueId = u.id;
        }
        await client.query(
          `INSERT INTO auth_users (id, email, first_name, last_name, display_name, created_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (id) DO NOTHING`,
          [userId, email, row.first_name, row.last_name, display]
        );
      }

      await client.query(
        `UPDATE signup_requests
            SET status = 'email_confirmed', email_confirmed_at = now(), user_id = $2
          WHERE id = $1`,
        [row.id, userId]
      );
      await recordAccountAcceptances(client, userId, row);
      await client.query('COMMIT');
      logger.info({ email, user_id: userId }, 'signup email confirmed');
      ok(res, { email, mode: 'new' });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (createdGoTrueId) {
        logger.error(
          { orphan_gotrue_user_id: createdGoTrueId },
          'signup confirm failed after GoTrue user create — orphan auth user left behind, clean up manually'
        );
      }
      throw err;
    } finally {
      client.release();
    }
  })
);

/**
 * The person-level acceptances captured on the website form (T&C, privacy
 * notice), written against the account once it exists —
 * with the moment, IP and browser of the REGISTRATION, which is when they were
 * given. The company-level ones (DPA, art. 1341, powers) are recorded at step 3.
 */
export async function recordAccountAcceptances(
  client: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  userId: string,
  request: {
    consents: Record<string, { accepted?: boolean; version?: string }> | null;
    ip: string | null;
    user_agent: string | null;
    created_at: Date | string;
  }
): Promise<void> {
  const docs: Array<'tos' | 'privacy_ack' | 'marketing'> = ['tos', 'privacy_ack', 'marketing'];
  for (const doc of docs) {
    const c = request.consents?.[doc];
    if (!c?.accepted) continue;
    await client.query(
      `INSERT INTO legal_acceptances (user_id, document, version, accepted_at, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, doc, c.version ?? LEGAL_VERSIONS[doc], request.created_at, request.ip, request.user_agent]
    );
  }
}
