import { Router, type Request } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { formatEuroCents, isEntitledStatus, type EntitlementOverrides } from '@sonoqui/shared';
import { env } from '../env.js';
import { adminPool } from '../lib/admin-db.js';
import { ok } from '../lib/api-response.js';
import { asyncHandler } from '../lib/route-helpers.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../errors/index.js';
import { authenticatePartner, requireSuperAdmin } from '../middleware/partnership-auth.js';
import { logPartnershipAudit } from '../lib/partnership-audit.js';
import { applyEntitlements, getCustomerId, loadBillingProfile, syncCustomer } from '../lib/billing.js';
import {
  billingEnabled,
  getStripe,
  stripeDashboardCustomerUrl,
  stripeLivemode,
  stripeMode,
  tenantLivemode,
  tenantLivemodeSql,
} from '../lib/stripe.js';
import { checkVies } from '../lib/vat.js';
import { sendMail } from '../lib/mailer.js';
import { buildSignupConfirmMail } from '../lib/billing-mail.js';
import { hashSignupToken } from './signup.js';

// Super-user console surface for self-service companies (Specs/SELF_SERVICE_BILLING.md §3.7):
// the Registrazioni funnel, the "Pagamenti da fatturare" ledger and per-company
// billing controls. Every route is super-user only (D11): other platform admins
// still see these companies in Aziende, but money and signups stay with one person.

