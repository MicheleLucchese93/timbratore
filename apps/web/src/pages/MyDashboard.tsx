import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useSession } from '../store/session.ts';

interface CurrentState {
  state: 'nothing' | 'clocked_in' | 'on_break' | 'on_lunch';
  lastEvent: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' | 'lunch_start' | 'lunch_end' | null;
  lastEventAt: string | null;
}

interface Stamp {
  id: string;
  event_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' | 'lunch_start' | 'lunch_end';
  occurred_at: string;
}

export function MyDashboard() {
  const me = useSession((s) => s.me);
  const [state, setState] = useState<CurrentState | null>(null);
  const [recent, setRecent] = useState<Stamp[]>([]);

  async function load() {
    const [s, r] = await Promise.all([
      api<CurrentState>('/api/v1/stamps/me/current-state'),
      api<Stamp[]>('/api/v1/stamps/me'),
    ]);
    setState(s);
    setRecent(r.slice(0, 8));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  if (!me) return null;

  const stateLabel =
    state?.state === 'clocked_in' ? 'Al lavoro'
    : state?.state === 'on_break' ? 'In pausa'
    : state?.state === 'on_lunch' ? 'In pausa pranzo'
    : 'Fuori servizio';
  const stateTone =
    state?.state === 'clocked_in' ? 'badge-ok'
    : state?.state === 'on_break' || state?.state === 'on_lunch' ? 'badge-warn'
    : 'badge-muted';

  return (
    <div className="space-y-5">
      <h1 className="sr-only">Ciao, {me.user.email.split('@')[0]}</h1>

      <section className="card flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-wide muted">Stato</div>
          <div className="mt-1 flex items-center gap-3">
            <span className={`badge ${stateTone}`}>{stateLabel}</span>
            {state?.lastEventAt && (
              <span className="text-sm muted">
                Ultimo evento: {labelEvent(state.lastEvent)} alle {formatTime(state.lastEventAt)}
              </span>
            )}
          </div>
        </div>
        <p className="text-sm muted max-w-md">
          Per timbrare usa l'app mobile su <a href="https://m-sonoqui.xdevapp.it" style={{ color: 'var(--color-primary)' }} className="font-medium">m-sonoqui.xdevapp.it</a>.
        </p>
      </section>

      <section className="card p-0">
        <header className="flex items-center justify-between p-4 border-b border-neutral-100">
          <h2 className="section-title">Ultime timbrature</h2>
          <Link to="/me/stamps" className="btn btn-secondary btn-sm">Vedi tutte</Link>
        </header>
        {recent.length === 0 ? (
          <div className="p-6 text-sm muted text-center">Nessuna timbratura registrata.</div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {recent.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>{labelEvent(s.event_type)}</span>
                <span className="num muted text-xs">{new Date(s.occurred_at).toLocaleString('it-IT')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function labelEvent(e: string | null): string {
  switch (e) {
    case 'clock_in': return 'Ingresso';
    case 'clock_out': return 'Uscita';
    case 'break_start': return 'Inizio pausa';
    case 'break_end': return 'Fine pausa';
    case 'lunch_start': return 'Inizio pausa pranzo';
    case 'lunch_end': return 'Fine pausa pranzo';
    default: return '–';
  }
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}
