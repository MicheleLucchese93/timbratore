import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

interface CorrectionRequest {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  original_stamp_id: string | null;
  original_event_type: string | null;
  original_occurred_at: string | null;
  original_branch_id: string | null;
  original_branch_name: string | null;
  claimed_event_type: string;
  claimed_occurred_at: string;
  claimed_branch_id: string | null;
  claimed_branch_name: string | null;
  justification: string;
  resolution_note: string | null;
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
    try {
      await api(`/api/v1/correction-requests/${cr.id}/approve`, { method: 'POST', json: {} });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }
  async function reject(cr: CorrectionRequest) {
    const note = prompt('Motivo rifiuto:') ?? '';
    try {
      await api(`/api/v1/correction-requests/${cr.id}/reject`, {
        method: 'POST',
        json: { resolution_note: note },
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-end gap-4 flex-wrap">
        <h1 className="sr-only">Correzioni</h1>
        <select
          className="input max-w-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'pending' | 'all')}
        >
          <option value="pending">Solo in attesa</option>
          <option value="all">Tutte</option>
        </select>
      </header>
      {err && <div className="card text-sm text-[color:var(--color-error)]">{err}</div>}
      {list.length === 0 ? (
        <div className="card text-sm text-neutral-600">Nessuna richiesta.</div>
      ) : (
        <ul className="space-y-3">
          {list.map((cr) => (
            <li key={cr.id} className="card space-y-3">
              <div className="flex justify-between items-start gap-3">
                <div className="space-y-1">
                  <div className="font-medium">{cr.user_display_name || cr.user_email}</div>
                  <div className="text-xs muted">
                    Inviata {new Date(cr.created_at).toLocaleString('it-IT')}
                  </div>
                </div>
                {cr.status === 'pending' ? (
                  <div className="flex gap-2 shrink-0">
                    <button className="btn btn-primary btn-sm" onClick={() => approve(cr)}>
                      Approva
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => reject(cr)}>
                      Rifiuta
                    </button>
                  </div>
                ) : (
                  <span
                    className={`badge ${
                      cr.status === 'approved'
                        ? 'badge-ok'
                        : cr.status === 'rejected'
                        ? 'badge-err'
                        : 'badge-muted'
                    }`}
                  >
                    {statusLabel(cr.status)}
                  </span>
                )}
              </div>

              <DiffBlock cr={cr} />

              <div>
                <div className="text-xs muted font-semibold uppercase tracking-wide">
                  Motivazione
                </div>
                <div className="text-sm mt-1">{cr.justification}</div>
              </div>

              {cr.resolution_note?.trim() && (
                <div
                  className="rounded-md p-2 text-sm"
                  style={{
                    background: cr.status === 'rejected' ? '#fde4e4' : '#e8f3ec',
                  }}
                >
                  <div className="text-xs muted font-semibold uppercase tracking-wide">
                    Nota della decisione
                  </div>
                  <div className="mt-1">{cr.resolution_note}</div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DiffBlock({ cr }: { cr: CorrectionRequest }) {
  const isEdit = cr.original_stamp_id != null && cr.original_occurred_at != null;
  if (!isEdit) {
    return (
      <div className="rounded-md p-2 text-sm" style={{ background: 'var(--color-surface-variant)' }}>
        <div className="text-xs muted font-semibold uppercase tracking-wide">
          Timbratura mancante da aggiungere
        </div>
        <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Field label="Evento" value={labelEvent(cr.claimed_event_type)} />
          <Field
            label="Data e ora"
            value={new Date(cr.claimed_occurred_at).toLocaleString('it-IT')}
          />
          <Field label="Sede" value={cr.claimed_branch_name ?? '—'} />
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <div className="rounded-md p-2 text-sm" style={{ background: '#fde4e4' }}>
        <div className="text-xs muted font-semibold uppercase tracking-wide">
          Valori attuali
        </div>
        <div className="mt-1 space-y-1">
          <Field label="Evento" value={labelEvent(cr.original_event_type ?? '')} />
          <Field
            label="Data e ora"
            value={
              cr.original_occurred_at
                ? new Date(cr.original_occurred_at).toLocaleString('it-IT')
                : '—'
            }
          />
          <Field label="Sede" value={cr.original_branch_name ?? '—'} />
        </div>
      </div>
      <div className="rounded-md p-2 text-sm" style={{ background: '#e8f3ec' }}>
        <div className="text-xs muted font-semibold uppercase tracking-wide">
          Valori richiesti
        </div>
        <div className="mt-1 space-y-1">
          <Field
            label="Evento"
            value={labelEvent(cr.claimed_event_type)}
            changed={cr.claimed_event_type !== cr.original_event_type}
          />
          <Field
            label="Data e ora"
            value={new Date(cr.claimed_occurred_at).toLocaleString('it-IT')}
            changed={
              cr.original_occurred_at == null ||
              new Date(cr.claimed_occurred_at).getTime() !==
                new Date(cr.original_occurred_at).getTime()
            }
          />
          <Field
            label="Sede"
            value={cr.claimed_branch_name ?? '—'}
            changed={cr.claimed_branch_id !== cr.original_branch_id}
          />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  changed,
}: {
  label: string;
  value: string;
  changed?: boolean;
}) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="muted min-w-[5.5rem]">{label}:</span>
      <span style={{ fontWeight: changed ? 700 : 400 }}>{value}</span>
    </div>
  );
}

function labelEvent(e: string): string {
  switch (e) {
    case 'clock_in':
      return 'Ingresso';
    case 'clock_out':
      return 'Uscita';
    case 'break_start':
      return 'Inizio pausa';
    case 'break_end':
      return 'Fine pausa';
    case 'lunch_start':
      return 'Inizio pausa pranzo';
    case 'lunch_end':
      return 'Fine pausa pranzo';
    default:
      return e || '—';
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case 'approved':
      return 'Approvata';
    case 'rejected':
      return 'Rifiutata';
    case 'superseded':
      return 'Superata';
    default:
      return s;
  }
}
