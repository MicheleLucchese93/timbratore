import { type ReactNode, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '../store/session.ts';
import { ProfileModal } from '../components/ProfileModal.tsx';

function initials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function IconLogout() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { me, logout } = useSession();
  const [profileOpen, setProfileOpen] = useState(false);
  // Off-canvas drawer state for phones; ignored at desktop width (CSS).
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAdmin = me?.role === 'admin';
  const name = me?.display_name?.trim() || me?.email || '';
  const closeMobile = () => setMobileOpen(false);

  // Mobile hamburger shows only at the top of the page; it slides away as soon
  // as the content scrolls down. The scroll container is .main-body.
  const location = useLocation();
  const mainBodyRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);

  useEffect(() => {
    const el = mainBodyRef.current;
    if (!el) return;
    const onScroll = () => setAtTop(el.scrollTop <= 8);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // New page → scroll back to top so the hamburger is available again.
  useEffect(() => {
    const el = mainBodyRef.current;
    if (el) el.scrollTop = 0;
    setAtTop(true);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      {mobileOpen && (
        <button className="sidebar-backdrop" aria-label={t('nav.closeMenu')} onClick={closeMobile} />
      )}

      <aside className={`sidebar${mobileOpen ? ' sidebar-mobile-open' : ''}`}>
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
          <NavLink to="/" end onClick={closeMobile}>{t('nav.tenants')}</NavLink>
          {isAdmin && <NavLink to="/partners" onClick={closeMobile}>{t('nav.partners')}</NavLink>}
          <NavLink to="/audit" onClick={closeMobile}>{t('nav.audit')}</NavLink>
          <NavLink to="/settings" onClick={closeMobile}>{t('nav.settings')}</NavLink>
          <NavLink to="/manual" onClick={closeMobile}>{t('nav.manual')}</NavLink>
        </nav>

        <div className="sidebar-foot">
          <button className="sidebar-user" onClick={() => setProfileOpen(true)} title={t('profile.title')} data-testid="profile-open">
            <span className="avatar">{initials(name)}</span>
            <span className="sidebar-user-text">
              <span className="sidebar-user-name">{name}</span>
              <span className="sidebar-user-role">{t(`role.${me?.role ?? 'partner'}`)}</span>
            </span>
          </button>
          <button className="icon-btn" onClick={() => logout()} title={t('nav.logout')} aria-label={t('nav.logout')}>
            <IconLogout />
          </button>
        </div>
      </aside>

      <main className="main">
        <button
          type="button"
          className={`mobile-hamburger${atTop ? '' : ' mobile-hamburger-hidden'}`}
          onClick={() => setMobileOpen(true)}
          aria-label={t('nav.openMenu')}
        >
          <IconMenu />
        </button>
        <div className="main-body" ref={mainBodyRef}>{children}</div>
      </main>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
