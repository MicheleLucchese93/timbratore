import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { api, getToken, getTenantId, apiUrl } from '../lib/api.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';
import { fmtDateTime } from '../i18n/format.ts';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { IconButton } from '../components/IconButton.tsx';

type ExportFormat = 'xlsx' | 'json' | 'centro';

interface ExportJob {
  id: string;
  format: ExportFormat;
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
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [busy, setBusy] = useState(false);
  // Centro Paghe is opt-in: only tenants that configured a codice ditta
  // (Impostazioni → Centro Paghe) get the format option. Avoids generating a
  // payroll file with no company code — which only ever errored.
  const [centroEnabled, setCentroEnabled] = useState(false);
  const confirm = useConfirm();

  // Centro Paghe = one whole calendar month. Snap the range to month bounds when
  // the format or the start date changes while it's selected.
  function onFormatChange(next: ExportFormat) {
    setFormat(next);
    if (next === 'centro') {
      const b = monthBounds(from);
      setFrom(b.first);
      setTo(b.last);
    }
  }
  function onFromChange(value: string) {
    if (format === 'centro') {
      const b = monthBounds(value);
      setFrom(b.first);
      setTo(b.last);
    } else {
      setFrom(value);
    }
  }

  async function load() {
    setList(await api<ExportJob[]>('/api/v1/exports'));
  }
  useEffect(() => {
    load().catch(() => {});
    const id = setInterval(() => load().catch(() => {}), 2000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    api<{ codice_ditta: string | null }>('/api/v1/settings')
      .then((s) => setCentroEnabled(Boolean(s.codice_ditta?.trim())))
      .catch(() => {});
  }, []);

  async function enqueue(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/v1/exports', { method: 'POST', json: { format, period_from: from, period_to: to, filters: {} } });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : t('createFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function download(j: ExportJob) {
    const headers: Record<string, string> = { Authorization: `Bearer ${getToken()}` };
    const tid = getTenantId();
    if (tid) headers['X-Tenant-Id'] = tid;
    const r = await fetch(apiUrl(`/api/v1/exports/${j.id}/download`), { headers });
    if (!r.ok) { alert(t('downloadFailed')); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cd = r.headers.get('content-disposition') ?? '';
    const m = /filename="?([^";]+)"?/.exec(cd);
    a.download = m ? m[1]! : `${j.id}.${j.format}`;
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
    <div className="space-y-4">
      <PageHeader title={t('title')} />

      <form onSubmit={enqueue} className="card grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="label">{t('from')}</label>
          <input type="date" className="input" value={from} onChange={(e) => onFromChange(e.target.value)} required />
        </div>
        <div>
          <label className="label">{t('to')}</label>
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={format === 'centro'}
            required
          />
        </div>
        <div>
          <label className="label">{t('format')}</label>
          <select className="input" value={format} onChange={(e) => onFormatChange(e.target.value as ExportFormat)}>
            <option value="xlsx">{t('formatXlsx')}</option>
            <option value="json">JSON</option>
            {centroEnabled && <option value="centro">{t('formatCentro')}</option>}
          </select>
          {format === 'centro' && <p className="field-hint">{t('centroMonthHint')}</p>}
        </div>
        <button className="btn btn-primary" disabled={busy}>{busy ? t('sending') : t('common:btn.generate')}</button>
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
          { value: 'centro', label: 'Centro Paghe' },
        ],
        renderCell: (p) => (p.row.format === 'centro' ? 'Centro Paghe' : p.row.format.toUpperCase()),
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
          <div className="flex gap-1 items-center">
            {p.row.status === 'ready' && (
              <IconButton kind="download" onClick={() => onDownload(p.row)} />
            )}
            {p.row.status === 'failed' && p.row.error && (
              <span className="text-xs" style={{ color: 'var(--color-error)' }}>
                {p.row.error}
              </span>
            )}
            <IconButton kind="delete" onClick={() => onRemove(p.row)} title={t('deleteAriaLabel')} />
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

function monthBounds(dateStr: string): { first: string; last: string } {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    first: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
    last: new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10),
  };
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
