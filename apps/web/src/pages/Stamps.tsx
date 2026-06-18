import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { api } from '../lib/api.ts';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';
import { fmtDateTime } from '../i18n/format.ts';
import { StampMonthGrid } from '../components/StampMonthGrid.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { type Stamp, type Branch, type UserRow } from '../lib/stamp-types.ts';

export function Stamps() {
  const { t } = useTranslation(['stamps', 'common']);
  const [list, setList] = useState<Stamp[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [editing, setEditing] = useState<Stamp | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'list' | 'grid'>('list');

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
    const reason = prompt(t('deletePrompt'));
    if (!reason) return;
    await api(`/api/v1/admin/stamps/${id}`, { method: 'DELETE', json: { deletion_reason: reason } });
    await load();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('heading')}
        actions={
          <>
            <div className="cal-seg" role="tablist" aria-label={t('heading')}>
              <button
                type="button"
                role="tab"
                className="cal-seg-btn"
                aria-pressed={view === 'list'}
                aria-selected={view === 'list'}
                onClick={() => setView('list')}
              >
                {t('grid.viewList')}
              </button>
              <button
                type="button"
                role="tab"
                className="cal-seg-btn"
                aria-pressed={view === 'grid'}
                aria-selected={view === 'grid'}
                onClick={() => setView('grid')}
              >
                {t('grid.viewGrid')}
              </button>
            </div>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>{t('newStamp')}</button>
          </>
        }
      />

      {view === 'list' ? (
        <div className="card" style={{ padding: 0 }}>
          <StampsDataGrid
            list={list}
            branches={branches}
            onEdit={setEditing}
            onDelete={remove}
          />
        </div>
      ) : (
        <StampMonthGrid users={users} branches={branches} />
      )}

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
  const { t } = useTranslation(['stamps', 'common']);
  const clsMap: Record<Stamp['event_type'], string> = {
    clock_in: 'badge-ok',
    clock_out: 'badge-muted',
    break_start: 'badge-warn',
    break_end: 'badge-warn',
    lunch_start: 'badge-warn',
    lunch_end: 'badge-warn',
  };
  return <span className={`badge ${clsMap[event]}`}>{t(`common:stampEvent.${event}`)}</span>;
}

function SourceBadge({ source }: { source: string }) {
  const { t } = useTranslation(['stamps', 'common']);
  return <span className="badge badge-muted">{sourceLabel(source, t)}</span>;
}

function sourceLabel(s: string, t: (k: string) => string): string {
  return s === 'employee_app'
    ? t('common:origin.app')
    : s === 'employee_correction'
      ? t('common:origin.correction')
      : s === 'admin_manual'
        ? t('common:origin.admin')
        : s === 'system_auto'
          ? t('origin.auto')
          : s;
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

const DATETIME_OPTS: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };
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
  const { t } = useTranslation(['stamps', 'common']);
  useEscapeKey(onClose);
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
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-md space-y-3">
        <h2 className="section-title">{stamp ? t('editStamp') : t('newStamp')}</h2>
        {!stamp && (
          <div>
            <label className="label">{t('form.user')}</label>
            <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)} required>
              {users.map((u) => (
                <option key={u.user_id} value={u.user_id}>{u.email}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">{t('form.event')}</label>
          <select className="input" value={eventType} onChange={(e) => setEventType(e.target.value as Stamp['event_type'])}>
            <option value="clock_in">{t('common:stampEvent.clock_in')}</option>
            <option value="break_start">{t('common:stampEvent.break_start')}</option>
            <option value="break_end">{t('common:stampEvent.break_end')}</option>
            <option value="lunch_start">{t('common:stampEvent.lunch_start')}</option>
            <option value="lunch_end">{t('common:stampEvent.lunch_end')}</option>
            <option value="clock_out">{t('common:stampEvent.clock_out')}</option>
          </select>
        </div>
        <div>
          <label className="label">{t('form.when')}</label>
          <input type="datetime-local" className="input" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} required />
        </div>
        <div>
          <label className="label">{t('form.branch')}</label>
          <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">{t('form.noBranch')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('form.justification')}</label>
          <input className="input" value={justification} onChange={(e) => setJustification(e.target.value)} placeholder={t('form.justificationPlaceholder')} />
        </div>
        {err && <div className="rounded-md px-3 py-2 text-sm" style={{ background: 'var(--color-error-tint)', color: 'var(--color-error)' }}>{err}</div>}
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t('common:btn.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('common:state.saving') : t('common:btn.save')}</button>
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
  const { t } = useTranslation(['stamps', 'common']);
  const columns = useMemo<GridColDef<Stamp>[]>(
    () => [
      {
        field: 'occurred_at',
        headerName: t('col.when'),
        width: 170,
        type: 'dateTime',
        valueGetter: (_v, row) => new Date(row.occurred_at),
        renderCell: (p) => <span className="num text-xs">{fmtDateTime(p.row.occurred_at, DATETIME_OPTS)}</span>,
      },
      { field: 'user_email', headerName: t('col.user'), flex: 1.2, minWidth: 180 },
      {
        field: 'event_type',
        headerName: t('col.event'),
        width: 140,
        type: 'singleSelect',
        valueOptions: [
          { value: 'clock_in', label: t('common:stampEvent.clock_in') },
          { value: 'clock_out', label: t('common:stampEvent.clock_out') },
          { value: 'break_start', label: t('common:stampEvent.break_start') },
          { value: 'break_end', label: t('common:stampEvent.break_end') },
          { value: 'lunch_start', label: t('common:stampEvent.lunch_start') },
          { value: 'lunch_end', label: t('common:stampEvent.lunch_end') },
        ],
        renderCell: (p) => <EventBadge event={p.row.event_type} />,
      },
      {
        field: 'source',
        headerName: t('col.origin'),
        width: 110,
        type: 'singleSelect',
        valueOptions: [
          { value: 'employee_app', label: t('common:origin.app') },
          { value: 'employee_correction', label: t('common:origin.correction') },
          { value: 'admin_manual', label: t('common:origin.admin') },
          { value: 'system_auto', label: t('origin.auto') },
        ],
        renderCell: (p) => <SourceBadge source={p.row.source} />,
      },
      {
        field: 'branch_id',
        headerName: t('col.branch'),
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
        headerName: t('col.notes'),
        flex: 1,
        minWidth: 160,
        renderCell: (p) => (
          <span className="text-xs">
            {p.row.suspicious_mock_location && (
              <span className="badge badge-warn mr-1">{t('badge.mock')}</span>
            )}
            {p.row.out_of_geofence && (
              <span className="badge badge-warn mr-1">{t('badge.outOfArea')}</span>
            )}
            {p.row.notes ?? ''}
          </span>
        ),
      },
      {
        field: 'actions',
        headerName: t('col.actions'),
        width: 110,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <div className="flex gap-1">
            <StampIconButton
              kind="edit"
              title={t('action.edit')}
              onClick={() => onEdit(p.row)}
            />
            <StampIconButton
              kind="delete"
              title={t('action.delete')}
              onClick={() => onDelete(p.row.id)}
            />
          </div>
        ),
      },
    ],
    [branches, onEdit, onDelete, t]
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
