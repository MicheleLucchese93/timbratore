import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { api } from '../lib/api.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';

interface Stamp {
  id: string;
  user_id: string;
  user_email: string;
  event_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' | 'lunch_start' | 'lunch_end';
  occurred_at: string;
  source: string;
  branch_id: string | null;
  notes: string | null;
  suspicious_mock_location: boolean;
  out_of_geofence?: boolean;
}

interface Branch { id: string; name: string }
interface UserRow { user_id: string; email: string }

export function Stamps() {
  const [list, setList] = useState<Stamp[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [editing, setEditing] = useState<Stamp | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    const params = new URLSearchParams();
    params.set('from', isoNDaysAgo(90));
    params.set('to', isoToday());
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
  }, []);

  async function remove(id: string) {
    const reason = prompt('Motivo eliminazione (obbligatorio):');
    if (!reason) return;
    await api(`/api/v1/admin/stamps/${id}`, { method: 'DELETE', json: { deletion_reason: reason } });
    await load();
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-end gap-4 flex-wrap">
        <h1 className="sr-only">Timbrature</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>Nuova timbratura</button>
      </header>

      <div className="card" style={{ padding: 0 }}>
        <StampsDataGrid
          list={list}
          branches={branches}
          onEdit={setEditing}
          onDelete={remove}
        />
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
    lunch_start: { label: 'Inizio pausa pranzo', cls: 'badge-warn' },
    lunch_end: { label: 'Fine pausa pranzo', cls: 'badge-warn' },
  };
  const v = map[event];
  return <span className={`badge ${v.cls}`}>{v.label}</span>;
}

function SourceBadge({ source }: { source: string }) {
  const label = source === 'employee_app' ? 'app' : source === 'employee_correction' ? 'correz.' : source === 'admin_manual' ? 'admin' : source === 'system_auto' ? 'auto' : source;
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
            <option value="lunch_start">Inizio pausa pranzo</option>
            <option value="lunch_end">Fine pausa pranzo</option>
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

function StampsDataGrid({
  list,
  branches,
  onEdit,
  onDelete,
}: {
  list: Stamp[];
  branches: Branch[];
  onEdit: (s: Stamp) => void;
  onDelete: (id: string) => void;
}) {
  const columns = useMemo<GridColDef<Stamp>[]>(
    () => [
      {
        field: 'occurred_at',
        headerName: 'Quando',
        width: 170,
        type: 'dateTime',
        valueGetter: (_v, row) => new Date(row.occurred_at),
        renderCell: (p) => <span className="num text-xs">{formatDateTime(p.row.occurred_at)}</span>,
      },
      { field: 'user_email', headerName: 'Utente', flex: 1.2, minWidth: 180 },
      {
        field: 'event_type',
        headerName: 'Evento',
        width: 140,
        type: 'singleSelect',
        valueOptions: [
          { value: 'clock_in', label: 'Ingresso' },
          { value: 'clock_out', label: 'Uscita' },
          { value: 'break_start', label: 'Inizio pausa' },
          { value: 'break_end', label: 'Fine pausa' },
          { value: 'lunch_start', label: 'Inizio pausa pranzo' },
          { value: 'lunch_end', label: 'Fine pausa pranzo' },
        ],
        renderCell: (p) => <EventBadge event={p.row.event_type} />,
      },
      {
        field: 'source',
        headerName: 'Origine',
        width: 110,
        type: 'singleSelect',
        valueOptions: [
          { value: 'employee_app', label: 'app' },
          { value: 'employee_correction', label: 'correz.' },
          { value: 'admin_manual', label: 'admin' },
          { value: 'system_auto', label: 'auto' },
        ],
        renderCell: (p) => <SourceBadge source={p.row.source} />,
      },
      {
        field: 'branch_id',
        headerName: 'Sede',
        flex: 0.8,
        minWidth: 130,
        type: 'singleSelect',
        valueOptions: branches.map((b) => ({ value: b.id, label: b.name })),
        valueGetter: (_v, row) => row.branch_id ?? '',
        renderCell: (p) => (
          <span className="text-xs">
            {branches.find((b) => b.id === p.row.branch_id)?.name ?? '—'}
          </span>
        ),
      },
      {
        field: 'notes',
        headerName: 'Note',
        flex: 1,
        minWidth: 160,
        renderCell: (p) => (
          <span className="text-xs">
            {p.row.suspicious_mock_location && (
              <span className="badge badge-warn mr-1">mock</span>
            )}
            {p.row.out_of_geofence && (
              <span className="badge badge-warn mr-1">fuori area</span>
            )}
            {p.row.notes ?? ''}
          </span>
        ),
      },
      {
        field: 'actions',
        headerName: 'Azioni',
        width: 110,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <div className="flex gap-1">
            <StampIconButton
              kind="edit"
              title="Modifica timbratura"
              onClick={() => onEdit(p.row)}
            />
            <StampIconButton
              kind="delete"
              title="Elimina timbratura"
              onClick={() => onDelete(p.row.id)}
            />
          </div>
        ),
      },
    ],
    [branches, onEdit, onDelete]
  );

  return (
    <DataGrid<Stamp>
      rows={list}
      columns={columns}
      getRowId={(r) => r.id}
      sx={dataGridSx}
      {...dataGridDefaults}
    />
  );
}
