import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useSession } from '../store/session.ts';

const navItems: Array<{ to: string; label: string }> = [
  { to: '/', label: 'Dashboard' },
  { to: '/stamps', label: 'Timbrature' },
  { to: '/corrections', label: 'Correzioni' },
  { to: '/users', label: 'Utenti' },
  { to: '/branches', label: 'Sedi' },
  { to: '/exports', label: 'Esportazioni' },
  { to: '/settings', label: 'Impostazioni' },
  { to: '/compliance', label: 'Conformità' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { me, logout } = useSession();
  return (
    <div className="min-h-screen flex flex-col bg-[color:var(--color-surface)]">
      <header
        className="border-b shadow-sm"
        style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
      >
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="font-extrabold text-xl tracking-tight">ciSono</div>
            <div className="hidden sm:block h-5 w-px bg-white/30" />
            <div className="text-sm opacity-90 truncate">{me?.tenant.ragione_sociale}</div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden sm:inline opacity-80 truncate max-w-[14rem]">
              {me?.user.email}
            </span>
            <button className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }} onClick={() => { void logout(); }}>
              Esci
            </button>
          </div>
        </div>
      </header>
      <div className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 grid grid-cols-12 gap-6">
        <aside className="col-span-12 md:col-span-3 lg:col-span-2">
          <nav className="card card-tight">
            <ul className="space-y-0.5">
              {navItems.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end={n.to === '/'}
                    className={({ isActive }) =>
                      [
                        'block px-3 py-2 rounded-md text-sm transition',
                        isActive
                          ? 'font-semibold'
                          : 'hover:bg-[color:var(--color-surface)] text-[color:var(--color-on-surface-variant)]',
                      ].join(' ')
                    }
                    style={({ isActive }) =>
                      isActive
                        ? {
                            background: 'var(--color-primary-container)',
                            color: 'var(--color-on-primary-container)',
                          }
                        : undefined
                    }
                  >
                    {n.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <main className="col-span-12 md:col-span-9 lg:col-span-10 min-w-0">{children}</main>
      </div>
    </div>
  );
}
