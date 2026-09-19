import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useReadOnly, useSession } from '../../store/session.ts';

/**
 * "Passa a Premium" pill under the logo (Specs/SELF_SERVICE_BILLING.md §3.6).
 * Only for the admins of a self-service company on the Free plan: employees
 * cannot buy, partner-managed companies are billed by their partner, and a
 * read-only support session must not look like it could.
 */
export function PremiumBadge({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation('billing');
  const me = useSession((s) => s.me);
  const readOnly = useReadOnly();
  if (!me || readOnly || me.user.role !== 'admin') return null;
  if (me.tenant.billing_mode !== 'stripe' || me.tenant.plan !== 'free') return null;
  return (
    <NavLink
      to="/settings/subscription"
      onClick={onNavigate}
      className={`premium-badge${collapsed ? ' premium-badge-collapsed' : ''}`}
      title={t('badge.title')}
      aria-label={t('badge.label')}
      data-testid="premium-badge"
    >
      <IconSparkle />
      {!collapsed && <span>{t('badge.label')}</span>}
    </NavLink>
  );
}

function IconSparkle() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.8 4.9L19 9.7l-4.3 3.1L16.2 18 12 15l-4.2 3 1.5-5.2L5 9.7l5.2-1.8Z" />
    </svg>
  );
}
