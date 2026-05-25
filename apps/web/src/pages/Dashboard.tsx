import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.ts';
import { useSession } from '../store/session.ts';
import { useRealtimePolling } from '../hooks/useRealtimePolling.ts';

interface Usage {
  active_users: string | number;
  active_admins: string | number;
  max_users: number;
  max_admins: number;
  branches_count: string | number;
}

interface UserCard {
  user_id: string;
  email: string;
  role: 'admin' | 'user';
  state: 'nothing' | 'clocked_in' | 'on_break';
  last_event: string | null;
  last_event_at: string | null;
  branch_name: string | null;
}

interface PendingItem {
  id: string;
  user_email: string;
  claimed_event_type: string;
  claimed_occurred_at: string;
  justification: string;
}

export function Dashboard() {
  const me = useSession((s) => s.me);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [cards, setCards] = useState<UserCard[]>([]);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const load = useCallback(async () => {
    const [u, c, p] = await Promise.all([
      api<Usage>('/api/v1/settings/usage'),
      api<UserCard[]>('/api/v1/dashboard/cards'),
      api<PendingItem[]>('/api/v1/correction-requests?status=pending'),
    ]);
    setUsage(u);
    setCards(c);
    setPending(p);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load, refreshTick]);

  useRealtimePolling(() => setRefreshTick((t) => t + 1));

  if (!me) return null;

  return (
    <div className="space-y-6">
      <header className="page-header">
        <div className="page-header-title">
          <h1>Dashboard</h1>
          <p>Stato in tempo reale dei tuoi dipendenti.</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary" onClick={load}>
            <IconRefresh /> Aggiorna
          </button>
        </div>
      </header>

      <section className="stat-grid">
        <StatCard
          label="Utenti attivi"
          value={String(usage?.active_users ?? '–')}
          suffix={`/ ${usage?.max_users ?? '–'}`}
          icon={<IconUsers />}
        />
        <StatCard
          label="Amministratori"
          value={String(usage?.active_admins ?? '–')}
          suffix={`/ ${usage?.max_admins ?? '–'}`}
          icon={<IconShield />}
        />
        <StatCard
          label="Sedi"
          value={String(usage?.branches_count ?? '–')}
          icon={<IconMapPin />}
        />
        <StatCard
          label="Da approvare"
          value={String(pending.length)}
          icon={<IconInbox />}
          accent={pending.length > 0 ? 'warn' : undefined}
        />
      </section>

      <section>
        <h2 className="section-title mb-3">Stato attuale</h2>
        {cards.length === 0 ? (
          <EmptyState
            icon={<IconUsers />}
            title="Nessun dipendente ancora"
            hint="Invita il primo collaboratore dalla sezione Utenti."
          />
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {cards.map((c) => (
              <li key={c.user_id} className="status-card">
                <div className="status-card-head">
                  <div className="status-card-identity">
                    <div className="status-card-avatar" aria-hidden="true">
                      {initialsFor(c.email)}
                    </div>
                    <div className="status-card-name" title={c.email}>{c.email}</div>
                  </div>
                  <StateBadge state={c.state} />
                </div>
                <div className="status-card-meta">
                  {c.branch_name && <div>Sede: {c.branch_name}</div>}
                  {c.last_event_at ? (
                    <div>
                      Ultimo evento: {labelEvent(c.last_event)} alle{' '}
                      {new Date(c.last_event_at).toLocaleTimeString('it-IT', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  ) : (
                    <div className="status-card-meta-empty">Nessuna attività oggi</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="section-title mb-3">Da approvare</h2>
        {pending.length === 0 ? (
          <EmptyState
            icon={<IconInbox />}
            title="Nessuna richiesta in coda"
            hint="Le richieste di correzione dei dipendenti compariranno qui."
          />
        ) : (
          <ul className="space-y-2">
            {pending.map((p) => (
              <li key={p.id} className="card flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">{p.user_email}</div>
                  <div className="text-xs text-neutral-600">
                    {labelEvent(p.claimed_event_type)} alle{' '}
                    {new Date(p.claimed_occurred_at).toLocaleString('it-IT')}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">{p.justification}</div>
                </div>
                <a href="/corrections" className="btn btn-secondary btn-sm">Apri</a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  icon,
  accent,
}: {
  label: string;
  value: string;
  suffix?: string;
  icon: React.ReactNode;
  accent?: 'warn';
}) {
  return (
    <div className={`stat-card ${accent === 'warn' ? 'stat-card-warn' : ''}`}>
      <div className="stat-card-icon">{icon}</div>
      <div className="stat-card-body">
        <div className="stat-card-label">{label}</div>
        <div className="stat-card-value">
          {value}
          {suffix && <span className="stat-card-value-muted"> {suffix}</span>}
        </div>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: UserCard['state'] }) {
  if (state === 'clocked_in') return <span className="badge badge-ok">Al lavoro</span>;
  if (state === 'on_break') return <span className="badge badge-warn">In pausa</span>;
  return <span className="badge badge-muted">Fuori servizio</span>;
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
    </div>
  );
}

function initialsFor(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
  return letters || local.slice(0, 2).toUpperCase() || '?';
}

function labelEvent(e: string | null): string {
  switch (e) {
    case 'clock_in': return 'Ingresso';
    case 'clock_out': return 'Uscita';
    case 'break_start': return 'Inizio pausa';
    case 'break_end': return 'Fine pausa';
    default: return '–';
  }
}

/* Icons -------------------------------------------------------------- */
const I = {
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
function IconUsers() {
  return (
    <svg {...I}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg {...I}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </svg>
  );
}
function IconMapPin() {
  return (
    <svg {...I}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
function IconInbox() {
  return (
    <svg {...I}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </svg>
  );
}
function IconRefresh() {
  return (
    <svg {...I} width={16} height={16}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
