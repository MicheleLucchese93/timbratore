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
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="muted text-sm mt-0.5">Stato in tempo reale dei tuoi dipendenti.</p>
        </div>
        <button className="btn btn-secondary" onClick={load}>Aggiorna</button>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Utenti attivi" value={`${usage?.active_users ?? '–'} / ${usage?.max_users ?? '–'}`} />
        <Stat label="Amministratori" value={`${usage?.active_admins ?? '–'} / ${usage?.max_admins ?? '–'}`} />
        <Stat label="Sedi" value={String(usage?.branches_count ?? '–')} />
        <Stat
          label="Da approvare"
          value={String(pending.length)}
          accent={pending.length > 0 ? 'warn' : undefined}
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Stato attuale</h2>
        {cards.length === 0 ? (
          <div className="card text-sm text-neutral-600">Nessun dipendente ancora.</div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {cards.map((c) => (
              <li key={c.user_id} className="card">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium">{c.email}</div>
                  <StateBadge state={c.state} />
                </div>
                <div className="text-xs text-neutral-600 space-y-0.5">
                  {c.branch_name && <div>Sede: {c.branch_name}</div>}
                  {c.last_event_at && (
                    <div>
                      Ultimo evento: {labelEvent(c.last_event)} alle{' '}
                      {new Date(c.last_event_at).toLocaleTimeString('it-IT', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Da approvare</h2>
        {pending.length === 0 ? (
          <div className="card text-sm text-neutral-600">Nessuna richiesta in coda.</div>
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

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'warn' }) {
  return (
    <div className="card" style={accent === 'warn' ? { borderColor: 'var(--color-warning)' } : undefined}>
      <div className="text-xs muted uppercase tracking-wide">{label}</div>
      <div className="text-3xl font-bold mt-1 num">{value}</div>
    </div>
  );
}

function StateBadge({ state }: { state: UserCard['state'] }) {
  if (state === 'clocked_in') return <span className="badge badge-ok">Al lavoro</span>;
  if (state === 'on_break') return <span className="badge badge-warn">In pausa</span>;
  return <span className="badge badge-muted">Fuori servizio</span>;
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
