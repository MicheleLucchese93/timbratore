import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '../store/session.ts';
import { getCheckoutStatus } from '../lib/billing.ts';

const ATTEMPTS = 8;
const EVERY_MS = 1500;

/**
 * Stripe Checkout's success_url. The page never grants anything: it asks the
 * API, which verifies the session belongs to this company, re-syncs from Stripe
 * and reports whether the purchase is active (polled, per the pinned
 * boilerplate design: 8 × 1500 ms). The webhook is the other path in.
 */
export function CheckoutSuccess() {
  const { t } = useTranslation('billing');
  const [params] = useSearchParams();
  const refreshQuiet = useSession((s) => s.refreshQuiet);
  const [state, setState] = useState<'activating' | 'done' | 'slow'>('activating');
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = params.get('session_id');
    let cancelled = false;
    (async () => {
      for (let i = 0; i < ATTEMPTS && !cancelled; i++) {
        try {
          if (sessionId) {
            const s = await getCheckoutStatus(sessionId);
            if (s.label) setLabel(s.label);
            if (s.active) {
              await refreshQuiet();
              if (!cancelled) setState('done');
              return;
            }
          }
        } catch {
          /* keep polling; the fallback message covers a persistent failure */
        }
        await new Promise((r) => setTimeout(r, EVERY_MS));
      }
      if (!cancelled) setState('slow');
    })();
    return () => {
      cancelled = true;
    };
  }, [params, refreshQuiet]);

  return (
    <div className="max-w-xl mx-auto card space-y-4 text-center" data-testid="checkout-success">
      <h1 className="page-title">{t('checkout.success.title')}</h1>
      {state === 'activating' && <p className="muted">{t('checkout.success.activating')}</p>}
      {state === 'done' && (
        <p data-testid="checkout-done">
          {label ? `${label} ✓ ` : ''}
          {t('checkout.success.done')}
        </p>
      )}
      {state === 'slow' && <p className="muted">{t('checkout.success.slow')}</p>}
      <Link to="/settings/subscription" className="btn btn-primary">
        {t('checkout.success.cta')}
      </Link>
    </div>
  );
}

export function CheckoutCancel() {
  const { t } = useTranslation('billing');
  return (
    <div className="max-w-xl mx-auto card space-y-4 text-center" data-testid="checkout-cancel">
      <h1 className="page-title">{t('checkout.cancel.title')}</h1>
      <p className="muted">{t('checkout.cancel.text')}</p>
      <Link to="/settings/subscription" className="btn btn-primary">
        {t('checkout.cancel.cta')}
      </Link>
    </div>
  );
}