export const partnershipBillingRouter = Router();
partnershipBillingRouter.use(authenticatePartner);
partnershipBillingRouter.use(requireSuperAdmin);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function auditCtx(req: Request): { actorUserId: string; actorRole: string; ip: string | null; userAgent: string | null } {
  return {
    actorUserId: req.partner!.userId,
    actorRole: req.partner!.role,
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

function uuidParam(v: unknown): string {
  const s = String(v ?? '');
  if (!UUID_RE.test(s)) throw new ValidationError('invalid id');
  return s;
}

// ---- Registrazioni -----------------------------------------------------------

const SignupList = z.object({
  status: z.enum(['all', 'pending', 'email_confirmed', 'company_created', 'expired', 'rejected']).default('all'),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

partnershipBillingRouter.get(
  '/signups',
  asyncHandler(async (req, res) => {
    const parse = SignupList.safeParse(req.query);
    if (!parse.success) throw new ValidationError('invalid query', parse.error.flatten());
    const { status, q, limit, offset } = parse.data;
    const params: unknown[] = [];
    const where: string[] = [];
    if (status !== 'all') {
      params.push(status);
      where.push(`s.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      where.push(
        `(lower(s.email) LIKE $${params.length} OR lower(s.first_name || ' ' || s.last_name) LIKE $${params.length}
          OR lower(coalesce(t.ragione_sociale, '')) LIKE $${params.length} OR coalesce(t.partita_iva, '') LIKE $${params.length})`
      );
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await adminPool.query(
      `SELECT count(*)::int AS n FROM signup_requests s LEFT JOIN tenants t ON t.id = s.tenant_id ${whereSql}`,
      params
    );
    params.push(limit, offset);
    const r = await adminPool.query(
      `SELECT s.id, s.status, s.mode, s.email, s.first_name, s.last_name, s.phone, s.plan_hint, s.utm,
              s.language, s.created_at, s.expires_at, s.send_count, s.email_confirmed_at,
              s.company_created_at, s.rejected_at, s.reject_reason,
              (s.status = 'pending' AND s.expires_at <= now()) AS expired,
              s.tenant_id, t.ragione_sociale, t.partita_iva, t.plan, t.billing_mode,
              p.vat_status, p.vies_request_id, p.vat_reviewed_at, p.headcount_band,
              EXISTS (SELECT 1 FROM billing_payments bp
                       WHERE bp.tenant_id = s.tenant_id AND bp.livemode = ${tenantLivemodeSql('s.tenant_id')}) AS paying,
              (SELECT max(st.occurred_at) FROM stamps st WHERE st.tenant_id = s.tenant_id) AS last_stamp_at
         FROM signup_requests s
         LEFT JOIN tenants t ON t.id = s.tenant_id
         LEFT JOIN tenant_billing_profiles p ON p.tenant_id = s.tenant_id
         ${whereSql}
        ORDER BY s.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const funnel = await adminPool.query(
      `SELECT
         count(*)::int AS requested,
         count(*) FILTER (WHERE s.status IN ('email_confirmed', 'company_created'))::int AS confirmed,
         count(*) FILTER (WHERE s.status = 'company_created')::int AS companies,
         count(DISTINCT s.tenant_id) FILTER (
           WHERE EXISTS (SELECT 1 FROM stamps st WHERE st.tenant_id = s.tenant_id))::int AS stamping,
         count(DISTINCT s.tenant_id) FILTER (
           WHERE EXISTS (SELECT 1 FROM billing_payments bp
                          WHERE bp.tenant_id = s.tenant_id AND bp.livemode = ${tenantLivemodeSql('s.tenant_id')}))::int AS paying
       FROM signup_requests s
      WHERE s.created_at > now() - interval '90 days'`
    );
    ok(res, { items: r.rows, total: total.rows[0].n, funnel: funnel.rows[0] });
  })
);

partnershipBillingRouter.post(
  '/signups/:id/resend',
  asyncHandler(async (req, res) => {
    const id = uuidParam(req.params.id);
    const r = await adminPool.query(
      `SELECT id, email, first_name, mode, language, status FROM signup_requests WHERE id = $1`,
      [id]
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundError('signup not found');
    if (row.status !== 'pending' && row.status !== 'expired') {
      throw new ConflictError('Email already confirmed', 'SIGNUP_NOT_PENDING');
    }
    const token = randomBytes(32).toString('base64url');
    await adminPool.query(
      `UPDATE signup_requests
          SET token_hash = $2, status = 'pending', last_sent_at = now(), send_count = send_count + 1,
              expires_at = now() + make_interval(hours => $3)
        WHERE id = $1`,
      [id, hashSignupToken(token), env.SIGNUP_TOKEN_TTL_HOURS]
    );
    const mail = buildSignupConfirmMail({
      firstName: row.first_name,
      token,
      mode: row.mode,
      ttlHours: env.SIGNUP_TOKEN_TTL_HOURS,
      language: row.language,
    });
    const sent = await sendMail({ to: row.email, ...mail });
    await logPartnershipAudit({
      ...auditCtx(req),
      action: 'signup.resend',
      targetType: 'signup',
      targetId: id,
      targetLabel: row.email,
    });
    ok(res, { sent });
  })
);

const Reject = z.object({ reason: z.string().trim().max(500).optional() });

partnershipBillingRouter.post(
  '/signups/:id/reject',
  asyncHandler(async (req, res) => {
    const id = uuidParam(req.params.id);
    const parse = Reject.safeParse(req.body ?? {});
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const r = await adminPool.query(
      `UPDATE signup_requests
          SET status = 'rejected', rejected_at = now(), rejected_by = $2, reject_reason = $3
        WHERE id = $1 AND status IN ('pending', 'email_confirmed', 'expired')
        RETURNING email`,
      [id, req.partner!.userId, parse.data.reason ?? null]
    );
    if (!r.rowCount) throw new ConflictError('Only a signup without a company can be rejected', 'SIGNUP_NOT_REJECTABLE');
    await logPartnershipAudit({
      ...auditCtx(req),
      action: 'signup.reject',
      targetType: 'signup',
      targetId: id,
      targetLabel: r.rows[0].email,
      after: { reason: parse.data.reason ?? null },
    });
    ok(res, { rejected: true });
  })
);

// ---- Pagamenti (ledger) ---------------------------------------------------------

const PaymentList = z.object({
  status: z.enum(['to_invoice', 'invoiced', 'all']).default('to_invoice'),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  tenant_id: z.string().regex(UUID_RE).optional(),
  q: z.string().trim().max(100).optional(),
});

function paymentWhere(f: z.infer<typeof PaymentList>): { sql: string; params: unknown[] } {
  // Only the current Stripe mode: a sandbox charge must never reach the
  // "da fatturare" list once the API runs live (nor clutter it the other way).
  const params: unknown[] = [stripeLivemode()];
  const where: string[] = ['bp.livemode = $1'];
  if (f.status === 'to_invoice') where.push('bp.invoiced_at IS NULL');
  if (f.status === 'invoiced') where.push('bp.invoiced_at IS NOT NULL');
  if (f.month) {
    params.push(`${f.month}-01`);
    where.push(`bp.paid_at >= ($${params.length}::date AT TIME ZONE 'Europe/Rome')
                AND bp.paid_at < (($${params.length}::date + interval '1 month') AT TIME ZONE 'Europe/Rome')`);
  }
  if (f.tenant_id) {
    params.push(f.tenant_id);
    where.push(`bp.tenant_id = $${params.length}`);
  }
  if (f.q) {
    params.push(`%${f.q.toLowerCase()}%`);
    where.push(`(lower(t.ragione_sociale) LIKE $${params.length}
                 OR coalesce(bp.billing_snapshot->>'partita_iva', '') LIKE $${params.length}
                 OR lower(coalesce(bp.invoice_number, '')) LIKE $${params.length})`);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const PAYMENT_COLUMNS = `bp.id, bp.tenant_id, t.ragione_sociale, bp.stripe_invoice_id, bp.stripe_charge_id,
  bp.livemode, bp.paid_at, bp.currency, bp.net_cents, bp.tax_cents, bp.total_cents, bp.fee_cents,
  bp.period_start, bp.period_end, bp.lines, bp.billing_snapshot, bp.refunded_cents, bp.disputed,
  bp.invoiced_at, bp.invoice_number, bp.invoice_date, bp.note`;

partnershipBillingRouter.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const parse = PaymentList.safeParse(req.query);
    if (!parse.success) throw new ValidationError('invalid query', parse.error.flatten());
    const w = paymentWhere(parse.data);
    const r = await adminPool.query(
      `SELECT ${PAYMENT_COLUMNS}
         FROM billing_payments bp JOIN tenants t ON t.id = bp.tenant_id
         ${w.sql}
        ORDER BY bp.paid_at DESC
        LIMIT 500`,
      w.params
    );
    const totals = await adminPool.query(
      `SELECT count(*)::int AS count, coalesce(sum(bp.net_cents), 0)::int AS net_cents,
              coalesce(sum(bp.tax_cents), 0)::int AS tax_cents, coalesce(sum(bp.total_cents), 0)::int AS total_cents,
              coalesce(sum(bp.fee_cents), 0)::int AS fee_cents,
              count(*) FILTER (WHERE bp.invoiced_at IS NULL)::int AS to_invoice
         FROM billing_payments bp JOIN tenants t ON t.id = bp.tenant_id ${w.sql}`,
      w.params
    );
    ok(res, { items: r.rows, totals: totals.rows[0], stripe_mode: stripeMode() });
  })
);

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  // Formula-injection guard for spreadsheet apps + RFC 4180 quoting.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function euro(cents: number | null | undefined): string {
  return cents == null ? '' : (cents / 100).toFixed(2).replace('.', ',');
}

function romeDate(v: Date | string | null): string {
  if (!v) return '';
  return new Date(v).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
}

// CSV for the accountant / invoicing software: one row per charge, Italian
// number format, semicolon-separated (what Excel expects on an Italian locale).
partnershipBillingRouter.get(
  '/payments/export.csv',
  asyncHandler(async (req, res) => {
    const parse = PaymentList.safeParse(req.query);
    if (!parse.success) throw new ValidationError('invalid query', parse.error.flatten());
    const w = paymentWhere(parse.data);
    const r = await adminPool.query(
      `SELECT ${PAYMENT_COLUMNS} FROM billing_payments bp JOIN tenants t ON t.id = bp.tenant_id
         ${w.sql} ORDER BY bp.paid_at ASC`,
      w.params
    );
    const header = [
      'Data incasso', 'Ragione sociale', 'P.IVA', 'Codice fiscale', 'Indirizzo', 'CAP', 'Comune', 'Provincia',
      'Codice SDI', 'PEC', 'Email fatturazione', 'Descrizione', 'Periodo dal', 'Periodo al',
      'Imponibile', 'IVA', 'Totale', 'Commissione Stripe', 'Rimborsato', 'Fatturato il', 'Numero fattura',
      'ID fattura Stripe',
    ];
    const rows = r.rows.map((p) => {
      const b = (p.billing_snapshot ?? {}) as Record<string, string | null>;
      const lines = (p.lines ?? []) as Array<{ label?: string | null; description?: string | null }>;
      return [
        romeDate(p.paid_at), b.legal_name ?? p.ragione_sociale, b.partita_iva, b.codice_fiscale, b.address, b.cap,
        b.city, b.province, b.sdi_code, b.pec, b.billing_email,
        lines.map((l) => l.label ?? l.description ?? '').filter(Boolean).join(' | '),
        romeDate(p.period_start), romeDate(p.period_end),
        euro(p.net_cents), euro(p.tax_cents), euro(p.total_cents), euro(p.fee_cents), euro(p.refunded_cents),
        romeDate(p.invoiced_at), p.invoice_number, p.stripe_invoice_id,
      ].map(csvCell).join(';');
    });
    const body = '﻿' + [header.join(';'), ...rows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pagamenti-sonoqui-${parse.data.month ?? 'tutti'}.csv"`);
    res.send(body);
  })
);

const MarkInvoiced = z.object({
  invoiced: z.boolean(),
  invoice_number: z.string().trim().max(60).nullable().optional(),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

partnershipBillingRouter.patch(
  '/payments/:id',
  asyncHandler(async (req, res) => {
    const id = uuidParam(req.params.id);
    const parse = MarkInvoiced.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    if (b.invoiced && !b.invoice_number) throw new ValidationError('invoice_number required');
    const r = b.invoiced
      ? await adminPool.query(
          `UPDATE billing_payments
              SET invoiced_at = now(), invoiced_by = $2, invoice_number = $3,
                  invoice_date = COALESCE($4::date, (now() AT TIME ZONE 'Europe/Rome')::date),
                  note = COALESCE($5, note)
            WHERE id = $1 RETURNING id, tenant_id, total_cents, invoice_number`,
          [id, req.partner!.userId, b.invoice_number ?? null, b.invoice_date ?? null, b.note ?? null]
        )
      : await adminPool.query(
          `UPDATE billing_payments
              SET invoiced_at = NULL, invoiced_by = NULL, invoice_number = NULL, invoice_date = NULL,
                  note = COALESCE($2, note)
            WHERE id = $1 RETURNING id, tenant_id, total_cents, invoice_number`,
          [id, b.note ?? null]
        );
    if (!r.rowCount) throw new NotFoundError('payment not found');
    await logPartnershipAudit({
      ...auditCtx(req),
      action: b.invoiced ? 'billing.payment_invoiced' : 'billing.payment_uninvoiced',
      targetType: 'payment',
      targetId: id,
      targetLabel: `${formatEuroCents(r.rows[0].total_cents)}${b.invoice_number ? ` · n. ${b.invoice_number}` : ''}`,
      after: b,
    });
    ok(res, { id, invoiced: b.invoiced });
  })
);

// ---- per-company billing controls --------------------------------------------------

partnershipBillingRouter.get(
  '/tenants/:id',
  asyncHandler(async (req, res) => {
    const id = uuidParam(req.params.id);
    const t = await adminPool.query(
      `SELECT id, ragione_sociale, partita_iva, signup_source, billing_mode, plan, pending_plan,
              entitlement_overrides, over_limit_since, max_users, max_branches, max_admins, max_documentali,
              cantieri_enabled, api_enabled, created_at
         FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!t.rowCount) throw new NotFoundError('tenant not found');
    const customerId = await getCustomerId(id);
    const livemode = tenantLivemode(id);
    const subs = await adminPool.query(
      `SELECT stripe_subscription_id AS id, product_line, price_lookup_key, status, billing_interval,
              current_period_end, cancel_at_period_end, canceled_at, ended_at
         FROM billing_subscriptions WHERE tenant_id = $1 AND livemode = $2 ORDER BY created_at DESC`,
      [id, livemode]
    );
    const payments = await adminPool.query(
      `SELECT count(*)::int AS count, coalesce(sum(total_cents), 0)::int AS total_cents,
              count(*) FILTER (WHERE invoiced_at IS NULL)::int AS to_invoice
         FROM billing_payments WHERE tenant_id = $1 AND livemode = $2`,
      [id, livemode]
    );
    const signup = await adminPool.query(
      `SELECT email, first_name, last_name, phone, plan_hint, utm, created_at, company_created_at
         FROM signup_requests WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    ok(res, {
      tenant: t.rows[0],
      profile: await loadBillingProfile(id),
      stripe_customer_id: customerId,
      stripe_dashboard_url: customerId ? stripeDashboardCustomerUrl(customerId, livemode) : null,
      subscriptions: subs.rows,
      payments: payments.rows[0],
      signup: signup.rows[0] ?? null,
      billing_enabled: billingEnabled(),
      // The mode THIS company's rows are read in (differs from the API's only
      // on a production running the sandbox, for non-test companies).
      stripe_mode: livemode ? 'live' : 'sandbox',
    });
  })
);

const Overrides = z
  .object({
    max_users: z.number().int().min(1).max(100000).optional(),
    max_branches: z.number().int().min(1).max(10000).optional(),
    max_admins: z.number().int().min(1).max(1000).optional(),
    max_documentali: z.number().int().min(1).max(1000).optional(),
    cantieri_enabled: z.boolean().optional(),
    api_enabled: z.boolean().optional(),
  })
  .strict();

const TenantBilling = z.object({
  billing_mode: z.enum(['managed', 'stripe']).optional(),
  entitlement_overrides: Overrides.optional(),
  // When leaving Stripe: what to do with the live subscriptions.
  stripe_subscriptions: z.enum(['keep', 'cancel_at_period_end', 'cancel_now']).default('keep'),
});

partnershipBillingRouter.patch(
  '/tenants/:id',
  asyncHandler(async (req, res) => {
    const id = uuidParam(req.params.id);
    const parse = TenantBilling.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const cur = await adminPool.query(
      `SELECT ragione_sociale, billing_mode, entitlement_overrides FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!cur.rowCount) throw new NotFoundError('tenant not found');
    const before = cur.rows[0];

    if (b.entitlement_overrides) {
      await adminPool.query(`UPDATE tenants SET entitlement_overrides = $2::jsonb WHERE id = $1`, [
        id,
        JSON.stringify(b.entitlement_overrides satisfies EntitlementOverrides),
      ]);
      await logPartnershipAudit({
        ...auditCtx(req),
        action: 'tenant.entitlement_override',
        targetType: 'tenant',
        targetId: id,
        targetLabel: before.ragione_sociale,
        before: { entitlement_overrides: before.entitlement_overrides },
        after: { entitlement_overrides: b.entitlement_overrides },
      });
    }

    if (b.billing_mode && b.billing_mode !== before.billing_mode) {
      if (b.billing_mode === 'managed' && b.stripe_subscriptions !== 'keep' && billingEnabled()) {
        if (tenantLivemode(id) !== stripeLivemode()) {
          // Its subscriptions live in the other Stripe mode: this key cannot
          // cancel them, and "cancelled" must never be reported when it wasn't.
          throw new ConflictError(
            'This company is billed in the other Stripe mode: switch STRIPE_MODE to cancel its subscriptions',
            'STRIPE_MODE_MISMATCH'
          );
        }
        const subs = await adminPool.query(
          `SELECT stripe_subscription_id, status FROM billing_subscriptions WHERE tenant_id = $1 AND livemode = $2`,
          [id, stripeLivemode()]
        );
        for (const s of subs.rows.filter((x) => isEntitledStatus(x.status as string))) {
          if (b.stripe_subscriptions === 'cancel_now') {
            await getStripe().subscriptions.cancel(s.stripe_subscription_id as string, { prorate: false });
          } else {
            await getStripe().subscriptions.update(s.stripe_subscription_id as string, { cancel_at_period_end: true });
          }
        }
        await logPartnershipAudit({
          ...auditCtx(req),
          action: 'tenant.stripe_cancel',
          targetType: 'tenant',
          targetId: id,
          targetLabel: before.ragione_sociale,
          after: { mode: b.stripe_subscriptions },
        });
      }
      await adminPool.query(`UPDATE tenants SET billing_mode = $2 WHERE id = $1`, [id, b.billing_mode]);
      await logPartnershipAudit({
        ...auditCtx(req),
        action: 'tenant.billing_mode_change',
        targetType: 'tenant',
        targetId: id,
        targetLabel: before.ragione_sociale,
        before: { billing_mode: before.billing_mode },
        after: { billing_mode: b.billing_mode, stripe_subscriptions: b.stripe_subscriptions },
      });
    }

    // Re-derive (no-op for managed tenants) and refresh the Stripe mirror when
    // subscriptions were just touched.
    const customerId = await getCustomerId(id);
    if (customerId && billingEnabled()) await syncCustomer(customerId, { actorUserId: null });
    else await applyEntitlements(id, null);
    ok(res, { updated: true });
  })
);

partnershipBillingRouter.post(
  '/tenants/:id/sync',
  asyncHandler(async (req, res) => {
    const id = uuidParam(req.params.id);
    const customerId = await getCustomerId(id);
    if (!customerId) throw new ConflictError('No Stripe customer', 'NO_CUSTOMER');
    if (!billingEnabled()) throw new AppError({ status: 503, code: 'BILLING_DISABLED', message: 'Billing disabled' });
    await syncCustomer(customerId, { actorUserId: null });
    ok(res, { synced: true });
  })
);

const VatReview = z.object({ recheck: z.boolean().default(false) });

// Mark a not_in_vies / unavailable P.IVA as checked by a human (D2), optionally
// re-running VIES first.
partnershipBillingRouter.post(
  '/tenants/:id/vat-review',
  asyncHandler(async (req, res) => {
    const id = uuidParam(req.params.id);
    const parse = VatReview.safeParse(req.body ?? {});
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const profile = await loadBillingProfile(id);
    if (!profile) throw new NotFoundError('billing profile not found');
    let status = profile.vat_status;
    if (parse.data.recheck) {
      const v = await checkVies(profile.partita_iva, { force: true });
      status = v.status;
      await adminPool.query(
        `UPDATE tenant_billing_profiles
            SET vat_status = $2, vies_name = COALESCE($3, vies_name), vies_address = COALESCE($4, vies_address),
                vies_request_id = COALESCE($5, vies_request_id), vies_checked_at = $6
          WHERE tenant_id = $1`,
        [id, v.status, v.name, v.address, v.requestIdentifier, v.checkedAt]
      );
    }
    await adminPool.query(
      `UPDATE tenant_billing_profiles SET vat_reviewed_at = now(), vat_reviewed_by = $2 WHERE tenant_id = $1`,
      [id, req.partner!.userId]
    );
    await logPartnershipAudit({
      ...auditCtx(req),
      action: 'tenant.vat_review',
      targetType: 'tenant',
      targetId: id,
      targetLabel: profile.legal_name,
      after: { vat_status: status, recheck: parse.data.recheck },
    });
    ok(res, { vat_status: status });
  })
);
