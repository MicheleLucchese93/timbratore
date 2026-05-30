import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';
import { LeaveCalendar, type CalendarEvent } from '../components/LeaveCalendar.tsx';
import { ASSENZA_SUBTYPE_LABEL, leaveTypeLabel } from '@sonoqui/shared';

type LeaveType = 'ferie' | 'permessi' | 'malattia' | 'assenza';

interface LeaveRequest {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  type: LeaveType | 'chiusura';
  status: string;
  from_ts: string;
  to_ts: string;
  duration_hours: number;
  inps_protocol: string | null;
  user_note: string | null;
  title: string | null;
  rejection_reason: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'In attesa',
  approved: 'Approvata',
  rejected: 'Rifiutata',
  cancelled: 'Annullata',
  cancellation_pending: 'Annullamento richiesto',
  cancelled_post_approval: 'Annullata',
  superseded_by_malattia: 'Sostituita da malattia',
};

const ASSENZA_SUBTYPES = Object.keys(ASSENZA_SUBTYPE_LABEL);

function fmtRange(from: string, to: string, type: string): string {
  const f = new Date(from);
  const t = new Date(to);
  const sameDay = f.toDateString() === t.toDateString();
  const d: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
  const h: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (type === 'permessi' && sameDay) {
    return `${f.toLocaleDateString('it-IT', d)} ${f.toLocaleTimeString('it-IT', h)}–${t.toLocaleTimeString('it-IT', h)}`;
  }
  if (sameDay) return f.toLocaleDateString('it-IT', d);
  return `${f.toLocaleDateString('it-IT', d)} → ${t.toLocaleDateString('it-IT', d)}`;
}

function toCalEvent(r: LeaveRequest): CalendarEvent {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    from_ts: r.from_ts,
    to_ts: r.to_ts,
    title: r.title,
  };
}

