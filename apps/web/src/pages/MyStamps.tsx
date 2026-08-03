import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { api } from '../lib/api.ts';
import { isoLocalDate, isoLocalDaysAgo } from '../lib/dates.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';
import { fmtDateTime } from '../i18n/format.ts';
import { PageHeader } from '../components/PageHeader.tsx';
import {
  DayDossierModal,
  DeletedBadge,
  EditedBadge,
  StampHistoryModal,
} from '../components/StampTrail.tsx';
import { isEdited } from '../lib/stamp-types.ts';

interface Stamp {
  id: string;
  event_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' | 'lunch_start' | 'lunch_end';
  occurred_at: string;
  source: string;
  branch_id: string | null;
  notes: string | null;
  original_occurred_at: string | null;
  original_event_type: string | null;
  edited_at: string | null;
  edited_by_name: string | null;
  deleted_at: string | null;
  deletion_reason: string | null;
  deleted_by_name: string | null;
}

const DT: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

export function MyStamps() {
  const { t } = useTranslation(['myStamps', 'stamps', 'common']);
  const [list, setList] = useState<Stamp[]>([]);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const [dossierDate, setDossierDate] = useState<string | null>(null);

  async function load() {
    const params = new URLSearchParams();
    params.set('from', isoLocalDaysAgo(90));
    params.set('to', isoLocalDate());
    // Deliberately always on for the employee's own list: if an admin moved or
    // removed one of your punches, you are the person who most needs to know.
    params.set('include_deleted', 'true');
    setList(await api<Stamp[]>(`/api/v1/stamps/me?${params}`));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  const changed = useMemo(
    () => list.filter((s) => isEdited(s) || s.deleted_at).length,
    [list]
  );

  const columns = useMemo<GridColDef<Stamp>[]>(
    () => [
      {
        field: 'occurred_at',
        headerName: t('col.when'),
        width: 200,
        type: 'dateTime',
        valueGetter: (_v, row) => new Date(row.occurred_at),
        renderCell: (p) => (
          <span
            className="text-xs num"
            style={p.row.deleted_at ? { textDecoration: 'line-through', opacity: 0.65 } : undefined}
          >
            {fmtDateTime(p.row.occurred_at, DT)}
            {p.row.original_occurred_at && (
              <span style={{ color: 'var(--color-warn, #b45309)' }}>
                {' '}
                ({fmtDateTime(p.row.original_occurred_at, { hour: '2-digit', minute: '2-digit' })})
              </span>
            )}
          </span>
        ),
      },
      {
        field: 'event_type',
        headerName: t('col.event'),
        width: 150,
        type: 'singleSelect',
        valueOptions: [
          { value: 'clock_in', label: t('common:stampEvent.clock_in') },
          { value: 'clock_out', label: t('common:stampEvent.clock_out') },
          { value: 'break_start', label: t('common:stampEvent.break_start') },
          { value: 'break_end', label: t('common:stampEvent.break_end') },
          { value: 'lunch_start', label: t('common:stampEvent.lunch_start') },
          { value: 'lunch_end', label: t('common:stampEvent.lunch_end') },
        ],
        renderCell: (p) => (
          <span className={`badge ${badgeOf(p.row.event_type)}`}>{t(`common:stampEvent.${p.row.event_type}`)}</span>
        ),
      },
      {
        field: 'source',
        headerName: t('col.origin'),
        width: 190,
        type: 'singleSelect',
        valueOptions: [
          { value: 'employee_app', label: t('common:origin.app') },
          { value: 'employee_correction', label: t('common:origin.correction') },
          { value: 'admin_manual', label: t('common:origin.admin') },
        ],
        renderCell: (p) => (
          <span className="flex items-center gap-1 flex-wrap">
            <span className="badge badge-muted">{sourceLabel(p.row.source, t)}</span>
            <EditedBadge stamp={p.row} />
            <DeletedBadge stamp={p.row} />
          </span>
        ),
      },
      {
        field: 'notes',
        headerName: t('col.notes'),
        flex: 1,
        minWidth: 160,
        renderCell: (p) => (
          <span className="text-xs">{p.row.deletion_reason ?? p.row.notes ?? ''}</span>
        ),
      },
      {
        field: 'actions',
        headerName: t('stamps:col.actions'),
        width: 120,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <div className="flex gap-1">
            <button
              type="button"
              className="icon-btn"
              title={t('stamps:action.history')}
              aria-label={t('stamps:action.history')}
              onClick={() => setHistoryOf(p.row.id)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </svg>
            </button>
            <button
              type="button"
              className="icon-btn"
              title={t('stamps:action.dossier')}
              aria-label={t('stamps:action.dossier')}
              onClick={() =>
                setDossierDate(isoLocalDate(new Date(p.row.original_occurred_at ?? p.row.occurred_at)))
              }
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="17" x2="13" y2="17" />
              </svg>
            </button>
          </div>
        ),
      },
    ],
    [t]
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t('heading')} />

      {changed > 0 && (
        <div
          className="card text-sm"
          data-testid="my-stamps-changed-notice"
          style={{
            background: 'var(--color-tertiary-container, #fef3c7)',
            color: 'var(--color-on-tertiary-container, #92400e)',
          }}
        >
          {t('changedNotice', { count: changed })}
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <DataGrid<Stamp>
          rows={list}
          columns={columns}
          getRowId={(r) => r.id}
          sx={dataGridSx}
          {...dataGridDefaults}
        />
      </div>

      {historyOf && <StampHistoryModal stampId={historyOf} onClose={() => setHistoryOf(null)} />}
      {dossierDate && (
        <DayDossierModal date={dossierDate} onClose={() => setDossierDate(null)} />
      )}
    </div>
  );
}

function badgeOf(e: string): string {
  if (e === 'clock_in') return 'badge-ok';
  if (e === 'clock_out') return 'badge-muted';
  return 'badge-warn';
}
function sourceLabel(s: string, t: (k: string) => string): string {
  return s === 'employee_app'
    ? t('common:origin.app')
    : s === 'employee_correction'
      ? t('common:origin.correction')
      : s === 'admin_manual'
        ? t('common:origin.admin')
        : s;
}
