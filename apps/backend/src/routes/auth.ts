import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { signDevToken } from '../lib/jwt.js';
import { adminPool } from '../lib/admin-db.js';
import { ok } from '../lib/api-response.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors/index.js';
import { asyncHandler } from '../lib/route-helpers.js';
import { triggerRecovery, updatePassword, verifyTokenHash } from '../lib/gotrue-admin.js';

export const authRouter = Router();

// App origins allowed as a post-reset landing target. The set-password page
// sends the user back here after they choose a new password, so it must be an
// app we own. Anything else is dropped and the page falls back to the default
// web app. GoTrue re-validates against GOTRUE_URI_ALLOW_LIST as a second gate.
const REDIRECT_ALLOW = new Set([
  'https://app.sonoqui.pro',
  'https://partners.sonoqui.pro',
  'https://app-sonoqui.xdevapp.it',
]);

function safeRedirectTo(raw?: string): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (!REDIRECT_ALLOW.has(u.origin)) return undefined;
    // Forward origin + path (drop query/hash). A path is required so the URL
    // matches GoTrue's `<origin>/**` allow-list glob — a bare origin would be
    // rejected and silently fall back to the default SiteURL.
    const path = u.pathname === '/' ? '/login' : u.pathname;
    return `${u.origin}${path}`;
  } catch {
    return undefined;
  }
}

const Recover = z.object({
  email: z.string().email(),
  redirect_to: z.string().url().optional(),
});

authRouter.post(
  '/recover',
  asyncHandler(async (req, res) => {
    const parse = Recover.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    // Always 200 — never leak whether the email is registered.
    await triggerRecovery(parse.data.email, safeRedirectTo(parse.data.redirect_to));
    ok(res, { sent: true });
  })
);

// Accepts either a session access_token (legacy hash flow, e.g. the invite
// bounce) or a single-use token_hash straight from a recovery/invite email
// link. token_hash is exchanged for a session here, server-side, so the static
// set-password page never has to call GoTrue cross-origin (keeps its CSP tight).
const UpdatePassword = z
  .object({
    access_token: z.string().min(20).optional(),
    token_hash: z.string().min(10).optional(),
    type: z.enum(['recovery', 'invite', 'signup', 'email']).optional(),
    password: z.string().min(8),
  })
  .refine((d) => Boolean(d.access_token || d.token_hash), {
    message: 'access_token or token_hash required',
  });

authRouter.post(
  '/update-password',
  asyncHandler(async (req, res) => {
    const parse = UpdatePassword.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    try {
      const accessToken =
        parse.data.access_token ??
        (await verifyTokenHash(parse.data.token_hash as string, parse.data.type ?? 'recovery'));
      await updatePassword(accessToken, parse.data.password);
    } catch (err) {
      throw new ValidationError((err as Error).message);
    }
    ok(res, { updated: true });
  })
);

const DevLogin = z.object({ email: z.string().email() });

authRouter.post(
  '/dev-token',
  asyncHandler(async (req, res) => {
    if (!env.DEV_AUTH_ENABLED) throw new ForbiddenError('dev auth disabled');
    const parse = DevLogin.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const u = await adminPool.query(`SELECT id, email FROM auth_users WHERE email = $1`, [parse.data.email]);
    if (u.rowCount === 0) throw new NotFoundError(`user not found: ${parse.data.email}`);
    const token = await signDevToken({ sub: u.rows[0].id, email: u.rows[0].email });
    ok(res, { token, user: u.rows[0] });
  })
);

// GoTrue-shaped /token endpoint for local mobile e2e: lets Expo Web hit the
// same backend for auth without a real GoTrue instance. DEV_AUTH_ENABLED
// gates it — production refuses to boot with this flag on (see env.ts:71).
const PasswordLogin = z.object({
  email: z.string().email().optional(),
  username: z.string().email().optional(),
  password: z.string().min(1),
});

authRouter.post(
  '/token',
  asyncHandler(async (req, res) => {
    if (!env.DEV_AUTH_ENABLED) throw new ForbiddenError('dev auth disabled');
    if (req.query.grant_type !== 'password') {
      throw new ValidationError('only grant_type=password supported in dev shim');
    }
    const parse = PasswordLogin.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const email = parse.data.email ?? parse.data.username;
    if (!email) throw new ValidationError('email required');
    const u = await adminPool.query(`SELECT id, email FROM auth_users WHERE email = $1`, [email]);
    if (u.rowCount === 0) throw new NotFoundError(`user not found: ${email}`);
    const access = await signDevToken({ sub: u.rows[0].id, email: u.rows[0].email });
    res.json({
      access_token: access,
      refresh_token: access,
      token_type: 'bearer',
      expires_in: 3600,
      user: { id: u.rows[0].id, email: u.rows[0].email },
    });
  })
);
