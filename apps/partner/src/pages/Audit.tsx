import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { api, type ApiError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { PageHeader } from '../components/PageHeader.tsx';

interface AuditRow {
  id: string;
  actor_email: string | null;
  actor_role: string;
  action: string;
  target_type: string | null;
  target_label: string | null;
  created_at: string;
}

export function Audit() {
  const { t } = useTranslation();
  const toast = useToast();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ entries: AuditRow[] }>('/api/v1/partnership/audit');
      setRows(r.entries);
    } catch (e) {
      const code = (e as ApiError | null)?.code;
      toast(t(`errors.${code ?? 'default'}`, { defaultValue: t('errors.default') }), true);
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: GridColDef<AuditRow>[] = [
    {
      field: 'created_at',
      headerName: t('audit.col.when'),
      width: 180,
      renderCell: (p) => new Date(p.row.created_at).toLocaleString(),
    },
    { field: 'actor_email', headerName: t('audit.col.actor'), flex: 1, minWidth: 180 },
    {
      field: 'actor_role',
      headerName: t('audit.col.role'),
      width: 120,
      renderCell: (p) => t(`role.${p.row.actor_role}`, { defaultValue: p.row.actor_role }),
    },
    {
      field: 'action',
      headerName: t('audit.col.action'),
      flex: 1,
      minWidth: 180,
      renderCell: (p) => t(`audit.action.${p.row.action}`, { defaultValue: p.row.action }),
    },
    { field: 'target_label', headerName: t('audit.col.target'), flex: 1.2, minWidth: 180 },
  ];

  return (
    <>
      <PageHeader
        title={t('audit.title')}
        subtitle={t('audit.subtitle')}
        actions={
          <button className="btn btn-secondary" onClick={() => load()}>
            {t('actions.refresh')}
          </button>
        }
      />
      <div className="grid-wrap card">
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          disableRowSelectionOnClick
          density="compact"
          initialState={{ pagination: { paginationModel: { pageSize: 50 } } }}
          pageSizeOptions={[50, 100]}
          sx={{ border: 0 }}
        />
      </div>
    </>
  );
}
