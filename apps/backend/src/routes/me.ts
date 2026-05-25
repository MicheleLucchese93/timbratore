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
              mock_location_action, break_paid_threshold_min,
              max_shift_hours, max_break_hours,
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
    });
  })
);

const PatchMe = z.object({
  language: z.enum(['it', 'en']).optional(),
});

meRouter.patch(
  '/',
  tenantHandler(async (req, res, client) => {
    const parse = PatchMe.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    if (parse.data.language) {
      await client.query(
        `INSERT INTO user_preferences(user_id, language) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET language = EXCLUDED.language`,
        [req.user!.id, parse.data.language]
      );
    }
    ok(res, { updated: true });
  })
);
