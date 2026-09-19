import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api.ts';
import { useReadOnly, useSession } from '../../store/session.ts';

const DISMISS_KEY = 'sonoqui.onboarding.dismissed.';

/**
 * First-run checklist on the admin Dashboard of a self-registered company
 * (Specs/SELF_SERVICE_BILLING.md §3.2): sede → collaboratori → orario → app.
 * Every tick is derived from real data, never stored; the card disappears by
 * itself once all four are done, or when dismissed (remembered per company).
 */
export function OnboardingChecklist({
  branches,
  users,
  anyStamp,
}: {
  branches: number;
  users: number;
  anyStamp: boolean;
}) {
  const { t } = useTranslation('dashboard');
  const me = useSession((s) => s.me);
  const readOnly = useReadOnly();
  const tenantId = me?.tenant.id ?? '';
  const [templates, setTemplates] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY + tenantId) === '1';
    } catch {
      return false;
    }
  });

  const eligible = !!me && !readOnly && me.user.role === 'admin' && me.tenant.signup_source === 'self_service';

  useEffect(() => {
    if (!eligible || dismissed) return;
    api<unknown[]>('/api/v1/shifts/templates')
      .then((list) => setTemplates(Array.isArray(list) ? list.length : 0))
      .catch(() => setTemplates(0));
  }, [eligible, dismissed]);

  if (!eligible || dismissed || templates === null) return null;

  const steps = [
    { key: 'branch', done: branches > 0, to: '/branches' },
    { key: 'users', done: users > 1, to: '/users' },
    { key: 'shifts', done: templates > 0, to: '/shifts' },
    { key: 'app', done: anyStamp, to: '/manual' },
  ] as const;
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY + tenantId, '1');
    } catch {
      /* private mode: dismiss for this visit only */
    }
    setDismissed(true);
  }

  return (
    <section className="card space-y-3" data-testid="onboarding-checklist">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="section-title">{t('onboarding.title')}</h2>
          <p className="muted text-sm">{t('onboarding.subtitle', { done: doneCount, total: steps.length })}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
          {t('onboarding.dismiss')}
        </button>
      </div>
      <ol className="onboarding-steps">
        {steps.map((s, i) => (
          <li key={s.key} className={s.done ? 'is-done' : ''} data-testid={`onboarding-step-${s.key}`}>
            <span className="onboarding-step-num" aria-hidden="true">{s.done ? '✓' : i + 1}</span>
            <div className="onboarding-step-body">
              <strong>{t(`onboarding.steps.${s.key}.title`)}</strong>
              <span className="muted text-sm">{t(`onboarding.steps.${s.key}.hint`)}</span>
            </div>
            {!s.done && (
              <Link to={s.to} className="btn btn-sm btn-secondary">
                {t(`onboarding.steps.${s.key}.cta`)}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
