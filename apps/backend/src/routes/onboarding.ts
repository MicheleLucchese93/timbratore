import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import {
  DEFAULT_SDI_CODE,
  LEGAL_VERSIONS,
  PLAN_CAPS,
  isValidCap,
  isValidPartitaIva,
  isValidProvincia,
  normalizePartitaIva,
} from '@sonoqui/shared';
import { env } from '../env.js';
import { adminPool } from '../lib/admin-db.js';
import { ok } from '../lib/api-response.js';
import { asyncHandler } from '../lib/route-helpers.js';
import { AppError, ConflictError, ForbiddenError, ValidationError } from '../errors/index.js';
import { authenticateAccount } from '../middleware/account-auth.js';
import { invalidateMembershipCache } from '../middleware/auth.js';
import { checkVies, parseItalianAddress } from '../lib/vat.js';
import { provisionTenant } from '../lib/provision-tenant.js';
import { logAuditAs } from '../lib/audit.js';
import { sendMail } from '../lib/mailer.js';
import {
  buildOperatorDuplicateVatMail,
  buildOperatorSignupMail,
  buildWelcomeMail,
} from '../lib/billing-mail.js';
import { createLogger } from '../lib/logger.js';
import { hashSignupToken, recordAccountAcceptances } from './signup.js';

// Self-service registration, step 3 — the company. The caller is a signed-in
// ACCOUNT that (usually) has no company yet, so this router authenticates the
// person only (authenticateAccount) and every handler re-checks that the
// account really has a confirmed signup waiting. Specs/SELF_SERVICE_BILLING.md §3.2.

const logger = createLogger('onboarding');

export const onboardingRouter = Router();
onboardingRouter.use(authenticateAccount);

const vatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.account?.id ?? ipKeyGenerator(req.ip ?? 'anon'),
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many VAT checks, wait a minute.' } },
});

interface PendingSignup {
  id: string;
  status: 'email_confirmed' | 'company_created';
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  plan_hint: 'piccola' | 'media' | null;
  language: 'it' | 'en';
  tenant_id: string | null;
}

