import { useEffect, useMemo, useState } from 'react';
import { DataGrid, type GridColDef, type GridRenderCellParams } from '@mui/x-data-grid';
import { api } from '../lib/api.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';
import { useSession } from '../store/session.ts';
import { leaveTypeLabel } from '@sonoqui/shared';

/**
 * One roster row per tenant member. Members with no active quota come back with
 * `type`/`template_name` null and zero usage (so everyone is listed).
 */
interface AssignmentRow {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  type: 'ferie' | 'permessi' | null;
  template_name: string | null;
  initial_balance: number;
  accrued_total: number;
  used_approved: number;
  used_pending: number;
}

/** GET /leave-quotas/me/summary shape (own residuals). */
interface QuotaSummary {
  type: 'ferie' | 'permessi';
  template_name: string | null;
  initial_balance: number;
  accrued_total: number;
  used_approved: number;
  used_pending: number;
  residual_strict: number;
  residual_with_pending: number;
  last_accrual_on: string | null;
}

const fmtH = (n: number): string =>
  `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 })} h`;

/** residuo = saldo iniziale + maturato − usati approvati (può essere negativo). */
const residualStrict = (r: { initial_balance: number; accrued_total: number; used_approved: number }): number =>
  r.initial_balance + r.accrued_total - r.used_approved;

export function Residui() {
  const { me } = useSession();
  const isAdmin = me?.user.role === 'admin';
  return (
    <div className="space-y-5">
      <h1 className="sr-only">Residui</h1>
      {isAdmin ? <AdminResidui /> : <MyResidui />}
    </div>
  );
}

/* ---------- Admin: residui di tutti i dipendenti ---------- */

function AdminResidui() {
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<AssignmentRow[]>('/api/v1/leave-quotas/residui')
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : 'errore'));
  }, []);

  const columns = useMemo<GridColDef<AssignmentRow>[]>(
    () => [
      {
        field: 'user',
        headerName: 'Utente',
        flex: 1.2,
        minWidth: 180,
        valueGetter: (_v: unknown, row: AssignmentRow) => row.user_display_name || row.user_email,
      },
      {
        field: 'type',
        headerName: 'Tipo',
        width: 120,
        valueGetter: (_v: unknown, row: AssignmentRow) =>
          row.type ? leaveTypeLabel(row.type) : '—',
      },
      {
        field: 'initial_balance',
        headerName: 'Saldo iniziale',
        width: 130,
        valueGetter: (_v: unknown, row: AssignmentRow) => row.initial_balance,
        renderCell: (p: GridRenderCellParams<AssignmentRow>) =>
          p.row.type ? fmtH(p.row.initial_balance) : '—',
      },
      {
        field: 'accrued_total',
        headerName: 'Maturato',
        width: 120,
        valueGetter: (_v: unknown, row: AssignmentRow) => row.accrued_total,
        renderCell: (p: GridRenderCellParams<AssignmentRow>) =>
          p.row.type ? fmtH(p.row.accrued_total) : '—',
      },
      {
        field: 'used_approved',
        headerName: 'Usato',
        width: 120,
        valueGetter: (_v: unknown, row: AssignmentRow) => row.used_approved,
        renderCell: (p: GridRenderCellParams<AssignmentRow>) =>
          p.row.type ? fmtH(p.row.used_approved) : '—',
      },
      {
        field: 'used_pending',
        headerName: 'In attesa',
        width: 120,
        valueGetter: (_v: unknown, row: AssignmentRow) => row.used_pending,
        renderCell: (p: GridRenderCellParams<AssignmentRow>) =>
          p.row.type ? fmtH(p.row.used_pending) : '—',
      },
      {
        field: 'residual',
        headerName: 'Residuo',
        width: 130,
        valueGetter: (_v: unknown, row: AssignmentRow) => residualStrict(row),
        renderCell: (p: GridRenderCellParams<AssignmentRow>) => {
          if (!p.row.type) return '—';
          const v = residualStrict(p.row);
          return (
            <span style={{ fontWeight: 600, color: v < 0 ? 'var(--color-error)' : undefined }}>{fmtH(v)}</span>
          );
        },
      },
      {
        field: 'residual_pending',
        headerName: 'Residuo con pending',
        width: 180,
        valueGetter: (_v: unknown, row: AssignmentRow) => residualStrict(row) - row.used_pending,
        renderCell: (p: GridRenderCellParams<AssignmentRow>) => {
          if (!p.row.type) return '—';
          const v = residualStrict(p.row) - p.row.used_pending;
          return <span style={{ color: v < 0 ? 'var(--color-error)' : undefined }}>{fmtH(v)}</span>;
        },
      },
    ],
    []
  );

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="section-title">Residui dipendenti</h2>
        <p className="muted text-sm">
          Ore residue di ferie e permessi per ogni dipendente. Chi non ha una quota
          assegnata compare comunque, senza valori (—).
        </p>
      </div>
      {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
      <DataGrid<AssignmentRow>
        rows={rows}
        columns={columns}
        getRowId={(r: AssignmentRow) => r.id}
        sx={dataGridSx}
        {...dataGridDefaults}
      />
      <div className="callout callout-info text-sm">
        <strong>Residuo</strong> = saldo iniziale + maturato − usati approvati. Le richieste in
        attesa non vengono scalate subito: il <em>residuo con pending</em> mostra cosa resterebbe se
        venissero tutte approvate, e può diventare negativo.
      </div>
    </div>
  );
}

/* ---------- Dipendente: solo i propri residui ---------- */

function MyResidui() {
  const [rows, setRows] = useState<QuotaSummary[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<QuotaSummary[]>('/api/v1/leave-quotas/me/summary')
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : 'errore'))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="section-title">I miei residui</h2>
        <p className="muted text-sm">Ore residue di ferie e permessi a tua disposizione.</p>
      </div>
      {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
      {loaded && rows.length === 0 && !err && (
        <div className="card">
          <p className="muted text-sm">
            Nessuna quota di ferie o permessi assegnata. Contatta l'amministratore.
          </p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((q) => (
          <ResidualCard key={q.type} q={q} />
        ))}
      </div>
    </div>
  );
}

function ResidualCard({ q }: { q: QuotaSummary }) {
  const neg = q.residual_strict < 0;
  return (
    <div className="card space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">{leaveTypeLabel(q.type)}</h3>
        {q.template_name && <span className="text-xs muted">{q.template_name}</span>}
      </div>
      <div>
        <div className="text-3xl font-bold" style={{ color: neg ? 'var(--color-error)' : 'var(--color-primary)' }}>
          {fmtH(q.residual_strict)}
        </div>
        <div className="text-xs muted">
          residuo disponibile
          {q.used_pending > 0 && <> · con richieste in attesa: <strong>{fmtH(q.residual_with_pending)}</strong></>}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Row label="Saldo iniziale" value={fmtH(q.initial_balance)} />
        <Row label="Maturato" value={fmtH(q.accrued_total)} />
        <Row label="Usato approvato" value={fmtH(q.used_approved)} />
        <Row label="In attesa" value={fmtH(q.used_pending)} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
