import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import {
  DOCUMENT_CATEGORIES,
  type DocumentListItem,
} from '@sonoqui/shared';
import { api } from '../lib/api.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';
import { fmtDate, fmtDateTime } from '../i18n/format.ts';
import { PageHeader } from '../components/PageHeader.tsx';
import { IconButton } from '../components/IconButton.tsx';

export function MyDocuments() {
  const { t } = useTranslation(['documents', 'common']);
  const [list, setList] = useState<DocumentListItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setList(await api<DocumentListItem[]>('/api/v1/documents/me'));
  }
  useEffect(() => {
    load().catch((e) => setErr(e instanceof Error ? e.message : t('errorGeneric')));
  }, []);

  // Opening a document records the first view server-side (the download
  // endpoint inserts the view row). Refresh so the badge flips to "viewed".
  async function download(d: DocumentListItem) {
    setErr(null);
    try {
      const { url } = await api<{ url: string; expires_in: number }>(
        `/api/v1/documents/${d.id}/download`
      );
      window.open(url, '_blank', 'noopener');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }

  const columns = useMemo<GridColDef<DocumentListItem>[]>(
    () => [
      {
        field: 'category',
        headerName: t('col.category'),
        width: 140,
        type: 'singleSelect',
        valueOptions: DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) })),
        renderCell: (p) => (
          <span className="badge badge-muted">{t(`category.${p.row.category}`)}</span>
        ),
      },
      {
        field: 'title',
        headerName: t('col.title'),
        flex: 1.4,
        minWidth: 200,
        renderCell: (p) => <span className="text-sm">{p.row.title}</span>,
      },
      {
        field: 'created_at',
        headerName: t('col.uploaded'),
        width: 160,
        type: 'dateTime',
        valueGetter: (_v, row) => new Date(row.created_at),
        renderCell: (p) => <span className="text-xs num">{fmtDateTime(p.value as Date)}</span>,
      },
      {
        field: 'retention_until',
        headerName: t('col.retentionUntil'),
        width: 130,
        type: 'date',
        valueGetter: (_v, row) => new Date(row.retention_until),
        renderCell: (p) => <span className="text-xs num">{fmtDate(p.value as Date)}</span>,
      },
      {
        field: 'viewed_at',
        headerName: t('col.viewed'),
        width: 130,
        sortable: false,
        valueGetter: (_v, row) => row.viewed_at ?? '',
        renderCell: (p) =>
          p.row.viewed_at ? (
            <span className="badge badge-ok" title={fmtDateTime(p.row.viewed_at)}>
              {t('viewed')}
            </span>
          ) : (
            <span className="badge badge-warn">{t('notViewed')}</span>
          ),
      },
      {
        field: 'actions',
        headerName: t('col.actions'),
        width: 130,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <IconButton
            kind="download"
            onClick={() => download(p.row)}
            title={t('actions.download')}
          />
        ),
      },
    ],
    [t]
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t('myHeading')} subtitle={t('myIntro')} />

      {err && (
        <div className="card text-sm" style={{ color: 'var(--color-error)' }}>
          {err}
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <DataGrid<DocumentListItem>
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