/** The most recent confirmed signup of this account, if any. */
async function latestSignup(userId: string): Promise<PendingSignup | null> {
  const r = await adminPool.query(
    `SELECT id, status, email, first_name, last_name, phone, plan_hint, language, tenant_id
       FROM signup_requests
      WHERE user_id = $1 AND status IN ('email_confirmed', 'company_created')
      ORDER BY email_confirmed_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [userId]
  );
  return (r.rows[0] as PendingSignup | undefined) ?? null;
}

// GET /api/v1/onboarding — where this account stands. 404 NO_ONBOARDING when
// it never registered: the web app then shows its usual generic login error,
// so a suspended company's users learn nothing new.
onboardingRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const s = await latestSignup(req.account!.id);
    if (!s) throw new AppError({ status: 404, code: 'NO_ONBOARDING', message: 'No pending registration' });
    ok(res, {
      step: s.status === 'email_confirmed' ? 'company' : 'done',
      email: s.email,
      first_name: s.first_name,
      last_name: s.last_name,
      plan_hint: s.plan_hint,
      language: s.language,
      tenant_id: s.tenant_id,
    });
  })
);

const Claim = z.object({ token: z.string().min(20).max(200) });

// POST /api/v1/onboarding/claim — an EXISTING account confirms its signup by
// logging in and presenting the emailed token. The token must belong to the
// same email as the account: it is a proof of mailbox, not a transferable voucher.
onboardingRouter.post(
  '/claim',
  asyncHandler(async (req, res) => {
    const parse = Claim.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `SELECT id, email, status, consents, ip, user_agent, created_at, expires_at > now() AS live
           FROM signup_requests WHERE token_hash = $1 FOR UPDATE`,
        [hashSignupToken(parse.data.token)]
      );
      const row = r.rows[0];
      if (!row || row.status !== 'pending' || !row.live) {
        throw new AppError({ status: 410, code: 'SIGNUP_TOKEN_INVALID', message: 'Link expired or invalid' });
      }
      const accountEmail = req.account!.email ?? '';
      if (String(row.email).toLowerCase() !== accountEmail) {
        throw new ForbiddenError('This link belongs to another email address', 'SIGNUP_EMAIL_MISMATCH');
      }
      await client.query(
        `UPDATE signup_requests
            SET status = 'email_confirmed', email_confirmed_at = now(), user_id = $2
          WHERE id = $1`,
        [row.id, req.account!.id]
      );
      await recordAccountAcceptances(client, req.account!.id, row);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    ok(res, { step: 'company' });
  })
);

const VatCheck = z.object({ partita_iva: z.string().trim().min(11).max(20) });

// POST /api/v1/onboarding/vat-check — checksum (hard) + VIES (soft, D2).
onboardingRouter.post(
  '/vat-check',
  vatLimiter,
  asyncHandler(async (req, res) => {
    if (!(await latestSignup(req.account!.id))) {
      throw new AppError({ status: 404, code: 'NO_ONBOARDING', message: 'No pending registration' });
    }
    const parse = VatCheck.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const piva = normalizePartitaIva(parse.data.partita_iva);
    if (!isValidPartitaIva(piva)) {
      throw new AppError({ status: 422, code: 'INVALID_VAT', message: 'Partita IVA not valid' });
    }
    const v = await checkVies(piva);
    ok(res, {
      partita_iva: piva,
      status: v.status,
      name: v.name,
      address: parseItalianAddress(v.address),
      raw_address: v.address,
    });
  })
);

const Company = z.object({
  partita_iva: z.string().trim().min(11).max(20),
  ragione_sociale: z.string().trim().min(2).max(200).regex(/^[^\r\n<>]*$/),
  address: z.string().trim().min(3).max(200),
  cap: z.string().trim().refine(isValidCap, 'cap'),
  city: z.string().trim().min(2).max(100),
  province: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isValidProvincia, 'province'),
  accept_dpa: z.literal(true),
  accept_art1341: z.literal(true),
  accept_powers: z.literal(true),
});

// POST /api/v1/onboarding/company — creates the company on the Free plan,
// with the signed-in account as its first admin. One transaction: tenant,
// admin membership, billing profile, the company-level acceptances and the
// signup's own status either all commit or none do.
onboardingRouter.post(
  '/company',
  asyncHandler(async (req, res) => {
    const account = req.account!;
    const signup = await latestSignup(account.id);
    if (!signup || signup.status !== 'email_confirmed') {
      throw new AppError({ status: 409, code: 'NO_ONBOARDING', message: 'No company registration pending' });
    }
    const parse = Company.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const piva = normalizePartitaIva(b.partita_iva);
    if (!isValidPartitaIva(piva)) {
      throw new AppError({ status: 422, code: 'INVALID_VAT', message: 'Partita IVA not valid' });
    }

    // Any live company with this P.IVA — a partner's customer included — blocks
    // the signup: the person should be added to it, not create a twin (and a
    // partner's customer must not route around the partner).
    const dup = await adminPool.query(
      `SELECT ragione_sociale FROM tenants WHERE partita_iva = $1 AND deleted_at IS NULL LIMIT 1`,
      [piva]
    );
    if (dup.rowCount) {
      await notifyOperator(
        buildOperatorDuplicateVatMail({
          partitaIva: piva,
          email: signup.email,
          existingCompany: dup.rows[0].ragione_sociale,
        })
      );
      throw new ConflictError('This Partita IVA is already registered', 'VAT_ALREADY_REGISTERED');
    }

    const vies = await checkVies(piva);
    let result;
    try {
      result = await provisionTenant({
        ragioneSociale: b.ragione_sociale,
        adminEmail: signup.email,
        adminFirstName: signup.first_name,
        adminLastName: signup.last_name,
        language: signup.language,
        maxUsers: PLAN_CAPS.free.maxUsers,
        maxAdmins: PLAN_CAPS.free.maxAdmins,
        maxBranches: PLAN_CAPS.free.maxBranches,
        maxDocumentali: PLAN_CAPS.free.maxDocumentali,
        createdByPartner: null,
        selfService: { partitaIva: piva, plan: 'free', pendingPlan: signup.plan_hint },
        extra: async (client, { tenantId, adminUserId }) => {
          if (adminUserId !== account.id) {
            // The account resolved by email must be the one signed in.
            throw new ForbiddenError('Account mismatch', 'SIGNUP_EMAIL_MISMATCH');
          }
          await client.query(
            `INSERT INTO tenant_billing_profiles
               (tenant_id, legal_name, partita_iva, codice_fiscale, address, cap, city, province,
                sdi_code, billing_email, vat_status, vies_name, vies_address, vies_request_id, vies_checked_at,
                updated_by)
             VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              tenantId,
              b.ragione_sociale,
              piva,
              b.address,
              b.cap,
              b.city,
              b.province,
              DEFAULT_SDI_CODE,
              signup.email,
              vies.status,
              vies.name,
              vies.address,
              vies.requestIdentifier,
              vies.checkedAt,
              account.id,
            ]
          );
          for (const doc of ['dpa', 'art1341', 'powers'] as const) {
            await client.query(
              `INSERT INTO legal_acceptances (tenant_id, user_id, document, version, ip, user_agent)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [tenantId, account.id, doc, LEGAL_VERSIONS[doc], req.ip ?? null, req.header('user-agent')?.slice(0, 400) ?? null]
            );
          }
          await client.query(
            `UPDATE tenants SET dpa_accepted_at = now(), dpa_accepted_by = $2, dpa_version = $3 WHERE id = $1`,
            [tenantId, account.id, LEGAL_VERSIONS.dpa]
          );
          await client.query(
            `UPDATE signup_requests
                SET status = 'company_created', company_created_at = now(), tenant_id = $2
              WHERE id = $1`,
            [signup.id, tenantId]
          );
          await logAuditAs(client, tenantId, account.id, {
            action: 'tenant.self_signup',
            resourceType: 'tenant',
            resourceId: tenantId,
            after: {
              ragione_sociale: b.ragione_sociale,
              partita_iva: piva,
              vat_status: vies.status,
              plan: 'free',
              pending_plan: signup.plan_hint,
            },
            req,
          });
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        // tenants_self_service_piva_uq: a concurrent registration won the race.
        throw new ConflictError('This Partita IVA is already registered', 'VAT_ALREADY_REGISTERED');
      }
      throw err;
    }

    invalidateMembershipCache(account.id);
    logger.info({ tenant_id: result.tenantId, user_id: account.id, vat_status: vies.status }, 'self-service company created');

    // Mails after commit; a failed send never undoes a created company.
    const welcome = buildWelcomeMail({
      firstName: signup.first_name,
      companyName: b.ragione_sociale,
      pendingPlan: signup.plan_hint,
      language: signup.language,
    });
    await sendMail({ to: signup.email, ...welcome });
    await notifyOperator(
      buildOperatorSignupMail({
        companyName: b.ragione_sociale,
        partitaIva: piva,
        vatStatus: vies.status,
        headcountBand: null,
        planHint: signup.plan_hint,
        adminName: `${signup.first_name} ${signup.last_name}`.trim(),
        adminEmail: signup.email,
        phone: signup.phone,
        tenantId: result.tenantId,
      })
    );

    ok(res, { tenant_id: result.tenantId, ragione_sociale: b.ragione_sociale, pending_plan: signup.plan_hint }, 201);
  })
);

/** Operator notices go to the platform support mailbox (SUPPORT_TICKET_TO). */
async function notifyOperator(mail: { subject: string; text: string; html: string }): Promise<void> {
  try {
    await sendMail({ to: env.SUPPORT_TICKET_TO, ...mail });
  } catch (err) {
    logger.warn({ err }, 'operator notice failed');
  }
}

