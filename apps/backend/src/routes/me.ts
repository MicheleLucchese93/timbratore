import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, tenantHandler } from '../lib/route-helpers.js';
import { adminPool } from '../lib/admin-db.js';
import { ok } from '../lib/api-response.js';
import { ValidationError } from '../errors/index.js';

// Keep in sync with migrations 021_push_notification_prefs.sql,
// 030_leave_reminders_and_email_prefs.sql and 041_documents.sql. Push keys
// default ON (opt-out), email keys default OFF (opt-in) — EXCEPT email_documents
// which defaults ON by product decision (a new HR document is important enough
// to email unless the employee explicitly opts out).
const NOTIF_PREF_DEFAULTS = {
  push_leave_decisions: true,
  push_correction_decisions: true,
  push_leave_submissions: true,
  push_correction_submissions: true,
  push_leave_reminders: true,
  push_documents: true,
  email_leave_decisions: false,
  email_correction_decisions: false,
  email_leave_submissions: false,
  email_correction_submissions: false,
  email_leave_reminders: false,
  email_documents: true,
} as const;

type NotifPrefKey = keyof typeof NOTIF_PREF_DEFAULTS;

function mergeNotifPrefs(stored: unknown): Record<NotifPrefKey, boolean> {
  const out: Record<string, boolean> = { ...NOTIF_PREF_DEFAULTS };
  if (stored && typeof stored === 'object') {
    for (const k of Object.keys(NOTIF_PREF_DEFAULTS) as NotifPrefKey[]) {
      const v = (stored as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out as Record<NotifPrefKey, boolean>;
}

export const meRouter = Router();
meRouter.use(authenticate);

// All companies the caller is an active member of. Deliberately tenant-agnostic
// (keyed by user_id via adminPool, outside RLS) so the client can render the
// post-login company chooser BEFORE any tenant is selected — and so a stale
// stored X-Tenant-Id can't lock a user out of their own list.
meRouter.get(
  '/tenants',
  asyncHandler(async (req, res) => {
    const r = await adminPool.query(
      `SELECT m.tenant_id, m.role, t.ragione_sociale
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = $1
         AND m.active = TRUE
         AND m.deleted_at IS NULL
         AND t.deleted_at IS NULL
         -- A suspended company is hidden from its users' company list, so it is
         -- never offered in the chooser (matches the auth middleware, which also
         -- refuses to resolve a membership for a suspended tenant).
         AND t.suspended_at IS NULL
       ORDER BY t.ragione_sociale ASC`,
      [req.user!.id]
    );
    ok(res, {
      tenants: r.rows.map((row) => ({
        tenant_id: row.tenant_id,
        ragione_sociale: row.ragione_sociale,
        role: row.role,
      })),
    });
  })
);

meRouter.get(
  '/',
  tenantHandler(async (req, res, client) => {
    const tenant = await client.query(
      `SELECT id, ragione_sociale, country, timezone, language,
              mock_location_action,
              max_admins, max_users, max_branches, max_documentali
       FROM tenants
       WHERE id = $1`,
      [req.user!.tenantId]
    );
    const membership = await client.query(
      `SELECT stamp_modes, is_documentale
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
              push_token,
              notification_preferences
         FROM user_preferences
        WHERE user_id = $1`,
      [req.user!.id]
    );
    const pref = prefs.rows[0] ?? {};
    const notifPrefs = mergeNotifPrefs(pref.notification_preferences);
    const branches = await client.query(
      `SELECT b.id, b.name, b.address, b.latitude, b.longitude, b.radius_m, b.enforce_radius,
              b.smart_working
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
        is_documentale: membership.rows[0]?.is_documentale === true,
        first_name: p.first_name ?? null,
        last_name: p.last_name ?? null,
        display_name: p.display_name ?? null,
        stamp_modes: membership.rows[0]?.stamp_modes ?? ['gps'],
      },
      tenant: tenant.rows[0],
      branches: branches.rows,
      preferences: {
        // null = the user has never explicitly picked a language. The client
        // keeps its browser-detected default (EN for non-IT/EN browsers) until
        // the user chooses in Settings; only an explicit choice is persisted.
        language: pref.language ?? null,
        email_notifications_enabled: !!pref.email_notifications_enabled,
        push_token_registered: !!pref.push_token,
        notification_preferences: notifPrefs,
      },
    });
  })
);

const NotificationPrefsPatch = z
  .object({
    push_leave_decisions: z.boolean().optional(),
    push_correction_decisions: z.boolean().optional(),
    push_leave_submissions: z.boolean().optional(),
    push_correction_submissions: z.boolean().optional(),
    push_leave_reminders: z.boolean().optional(),
    push_documents: z.boolean().optional(),
    email_leave_decisions: z.boolean().optional(),
    email_correction_decisions: z.boolean().optional(),
    email_leave_submissions: z.boolean().optional(),
    email_correction_submissions: z.boolean().optional(),
    email_leave_reminders: z.boolean().optional(),
    email_documents: z.boolean().optional(),
  })
  .strict();

const PatchMe = z.object({
  language: z.enum(['it', 'en']).optional(),
  email_notifications_enabled: z.boolean().optional(),
  push_token: z.string().min(1).max(200).nullable().optional(),
  notification_preferences: NotificationPrefsPatch.optional(),
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
      b.push_token === undefined &&
      b.notification_preferences === undefined
    ) {
      ok(res, { updated: false });
      return;
    }
    const prefsPatchJson =
      b.notification_preferences !== undefined
        ? JSON.stringify(b.notification_preferences)
        : null;
    const defaultsJson = JSON.stringify(NOTIF_PREF_DEFAULTS);
    await client.query(
      `INSERT INTO user_preferences(
         user_id, language, email_notifications_enabled, push_token, notification_preferences
       )
       VALUES (
         $1,
         COALESCE($2, 'it'),
         COALESCE($3, FALSE),
         $4,
         $8::jsonb || COALESCE($6::jsonb, '{}'::jsonb)
       )
       ON CONFLICT (user_id) DO UPDATE SET
         language = COALESCE($2, user_preferences.language),
         email_notifications_enabled = COALESCE($3, user_preferences.email_notifications_enabled),
         push_token = CASE WHEN $5::boolean THEN $4 ELSE user_preferences.push_token END,
         notification_preferences = CASE
           WHEN $7::boolean
             THEN COALESCE(user_preferences.notification_preferences, '{}'::jsonb) || $6::jsonb
           ELSE user_preferences.notification_preferences
         END,
         updated_at = now()`,
      [
        req.user!.id,
        b.language ?? null,
        b.email_notifications_enabled ?? null,
        b.push_token ?? null,
        b.push_token !== undefined,
        prefsPatchJson,
        b.notification_preferences !== undefined,
        defaultsJson,
      ]
    );
    ok(res, { updated: true });
  })
);
