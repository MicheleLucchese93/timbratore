import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef, type GridPaginationModel } from '@mui/x-data-grid';
import { api } from '../lib/api.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';
import { fmtDateTime } from '../i18n/format.ts';
import { PageHeader } from '../components/PageHeader.tsx';
import { type UserRow, userLabel } from '../lib/stamp-types.ts';

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
  'settings',
] as const;

export function Audit() {
  const { t } = useTranslation(['audit', 'common']);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actor, setActor] = useState('');
  const [target, setTarget] = useState('');
  const [category, setCategory] = useState('');
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 50 });

  const load = useCallback(async () => {
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
      setEntries(r.entries);
      if (r.total !== null) setTotal(r.total);
    } finally {
      setLoading(false);
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
        flex: 1.4,
        minWidth: 200,
        sortable: false,
        filterable: false,
        valueGetter: (_v, row) => detailSummary(row),
        renderCell: (p) => (
          <span className="text-xs" title={p.value as string} style={{ color: 'var(--color-on-surface-variant)' }}>
            {p.value}
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
        subtitle={t('subtitle')}
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
          sx={dataGridSx}
          {...dataGridDefaults}
          showToolbar={false}
          paginationMode="server"
          rowCount={total}
          paginationModel={pagination}
          onPaginationModelChange={setPagination}
          pageSizeOptions={[50, 100, 200]}
          loading={loading}
          localeText={{ noRowsLabel: t('empty') }}
        />
      </div>
    </div>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Compact one-line summary of the changed fields (after wins over before).
 * Ids/uuids are dropped — they mean nothing to an admin reading the log. */
function detailSummary(row: AuditEntry): string {
  const payload = row.after ?? row.before;
  if (payload === null || payload === undefined) return '';
  if (typeof payload !== 'object') return String(payload);
  return Object.entries(payload as Record<string, unknown>)
    .filter(
      ([k, v]) =>
        v !== null &&
        v !== undefined &&
        typeof v !== 'object' &&
        k !== 'id' &&
        !k.endsWith('_id') &&
        !(typeof v === 'string' && UUID_RE.test(v))
    )
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');
}
