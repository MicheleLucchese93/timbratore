import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { api } from '../lib/api.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';
import { fmtDateTime } from '../i18n/format.ts';

interface Stamp {
  id: string;
  event_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' | 'lunch_start' | 'lunch_end';
  occurred_at: string;
  source: string;
  branch_id: string | null;
  notes: string | null;
}

export function MyStamps() {
  const { t } = useTranslation(['myStamps', 'common']);
  const [list, setList] = useState<Stamp[]>([]);

  async function load() {
    const params = new URLSearchParams();
    params.set('from', isoNDaysAgo(90));
    params.set('to', isoToday());
    setList(await api<Stamp[]>(`/api/v1/stamps/me?${params}`));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  const columns = useMemo<GridColDef<Stamp>[]>(
    () => [
      {
        field: 'occurred_at',
        headerName: t('col.when'),
        width: 180,
        type: 'dateTime',
        valueGetter: (_v, row) => new Date(row.occurred_at),
        renderCell: (p) => (
          <span className="text-xs num">{fmtDateTime(p.value as Date)}</span>
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
        width: 120,
        type: 'singleSelect',
        valueOptions: [
          { value: 'employee_app', label: t('common:origin.app') },
          { value: 'employee_correction', label: t('common:origin.correction') },
          { value: 'admin_manual', label: t('common:origin.admin') },
        ],
        renderCell: (p) => <span className="badge badge-muted">{sourceLabel(p.row.source, t)}</span>,
      },
      {
        field: 'notes',
        headerName: t('col.notes'),
        flex: 1,
        minWidth: 200,
        renderCell: (p) => <span className="text-xs">{p.row.notes ?? ''}</span>,
      },
    ],
    [t]
  );

  return (
    <div className="space-y-5">
      <h1 className="sr-only">{t('heading')}</h1>

      <div className="card" style={{ padding: 0 }}>
        <DataGrid<Stamp>
          rows={list}
          columns={columns}
          getRowId={(r) => r.id}
          sx={dataGridSx}
          {...dataGridDefaults}
        />
      </div>
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
function isoToday(): string { return new Date().toISOString().slice(0, 10); }
function isoNDaysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
