import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

interface Stamp {
  id: string;
  event_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  occurred_at: string;
  source: string;
  branch_id: string | null;
  notes: string | null;
}

export function MyStamps() {
  const [list, setList] = useState<Stamp[]>([]);
  const [from, setFrom] = useState(() => isoNDaysAgo(30));
  const [to, setTo] = useState(() => isoToday());

  async function load() {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    setList(await api<Stamp[]>(`/api/v1/stamps/me?${params}`));
  }
  useEffect(() => {
    load().catch(() => {});
  }, [from, to]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="page-title">Le mie timbrature</h1>
        <p className="muted text-sm mt-0.5">Storico delle tue timbrature. Vedi solo le tue.</p>
      </header>

      <div className="card grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div>
          <label className="label" htmlFor="from">Dal</label>
          <input id="from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="to">Al</label>
          <input id="to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className="btn btn-secondary btn-block" onClick={load}>Aggiorna</button>
      </div>

      <div className="card p-0">
        <div className="table-wrap">
          <table className="table">
            <colgroup>
              <col style={{ width: '14rem' }} />
              <col style={{ width: '10rem' }} />
              <col style={{ width: '7rem' }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Evento</th>
                <th>Origine</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center muted">Nessuna timbratura nel periodo.</td></tr>
              ) : list.map((s) => (
                <tr key={s.id}>
                  <td className="num nowrap text-xs">{new Date(s.occurred_at).toLocaleString('it-IT')}</td>
                  <td><span className={`badge ${badgeOf(s.event_type)}`}>{labelEvent(s.event_type)}</span></td>
                  <td><span className="badge badge-muted">{sourceLabel(s.source)}</span></td>
                  <td className="text-xs">{s.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function labelEvent(e: string): string {
  switch (e) {
    case 'clock_in': return 'Ingresso';
    case 'clock_out': return 'Uscita';
    case 'break_start': return 'Inizio pausa';
    case 'break_end': return 'Fine pausa';
    default: return e;
  }
}
function badgeOf(e: string): string {
  if (e === 'clock_in') return 'badge-ok';
  if (e === 'clock_out') return 'badge-muted';
  return 'badge-warn';
}
function sourceLabel(s: string): string {
  return s === 'employee_app' ? 'app' : s === 'employee_correction' ? 'correz.' : s === 'admin_manual' ? 'admin' : s;
}
function isoToday(): string { return new Date().toISOString().slice(0, 10); }
function isoNDaysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
