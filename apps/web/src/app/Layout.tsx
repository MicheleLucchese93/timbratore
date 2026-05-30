import { type ReactNode, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useSession } from '../store/session.ts';

interface NavItem { to: string; label: string; icon: ReactNode }

const adminNav: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <IconHome /> },
  { to: '/stamps', label: 'Timbrature', icon: <IconStamp /> },
  { to: '/corrections', label: 'Correzioni', icon: <IconEdit /> },
  { to: '/users', label: 'Utenti', icon: <IconUsers /> },
  { to: '/branches', label: 'Sedi', icon: <IconMapPin /> },
  { to: '/shifts', label: 'Orari', icon: <IconClock /> },
  { to: '/anomalies', label: 'Anomalie', icon: <IconAlert /> },
  { to: '/leaves', label: 'Ferie & Permessi', icon: <IconCalendar /> },
  { to: '/exports', label: 'Esportazioni', icon: <IconDownload /> },
  { to: '/settings', label: 'Impostazioni', icon: <IconCog /> },
  { to: '/manual', label: 'Manuale Utente', icon: <IconBook /> },
];

const userNav: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <IconHome /> },
  { to: '/me/stamps', label: 'Le mie timbrature', icon: <IconStamp /> },
  { to: '/me/corrections', label: 'Le mie richieste', icon: <IconEdit /> },
  { to: '/me/leaves', label: 'Ferie & Permessi', icon: <IconCalendar /> },
  { to: '/manual', label: 'Manuale Utente', icon: <IconBook /> },
];

const COLLAPSED_KEY = 'sonoqui.sidebar.collapsed';

export function Layout({ children }: { children: ReactNode }) {
  const { me, logout } = useSession();
  const navItems = me?.user.role === 'admin' ? adminNav : userNav;

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const email = me?.user.email ?? '';
  const initials = (email.split('@')[0] ?? '')
    .split(/[._-]/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?';

  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          aria-label="Chiudi menu"
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={[
          'sidebar',
          collapsed ? 'sidebar-collapsed' : '',
          mobileOpen ? 'sidebar-mobile-open' : '',
        ].join(' ')}
      >
        <div className="sidebar-brand">
          <img
            src="/icon-192.png"
            alt=""
            width={36}
            height={36}
            className="sidebar-brand-logo"
          />
          {!collapsed && (
            <div className="sidebar-brand-text">
              <div className="sidebar-brand-name">
                sono<span style={{ color: 'var(--color-on-primary-container)' }}>Qui</span>
              </div>
              <div className="sidebar-brand-tenant" title={me?.tenant.ragione_sociale}>
                {me?.tenant.ragione_sociale}
              </div>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          <ul>
            {navItems.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.to === '/'}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`
                  }
                  title={collapsed ? n.label : undefined}
                >
                  <span className="sidebar-link-icon">{n.icon}</span>
                  {!collapsed && <span className="sidebar-link-label">{n.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-user" title={email}>
            <div className="sidebar-user-avatar" aria-hidden="true">{initials}</div>
            {!collapsed && (
              <div className="sidebar-user-text">
                <div className="sidebar-user-email">{email}</div>
                <div className="sidebar-user-role">
                  {me?.user.role === 'admin' ? 'Amministratore' : 'Dipendente'}
                </div>
              </div>
            )}
            <button
              type="button"
              className="sidebar-user-logout"
              onClick={() => { void logout(); }}
              title="Esci"
              aria-label="Esci"
            >
              <IconLogout />
            </button>
          </div>
        </div>

        <button
          type="button"
          className="sidebar-collapse-handle"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Espandi menu' : 'Comprimi menu'}
          aria-label={collapsed ? 'Espandi menu' : 'Comprimi menu'}
        >
          <IconChevron flip={collapsed} />
        </button>
      </aside>

      <div className="app-main">
        <button
          type="button"
          className="mobile-hamburger"
          onClick={() => setMobileOpen(true)}
          aria-label="Apri menu"
        >
          <IconMenu />
        </button>
        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}

/* Icons ----------------------------------------------------------------- */
const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};
function IconHome() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 11 12 3l9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}
function IconStamp() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function IconEdit() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconMapPin() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
function IconDownload() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}
function IconCog() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}
function IconChevron({ flip }: { flip?: boolean }) {
  return (
    <svg
      {...ICON_PROPS}
      width={14}
      height={14}
      style={{ transform: flip ? 'rotate(180deg)' : undefined }}
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}
function IconMenu() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}
function IconAlert() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg {...ICON_PROPS} width={16} height={16}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
function IconBook() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
