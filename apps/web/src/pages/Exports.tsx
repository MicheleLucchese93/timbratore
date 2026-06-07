import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { api, getToken, apiUrl } from '../lib/api.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';
import { fmtDateTime } from '../i18n/format.ts';
import { useConfirm } from '../components/ConfirmDialog.tsx';

interface ExportJob {
  id: string;
  format: 'xlsx' | 'json';
  period_from: string;
  period_to: string;
  status: 'pending' | 'running' | 'ready' | 'failed';
  r2_key: string | null;
  error: string | null;
  created_at: string;
}

export function Exports() {
  const { t } = useTranslation(['exports', 'common']);
  const [list, setList] = useState<ExportJob[]>([]);
  const [from, setFrom] = useState(() => firstOfPrevMonth());
  const [to, setTo] = useState(() => lastOfPrevMonth());
  const [format, setFormat] = useState<'xlsx' | 'json'>('xlsx');
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  async function load() {
    setList(await api<ExportJob[]>('/api/v1/exports'));
  }
  useEffect(() => {
    load().catch(() => {});
    const id = setInterval(() => load().catch(() => {}), 2000);
    return () => clearInterval(id);
  }, []);

  async function enqueue(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/v1/exports', { method: 'POST', json: { format, period_from: from, period_to: to, filters: {} } });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function download(j: ExportJob) {
    const r = await fetch(apiUrl(`/api/v1/exports/${j.id}/download`), {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!r.ok) { alert(t('downloadFailed')); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${j.id}.${j.format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function remove(j: ExportJob) {
    if (!(await confirm({ title: t('deleteConfirm.title'), danger: true, confirmLabel: t('common:btn.delete') }))) return;
    setList((prev) => prev.filter((x) => x.id !== j.id));
    await api(`/api/v1/exports/${j.id}`, { method: 'DELETE' }).catch(() => {});
    await load().catch(() => {});
  }

  return (
    <div className="space-y-5">
      <h1 className="sr-only">{t('title')}</h1>

      <form onSubmit={enqueue} className="card grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="label">{t('from')}</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </div>
        <div>
          <label className="label">{t('to')}</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} required />
        </div>
        <div>
          <label className="label">{t('format')}</label>
          <select className="input" value={format} onChange={(e) => setFormat(e.target.value as 'xlsx' | 'json')}>
            <option value="xlsx">{t('formatXlsx')}</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? t('sending') : t('common:btn.generate')}</button>
      </form>

      <div className="card" style={{ padding: 0 }}>
        <ExportsDataGrid list={list} onDownload={download} onRemove={remove} />
      </div>
    </div>
  );
}

function ExportsDataGrid({
  list,
  onDownload,
  onRemove,
}: {
  list: ExportJob[];
  onDownload: (j: ExportJob) => void;
  onRemove: (j: ExportJob) => void;
}) {
  const { t } = useTranslation(['exports', 'common']);
  const columns = useMemo<GridColDef<ExportJob>[]>(
    () => [
      {
        field: 'period',
        headerName: t('column.period'),
        flex: 1,
        minWidth: 200,
        valueGetter: (_v, row) => `${row.period_from} → ${row.period_to}`,
        renderCell: (p) => <span className="text-xs num">{p.value}</span>,
      },
      {
        field: 'format',
        headerName: t('format'),
        width: 110,
        type: 'singleSelect',
        valueOptions: [
          { value: 'xlsx', label: 'XLSX' },
          { value: 'json', label: 'JSON' },
        ],
        renderCell: (p) => p.row.format.toUpperCase(),
      },
      {
        field: 'status',
        headerName: t('column.status'),
        width: 150,
        type: 'singleSelect',
        valueOptions: [
          { value: 'pending', label: t('filter.pending') },
          { value: 'running', label: t('filter.running') },
          { value: 'ready', label: t('filter.ready') },
          { value: 'failed', label: t('filter.failed') },
        ],
        renderCell: (p) => <StatusBadge status={p.row.status} />,
      },
      {
        field: 'created_at',
        headerName: t('column.created'),
        width: 180,
        type: 'dateTime',
        valueGetter: (_v, row) => new Date(row.created_at),
        renderCell: (p) => (
          <span className="text-xs num">{fmtDateTime(p.value as Date)}</span>
        ),
      },
      {
        field: 'actions',
        headerName: t('column.actions'),
        flex: 1,
        minWidth: 180,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <div className="flex gap-2 items-center">
            {p.row.status === 'ready' && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => onDownload(p.row)}
              >
                {t('common:btn.download')}
              </button>
            )}
            {p.row.status === 'failed' && p.row.error && (
              <span className="text-xs" style={{ color: 'var(--color-error)' }}>
                {p.row.error}
              </span>
            )}
            <button
              type="button"
              className="icon-btn icon-btn-danger"
              onClick={() => onRemove(p.row)}
              aria-label={t('deleteAriaLabel')}
              title={t('common:btn.delete')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        ),
      },
    ],
    [onDownload, onRemove, t]
  );

  return (
    <DataGrid<ExportJob>
      rows={list}
      columns={columns}
      getRowId={(r) => r.id}
      sx={dataGridSx}
      {...dataGridDefaults}
    />
  );
}

function StatusBadge({ status }: { status: ExportJob['status'] }) {
  const { t } = useTranslation('exports');
  if (status === 'ready') return <span className="badge badge-ok">{t('badge.ready')}</span>;
  if (status === 'failed') return <span className="badge badge-err">{t('badge.failed')}</span>;
  if (status === 'running') return <span className="badge badge-warn">{t('badge.running')}</span>;
  return <span className="badge badge-muted">{t('badge.pending')}</span>;
}

function firstOfPrevMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}
function lastOfPrevMonth(): string {
  const d = new Date();
  d.setDate(0);
  return d.toISOString().slice(0, 10);
}
