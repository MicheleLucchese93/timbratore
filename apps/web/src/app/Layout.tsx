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
    <div className="min-h-screen flex flex-col">
      <header className="border-b" style={{ background: 'var(--color-primary)', color: 'white' }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="font-bold text-xl tracking-tight">ciSono</div>
            <div className="text-xs opacity-80">{me?.tenant.ragione_sociale}</div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="opacity-80">{me?.user.email}</span>
            <button className="btn btn-secondary" onClick={logout}>Esci</button>
          </div>
        </div>
      </header>
      <div className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 grid grid-cols-12 gap-6">
        <nav className="col-span-12 md:col-span-3 lg:col-span-2">
          <ul className="space-y-1">
            {navItems.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.to === '/'}
                  className={({ isActive }) =>
                    `block px-3 py-2 rounded-md text-sm ${
                      isActive
                        ? 'bg-[color:var(--color-primary-container)] text-[color:var(--color-on-primary-container)] font-medium'
                        : 'hover:bg-neutral-100'
                    }`
                  }
                >
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main className="col-span-12 md:col-span-9 lg:col-span-10">{children}</main>
      </div>
    </div>
  );
}
