import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

interface CorrectionRequest {
  id: string;
  user_id: string;
  user_email: string;
  original_stamp_id: string | null;
  claimed_event_type: string;
  claimed_occurred_at: string;
  claimed_branch_id: string | null;
  justification: string;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  created_at: string;
}

export function Corrections() {
  const [list, setList] = useState<CorrectionRequest[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const q = filter === 'pending' ? '?status=pending' : '';
    setList(await api<CorrectionRequest[]>(`/api/v1/correction-requests${q}`));
  }
  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [filter]);

  async function approve(cr: CorrectionRequest) {
    await api(`/api/v1/correction-requests/${cr.id}/approve`, { method: 'POST', json: {} });
    await load();
  }
  async function reject(cr: CorrectionRequest) {
    const note = prompt('Motivo rifiuto:') ?? '';
    await api(`/api/v1/correction-requests/${cr.id}/reject`, {
      method: 'POST',
      json: { resolution_note: note },
    });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Richieste di correzione</h1>
        <select className="input max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value as 'pending' | 'all')}>
          <option value="pending">Solo in attesa</option>
          <option value="all">Tutte</option>
        </select>
      </div>
      {err && <div className="card text-sm text-[color:var(--color-error)]">{err}</div>}
      {list.length === 0 ? (
        <div className="card text-sm text-neutral-600">Nessuna richiesta.</div>
      ) : (
        <ul className="space-y-3">
          {list.map((cr) => (
            <li key={cr.id} className="card">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <div className="font-medium">{cr.user_email}</div>
                  <div className="text-xs text-neutral-600 mb-1">
                    {labelEvent(cr.claimed_event_type)} richiesto per{' '}
                    {new Date(cr.claimed_occurred_at).toLocaleString('it-IT')}
                  </div>
                  <div className="text-sm">{cr.justification}</div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Inviata {new Date(cr.created_at).toLocaleString('it-IT')}
                  </div>
                </div>
                {cr.status === 'pending' ? (
                  <div className="flex gap-2 shrink-0">
                    <button className="btn btn-primary" onClick={() => approve(cr)}>Approva</button>
                    <button className="btn btn-danger" onClick={() => reject(cr)}>Rifiuta</button>
                  </div>
                ) : (
                  <span className={`badge ${cr.status === 'approved' ? 'badge-ok' : cr.status === 'rejected' ? 'badge-err' : 'badge-muted'}`}>
                    {cr.status}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
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
