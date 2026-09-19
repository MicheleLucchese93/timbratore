/**
 * Local-dev stand-in for `stripe listen`: polls the account's events and
 * forwards each one to the local webhook, signed with STRIPE_SANDBOX_WEBHOOK_SECRET
 * from .env.development — so the real handler (signature check, idempotency,
 * sync, ledger) runs exactly as in production, with no public endpoint and no
 * Stripe CLI install.
 *
 *   npx tsx scripts/stripe-dev-webhooks.ts                  # from now on
 *   npx tsx scripts/stripe-dev-webhooks.ts --replay=30      # also the last 30 minutes
 *   npx tsx scripts/stripe-dev-webhooks.ts --once --replay=30
 *
 * Sandbox only: refuses to run with STRIPE_MODE=live.
 */
import type Stripe from 'stripe';
import { env } from '../src/env.js';
import { getStripe, stripeTestMode } from '../src/lib/stripe.js';

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const ONCE = process.argv.includes('--once');
const replayMinutes = Number(arg('replay') ?? 0);
const target = arg('url') ?? `http://localhost:${env.PORT}/api/v1/webhooks/stripe`;

async function main(): Promise<void> {
  if (!stripeTestMode()) throw new Error('refusing to forward events with STRIPE_MODE=live');
  const secret = env.STRIPE_SANDBOX_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_SANDBOX_WEBHOOK_SECRET is not set');
  const stripe = getStripe();
  let since = Math.floor(Date.now() / 1000) - replayMinutes * 60;
  const seen = new Set<string>();
  // eslint-disable-next-line no-console
  console.log(`forwarding Stripe events since ${new Date(since * 1000).toISOString()} → ${target}`);
  for (;;) {
    const batch: Stripe.Event[] = [];
    for await (const e of stripe.events.list({ created: { gte: since }, limit: 100 })) {
      if (!seen.has(e.id)) batch.push(e);
    }
    batch.sort((a, b) => a.created - b.created);
    for (const e of batch) {
      const payload = JSON.stringify(e);
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
      const res = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
        body: payload,
      }).catch((err: Error) => ({ status: 0, text: async () => err.message }) as Response);
      // eslint-disable-next-line no-console
      console.log(`${new Date(e.created * 1000).toISOString()} ${e.type.padEnd(40)} ${e.id} → ${res.status}`);
      seen.add(e.id);
      since = Math.max(since, e.created);
    }
    if (ONCE) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
