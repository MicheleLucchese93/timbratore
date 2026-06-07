import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef, type GridRenderCellParams } from '@mui/x-data-grid';
import { api } from '../lib/api.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';
import { useSession } from '../store/session.ts';
import { fmtNumber } from '../i18n/format.ts';
import i18n from '../i18n/index.ts';

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
  `${fmtNumber(n, { maximumFractionDigits: 2 })} ${i18n.t('common:unit.hoursShort')}`;

/** residuo = saldo iniziale + maturato − usati approvati (può essere negativo). */
const residualStrict = (r: { initial_balance: number; accrued_total: number; used_approved: number }): number =>
  r.initial_balance + r.accrued_total - r.used_approved;

export function Residui() {
  const { t } = useTranslation(['residui', 'common']);
  const { me } = useSession();
  const isAdmin = me?.user.role === 'admin';
  return (
    <div className="space-y-5">
      <h1 className="sr-only">{t('title')}</h1>
      {isAdmin ? <AdminResidui /> : <MyResidui />}
    </div>
  );
}

/* ---------- Admin: residui di tutti i dipendenti ---------- */

function AdminResidui() {
  const { t } = useTranslation(['residui', 'common']);
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<AssignmentRow[]>('/api/v1/leave-quotas/residui')
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : t('common:state.error')));
  }, [t]);

  const columns = useMemo<GridColDef<AssignmentRow>[]>(
    () => [
      {
        field: 'user',
        headerName: t('admin.col.user'),
        flex: 1.2,
        minWidth: 180,
        valueGetter: (_v: unknown, row: AssignmentRow) => row.user_display_name || row.user_email,
      },
      {
        field: 'type',
        headerName: t('admin.col.type'),
        width: 120,
        valueGetter: (_v: unknown, row: AssignmentRow) =>
          row.type ? t(`common:leaveType.${row.type}`) : '—',
      },
      {
        field: 'initial_balance',
        headerName: t('admin.col.initialBalance'),
        width: 130,
        valueGetter: (_v: unknown, row: AssignmentRow) => row.initial_balance,
        renderCell: (p: GridRenderCellParams<AssignmentRow>) =>
          p.row.type ? fmtH(p.row.initial_balance) : '—',
      },
      {
        field: 'accrued_total',
        headerName: t('admin.col.accrued'),
        width: 120,
        valueGetter: (_v: unknown, row: AssignmentRow) => row.accrued_total,
        renderCell: (p: GridRenderCellParams<AssignmentRow>) =>
          p.row.type ? fmtH(p.row.accrued_total) : '—',
      },
      {
        field: 'used_approved',
        headerName: t('admin.col.used'),
        width: 120,
        valueGetter: (_v: unknown, row: AssignmentRow) => row.used_approved,
        renderCell: (p: GridRenderCellParams<AssignmentRow>) =>
          p.row.type ? fmtH(p.row.used_approved) : '—',
      },
      {
        field: 'used_pending',
        headerName: t('admin.col.pending'),
        width: 120,
        valueGetter: (_v: unknown, row: AssignmentRow) => row.used_pending,
        renderCell: (p: GridRenderCellParams<AssignmentRow>) =>
          p.row.type ? fmtH(p.row.used_pending) : '—',
      },
      {
        field: 'residual',
        headerName: t('admin.col.residual'),
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
        headerName: t('admin.col.residualWithPending'),
        width: 180,
        valueGetter: (_v: unknown, row: AssignmentRow) => residualStrict(row) - row.used_pending,
        renderCell: (p: GridRenderCellParams<AssignmentRow>) => {
          if (!p.row.type) return '—';
          const v = residualStrict(p.row) - p.row.used_pending;
          return <span style={{ color: v < 0 ? 'var(--color-error)' : undefined }}>{fmtH(v)}</span>;
        },
      },
    ],
    [t]
  );

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="section-title">{t('admin.title')}</h2>
        <p className="muted text-sm">
          {t('admin.subtitle')}
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
        <Trans
          t={t}
          i18nKey="admin.note"
          components={{ strong: <strong />, em: <em /> }}
        />
      </div>
    </div>
  );
}

/* ---------- Dipendente: solo i propri residui ---------- */

function MyResidui() {
  const { t } = useTranslation(['residui', 'common']);
  const [rows, setRows] = useState<QuotaSummary[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<QuotaSummary[]>('/api/v1/leave-quotas/me/summary')
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : t('common:state.error')))
      .finally(() => setLoaded(true));
  }, [t]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="section-title">{t('mine.title')}</h2>
        <p className="muted text-sm">{t('mine.subtitle')}</p>
      </div>
      {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
      {loaded && rows.length === 0 && !err && (
        <div className="card">
          <p className="muted text-sm">
            {t('mine.empty')}
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
  const { t } = useTranslation(['residui', 'common']);
  const neg = q.residual_strict < 0;
  return (
    <div className="card space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">{t(`common:leaveType.${q.type}`)}</h3>
        {q.template_name && <span className="text-xs muted">{q.template_name}</span>}
      </div>
      <div>
        <div className="text-3xl font-bold" style={{ color: neg ? 'var(--color-error)' : 'var(--color-primary)' }}>
          {fmtH(q.residual_strict)}
        </div>
        <div className="text-xs muted">
          {t('mine.available')}
          {q.used_pending > 0 && <> · {t('mine.withPending')} <strong>{fmtH(q.residual_with_pending)}</strong></>}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Row label={t('field.initialBalance')} value={fmtH(q.initial_balance)} />
        <Row label={t('field.accrued')} value={fmtH(q.accrued_total)} />
        <Row label={t('field.usedApproved')} value={fmtH(q.used_approved)} />
        <Row label={t('field.pending')} value={fmtH(q.used_pending)} />
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
