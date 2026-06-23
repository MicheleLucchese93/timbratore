import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '../store/session.ts';
import { LanguageToggle } from '../components/LanguageToggle.tsx';

export function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { me, logout } = useSession();
  const isAdmin = me?.role === 'admin';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src="/icon-192.png" alt="" width={36} height={36} />
          <div>
            <div className="sidebar-brand-name">
              sono<span style={{ color: 'var(--color-on-primary-container)' }}>Qui</span>
            </div>
            <div className="sidebar-brand-sub">{t('app.suffix')}</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          <NavLink to="/" end>{t('nav.tenants')}</NavLink>
          {isAdmin && <NavLink to="/partners">{t('nav.partners')}</NavLink>}
          <NavLink to="/audit">{t('nav.audit')}</NavLink>
        </nav>
        <div className="sidebar-foot">{me?.email}</div>
      </aside>

      <div className="main">
        <div className="main-bar">
          <span className="badge badge-muted">{t(`role.${me?.role ?? 'partner'}`)}</span>
          <span className="user-email">{me?.email}</span>
          <LanguageToggle />
          <button className="btn btn-ghost btn-sm" onClick={() => logout()}>
            {t('nav.logout')}
          </button>
        </div>
        <div className="main-body">{children}</div>
      </div>
    </div>
  );
}
