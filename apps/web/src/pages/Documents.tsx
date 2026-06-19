import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import {
  DOCUMENT_CATEGORIES,
  type DocumentAdminItem,
  type DocumentCategory,
} from '@sonoqui/shared';
import { api, apiUrl, getToken, getTenantId } from '../lib/api.ts';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';
import { IconButton } from '../components/IconButton.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { fmtDate, fmtDateTime } from '../i18n/format.ts';

// The subset of the Users API a document needs to auto-match a filename to its
// owning employee and to render a target picker.
interface UserOption {
  user_id: string;
  email: string;
  active: boolean;
  display_name: string | null;
  codice_fiscale: string | null;
  matricola: string | null;
}

// One row of the bulk-upload mapping table: a chosen file, the user it matched
// to (or null when unmatched), the category and a per-row upload outcome.
interface UploadRow {
  id: string;
  file: File;
  userId: string | null;
  category: DocumentCategory;
  title: string;
  matchedBy: 'codice_fiscale' | null;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

const MAX_BYTES = 15 * 1024 * 1024;

function userLabel(u: UserOption): string {
  return u.display_name?.trim() || u.email;
}

function isOtpRequired(e: unknown): boolean {
  return typeof e === 'object' && e != null && (e as { code?: string }).code === 'OTP_REQUIRED';
}

export function Documents() {
  const { t } = useTranslation(['documents', 'common']);
  const [list, setList] = useState<DocumentAdminItem[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [filterUserId, setFilterUserId] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DocumentAdminItem | null>(null);
  // null = still checking the OTP session; false = must enter a code before the
  // uploaded-documents list/downloads unlock; true = a live session.
  const [otpReady, setOtpReady] = useState<boolean | null>(null);
  useEscapeKey(() => setConfirmDelete(null), confirmDelete != null);

  async function loadUsers() {
    // Scoped recipient list (works for a base-user Documentale too — /api/v1/users
    // is admin-only). NOT OTP-gated: it powers the upload form.
    const u = await api<UserOption[]>('/api/v1/documents/recipients');
    setUsers(u);
  }

  async function loadDocs(userId?: string) {
    const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
    setList(await api<DocumentAdminItem[]>(`/api/v1/documents${qs}`));
  }

  useEffect(() => {
    loadUsers().catch((e) => setErr(e instanceof Error ? e.message : t('errorGeneric')));
    api<{ verified: boolean }>('/api/v1/documents/otp/status')
      .then((s) => setOtpReady(s.verified))
      .catch(() => setOtpReady(false));
  }, []);

  useEffect(() => {
    if (otpReady !== true) return;
    loadDocs(filterUserId || undefined).catch((e) => {
      if (isOtpRequired(e)) {
        setOtpReady(false);
        return;
      }
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    });
  }, [filterUserId, otpReady]);

  // Display-name lookup so the grid can label the target employee even though
  // the admin list carries only an optional display name.
  const userById = useMemo(() => {
    const m = new Map<string, UserOption>();
    for (const u of users) m.set(u.user_id, u);
    return m;
  }, [users]);

  async function download(d: DocumentAdminItem) {
    setErr(null);
    try {
      const { url } = await api<{ url: string; expires_in: number }>(
        `/api/v1/documents/${d.id}/download`
      );
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      if (isOtpRequired(e)) {
        // Session lapsed mid-use — drop back to the gate.
        setOtpReady(false);
        return;
      }
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }

  async function doDelete(d: DocumentAdminItem) {
    setErr(null);
    setInfo(null);
    try {
      await api(`/api/v1/documents/${d.id}`, { method: 'DELETE' });
      setInfo(t('deleted'));
      await loadDocs(filterUserId || undefined);
    } catch (e) {
      if (isOtpRequired(e)) {
        setOtpReady(false);
        return;
      }
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('heading')}
        actions={
          <button className="btn btn-primary" onClick={() => setShowUpload(true)}>
            {t('toolbar.upload')}
          </button>
        }
      />

      {otpReady === true && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="label" htmlFor="doc-filter-user" style={{ margin: 0 }}>
            {t('filterByEmployee')}
          </label>
          <select
            id="doc-filter-user"
            className="input"
            style={{ minWidth: 220 }}
            value={filterUserId}
            onChange={(e) => setFilterUserId(e.target.value)}
          >
            <option value="">{t('filterAll')}</option>
            {users
              .filter((u) => u.active)
              .map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {userLabel(u)}
                </option>
              ))}
          </select>
        </div>
      )}

      {err && (
        <div className="card text-sm" style={{ color: 'var(--color-error)', whiteSpace: 'pre-wrap' }}>
          {err}
        </div>
      )}
      {info && (
        <div className="card text-sm" style={{ color: 'var(--color-success)' }}>
          {info}
        </div>
      )}

      {otpReady === true ? (
        <div className="card" style={{ padding: 0 }}>
          <DocumentsDataGrid
            list={list}
            userById={userById}
            onDownload={download}
            onDelete={setConfirmDelete}
          />
        </div>
      ) : (
        <OtpGate checking={otpReady === null} onVerified={() => setOtpReady(true)} />
      )}

      {showUpload && (
        <BulkUploadModal
          users={users.filter((u) => u.active)}
          onClose={() => setShowUpload(false)}
          onUploaded={async (count) => {
            setShowUpload(false);
            setInfo(t('upload.done', { count }));
            await loadDocs(filterUserId || undefined);
          }}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
          <div className="card w-full max-w-md space-y-3">
            <h2 className="section-title">{t('confirmDelete.title')}</h2>
            <p className="text-sm muted">
              {t('confirmDelete.messagePre')} <strong>{confirmDelete.title}</strong>{' '}
              {t('confirmDelete.messagePost')}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmDelete(null)}
              >
                {t('common:btn.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  const target = confirmDelete;
                  setConfirmDelete(null);
                  await doDelete(target);
                }}
              >
                {t('common:btn.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// OTP gate shown before the uploaded-documents list/downloads unlock. The
// Documentale requests a 6-digit code (emailed to their own address), enters it,
// and a verified session keeps the list open for ~10 minutes.
function OtpGate({ checking, onVerified }: { checking: boolean; onVerified: () => void }) {
  const { t } = useTranslation(['documents', 'common']);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function requestCode() {
    setErr(null);
    setBusy(true);
    try {
      await api('/api/v1/documents/otp/request', { method: 'POST' });
      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setErr(null);
    setBusy(true);
    try {
      await api('/api/v1/documents/otp/verify', { method: 'POST', json: { code: code.trim() } });
      onVerified();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('otp.invalid'));
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return <div className="card text-sm muted">{t('common:loading')}</div>;
  }

  return (
    <div className="card space-y-3" style={{ maxWidth: 460 }}>
      <h2 className="section-title">{t('otp.title')}</h2>
      <p className="text-sm muted">{t('otp.intro')}</p>
      {!sent ? (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={requestCode}>
          {busy ? t('otp.sending') : t('otp.send')}
        </button>
      ) : (
        <>
          <p className="text-sm" style={{ color: 'var(--color-success)' }}>{t('otp.sent')}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="input"
              style={{ width: 140, letterSpacing: 4, fontSize: '1.1rem' }}
              maxLength={6}
              value={code}
              placeholder="••••••"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.trim().length === 6) void verify();
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || code.trim().length !== 6}
              onClick={verify}
            >
              {busy ? t('otp.verifying') : t('otp.verify')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={requestCode}>
              {t('otp.resend')}
            </button>
          </div>
        </>
      )}
      {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
    </div>
  );
}

function DocumentsDataGrid({
  list,
  userById,
  onDownload,
  onDelete,
}: {
  list: DocumentAdminItem[];
  userById: Map<string, UserOption>;
  onDownload: (d: DocumentAdminItem) => void;
  onDelete: (d: DocumentAdminItem) => void;
}) {
  const { t } = useTranslation(['documents', 'common']);
  const columns = useMemo<GridColDef<DocumentAdminItem>[]>(
    () => [
      {
        field: 'employee',
        headerName: t('col.employee'),
        flex: 1.2,
        minWidth: 180,
        sortable: false,
        valueGetter: (_v, row) =>
          row.user_display_name?.trim() || userById.get(row.user_id)?.email || row.user_id,
        renderCell: (p) => <span className="text-sm">{p.value as string}</span>,
      },
      {
        field: 'category',
        headerName: t('col.category'),
        width: 140,
        type: 'singleSelect',
        valueOptions: DOCUMENT_CATEGORIES.map((c) => ({
          value: c,
          label: t(`category.${c}`),
        })),
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
        width: 160,
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
        width: 110,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <div className="flex gap-1">
            <button
              type="button"
              className="icon-btn"
              title={t('actions.download')}
              aria-label={t('actions.download')}
              onClick={() => onDownload(p.row)}
            >
              <IconDownloadSm />
            </button>
            <IconButton kind="delete" title={t('actions.delete')} onClick={() => onDelete(p.row)} />
          </div>
        ),
      },
    ],
    [t, userById, onDownload, onDelete]
  );

  return (
    <DataGrid<DocumentAdminItem>
      rows={list}
      columns={columns}
      getRowId={(r) => r.id}
      sx={dataGridSx}
      {...dataGridDefaults}
    />
  );
}

function BulkUploadModal({
  users,
  onClose,
  onUploaded,
}: {
  users: UserOption[];
  onClose: () => void;
  onUploaded: (count: number) => void;
}) {
  const { t } = useTranslation(['documents', 'common']);
  useEscapeKey(onClose);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Auto-match a filename to a user by codice fiscale only. The user's full
  // codice fiscale appearing anywhere in the filename — even surrounded by
  // other text, e.g. "LCCMHL93A05L781V_febbraio_2026.pdf" — identifies the
  // employee (case-insensitive substring of the full stored CF). The length
  // guard ignores short/garbage values so a malformed CF can't mis-match a doc
  // to the wrong person. Matricola is intentionally NOT used (too collision-
  // prone); set the codice fiscale per user in Utenti.
  function matchUser(filename: string): { userId: string | null; by: UploadRow['matchedBy'] } {
    const name = filename.toLowerCase();
    for (const u of users) {
      const cf = u.codice_fiscale?.trim().toLowerCase();
      if (cf && cf.length >= 11 && name.includes(cf)) return { userId: u.user_id, by: 'codice_fiscale' };
    }
    return { userId: null, by: null };
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    setErr(null);
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!picked.length) return;
    const next: UploadRow[] = [];
    for (const file of picked) {
      const isPdf =
        file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const tooBig = file.size > MAX_BYTES;
      const { userId, by } = matchUser(file.name);
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${next.length}`,
        file,
        userId,
        matchedBy: by,
        category: 'cedolino',
        // Default title: filename without the .pdf extension.
        title: file.name.replace(/\.pdf$/i, ''),
        status: !isPdf ? 'error' : tooBig ? 'error' : 'pending',
        error: !isPdf ? t('upload.notPdf') : tooBig ? t('upload.tooBig') : undefined,
      });
    }
    setRows((cur) => [...cur, ...next]);
  }

  function updateRow(id: string, patch: Partial<UploadRow>) {
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: string) {
    setRows((cur) => cur.filter((r) => r.id !== id));
  }

  // Rows that are well-formed enough to upload: a valid PDF (status not preset
  // to error) with a target user and a title.
  const uploadable = rows.filter(
    (r) => r.status !== 'error' && r.userId && r.title.trim()
  );
  const hasUnmatched = rows.some((r) => r.status !== 'error' && !r.userId);

  async function uploadOne(row: UploadRow): Promise<boolean> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/pdf',
      Authorization: `Bearer ${getToken()}`,
      'X-Doc-User-Id': row.userId!,
      'X-Doc-Category': row.category,
      'X-Doc-Title': encodeURIComponent(row.title.trim()),
      'X-Doc-Filename': encodeURIComponent(row.file.name),
    };
    const tid = getTenantId();
    if (tid) headers['X-Tenant-Id'] = tid;
    try {
      const r = await fetch(apiUrl('/api/v1/documents'), {
        method: 'POST',
        headers,
        body: row.file,
      });
      if (!r.ok) {
        let msg = t('upload.failed');
        try {
          const parsed = (await r.json()) as { error?: { message?: string } };
          if (parsed?.error?.message) msg = parsed.error.message;
        } catch {
          /* ignore */
        }
        updateRow(row.id, { status: 'error', error: msg });
        return false;
      }
      updateRow(row.id, { status: 'done', error: undefined });
      return true;
    } catch (e) {
      updateRow(row.id, {
        status: 'error',
        error: e instanceof Error ? e.message : t('upload.failed'),
      });
      return false;
    }
  }

  async function confirm() {
    setErr(null);
    setBusy(true);
    // Snapshot the uploadable set so concurrent state edits don't shift it.
    const targets = rows.filter((r) => r.status !== 'error' && r.userId && r.title.trim());
    let ok = 0;
    for (const row of targets) {
      updateRow(row.id, { status: 'uploading', error: undefined });
      const success = await uploadOne(row);
      if (success) ok += 1;
    }
    setBusy(false);
    if (ok === targets.length && ok > 0) {
      onUploaded(ok);
    } else if (ok > 0) {
      // Partial success — keep the modal open so the admin sees which rows
      // failed, but surface the progress.
      setErr(t('upload.partial', { ok, total: targets.length }));
    } else {
      setErr(t('upload.allFailed'));
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <div className="card w-full max-w-3xl space-y-3" style={{ maxHeight: '90vh', overflow: 'auto' }}>
        <h2 className="section-title">{t('upload.title')}</h2>
        <p className="text-xs muted">{t('upload.subtitle')}</p>

        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={onPick}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
            {t('upload.pickFiles')}
          </button>
          {rows.length > 0 && (
            <span className="text-xs muted">{t('upload.fileCount', { count: rows.length })}</span>
          )}
        </div>

        {hasUnmatched && (
          <div className="text-sm" style={{ color: 'var(--color-error)' }}>
            {t('upload.unmatchedHint')}
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-auto" style={{ maxHeight: '50vh' }}>
            <table className="text-sm" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '4px 6px' }}>{t('upload.colFile')}</th>
                  <th style={{ padding: '4px 6px' }}>{t('upload.colEmployee')}</th>
                  <th style={{ padding: '4px 6px' }}>{t('upload.colCategory')}</th>
                  <th style={{ padding: '4px 6px' }}>{t('upload.colTitle')}</th>
                  <th style={{ padding: '4px 6px' }}>{t('upload.colStatus')}</th>
                  <th style={{ padding: '4px 6px' }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--color-outline-variant)' }}>
                    <td style={{ padding: '4px 6px', maxWidth: 180, wordBreak: 'break-all' }}>
                      <span className="text-xs">{r.file.name}</span>
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <select
                        className="input"
                        style={{ minHeight: '1.875rem', fontSize: '0.75rem' }}
                        value={r.userId ?? ''}
                        disabled={r.status === 'error' && !r.userId ? false : busy}
                        onChange={(e) =>
                          updateRow(r.id, { userId: e.target.value || null, matchedBy: null })
                        }
                      >
                        <option value="">{t('upload.pickEmployee')}</option>
                        {users.map((u) => (
                          <option key={u.user_id} value={u.user_id}>
                            {userLabel(u)}
                          </option>
                        ))}
                      </select>
                      {r.matchedBy && (
                        <div className="text-xs muted">
                          {t(`upload.matchedBy.${r.matchedBy}`)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <select
                        className="input"
                        style={{ minHeight: '1.875rem', fontSize: '0.75rem' }}
                        value={r.category}
                        disabled={busy}
                        onChange={(e) =>
                          updateRow(r.id, { category: e.target.value as DocumentCategory })
                        }
                      >
                        {DOCUMENT_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {t(`category.${c}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input
                        type="text"
                        className="input"
                        style={{ minHeight: '1.875rem', fontSize: '0.75rem', minWidth: 140 }}
                        value={r.title}
                        disabled={busy}
                        maxLength={200}
                        onChange={(e) => updateRow(r.id, { title: e.target.value })}
                      />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <RowStatus row={r} />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => removeRow(r.id)}
                        title={t('common:btn.remove')}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {err && (
          <div className="text-sm" style={{ color: 'var(--color-error)' }}>
            {err}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || uploadable.length === 0}
            onClick={confirm}
          >
            {busy
              ? t('upload.uploading')
              : t('upload.confirm', { count: uploadable.length })}
          </button>
        </div>
      </div>
    </div>
  );
}

function RowStatus({ row }: { row: UploadRow }) {
  const { t } = useTranslation(['documents']);
  if (row.status === 'done') return <span className="badge badge-ok">{t('upload.statusDone')}</span>;
  if (row.status === 'uploading')
    return <span className="badge badge-muted">{t('upload.statusUploading')}</span>;
  if (row.status === 'error')
    return (
      <span className="badge badge-warn" title={row.error}>
        {row.error ?? t('upload.statusError')}
      </span>
    );
  if (!row.userId) return <span className="badge badge-warn">{t('upload.statusUnmatched')}</span>;
  return <span className="badge badge-muted">{t('upload.statusReady')}</span>;
}

function IconDownloadSm() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}