export function MyLeaves() {
  const [tab, setTab] = useState<'mine' | 'calendar' | 'inbox'>('mine');
  const [mine, setMine] = useState<LeaveRequest[]>([]);
  const [inbox, setInbox] = useState<LeaveRequest[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const loadMine = useCallback(async () => {
    try {
      setMine(await api<LeaveRequest[]>('/api/v1/leaves?scope=mine'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }, []);
  const loadInbox = useCallback(async () => {
    try {
      setInbox(await api<LeaveRequest[]>('/api/v1/leaves?scope=inbox'));
    } catch {
      /* non-approvers simply get nothing */
    }
  }, []);

  useEffect(() => {
    void loadMine();
    void loadInbox();
  }, [loadMine, loadInbox]);

  const calEvents = useMemo(() => mine.map(toCalEvent), [mine]);
  const pendingInbox = inbox.filter((r) => r.status === 'pending' || r.status === 'cancellation_pending');

  async function act(path: string, json?: unknown) {
    setErr(null);
    try {
      await api(path, { method: 'POST', json });
      await Promise.all([loadMine(), loadInbox()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="sr-only">Ferie & Permessi</h1>

      <div className="card p-0">
        <div className="flex border-b" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
          <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>Le mie</TabButton>
          <TabButton active={tab === 'calendar'} onClick={() => setTab('calendar')}>Calendario</TabButton>
          {pendingInbox.length > 0 && (
            <TabButton active={tab === 'inbox'} onClick={() => setTab('inbox')}>
              Da approvare ({pendingInbox.length})
            </TabButton>
          )}
        </div>

        <div className="p-4">
          {err && <div className="mb-3 text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

          {tab === 'mine' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>+ Nuova richiesta</button>
              </div>
              {mine.length === 0 ? (
                <p className="muted text-sm">Nessuna richiesta.</p>
              ) : (
                <div className="space-y-2">
                  {mine.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2.5" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
                      <div>
                        <div className="text-sm font-medium">
                          {r.title || leaveTypeLabel(r.type)}
                          <span className="ml-2 text-xs opacity-70">{fmtRange(r.from_ts, r.to_ts, r.type)}</span>
                        </div>
                        <div className="text-xs opacity-70">
                          {r.duration_hours}h · {STATUS_LABEL[r.status] ?? r.status}
                          {r.rejection_reason ? ` · ${r.rejection_reason}` : ''}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {r.status === 'pending' && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => act(`/api/v1/leaves/${r.id}/cancel`)}>Annulla</button>
                        )}
                        {r.status === 'approved' && r.type !== 'malattia' && r.type !== 'chiusura' && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              const reason = window.prompt('Motivo della richiesta di annullamento:');
                              if (reason && reason.trim()) act(`/api/v1/leaves/${r.id}/request-cancellation`, { cancellation_reason: reason.trim() });
                            }}
                          >
                            Richiedi annullamento
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'calendar' && <LeaveCalendar events={calEvents} />}

          {tab === 'inbox' && (
            <div className="space-y-2">
              {pendingInbox.length === 0 ? (
                <p className="muted text-sm">Niente da approvare.</p>
              ) : (
                pendingInbox.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2.5" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
                    <div>
                      <div className="text-sm font-medium">
                        {r.user_display_name || r.user_email} · {leaveTypeLabel(r.type)}
                      </div>
                      <div className="text-xs opacity-70">{fmtRange(r.from_ts, r.to_ts, r.type)} · {r.duration_hours}h</div>
                    </div>
                    <div className="flex gap-2">
                      {r.status === 'pending' ? (
                        <>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => act(`/api/v1/leaves/${r.id}/approve`)}>Approva</button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => {
                              const reason = window.prompt('Motivo del rifiuto:');
                              if (reason && reason.trim()) act(`/api/v1/leaves/${r.id}/reject`, { rejection_reason: reason.trim() });
                            }}
                          >
                            Rifiuta
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => act(`/api/v1/leaves/${r.id}/decide-cancellation`, { approve: true })}>Accetta annull.</button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => act(`/api/v1/leaves/${r.id}/decide-cancellation`, { approve: false })}>Rifiuta annull.</button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {showNew && (
        <NewLeaveModal
          onClose={() => setShowNew(false)}
          onDone={() => { setShowNew(false); void loadMine(); }}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`px-4 py-2 text-sm border-b-2 ${active ? 'font-semibold' : 'opacity-70'}`}
      style={{ borderColor: active ? 'var(--color-primary, #2563eb)' : 'transparent' }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function NewLeaveModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<LeaveType>('ferie');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [inps, setInps] = useState('');
  const [subtype, setSubtype] = useState(ASSENZA_SUBTYPES[0]!);
  const [isPaid, setIsPaid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const timeMode = type === 'permessi'; // permessi need start/end times

  async function submit() {
    setErr(null);
    if (!from || !to) return setErr('Inserisci le date.');
    const fromTs = timeMode ? new Date(from).toISOString() : new Date(`${from}T00:00:00`).toISOString();
    const toTs = timeMode ? new Date(to).toISOString() : new Date(`${to}T23:59:00`).toISOString();
    if (new Date(toTs).getTime() <= new Date(fromTs).getTime()) return setErr('La fine precede l’inizio.');
    if (type === 'malattia' && !inps.trim()) return setErr('Protocollo INPS obbligatorio per malattia.');
    if (type === 'assenza' && !note.trim()) return setErr('La motivazione è obbligatoria per le assenze.');
    setBusy(true);
    try {
      await api('/api/v1/leaves', {
        method: 'POST',
        json: {
          type,
          from_ts: fromTs,
          to_ts: toTs,
          user_note: note.trim() || undefined,
          inps_protocol: type === 'malattia' ? inps.trim() : undefined,
          assenza_subtype: type === 'assenza' ? subtype : undefined,
          is_paid: type === 'assenza' ? isPaid : undefined,
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <div className="card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title">Nuova richiesta</h2>
        <div>
          <label className="label">Tipo</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as LeaveType)}>
            <option value="ferie">Ferie</option>
            <option value="permessi">Permesso</option>
            <option value="malattia">Malattia</option>
            <option value="assenza">Assenza</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Dal</label>
            <input type={timeMode ? 'datetime-local' : 'date'} className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">Al</label>
            <input type={timeMode ? 'datetime-local' : 'date'} className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {type === 'malattia' && (
          <div>
            <label className="label">Protocollo INPS</label>
            <input className="input" value={inps} onChange={(e) => setInps(e.target.value)} />
          </div>
        )}
        {type === 'assenza' && (
          <>
            <div>
              <label className="label">Tipologia assenza</label>
              <select className="input" value={subtype} onChange={(e) => setSubtype(e.target.value)}>
                {ASSENZA_SUBTYPES.map((s) => (
                  <option key={s} value={s}>{ASSENZA_SUBTYPE_LABEL[s]}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isPaid} onChange={(e) => setIsPaid(e.target.checked)} /> Retribuita
            </label>
          </>
        )}
        <div>
          <label className="label">Note{type === 'assenza' ? ' (obbligatorie)' : ''}</label>
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Annulla</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Invio…' : 'Invia richiesta'}</button>
        </div>
      </div>
    </div>
  );
}
