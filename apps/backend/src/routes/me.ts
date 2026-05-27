import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { ValidationError } from '../errors/index.js';

export const meRouter = Router();
meRouter.use(authenticate);

meRouter.get(
  '/',
  tenantHandler(async (req, res, client) => {
    const tenant = await client.query(
      `SELECT id, ragione_sociale, country, timezone, language,
              mock_location_action,
              max_admins, max_users
       FROM tenants
       WHERE id = $1`,
      [req.user!.tenantId]
    );
    const membership = await client.query(
      `SELECT disable_desktop_clock_in
       FROM memberships
       WHERE id = $1`,
      [req.user!.membershipId]
    );
    const profile = await client.query(
      `SELECT first_name, last_name, display_name
       FROM auth_users
       WHERE id = $1`,
      [req.user!.id]
    );
    const p = profile.rows[0] ?? {};
    const prefs = await client.query(
      `SELECT language,
              COALESCE(email_notifications_enabled, FALSE) AS email_notifications_enabled,
              push_token
         FROM user_preferences
        WHERE user_id = $1`,
      [req.user!.id]
    );
    const pref = prefs.rows[0] ?? {};
    const branches = await client.query(
      `SELECT b.id, b.name, b.address, b.latitude, b.longitude, b.radius_m, b.smart_working,
              b.geofence_policy, b.gps_accuracy_ceiling_m
       FROM branch_memberships bm
       JOIN branches b ON b.id = bm.branch_id AND b.deleted_at IS NULL AND b.active = TRUE
       WHERE bm.user_id = $1`,
      [req.user!.id]
    );
    ok(res, {
      user: {
        id: req.user!.id,
        email: req.user!.email,
        role: req.user!.role,
        first_name: p.first_name ?? null,
        last_name: p.last_name ?? null,
        display_name: p.display_name ?? null,
        disable_desktop_clock_in: membership.rows[0]?.disable_desktop_clock_in ?? true,
      },
      tenant: tenant.rows[0],
      branches: branches.rows,
      preferences: {
        language: pref.language ?? 'it',
        email_notifications_enabled: !!pref.email_notifications_enabled,
        push_token_registered: !!pref.push_token,
      },
    });
  })
);

const PatchMe = z.object({
  language: z.enum(['it', 'en']).optional(),
  email_notifications_enabled: z.boolean().optional(),
  push_token: z.string().min(1).max(200).nullable().optional(),
});

meRouter.patch(
  '/',
  tenantHandler(async (req, res, client) => {
    const parse = PatchMe.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    if (
      b.language === undefined &&
      b.email_notifications_enabled === undefined &&
      b.push_token === undefined
    ) {
      ok(res, { updated: false });
      return;
    }
    await client.query(
      `INSERT INTO user_preferences(user_id, language, email_notifications_enabled, push_token)
       VALUES ($1, COALESCE($2, 'it'), COALESCE($3, FALSE), $4)
       ON CONFLICT (user_id) DO UPDATE SET
         language = COALESCE($2, user_preferences.language),
         email_notifications_enabled = COALESCE($3, user_preferences.email_notifications_enabled),
         push_token = CASE WHEN $5::boolean THEN $4 ELSE user_preferences.push_token END,
         updated_at = now()`,
      [
        req.user!.id,
        b.language ?? null,
        b.email_notifications_enabled ?? null,
        b.push_token ?? null,
        b.push_token !== undefined,
      ]
    );
    ok(res, { updated: true });
  })
);
