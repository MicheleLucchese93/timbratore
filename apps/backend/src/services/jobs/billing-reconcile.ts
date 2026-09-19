import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';
import { getStripe, stripeConfigured, stripeLivemode, stripeMode } from '../../lib/stripe.js';
import { applyEntitlements, recordInvoicePaid, syncCustomer } from '../../lib/billing.js';
import { checkVies } from '../../lib/vat.js';

const logger = createLogger('billing_reconcile');

/** How far back the nightly ledger catch-up looks for paid invoices. */
const LEDGER_CATCHUP_DAYS = 35;

/**
 * Nightly safety net for Stripe webhooks: re-read every linked customer's
 * subscriptions and re-apply entitlements. A webhook lost for good (endpoint
 * down past Stripe's 3-day retry window) is repaired here within a day.
 * Sequential on purpose — a few hundred customers, Stripe rate limits, no rush.
 */
export async function billingReconcile(): Promise<void> {
  if (stripeConfigured()) {
    // Only the current mode's customers: the other mode's cannot be read with
    // this key, and their subscriptions do not count while it is inactive.
    const customers = await adminPool.query(
      `SELECT bc.stripe_customer_id
         FROM billing_customers bc JOIN tenants t ON t.id = bc.tenant_id
        WHERE t.deleted_at IS NULL AND bc.livemode = $1`,
      [stripeLivemode()]
    );
    let ok = 0;
    let failed = 0;
    let recovered = 0;
    // Paid invoices the ledger lacks — an `invoice.paid` Stripe gave up on, or
    // a live one deferred while the API ran the sandbox. Idempotent per invoice.
    const since = Math.floor(Date.now() / 1000) - LEDGER_CATCHUP_DAYS * 86_400;
    for (const c of customers.rows) {
      const customerId = c.stripe_customer_id as string;
      try {
        await syncCustomer(customerId);
        for await (const inv of getStripe().invoices.list({
          customer: customerId,
          status: 'paid',
          created: { gte: since },
          limit: 100,
        })) {
          if (!inv.id || inv.amount_paid <= 0) continue;
          const known = await adminPool.query(`SELECT 1 FROM billing_payments WHERE stripe_invoice_id = $1`, [inv.id]);
          if (known.rowCount) continue;
          await recordInvoicePaid(inv.id);
          recovered++;
        }
        ok++;
      } catch (err) {
        failed++;
        logger.warn({ err, customer: customerId }, 'reconcile failed for customer');
      }
    }
    logger.info({ ok, failed, recovered_payments: recovered }, 'billing reconcile done');
  }
  await rederiveStripeTenants();

  // Webhook idempotency log: 30 days is far beyond Stripe's retry window.
  await adminPool.query(
    `DELETE FROM stripe_webhook_events WHERE received_at < now() - interval '30 days' AND processed_at IS NOT NULL`
  );

  // P.IVA checks that could not reach VIES at registration (D2): try again.
  const pending = await adminPool.query(
    `SELECT tenant_id, partita_iva FROM tenant_billing_profiles WHERE vat_status = 'unavailable' LIMIT 200`
  );
  for (const p of pending.rows) {
    const v = await checkVies(p.partita_iva as string, { force: true });
    if (v.status === 'unavailable') continue;
    await adminPool.query(
      `UPDATE tenant_billing_profiles
          SET vat_status = $2, vies_name = $3, vies_address = $4, vies_request_id = $5, vies_checked_at = $6
        WHERE tenant_id = $1`,
      [p.tenant_id, v.status, v.name, v.address, v.requestIdentifier, v.checkedAt]
    );
  }
}

/**
 * Re-apply every Stripe-billed company's entitlements from the local mirror —
 * no Stripe call, a no-op when nothing changed. It is what makes a STRIPE_MODE
 * flip converge: companies that only ever paid in the other mode fall back to
 * their Free caps (and overrides), and those with this mode's subscriptions get
 * them. Runs nightly after the sync and once at every scheduler start.
 */
export async function rederiveStripeTenants(): Promise<void> {
  const tenants = await adminPool.query(
    `SELECT id FROM tenants WHERE billing_mode = 'stripe' AND deleted_at IS NULL ORDER BY created_at`
  );
  let failed = 0;
  for (const t of tenants.rows) {
    try {
      await applyEntitlements(t.id as string, null);
    } catch (err) {
      failed++;
      logger.warn({ err, tenantId: t.id }, 'entitlement re-derivation failed');
    }
  }
  logger.info({ tenants: tenants.rowCount, failed, stripe_mode: stripeMode() }, 'entitlements re-derived');
}
