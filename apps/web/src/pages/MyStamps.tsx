import { useEffect, useMemo, useState } from 'react';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { api } from '../lib/api.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';

interface Stamp {
  id: string;
  event_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' | 'lunch_start' | 'lunch_end';
  occurred_at: string;
  source: string;
  branch_id: string | null;
  notes: string | null;
}

export function MyStamps() {
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
        headerName: 'Quando',
        width: 180,
        type: 'dateTime',
        valueGetter: (_v, row) => new Date(row.occurred_at),
        renderCell: (p) => (
          <span className="text-xs num">{(p.value as Date).toLocaleString('it-IT')}</span>
        ),
      },
      {
        field: 'event_type',
        headerName: 'Evento',
        width: 150,
        type: 'singleSelect',
        valueOptions: [
          { value: 'clock_in', label: 'Ingresso' },
          { value: 'clock_out', label: 'Uscita' },
          { value: 'break_start', label: 'Inizio pausa' },
          { value: 'break_end', label: 'Fine pausa' },
          { value: 'lunch_start', label: 'Inizio pausa pranzo' },
          { value: 'lunch_end', label: 'Fine pausa pranzo' },
        ],
        renderCell: (p) => (
          <span className={`badge ${badgeOf(p.row.event_type)}`}>{labelEvent(p.row.event_type)}</span>
        ),
      },
      {
        field: 'source',
        headerName: 'Origine',
        width: 120,
        type: 'singleSelect',
        valueOptions: [
          { value: 'employee_app', label: 'app' },
          { value: 'employee_correction', label: 'correz.' },
          { value: 'admin_manual', label: 'admin' },
        ],
        renderCell: (p) => <span className="badge badge-muted">{sourceLabel(p.row.source)}</span>,
      },
      {
        field: 'notes',
        headerName: 'Note',
        flex: 1,
        minWidth: 200,
        renderCell: (p) => <span className="text-xs">{p.row.notes ?? ''}</span>,
      },
    ],
    []
  );

  return (
    <div className="space-y-5">
      <header>
        <h1 className="page-title">Le mie timbrature</h1>
        <p className="muted text-sm mt-0.5">Storico delle tue timbrature. Vedi solo le tue.</p>
      </header>

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

function labelEvent(e: string): string {
  switch (e) {
    case 'clock_in': return 'Ingresso';
    case 'clock_out': return 'Uscita';
    case 'break_start': return 'Inizio pausa';
    case 'break_end': return 'Fine pausa';
    case 'lunch_start': return 'Inizio pausa pranzo';
    case 'lunch_end': return 'Fine pausa pranzo';
    default: return e;
  }
}
function badgeOf(e: string): string {
  if (e === 'clock_in') return 'badge-ok';
  if (e === 'clock_out') return 'badge-muted';
  return 'badge-warn';
}
function sourceLabel(s: string): string {
  return s === 'employee_app' ? 'app' : s === 'employee_correction' ? 'correz.' : s === 'admin_manual' ? 'admin' : s;
}
function isoToday(): string { return new Date().toISOString().slice(0, 10); }
function isoNDaysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
