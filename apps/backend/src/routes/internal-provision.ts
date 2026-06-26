import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../env.js';
import { ForbiddenError, ValidationError } from '../errors/index.js';
import { ok } from '../lib/api-response.js';
import { asyncHandler } from '../lib/route-helpers.js';
import { provisionTenant } from '../lib/provision-tenant.js';
import { sendAccessEmail } from '../lib/gotrue-admin.js';

// Constant-time bearer comparison — same guard the internal-e2e router uses.
function bearerMatches(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const provided = header.slice('Bearer '.length).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const NameField = z
  .string()
  .trim()
  .max(80)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

const ProvisionTenant = z.object({
  // Company legal name → tenants.ragione_sociale. The only required field;
  // every other tenant column (country IT, tz Europe/Rome, …) defaults.
  ragione_sociale: z.string().trim().min(1).max(200),
  admin_email: z.string().email(),
  admin_first_name: NameField,
  admin_last_name: NameField,
  // Drives both the tenant locale and the invite email language.
  language: z.enum(['it', 'en']).default('it'),
  // Optional plan-limit overrides; omitted → tenants table defaults
  // (2 admins / 20 users / 3 branches).
  max_admins: z.coerce.number().int().min(1).max(1000).optional(),
  max_users: z.coerce.number().int().min(1).max(100000).optional(),
  max_branches: z.coerce.number().int().min(1).max(10000).optional(),
});

export const internalProvisionRouter = Router();

// Provision a brand-new tenant and invite its first admin.
//
// Flow: INSERT tenants → GoTrue /invite (sends the invite email) → mirror the
// user into auth_users → INSERT an admin membership. The invited admin clicks
// the email link (confirm-email.html → reset-password.html), sets a password,
// and can then sign in and land in the new tenant as admin.
//
// Runs on adminPool (bypasses RLS) because there is no tenant context yet — the
// tenant is being created here. Guarded solely by PROVISION_SECRET; there is no
// user session. Unlike the e2e router this is NOT pinned to a single tenant, so
// it is deliberately gated behind a long bearer secret and mounts only when set.
internalProvisionRouter.post(
  '/tenant',
  asyncHandler(async (req, res) => {
    const secret = env.PROVISION_SECRET;
    if (!secret) throw new ForbiddenError('provisioning endpoint disabled');
    if (!bearerMatches(req.header('authorization'), secret)) {
      throw new ForbiddenError('invalid provisioning token');
    }

    const parse = ProvisionTenant.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const body = parse.data;

    // Shared with the partnership API — see lib/provision-tenant.ts. This route
    // keeps its original response contract (3 limits) for back-compat.
    const result = await provisionTenant({
      ragioneSociale: body.ragione_sociale,
      adminEmail: body.admin_email,
      adminFirstName: body.admin_first_name ?? null,
      adminLastName: body.admin_last_name ?? null,
      language: body.language,
      maxAdmins: body.max_admins ?? null,
      maxUsers: body.max_users ?? null,
      maxBranches: body.max_branches ?? null,
    });

    // This legacy route's contract is "provision + give the first admin access".
    // Send the access email (invite for a brand-new account, reset for a reused
    // one) — provisionTenant itself no longer sends mail.
    const emailType = await sendAccessEmail(
      result.admin.userId,
      result.admin.email,
      body.language
    );

    ok(
      res,
      {
        tenant_id: result.tenantId,
        ragione_sociale: result.ragioneSociale,
        admin: {
          user_id: result.admin.userId,
          email: result.admin.email,
          role: result.admin.role,
          membership_id: result.admin.membershipId,
        },
        // true → an access email was sent (back-compat field).
        invited: emailType !== 'none',
        email_type: emailType,
        limits: {
          max_admins: result.limits.maxAdmins,
          max_users: result.limits.maxUsers,
          max_branches: result.limits.maxBranches,
        },
      },
      201
    );
  })
);
