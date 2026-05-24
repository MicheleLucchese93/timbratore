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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Timbrature</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>Nuova timbratura</button>
      </div>

      <div className="card grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="label">Utente</label>
          <select className="input" value={filterUser} onChange={(e) => setFilterUser(e.target.value)}>
            <option value="">Tutti</option>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>{u.email}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Dal</label>
          <input type="date" className="input" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">Al</label>
          <input type="date" className="input" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
        </div>
        <div className="flex items-end">
          <button className="btn btn-secondary w-full" onClick={load}>Aggiorna</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-neutral-500 uppercase">
            <tr>
              <th className="py-2">Quando</th>
              <th className="py-2">Utente</th>
              <th className="py-2">Evento</th>
              <th className="py-2">Origine</th>
              <th className="py-2">Sede</th>
              <th className="py-2">Note</th>
              <th className="py-2 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={7} className="py-6 text-center text-neutral-500">Nessuna timbratura nel periodo.</td></tr>
            ) : list.map((s) => (
              <tr key={s.id} className="border-t border-neutral-100">
                <td className="py-2 text-xs">{new Date(s.occurred_at).toLocaleString('it-IT')}</td>
                <td className="py-2 text-xs">{s.user_email}</td>
                <td className="py-2">{labelEvent(s.event_type)}</td>
                <td className="py-2 text-xs">{labelSource(s.source)}</td>
                <td className="py-2 text-xs">
                  {s.branch_id ? branches.find((b) => b.id === s.branch_id)?.name ?? '—' : '—'}
                </td>
                <td className="py-2 text-xs">
                  {s.suspicious_mock_location && <span className="badge badge-warn mr-1">mock</span>}
                  {s.notes ?? ''}
                </td>
                <td className="py-2 text-right">
                  <button className="btn btn-secondary text-xs mr-1" onClick={() => setEditing(s)}>Modifica</button>
                  <button className="btn btn-danger text-xs" onClick={() => remove(s.id)}>Elimina</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <StampForm
          branches={branches}
          users={users}
          onClose={() => setCreating(false)}
          onSaved={async () => { setCreating(false); await load(); }}
        />
      )}
      {editing && (
        <StampForm
          stamp={editing}
          branches={branches}
          users={users}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
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
function labelSource(s: string): string {
  switch (s) {
    case 'employee_app': return 'app';
    case 'employee_correction': return 'correzione';
    case 'admin_manual': return 'admin';
    default: return s;
  }
}

function isoToday(): string { return new Date().toISOString().slice(0, 10); }
function isoNDaysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function StampForm({
  stamp,
  branches,
  users,
  onClose,
  onSaved,
}: {
  stamp?: Stamp;
  branches: Branch[];
  users: UserRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [userId, setUserId] = useState(stamp?.user_id ?? users[0]?.user_id ?? '');
  const [eventType, setEventType] = useState<'clock_in' | 'clock_out' | 'break_start' | 'break_end'>(
    stamp?.event_type ?? 'clock_in'
  );
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
        <h2 className="text-lg font-semibold">{stamp ? 'Modifica timbratura' : 'Nuova timbratura'}</h2>
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
          <select className="input" value={eventType} onChange={(e) => setEventType(e.target.value as typeof eventType)}>
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
          <label className="label">Motivazione (richiesta)</label>
          <input className="input" value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="es. timbratura dimenticata" />
        </div>
        {err && <div className="text-sm text-[color:var(--color-error)]">{err}</div>}
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annulla</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </form>
    </div>
  );
}
