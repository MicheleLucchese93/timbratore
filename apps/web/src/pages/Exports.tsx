import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { api, getToken, apiUrl } from '../lib/api.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';

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
  const [list, setList] = useState<ExportJob[]>([]);
  const [from, setFrom] = useState(() => firstOfPrevMonth());
  const [to, setTo] = useState(() => lastOfPrevMonth());
  const [format, setFormat] = useState<'xlsx' | 'json'>('xlsx');
  const [busy, setBusy] = useState(false);

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
    if (!r.ok) { alert('Download fallito'); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${j.id}.${j.format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="page-title">Esportazioni</h1>
        <p className="muted text-sm mt-0.5">XLSX commercialista o JSON, sull'intero tenant.</p>
      </header>

      <form onSubmit={enqueue} className="card grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="label">Dal</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </div>
        <div>
          <label className="label">Al</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} required />
        </div>
        <div>
          <label className="label">Formato</label>
          <select className="input" value={format} onChange={(e) => setFormat(e.target.value as 'xlsx' | 'json')}>
            <option value="xlsx">XLSX (commercialista)</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Invio…' : 'Genera'}</button>
      </form>

      <div className="card" style={{ padding: 0 }}>
        <ExportsDataGrid list={list} onDownload={download} />
      </div>
    </div>
  );
}

function ExportsDataGrid({
  list,
  onDownload,
}: {
  list: ExportJob[];
  onDownload: (j: ExportJob) => void;
}) {
  const columns = useMemo<GridColDef<ExportJob>[]>(
    () => [
      {
        field: 'period',
        headerName: 'Periodo',
        flex: 1,
        minWidth: 200,
        valueGetter: (_v, row) => `${row.period_from} → ${row.period_to}`,
        renderCell: (p) => <span className="text-xs num">{p.value}</span>,
      },
      {
        field: 'format',
        headerName: 'Formato',
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
        headerName: 'Stato',
        width: 150,
        type: 'singleSelect',
        valueOptions: [
          { value: 'pending', label: 'In coda' },
          { value: 'running', label: 'In elaborazione' },
          { value: 'ready', label: 'Pronta' },
          { value: 'failed', label: 'Errore' },
        ],
        renderCell: (p) => <StatusBadge status={p.row.status} />,
      },
      {
        field: 'created_at',
        headerName: 'Creata',
        width: 180,
        type: 'dateTime',
        valueGetter: (_v, row) => new Date(row.created_at),
        renderCell: (p) => (
          <span className="text-xs num">{(p.value as Date).toLocaleString('it-IT')}</span>
        ),
      },
      {
        field: 'actions',
        headerName: 'Azioni',
        flex: 1,
        minWidth: 180,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <div className="flex gap-2">
            {p.row.status === 'ready' && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => onDownload(p.row)}
              >
                Scarica
              </button>
            )}
            {p.row.status === 'failed' && p.row.error && (
              <span className="text-xs" style={{ color: 'var(--color-error)' }}>
                {p.row.error}
              </span>
            )}
          </div>
        ),
      },
    ],
    [onDownload]
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
  if (status === 'ready') return <span className="badge badge-ok">pronta</span>;
  if (status === 'failed') return <span className="badge badge-err">errore</span>;
  if (status === 'running') return <span className="badge badge-warn">in elaborazione</span>;
  return <span className="badge badge-muted">in coda</span>;
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
