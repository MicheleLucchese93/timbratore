import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

interface Stamp {
  id: string;
  user_id: string;
  user_email: string;
  event_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  occurred_at: string;
  source: string;
  branch_id: string | null;
  notes: string | null;
  suspicious_mock_location: boolean;
}

interface Branch { id: string; name: string }
interface UserRow { user_id: string; email: string }

export function Stamps() {
  const [list, setList] = useState<Stamp[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [filterUser, setFilterUser] = useState('');
  const [filterFrom, setFilterFrom] = useState(() => isoNDaysAgo(7));
  const [filterTo, setFilterTo] = useState(() => isoToday());
  const [editing, setEditing] = useState<Stamp | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    const params = new URLSearchParams();
    if (filterUser) params.set('user_id', filterUser);
    if (filterFrom) params.set('from', filterFrom);
    if (filterTo) params.set('to', filterTo);
    const [s, b, u] = await Promise.all([
      api<Stamp[]>(`/api/v1/stamps?${params}`),
      api<Branch[]>('/api/v1/branches'),
      api<UserRow[]>('/api/v1/users'),
    ]);
    setList(s);
    setBranches(b);
    setUsers(u);
  }
  useEffect(() => {
    load().catch(() => {});
  }, [filterUser, filterFrom, filterTo]);

  async function remove(id: string) {
    const reason = prompt('Motivo eliminazione (obbligatorio):');
    if (!reason) return;
    await api(`/api/v1/admin/stamps/${id}`, { method: 'DELETE', json: { deletion_reason: reason } });
    await load();
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Timbrature</h1>
          <p className="muted text-sm mt-0.5">Tutte le timbrature dei dipendenti.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>Nuova timbratura</button>
      </header>

      <div className="card grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="label" htmlFor="f-user">Utente</label>
          <select id="f-user" className="input" value={filterUser} onChange={(e) => setFilterUser(e.target.value)}>
            <option value="">Tutti</option>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>{u.email}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-from">Dal</label>
          <input id="f-from" type="date" className="input" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="f-to">Al</label>
          <input id="f-to" type="date" className="input" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
        </div>
        <div>
          <button className="btn btn-secondary btn-block" onClick={load}>Aggiorna</button>
        </div>
      </div>

      <div className="card p-0">
        <div className="table-wrap">
          <table className="table">
            <colgroup>
              <col style={{ width: '11rem' }} />
              <col />
              <col style={{ width: '9rem' }} />
              <col style={{ width: '6rem' }} />
              <col />
              <col />
              <col style={{ width: '6.5rem' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Utente</th>
                <th>Evento</th>
                <th>Origine</th>
                <th>Sede</th>
                <th>Note</th>
                <th className="text-center">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center muted">Nessuna timbratura nel periodo.</td></tr>
              ) : list.map((s) => (
                <tr key={s.id}>
                  <td className="num nowrap text-xs">{formatDateTime(s.occurred_at)}</td>
                  <td className="text-xs truncate">{s.user_email}</td>
                  <td><EventBadge event={s.event_type} /></td>
                  <td><SourceBadge source={s.source} /></td>
                  <td className="text-xs">{branches.find((b) => b.id === s.branch_id)?.name ?? '—'}</td>
                  <td className="text-xs">
                    {s.suspicious_mock_location && <span className="badge badge-warn mr-1">mock</span>}
                    {s.notes ?? ''}
                  </td>
                  <td>
                    <div className="flex justify-center gap-1">
                      <StampIconButton
                        kind="edit"
                        title="Modifica timbratura"
                        onClick={() => setEditing(s)}
                      />
                      <StampIconButton
                        kind="delete"
                        title="Elimina timbratura"
                        onClick={() => remove(s.id)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {creating && (
        <StampForm branches={branches} users={users} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await load(); }} />
      )}
      {editing && (
        <StampForm stamp={editing} branches={branches} users={users} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />
      )}
    </div>
  );
}

function EventBadge({ event }: { event: Stamp['event_type'] }) {
  const map: Record<Stamp['event_type'], { label: string; cls: string }> = {
    clock_in: { label: 'Ingresso', cls: 'badge-ok' },
    clock_out: { label: 'Uscita', cls: 'badge-muted' },
    break_start: { label: 'Inizio pausa', cls: 'badge-warn' },
    break_end: { label: 'Fine pausa', cls: 'badge-warn' },
  };
  const v = map[event];
  return <span className={`badge ${v.cls}`}>{v.label}</span>;
}

function SourceBadge({ source }: { source: string }) {
  const label = source === 'employee_app' ? 'app' : source === 'employee_correction' ? 'correz.' : source === 'admin_manual' ? 'admin' : source;
  return <span className="badge badge-muted">{label}</span>;
}

function StampIconButton({
  kind,
  title,
  onClick,
}: {
  kind: 'edit' | 'delete';
  title: string;
  onClick: () => void;
}) {
  const danger = kind === 'delete';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`icon-btn ${danger ? 'icon-btn-danger' : ''}`.trim()}
    >
      {kind === 'edit' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        </svg>
      )}
    </button>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function isoToday(): string { return new Date().toISOString().slice(0, 10); }
function isoNDaysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function StampForm({
  stamp, branches, users, onClose, onSaved,
}: {
  stamp?: Stamp;
  branches: Branch[];
  users: UserRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [userId, setUserId] = useState(stamp?.user_id ?? users[0]?.user_id ?? '');
  const [eventType, setEventType] = useState<Stamp['event_type']>(stamp?.event_type ?? 'clock_in');
  const [occurredAt, setOccurredAt] = useState(() => {
    const d = stamp ? new Date(stamp.occurred_at) : new Date();
    return d.toISOString().slice(0, 16);
  });
  const [branchId, setBranchId] = useState(stamp?.branch_id ?? branches[0]?.id ?? '');
  const [justification, setJustification] = useState(stamp?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const occurredIso = new Date(occurredAt).toISOString();
      if (stamp) {
        await api(`/api/v1/admin/stamps/${stamp.id}`, {
          method: 'PATCH',
          json: { event_type: eventType, occurred_at: occurredIso, branch_id: branchId, justification: justification || 'admin edit' },
        });
      } else {
        await api(`/api/v1/admin/stamps`, {
          method: 'POST',
          json: { user_id: userId, event_type: eventType, occurred_at: occurredIso, branch_id: branchId || null, justification: justification || 'admin create' },
        });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-md space-y-3">
        <h2 className="section-title">{stamp ? 'Modifica timbratura' : 'Nuova timbratura'}</h2>
        {!stamp && (
          <div>
            <label className="label">Utente</label>
            <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)} required>
              {users.map((u) => (
                <option key={u.user_id} value={u.user_id}>{u.email}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">Evento</label>
          <select className="input" value={eventType} onChange={(e) => setEventType(e.target.value as Stamp['event_type'])}>
            <option value="clock_in">Ingresso</option>
            <option value="break_start">Inizio pausa</option>
            <option value="break_end">Fine pausa</option>
            <option value="clock_out">Uscita</option>
          </select>
        </div>
        <div>
          <label className="label">Quando</label>
          <input type="datetime-local" className="input" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} required />
        </div>
        <div>
          <label className="label">Sede</label>
          <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">— Nessuna —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Motivazione</label>
          <input className="input" value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="es. timbratura dimenticata" />
        </div>
        {err && <div className="rounded-md px-3 py-2 text-sm" style={{ background: '#fde4e4', color: 'var(--color-error)' }}>{err}</div>}
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annulla</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Salvataggio…' : 'Salva'}</button>
        </div>
      </form>
    </div>
  );
}
