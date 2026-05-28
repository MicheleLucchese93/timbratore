import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { signDevToken } from '../lib/jwt.js';
import { adminPool } from '../lib/admin-db.js';
import { ok } from '../lib/api-response.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors/index.js';
import { asyncHandler } from '../lib/route-helpers.js';
import { triggerRecovery, updatePassword } from '../lib/gotrue-admin.js';

export const authRouter = Router();

const Recover = z.object({ email: z.string().email() });

authRouter.post(
  '/recover',
  asyncHandler(async (req, res) => {
    const parse = Recover.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    // Always 200 — never leak whether the email is registered.
    await triggerRecovery(parse.data.email);
    ok(res, { sent: true });
  })
);

const UpdatePassword = z.object({
  access_token: z.string().min(20),
  password: z.string().min(8),
});

authRouter.post(
  '/update-password',
  asyncHandler(async (req, res) => {
    const parse = UpdatePassword.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    try {
      await updatePassword(parse.data.access_token, parse.data.password);
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
