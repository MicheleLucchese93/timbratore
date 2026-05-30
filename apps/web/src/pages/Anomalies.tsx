import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ApiError } from '../lib/api.ts';

interface Anomaly {
  date: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  shift_template_id: string | null;
  shift_template_name: string | null;
  kind:
    | 'missing_clock_in'
    | 'missing_clock_out'
    | 'late_clock_in'
    | 'early_clock_out'
    | 'short_hours'
    | 'worked_on_rest_day'
    | 'break_too_short'
    | 'break_too_long'
    | 'lunch_too_short'
    | 'lunch_too_long';
  expected_start_at: string | null;
  expected_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  delta_minutes: number | null;
  break_total_min: number | null;
  lunch_total_min: number | null;
  details: string | null;
}

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
}

const KIND_LABEL: Record<Anomaly['kind'], string> = {
  missing_clock_in: 'Entrata mancante',
  missing_clock_out: 'Uscita mancante',
  late_clock_in: 'Entrata in ritardo',
  early_clock_out: 'Uscita anticipata',
  short_hours: 'Ore giornaliere insufficienti',
  worked_on_rest_day: 'Lavoro in giorno di riposo',
  break_too_short: 'Pausa troppo breve',
  break_too_long: 'Pausa troppo lunga',
  lunch_too_short: 'Pausa pranzo troppo breve',
  lunch_too_long: 'Pausa pranzo troppo lunga',
};

const KIND_COLOR: Record<Anomaly['kind'], string> = {
  missing_clock_in: '#b91c1c',
  missing_clock_out: '#b91c1c',
  late_clock_in: '#d97706',
  early_clock_out: '#d97706',
  short_hours: '#d97706',
  worked_on_rest_day: '#7c3aed',
  break_too_short: '#0369a1',
  break_too_long: '#0369a1',
  lunch_too_short: '#0369a1',
  lunch_too_long: '#0369a1',
};

const JUSTIFIABLE_KINDS: Anomaly['kind'][] = [
  'short_hours',
  'missing_clock_in',
  'missing_clock_out',
  'late_clock_in',
  'early_clock_out',
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 30);
  return { from: isoDate(start), to: isoDate(today) };
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
}

export function Anomalies() {
  const def = defaultRange();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [userId, setUserId] = useState<string>('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [rows, setRows] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notDeployed, setNotDeployed] = useState(false);

  useEffect(() => {
    api<UserRow[]>('/api/v1/users')
      .then((u) => setUsers(u))
      .catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    setErr(null);
    setNotDeployed(false);
    try {
      const q = new URLSearchParams({ from, to });
      if (userId) q.set('user_id', userId);
      const data = await api<Anomaly[]>(`/api/v1/shifts/anomalies?${q.toString()}`);
      setRows(data);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 404) setNotDeployed(true);
      else setErr(e instanceof Error ? e.message : 'errore');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, Anomaly[]>();
    for (const r of rows) {
      const key = r.date;
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    return [...m.entries()].sort(([a], [b]) => (a < b ? 1 : -1));
  }, [rows]);

  return (
    <div className="space-y-5">
      <h1 className="sr-only">Anomalie orario</h1>

      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Dal</label>
          <input
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Al</label>
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Utente</label>
          <select
            className="input"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">Tutti</option>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.display_name || u.email}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            load().catch(() => {});
          }}
          disabled={loading}
        >
          {loading ? 'Caricamento…' : 'Aggiorna'}
        </button>
      </div>

      {notDeployed && (
        <div className="card text-sm" style={{ color: 'var(--color-on-tertiary-container, #92400e)', background: 'var(--color-tertiary-container, #fef3c7)' }}>
          La funzione "Anomalie orario" è disponibile dopo l'aggiornamento del backend. Riprova quando il deploy sarà completato.
        </div>
      )}
      {err && (
        <div className="card text-sm" style={{ color: 'var(--color-error)' }}>
          {err}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="card text-sm text-neutral-500">
          Nessuna anomalia nel periodo selezionato.
        </div>
      )}

      <div className="space-y-4">
        {grouped.map(([day, items]) => (
          <div key={day} className="card">
            <div className="font-medium mb-2">{fmtDate(day)}</div>
            <ul className="space-y-2">
              {items.map((a, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 border-t border-neutral-100 first:border-t-0 pt-2 first:pt-0"
                >
                  <span
                    className="badge"
                    style={{
                      background: KIND_COLOR[a.kind] + '22',
                      color: KIND_COLOR[a.kind],
                    }}
                  >
                    {KIND_LABEL[a.kind]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {a.user_display_name || a.user_email}
                    </div>
                    <div className="text-xs text-neutral-500">
                      Orario: {a.shift_template_name ?? '—'} · Atteso{' '}
                      {fmtTime(a.expected_start_at)}–{fmtTime(a.expected_end_at)} · Effettivo{' '}
                      {fmtTime(a.actual_start_at)}–{fmtTime(a.actual_end_at)}
                      {a.delta_minutes !== null && ` · Δ ${a.delta_minutes}min`}
                      {a.break_total_min !== null && ` · Pausa ${a.break_total_min}min`}
                    </div>
                    {a.details && (
                      <div className="text-xs text-neutral-600 mt-0.5">{a.details}</div>
                    )}
                  </div>
                  {JUSTIFIABLE_KINDS.includes(a.kind) && (
                    <Link
                      to={`/leaves?user_id=${encodeURIComponent(a.user_id)}&date=${encodeURIComponent(a.date)}`}
                      className="btn btn-secondary btn-sm shrink-0"
                      title="Crea o approva un giustificativo (ferie/permesso/malattia) per coprire la mancanza"
                    >
                      Giustifica
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
