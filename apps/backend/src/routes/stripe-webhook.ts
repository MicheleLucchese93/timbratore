import express, { Router, type Request, type Response } from 'express';
import type Stripe from 'stripe';
import { adminPool } from '../lib/admin-db.js';
import { getStripe, stripeConfigured, stripeLivemode, webhookSecrets } from '../lib/stripe.js';
import {
  handleChargeEvent,
  handlePaymentFailed,
  recordInvoicePaid,
  syncCustomer,
} from '../lib/billing.js';
import { createLogger } from '../lib/logger.js';
import { webhookModeAction } from '../lib/stripe-mode.js';

// POST /api/v1/webhooks/stripe — mounted in app.ts BEFORE express.json, because
// the signature is computed over the exact raw bytes Stripe sent.
//
// Three rules keep this correct under Stripe's at-least-once, any-order delivery:
//  1. signature verified with the active mode's signing secret (300 s tolerance).
//     Events of the OTHER mode are never applied: a sandbox event while live is
//     acknowledged and dropped (test data); a LIVE event while the API runs the
//     sandbox answers 503, so Stripe keeps retrying it for up to 3 days and a
//     real payment is recorded once the mode is back to live;
//  2. idempotency by event id (stripe_webhook_events) — a processed event is
//     acknowledged without being re-applied;
//  3. payloads are only triggers: every handler re-reads the current state from
//     the Stripe API (syncCustomer / invoices.retrieve), so an old event can
//     never roll a subscription back.
// A handler failure answers 500 so Stripe retries (up to 3 days); the nightly
// reconcile job is the safety net beyond that.

const logger = createLogger('stripe-webhook');

export const stripeWebhookRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : v.id;
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const s = event.data.object as Stripe.Checkout.Session;
      const customerId = idOf(s.customer);
      const actor = s.metadata?.initiated_by;
      if (customerId) await syncCustomer(customerId, { actorUserId: actor && UUID_RE.test(actor) ? actor : null });
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
    case 'customer.subscription.pending_update_applied':
    case 'customer.subscription.pending_update_expired': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = idOf(sub.customer);
      if (customerId) await syncCustomer(customerId);
      return;
    }
    case 'invoice.paid': {
      const inv = event.data.object as Stripe.Invoice;
      if (inv.id) await recordInvoicePaid(inv.id);
      // A renewal that finally succeeds after dunning brings past_due back to active.
      const customerId = idOf(inv.customer);
      if (customerId) await syncCustomer(customerId);
      return;
    }
    case 'invoice.payment_failed':
    case 'invoice.payment_action_required': {
      const inv = event.data.object as Stripe.Invoice;
      if (inv.id) await handlePaymentFailed(inv.id);
      const customerId = idOf(inv.customer);
      if (customerId) await syncCustomer(customerId);
      return;
    }
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      await handleChargeEvent('refunded', charge.id);
      return;
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId = idOf(dispute.charge);
      if (chargeId) await handleChargeEvent('disputed', chargeId);
      return;
    }
    default:
      // Not subscribed to in production; harmless if the dev forwarder sends it.
      return;
  }
}

stripeWebhookRouter.post(
  '/',
  express.raw({ type: 'application/json', limit: '1mb' }),
  async (req: Request, res: Response) => {
    const secrets = webhookSecrets();
    if (!secrets.active || !stripeConfigured()) {
      res.status(503).json({ ok: false, error: { code: 'BILLING_NOT_CONFIGURED', message: 'Webhook not configured' } });
      return;
    }
    const stripe = getStripe();
    const verify = (secret: string): Stripe.Event | null => {
      try {
        return stripe.webhooks.constructEvent(req.body as Buffer, req.header('stripe-signature') ?? '', secret, 300);
      } catch {
        return null;
      }
    };
    const event = verify(secrets.active) ?? (secrets.other ? verify(secrets.other) : null);
    if (!event) {
      logger.warn({ ip: req.ip }, 'Stripe webhook signature rejected');
      res.status(400).json({ ok: false, error: { code: 'BAD_SIGNATURE', message: 'Invalid signature' } });
      return;
    }
    const action = webhookModeAction(event.livemode, stripeLivemode());
    if (action === 'defer') {
      // Real money while the API runs the sandbox: make Stripe hold it.
      logger.warn({ eventId: event.id, type: event.type }, 'live Stripe event deferred: API runs the sandbox');
      res
        .status(503)
        .json({ ok: false, error: { code: 'STRIPE_MODE_INACTIVE', message: 'Live mode inactive, retry later' } });
      return;
    }
    if (action === 'ignore') {
      res.json({ received: true, ignored: 'other_stripe_mode' });
      return;
    }

    const seen = await adminPool.query(
      `INSERT INTO stripe_webhook_events (event_id, type, livemode)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO UPDATE SET event_id = EXCLUDED.event_id
       RETURNING processed_at`,
      [event.id, event.type, event.livemode]
    );
    if (seen.rows[0]?.processed_at) {
      res.json({ received: true, duplicate: true });
      return;
    }

    try {
      await handleEvent(event);
      await adminPool.query(
        `UPDATE stripe_webhook_events SET processed_at = now(), error = NULL WHERE event_id = $1`,
        [event.id]
      );
      res.json({ received: true });
    } catch (err) {
      const message = (err as Error).message?.slice(0, 500) ?? 'error';
      logger.error({ err, eventId: event.id, type: event.type }, 'Stripe webhook handling failed');
      await adminPool
        .query(`UPDATE stripe_webhook_events SET error = $2 WHERE event_id = $1`, [event.id, message])
        .catch(() => {});
      res.status(500).json({ ok: false, error: { code: 'WEBHOOK_FAILED', message: 'Handling failed, retry' } });
    }
  }
);
