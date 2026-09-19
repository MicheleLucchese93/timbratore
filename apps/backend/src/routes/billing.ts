import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { ValidationError } from '../errors/index.js';
import { adminPool } from '../lib/admin-db.js';
import {
  billingOverview,
  checkoutStatus,
  createCheckout,
  createPortal,
  getCustomerId,
  saveBillingProfile,
  setModuleCancellation,
  syncCustomer,
  type PortalFlow,
} from '../lib/billing.js';
import { billingEnabled } from '../lib/stripe.js';

// Plan & modules for a company's admins (Impostazioni → Piano e moduli, the
// "Passa a Premium" page, /checkout/success). Everything here runs on the
// service pool scoped by req.user.tenantId: the billing tables are revoked from
// the per-request `app` role (migration 067). A read-only partner support
// session can look (GET) but never buy — authenticate() refuses its non-GETs.

export const billingRouter = Router();
billingRouter.use(authenticate);
billingRouter.use(requireAdmin);

const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.tenantId ?? ipKeyGenerator(req.ip ?? 'anon'),
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many refreshes, wait a minute.' } },
});

billingRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    ok(res, await billingOverview(req.user!.tenantId));
  })
);

const Profile = z.object({
  legal_name: z.string().trim().min(2).max(200).regex(/^[^\r\n<>]*$/).optional(),
  codice_fiscale: z.string().trim().max(16).nullable().optional(),
  address: z.string().trim().min(3).max(200).optional(),
  cap: z.string().trim().max(5).optional(),
  city: z.string().trim().min(2).max(100).optional(),
  province: z.string().trim().max(2).optional(),
  sdi_code: z.string().trim().max(7).nullable().optional(),
  pec: z.string().trim().max(254).nullable().optional(),
  billing_email: z.string().trim().email().max(254).optional(),
});

billingRouter.put(
  '/profile',
  asyncHandler(async (req, res) => {
    const parse = Profile.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    ok(res, await saveBillingProfile(req.user!.tenantId, req.user!.id, parse.data));
  })
);

const Checkout = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plan'), plan: z.enum(['piccola', 'media']), interval: z.enum(['month', 'year']) }),
  z.object({ kind: z.literal('module'), module: z.enum(['cantieri', 'api']) }),
]);

billingRouter.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const parse = Checkout.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    ok(res, await createCheckout({ tenantId: req.user!.tenantId, actorUserId: req.user!.id, item: parse.data }));
  })
);

// GET /billing/checkout/:sessionId — polled by /checkout/success.
billingRouter.get(
  '/checkout/:sessionId',
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const id = String(req.params.sessionId);
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) throw new ValidationError('invalid session id');
    ok(res, await checkoutStatus(req.user!.tenantId, id, req.user!.id));
  })
);

const Portal = z.object({
  flow: z.enum(['payment_method_update', 'subscription_update', 'subscription_cancel']).nullable().optional(),
});

billingRouter.post(
  '/portal',
  asyncHandler(async (req, res) => {
    const parse = Portal.safeParse(req.body ?? {});
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    ok(res, await createPortal({ tenantId: req.user!.tenantId, flow: (parse.data.flow ?? null) as PortalFlow }));
  })
);

const ModuleParam = z.enum(['cantieri', 'api']);

billingRouter.post(
  '/modules/:key/cancel',
  asyncHandler(async (req, res) => {
    const m = ModuleParam.safeParse(req.params.key);
    if (!m.success) throw new ValidationError('unknown module');
    await setModuleCancellation({ tenantId: req.user!.tenantId, actorUserId: req.user!.id, module: m.data, cancel: true });
    ok(res, await billingOverview(req.user!.tenantId));
  })
);

billingRouter.post(
  '/modules/:key/resume',
  asyncHandler(async (req, res) => {
    const m = ModuleParam.safeParse(req.params.key);
    if (!m.success) throw new ValidationError('unknown module');
    await setModuleCancellation({ tenantId: req.user!.tenantId, actorUserId: req.user!.id, module: m.data, cancel: false });
    ok(res, await billingOverview(req.user!.tenantId));
  })
);

// POST /billing/refresh — re-read this company's subscriptions from Stripe.
// Used by /checkout/success so activation does not wait on webhook delivery,
// and by local dev where no webhook reaches localhost.
billingRouter.post(
  '/refresh',
  refreshLimiter,
  asyncHandler(async (req, res) => {
    if (billingEnabled()) {
      const customerId = await getCustomerId(req.user!.tenantId);
      if (customerId) await syncCustomer(customerId, { actorUserId: req.user!.id });
    }
    ok(res, await billingOverview(req.user!.tenantId));
  })
);

// POST /billing/pending-plan/dismiss — "continue on Free": stop offering the
// plan picked on the website.
billingRouter.post(
  '/pending-plan/dismiss',
  asyncHandler(async (req, res) => {
    await adminPool.query(`UPDATE tenants SET pending_plan = NULL WHERE id = $1`, [req.user!.tenantId]);
    ok(res, { pending_plan: null });
  })
);
