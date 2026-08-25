import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef, type GridPaginationModel } from '@mui/x-data-grid';
import { api } from '../lib/api.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';
import { fmtDateTime } from '../i18n/format.ts';
import { PageHeader } from '../components/PageHeader.tsx';
import { type UserRow, userLabel } from '../lib/stamp-types.ts';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';
import {
  auditFields,
  auditSummaryText,
  summaryFields,
  type AuditField,
  type TFn,
} from '../lib/audit-detail.ts';

interface AuditEntry {
  id: number;
  action: string;
  resource_type: string;
  resource_id: string | null;
  created_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  target_user_id: string | null;
  target_label: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
}

const CATEGORIES = [
  'users',
  'stamps',
  'corrections',
  'leaves',
  'quotas',
  'shifts',
  'branches',
  'bacheca',
  'cantieri',
  'exports',
  'documents',
  'api',
  'settings',
] as const;

export function Audit() {
  const { t } = useTranslation(['audit', 'common']);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actor, setActor] = useState('');
  const [target, setTarget] = useState('');
  const [category, setCategory] = useState('');
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 50 });
  // Monotonic request id: a slow response for an old filter must not
  // overwrite the grid after a newer one already rendered.
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (actor) params.set('actor', actor);
      if (target) params.set('target', target);
      if (category) params.set('category', category);
      params.set('limit', String(pagination.pageSize));
      params.set('offset', String(pagination.page * pagination.pageSize));
      const r = await api<{ entries: AuditEntry[]; total: number | null }>(
        `/api/v1/audit?${params}`
      );
      if (seq !== seqRef.current) return;
      setEntries(r.entries);
      if (r.total !== null) setTotal(r.total);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [from, to, actor, target, category, pagination]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  useEffect(() => {
    api<UserRow[]>('/api/v1/users')
      .then(setUsers)
      .catch(() => {});
  }, []);

  // Any filter change restarts from the first page.
  function withPageReset(update: () => void) {
    update();
    setPagination((p) => (p.page === 0 ? p : { ...p, page: 0 }));
  }

  const columns = useMemo<GridColDef<AuditEntry>[]>(
    () => [
      {
        field: 'created_at',
        headerName: t('column.when'),
        width: 170,
        type: 'dateTime',
        valueGetter: (_v, row) => new Date(row.created_at),
        renderCell: (p) => <span className="text-xs num">{fmtDateTime(p.value as Date)}</span>,
      },
      {
        field: 'actor',
        headerName: t('column.actor'),
        flex: 1,
        minWidth: 160,
        sortable: false,
        valueGetter: (_v, row) => row.actor_name ?? row.actor_email ?? '—',
        renderCell: (p) => <span title={p.row.actor_email ?? undefined}>{p.value}</span>,
      },
      {
        field: 'action',
        headerName: t('column.action'),
        flex: 1.2,
        minWidth: 200,
        sortable: false,
        renderCell: (p) => t(`action.${p.row.action}`, { defaultValue: p.row.action }),
      },
      {
        field: 'target_label',
        headerName: t('column.target'),
        flex: 1,
        minWidth: 160,
        sortable: false,
        renderCell: (p) => p.row.target_label ?? '',
      },
      {
        field: 'details',
        headerName: t('column.details'),
        flex: 1.8,
        minWidth: 260,
        sortable: false,
        filterable: false,
        valueGetter: (_v, row) => auditSummaryText(row, t as TFn),
        renderCell: (p) => (
          <span className="text-xs" title={p.value as string}>
            <FieldList fields={summaryFields(p.row, t as TFn)} />
          </span>
        ),
      },
    ],
    [t]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('title')}
        subtitle={`${t('subtitle')} — ${t('detail.hint')}`}
        actions={
          <button className="btn" onClick={() => load().catch(() => {})}>
            {t('common:btn.refresh')}
          </button>
        }
      />

      <div className="card grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
        <div>
          <label className="label">{t('filter.from')}</label>
          <input
            type="date"
            className="input"
            value={from}
            onChange={(e) => withPageReset(() => setFrom(e.target.value))}
          />
        </div>
        <div>
          <label className="label">{t('filter.to')}</label>
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => withPageReset(() => setTo(e.target.value))}
          />
        </div>
        <div>
          <label className="label">{t('filter.actor')}</label>
          <select className="input" value={actor} onChange={(e) => withPageReset(() => setActor(e.target.value))}>
            <option value="">{t('filter.all')}</option>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {userLabel(u)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('filter.target')}</label>
          <select className="input" value={target} onChange={(e) => withPageReset(() => setTarget(e.target.value))}>
            <option value="">{t('filter.all')}</option>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {userLabel(u)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('filter.category')}</label>
          <select
            className="input"
            value={category}
            onChange={(e) => withPageReset(() => setCategory(e.target.value))}
          >
            <option value="">{t('filter.all')}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`category.${c}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <DataGrid<AuditEntry>
          rows={entries}
          columns={columns}
          getRowId={(r) => r.id}
          sx={{ ...dataGridSx, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
          {...dataGridDefaults}
          showToolbar={false}
          paginationMode="server"
          rowCount={total}
          paginationModel={pagination}
          onPaginationModelChange={setPagination}
          pageSizeOptions={[50, 100, 200]}
          loading={loading}
          onRowClick={(p) => setSelected(p.row)}
          slotProps={{
            noRowsOverlay: { art: 'history', title: t('empty'), hint: t('emptyHint') },
          }}
        />
      </div>

      {selected && <AuditDetailModal entry={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** `Campo: valore · Campo: prima → dopo`, with the old value struck through. */
function FieldList({ fields }: { fields: AuditField[] }) {
  if (fields.length === 0) return null;
  return (
    <>
      {fields.map((f, i) => (
        <span key={f.key}>
          {i > 0 && <span style={{ color: 'var(--color-outline)' }}> · </span>}
          <span style={{ color: 'var(--color-on-surface-variant)' }}>{f.label}: </span>
          {f.prev !== null && (
            <>
              <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>{f.prev}</span>
              <span aria-hidden="true"> → </span>
            </>
          )}
          <span style={{ fontWeight: f.prev !== null ? 600 : 400 }}>{f.value}</span>
        </span>
      ))}
    </>
  );
}

const TH: CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-on-surface-variant)',
  padding: '0 8px 4px 0',
};

/** Full, humanized dossier of one entry: who/when/what plus every field. */
function AuditDetailModal({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const { t } = useTranslation(['audit', 'common']);
  useEscapeKey(onClose);
  const fields = auditFields(entry, t as TFn);
  const isDiff = fields.some((f) => f.prev !== null);

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <div
        data-testid="audit-detail-modal"
        className="card w-full max-w-2xl space-y-3"
        role="dialog"
        aria-modal="true"
        style={{ maxHeight: '88vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="section-title">
            {t(`action.${entry.action}`, { defaultValue: entry.action })}
          </h2>
          <p className="text-sm muted">
            {fmtDateTime(entry.created_at)} ·{' '}
            {t('detail.by', { who: entry.actor_name ?? entry.actor_email ?? '—' })}
            {entry.target_label ? ` · ${t('detail.on', { who: entry.target_label })}` : ''}
          </p>
        </div>

        {fields.length === 0 ? (
          <p className="text-sm muted">{t('detail.noFields')}</p>
        ) : (
          <table className="text-sm w-full" data-testid="audit-detail-fields">
            <thead>
              {/* Not the `.label` class: it is display:block, which collapses a
                  table header row into stacked lines. */}
              <tr style={{ textAlign: 'left' }}>
                <th style={TH}>{t('detail.field')}</th>
                {isDiff && <th style={TH}>{t('detail.before')}</th>}
                <th style={TH}>{isDiff ? t('detail.after') : t('detail.value')}</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.key} style={{ borderTop: '1px solid var(--color-outline-variant)' }}>
                  <td style={{ padding: '4px 8px 4px 0', color: 'var(--color-on-surface-variant)' }}>
                    {f.label}
                  </td>
                  {isDiff && (
                    <td style={{ padding: '4px 8px 4px 0', opacity: 0.7 }}>
                      {f.prev !== null ? (
                        <span style={{ textDecoration: 'line-through' }}>{f.prev}</span>
                      ) : (
                        ''
                      )}
                    </td>
                  )}
                  <td style={{ padding: '4px 0', fontWeight: f.prev !== null ? 600 : 400 }}>
                    {f.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Support/forensics footer: the raw action code and origin IP are what a
            consultant needs when reconciling the log with a bug report. */}
        <p className="text-xs muted" style={{ wordBreak: 'break-all' }}>
          <span className="num">{entry.action}</span>
          {entry.resource_id ? ` · ${entry.resource_type}: ${entry.resource_id}` : ''}
          {entry.ip ? ` · IP ${entry.ip}` : ''}
        </p>

        <div className="flex justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common:btn.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

