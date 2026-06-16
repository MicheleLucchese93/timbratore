import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef, type GridRowSelectionModel } from '@mui/x-data-grid';
import { api, apiUrl, getToken } from '../lib/api.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';
import { useSession } from '../store/session.ts';
import { IconButton } from '../components/IconButton.tsx';
import { fmtDateTime } from '../i18n/format.ts';

interface UserRow {
  membership_id: string;
  user_id: string;
  email: string;
  role: 'admin' | 'user';
  active: boolean;
  stamp_modes: Array<'gps' | 'remote'>;
  created_at: string;
  last_stamp_at: string | null;
  branch_ids: string[];
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  // Centro Paghe payroll anagrafica (migration 040).
  codice_fiscale: string | null;
  matricola: string | null;
  inail: string | null;
  qualifica: string | null;
  qualifica2: string | null;
}

interface UserPatch {
  first_name?: string | null;
  last_name?: string | null;
  codice_fiscale?: string | null;
  matricola?: string | null;
  inail?: string | null;
  qualifica?: string | null;
  qualifica2?: string | null;
}

interface Usage {
  active_users: number | string;
  active_admins: number | string;
  max_users: number;
  max_admins: number;
}

interface BranchOption {
  id: string;
  name: string;
}

interface ShiftTemplateOption {
  id: string;
  name: string;
}

interface ShiftAssignmentRow {
  id: string;
  user_id: string;
  shift_template_id: string;
  valid_from: string;
  valid_to: string | null;
  template_name: string | null;
}

interface ImportResult {
  processed: number;
  created: number;
  updated: number;
  reactivated: number;
}

export function Users() {
  const { t } = useTranslation(['users', 'common']);
  const me = useSession((s) => s.me);
  const [list, setList] = useState<UserRow[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplateOption[]>([]);
  const [shiftAssignments, setShiftAssignments] = useState<ShiftAssignmentRow[]>([]);
  const [shiftEditor, setShiftEditor] = useState<UserRow | null>(null);
  const [approverEditor, setApproverEditor] = useState<{ user: UserRow; kind: ApproverKind } | null>(
    null
  );
  const [showInvite, setShowInvite] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<UserRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);
  const [branchEditor, setBranchEditor] = useState<UserRow | null>(null);
  const [userEditor, setUserEditor] = useState<UserRow | null>(null);
  const [modesEditor, setModesEditor] = useState<UserRow | null>(null);
  const [rowSelection, setRowSelection] = useState<GridRowSelectionModel>({
    type: 'include',
    ids: new Set<string>(),
  });
  // MUI's "select all" header returns an exclude-model ({type:'exclude', ids:∅}),
  // so resolve the selection against the row list to cover both modes.
  const selectedIdsArray = useMemo(() => {
    const all = list.map((u) => u.user_id);
    return rowSelection.type === 'exclude'
      ? all.filter((id) => !rowSelection.ids.has(id))
      : all.filter((id) => rowSelection.ids.has(id));
  }, [list, rowSelection]);
  const selectedCount = selectedIdsArray.length;
  function clearSelection() {
    setRowSelection({ type: 'include', ids: new Set() });
  }
  const [bulkMode, setBulkMode] = useState<'add' | 'remove' | null>(null);
  const [bulkPanel, setBulkPanel] = useState<
    null | 'reset' | 'shift' | 'modes' | 'leave' | 'correction'
  >(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    const [u, l, b] = await Promise.all([
      api<Usage>('/api/v1/settings/usage'),
      api<UserRow[]>('/api/v1/users'),
      api<BranchOption[]>('/api/v1/branches'),
    ]);
    setUsage(u);
    setList(l);
    setBranches(b);
    // Shifts endpoints may not yet be deployed — tolerate failure.
    const [stRes, saRes] = await Promise.allSettled([
      api<ShiftTemplateOption[]>('/api/v1/shifts/templates'),
      api<ShiftAssignmentRow[]>('/api/v1/shifts/assignments'),
    ]);
    setShiftTemplates(stRes.status === 'fulfilled' ? stRes.value : []);
    setShiftAssignments(saRes.status === 'fulfilled' ? saRes.value : []);
  }

  async function saveShift(
    u: UserRow,
    shift_template_id: string | null,
    valid_from: string
  ) {
    try {
      await api('/api/v1/shifts/assignments', {
        method: 'POST',
        json: { user_id: u.user_id, shift_template_id, valid_from },
      });
      setShiftEditor(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }
  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, []);

  async function toggleActive(u: UserRow) {
    const path = u.active
      ? `/api/v1/users/${u.user_id}/deactivate`
      : `/api/v1/users/${u.user_id}/reactivate`;
    try {
      await api(path, { method: 'POST' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }

  async function deleteUser(u: UserRow) {
    try {
      await api(`/api/v1/users/${u.user_id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }

  async function resetPassword(u: UserRow) {
    setErr(null);
    setInfo(null);
    try {
      await api(`/api/v1/users/${u.user_id}/reset-password`, { method: 'POST' });
      setInfo(t('resetPasswordSent', { email: u.email }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }

  async function saveBranches(u: UserRow, branch_ids: string[]) {
    try {
      await api(`/api/v1/users/${u.user_id}/branches`, {
        method: 'PUT',
        json: { branch_ids },
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }

  async function bulkBranches(branch_ids: string[], mode: 'add' | 'remove') {
    try {
      const user_ids = selectedIdsArray;
      await api(`/api/v1/users/branches/bulk`, {
        method: 'POST',
        json: { user_ids, branch_ids, mode },
      });
      setRowSelection({ type: 'include', ids: new Set() });
      setBulkMode(null);
      const n = branch_ids.length;
      setInfo(
        t(mode === 'add' ? 'bulkBranchesAdded' : 'bulkBranchesRemoved', {
          count: n,
          users: user_ids.length,
        })
      );
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }

  async function bulkResetPassword() {
    setErr(null);
    setInfo(null);
    try {
      const user_ids = selectedIdsArray;
      const r = await api<{ sent: number }>(`/api/v1/users/reset-password/bulk`, {
        method: 'POST',
        json: { user_ids },
      });
      clearSelection();
      setBulkPanel(null);
      setInfo(t('bulkReset.done', { count: r.sent }));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }

  async function bulkShift(shift_template_id: string | null, valid_from: string) {
    setErr(null);
    setInfo(null);
    try {
      const user_ids = selectedIdsArray;
      await api(`/api/v1/shifts/assignments/bulk`, {
        method: 'POST',
        json: { user_ids, shift_template_id, valid_from },
      });
      clearSelection();
      setBulkPanel(null);
      setInfo(t('bulkShift.done', { count: user_ids.length }));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }

  async function bulkApprovers(kind: ApproverKind, approver_user_ids: string[]) {
    setErr(null);
    setInfo(null);
    try {
      const user_ids = selectedIdsArray;
      await api(`/api/v1/users/approvers/bulk`, {
        method: 'POST',
        json: { user_ids, kind, approver_user_ids },
      });
      clearSelection();
      setBulkPanel(null);
      setInfo(t('bulkApprovers.done', { count: user_ids.length }));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }

  async function bulkModes(stamp_modes: Array<'gps' | 'remote'>) {
    setErr(null);
    setInfo(null);
    try {
      const user_ids = selectedIdsArray;
      await api(`/api/v1/users/stamp-modes/bulk`, {
        method: 'POST',
        json: { user_ids, stamp_modes },
      });
      clearSelection();
      setBulkPanel(null);
      setInfo(t('bulkModes.done', { count: user_ids.length }));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }

  async function saveUser(u: UserRow, patch: UserPatch) {
    try {
      await api(`/api/v1/users/${u.user_id}`, { method: 'PATCH', json: patch });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }

  async function setRole(u: UserRow, role: 'admin' | 'user') {
    try {
      await api(`/api/v1/users/${u.user_id}`, { method: 'PATCH', json: { role } });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }

  async function saveModes(u: UserRow, stamp_modes: Array<'gps' | 'remote'>) {
    const prev = u.stamp_modes;
    setList((cur) =>
      cur.map((row) => (row.user_id === u.user_id ? { ...row, stamp_modes } : row))
    );
    try {
      await api(`/api/v1/users/${u.user_id}`, {
        method: 'PATCH',
        json: { stamp_modes },
      });
    } catch (e) {
      setList((cur) =>
        cur.map((row) =>
          row.user_id === u.user_id ? { ...row, stamp_modes: prev } : row
        )
      );
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
  }

  async function exportXlsx() {
    setErr(null);
    setInfo(null);
    try {
      const r = await fetch(apiUrl('/api/v1/users/export.xlsx'), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!r.ok) throw new Error(t('export.failed'));
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = t('export.fileName', { date: new Date().toISOString().slice(0, 10) });
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('export.error'));
    }
  }

  async function onImportFile(e: ChangeEvent<HTMLInputElement>) {
    setErr(null);
    setInfo(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const r = await fetch(apiUrl('/api/v1/users/import'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        body: file,
      });
      const text = await r.text();
      const parsed = text ? JSON.parse(text) : {};
      if (!r.ok) {
        const message = parsed?.error?.message ?? t('import.failed');
        const details = parsed?.error?.details?.errors as
          | Array<{ row: number; message: string }>
          | undefined;
        if (details && details.length) {
          throw new Error(
            `${message}\n${details
              .slice(0, 5)
              .map((d) => t('import.rowError', { row: d.row, message: d.message }))
              .join('\n')}${details.length > 5 ? `\n${t('import.more', { count: details.length - 5 })}` : ''}`
          );
        }
        throw new Error(message);
      }
      const data = parsed.data as ImportResult;
      setInfo(
        t('import.success', {
          processed: data.processed,
          created: data.created,
          reactivated: data.reactivated,
          updated: data.updated,
        })
      );
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('import.error'));
    } finally {
      setImporting(false);
    }
  }

  const usersCount = Number(usage?.active_users ?? 0);
  const adminsCount = Number(usage?.active_admins ?? 0);
  const atUserLimit = !!usage && usersCount >= usage.max_users;
  const atAdminLimit = !!usage && adminsCount >= usage.max_admins;

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-end gap-4 flex-wrap">
        <h1 className="sr-only">{t('heading')}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={onImportFile}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={exportXlsx}
            title={t('toolbar.exportXlsxTitle')}
          >
            {t('toolbar.exportXlsx')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            title={t('toolbar.importXlsxTitle')}
          >
            {importing ? t('toolbar.importing') : t('toolbar.importXlsx')}
          </button>
          <button
            className="btn btn-primary"
            disabled={atUserLimit}
            title={atUserLimit ? t('toolbar.limitReachedTitle') : ''}
            onClick={() => setShowInvite(true)}
          >
            {t('toolbar.invite')}
          </button>
        </div>
      </header>

      {usage && (
        <div className="card flex gap-6 text-sm flex-wrap">
          <div>
            <span className="muted">{t('usage.users')}</span>
            <strong className="num">{usersCount}</strong> / {usage.max_users}
          </div>
          <div>
            <span className="muted">{t('usage.admins')}</span>
            <strong className="num">{adminsCount}</strong> / {usage.max_admins}
          </div>
        </div>
      )}

      {err && (
        <div
          className="card text-sm"
          style={{ color: 'var(--color-error)', whiteSpace: 'pre-wrap' }}
        >
          {err}
        </div>
      )}
      {info && (
        <div className="card text-sm" style={{ color: 'var(--color-success, #166534)' }}>
          {info}
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {selectedCount > 0 && (
          <div className="bulk-bar">
            <div>
              <strong>{selectedCount}</strong>{' '}
              {t('bulkBar.selected', { count: selectedCount })}
            </div>
            <div className="bulk-bar-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setBulkMode('add')}
              >
                {t('bulkBar.assignBranches')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setBulkMode('remove')}
              >
                {t('bulkBar.removeBranches')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setBulkPanel('shift')}
              >
                {t('bulkBar.assignShift')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setBulkPanel('modes')}
              >
                {t('bulkBar.stampModes')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setBulkPanel('leave')}
              >
                {t('bulkBar.leaveApprovers')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setBulkPanel('correction')}
              >
                {t('bulkBar.correctionApprovers')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setBulkPanel('reset')}
              >
                {t('bulkBar.resetPassword')}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={clearSelection}
              >
                {t('common:btn.cancel')}
              </button>
            </div>
          </div>
        )}
        <UsersDataGrid
          list={list}
          me={me}
          adminsCount={adminsCount}
          atAdminLimit={atAdminLimit}
          maxAdmins={usage?.max_admins}
          shiftAssignments={shiftAssignments}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          onSetRole={setRole}
          onEditModes={setModesEditor}
          onEditBranches={setBranchEditor}
          onEditShift={setShiftEditor}
          onEditApprovers={(user, kind) => setApproverEditor({ user, kind })}
          onEditUser={setUserEditor}
          onResetPassword={resetPassword}
          onToggleActive={(u) => (u.active ? setConfirmDeactivate(u) : toggleActive(u))}
          onDelete={setConfirmDelete}
        />
      </div>

      {showInvite && (
        <InviteForm
          branches={branches}
          onClose={() => setShowInvite(false)}
          onInvited={async () => {
            setShowInvite(false);
            setInfo(t('invite.createdNoEmail'));
            await load();
          }}
        />
      )}

      {confirmDeactivate && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
          <div className="card w-full max-w-md space-y-3">
            <h2 className="section-title">{t('confirmDeactivate.title')}</h2>
            <p className="text-sm muted">
              {t('confirmDeactivate.messagePre')} <strong>{confirmDeactivate.email}</strong>{' '}
              {t('confirmDeactivate.messagePost')}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmDeactivate(null)}
              >
                {t('common:btn.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const target = confirmDeactivate;
                  setConfirmDeactivate(null);
                  await toggleActive(target);
                }}
              >
                {t('confirmDeactivate.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
          <div className="card w-full max-w-md space-y-3">
            <h2 className="section-title">{t('confirmDelete.title')}</h2>
            <p className="text-sm muted">
              {t('confirmDelete.messagePre')} <strong>{confirmDelete.email}</strong>{' '}
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
                  await deleteUser(target);
                }}
              >
                {t('common:btn.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {branchEditor && (
        <BranchEditor
          user={branchEditor}
          branches={branches}
          onClose={() => setBranchEditor(null)}
          onSave={async (ids) => {
            const target = branchEditor;
            setBranchEditor(null);
            await saveBranches(target, ids);
          }}
        />
      )}

      {bulkMode && (
        <BulkBranchesDialog
          mode={bulkMode}
          count={selectedCount}
          branches={branches}
          onClose={() => setBulkMode(null)}
          onConfirm={(ids) => bulkBranches(ids, bulkMode)}
        />
      )}

      {bulkPanel === 'reset' && (
        <BulkResetDialog
          count={selectedCount}
          onClose={() => setBulkPanel(null)}
          onConfirm={bulkResetPassword}
        />
      )}

      {bulkPanel === 'shift' && (
        <BulkShiftDialog
          count={selectedCount}
          templates={shiftTemplates}
          onClose={() => setBulkPanel(null)}
          onConfirm={bulkShift}
        />
      )}

      {bulkPanel === 'modes' && (
        <BulkModesDialog
          count={selectedCount}
          onClose={() => setBulkPanel(null)}
          onConfirm={bulkModes}
        />
      )}

      {(bulkPanel === 'leave' || bulkPanel === 'correction') && (
        <BulkApproversDialog
          kind={bulkPanel}
          count={selectedCount}
          allUsers={list.filter((u) => u.active)}
          onClose={() => setBulkPanel(null)}
          onConfirm={(ids) => bulkApprovers(bulkPanel as ApproverKind, ids)}
        />
      )}

      {userEditor && (
        <UserEditor
          user={userEditor}
          onClose={() => setUserEditor(null)}
          onSave={async (patch) => {
            const target = userEditor;
            setUserEditor(null);
            await saveUser(target, patch);
          }}
        />
      )}

      {modesEditor && (
        <ModesEditor
          user={modesEditor}
          onClose={() => setModesEditor(null)}
          onSave={async (modes) => {
            const target = modesEditor;
            setModesEditor(null);
            await saveModes(target, modes);
          }}
        />
      )}

      {shiftEditor && (
        <ShiftAssignEditor
          user={shiftEditor}
          templates={shiftTemplates}
          current={
            shiftAssignments.find(
              (a) => a.user_id === shiftEditor.user_id && a.valid_to === null
            ) ?? null
          }
          onClose={() => setShiftEditor(null)}
          onSave={(templateId, validFrom) => saveShift(shiftEditor, templateId, validFrom)}
        />
      )}

      {approverEditor && (
        <ApproverEditor
          user={approverEditor.user}
          kind={approverEditor.kind}
          allUsers={list.filter((u) => u.user_id !== approverEditor.user.user_id && u.active)}
          onClose={() => setApproverEditor(null)}
          onSaved={() => setApproverEditor(null)}
        />
      )}
    </div>
  );
}

type ApproverKind = 'leave' | 'correction';

const APPROVER_KIND_META: Record<
  ApproverKind,
  { path: string; suffixKey: string; explainerKey: string }
> = {
  leave: {
    path: 'approvers',
    suffixKey: 'approver.leaveSuffix',
    explainerKey: 'approver.leaveExplainer',
  },
  correction: {
    path: 'correction-approvers',
    suffixKey: 'approver.correctionSuffix',
    explainerKey: 'approver.correctionExplainer',
  },
};

function ApproverEditor({
  user,
  kind,
  allUsers,
  onClose,
  onSaved,
}: {
  user: UserRow;
  kind: ApproverKind;
  allUsers: UserRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['users', 'common']);
  const meta = APPROVER_KIND_META[kind];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<Array<{ user_id: string }>>(
          `/api/v1/users/${user.user_id}/${meta.path}`
        );
        setSelected(new Set(r.map((row) => row.user_id)));
      } catch (e) {
        setErr(e instanceof Error ? e.message : t('errorGeneric'));
      } finally {
        setLoading(false);
      }
    })();
  }, [user.user_id, meta.path]);

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/v1/users/${user.user_id}/${meta.path}`, {
        method: 'PUT',
        json: { approver_user_ids: Array.from(selected) },
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <div className="card w-full max-w-md space-y-3">
        <h2 className="section-title">
          {t('approver.title', {
            suffix: t(meta.suffixKey),
            name: user.display_name || user.email,
          })}
        </h2>
        <p className="text-xs muted">{t(meta.explainerKey)}</p>
        {loading ? (
          <div className="text-sm muted">{t('common:state.loading')}</div>
        ) : allUsers.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            {t('approver.noUsers')}
          </p>
        ) : (
          <ul
            className="space-y-2 max-h-72 overflow-auto"
            style={{ paddingLeft: 0, listStyle: 'none' }}
          >
            {allUsers.map((u) => (
              <li key={u.user_id}>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(u.user_id)}
                    onChange={() => toggle(u.user_id)}
                  />
                  <span>{u.display_name || u.email}</span>
                  <span className="muted text-xs">
                    {u.role === 'admin' ? t('approver.roleAdmin') : t('approver.roleUser')}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {err && (
          <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
        )}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? t('common:state.saving') : t('common:btn.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ShiftAssignEditor({
  user,
  templates,
  current,
  onClose,
  onSave,
}: {
  user: UserRow;
  templates: ShiftTemplateOption[];
  current: ShiftAssignmentRow | null;
  onClose: () => void;
  onSave: (templateId: string | null, validFrom: string) => Promise<void> | void;
}) {
  const { t } = useTranslation(['users', 'common']);
  const [templateId, setTemplateId] = useState<string>(current?.shift_template_id ?? '');
  const [validFrom, setValidFrom] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await onSave(templateId || null, validFrom);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-md space-y-4"
      >
        <h2 className="text-lg font-semibold">{t('shift.title', { name: user.display_name || user.email })}</h2>

        <div>
          <label className="label">{t('shift.label')}</label>
          <select
            className="input"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">{t('shift.none')}</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </select>
          {templates.length === 0 && (
            <p className="text-xs text-neutral-500 mt-1">
              {t('shift.emptyHintPre')} <strong>{t('shift.emptyHintLink')}</strong> {t('shift.emptyHintPost')}
            </p>
          )}
        </div>

        <div>
          <label className="label">{t('shift.validFrom')}</label>
          <input
            type="date"
            className="input"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
          <p className="text-xs text-neutral-500 mt-1">
            {t('shift.validFromHint')}
          </p>
        </div>

        {err && (
          <div className="text-sm" style={{ color: 'var(--color-error)' }}>
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common:btn.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('common:state.saving') : t('common:btn.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

function UserEditor({
  user,
  onClose,
  onSave,
}: {
  user: UserRow;
  onClose: () => void;
  onSave: (patch: UserPatch) => Promise<void> | void;
}) {
  const { t } = useTranslation(['users', 'common']);
  const [firstName, setFirstName] = useState(user.first_name ?? '');
  const [lastName, setLastName] = useState(user.last_name ?? '');
  const [codiceFiscale, setCodiceFiscale] = useState(user.codice_fiscale ?? '');
  const [matricola, setMatricola] = useState(user.matricola ?? '');
  const [inail, setInail] = useState(user.inail ?? '');
  const [qualifica, setQualifica] = useState(user.qualifica ?? '');
  const [qualifica2, setQualifica2] = useState(user.qualifica2 ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave({
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        codice_fiscale: codiceFiscale.trim().toUpperCase() || null,
        matricola: matricola.trim() || null,
        inail: inail.trim().toUpperCase() || null,
        qualifica: qualifica.trim().toUpperCase() || null,
        qualifica2: qualifica2.trim().toUpperCase() || null,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-md space-y-3">
        <h2 className="section-title">{t('userEditor.title')}</h2>
        <p className="text-xs muted">
          {t('userEditor.emailHint', { email: user.email })}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">{t('userEditor.firstName')}</label>
            <input
              type="text"
              className="input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              maxLength={80}
              autoFocus
            />
          </div>
          <div>
            <label className="label">{t('userEditor.lastName')}</label>
            <input
              type="text"
              className="input"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              maxLength={80}
            />
          </div>
        </div>

        <div className="hairline my-1" />
        <p className="text-xs muted">{t('userEditor.anagraficaHint')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">{t('userEditor.codiceFiscale')}</label>
            <input
              type="text"
              className="input num"
              value={codiceFiscale}
              onChange={(e) => setCodiceFiscale(e.target.value.toUpperCase())}
              maxLength={16}
              style={{ textTransform: 'uppercase' }}
            />
          </div>
          <div>
            <label className="label">{t('userEditor.matricola')}</label>
            <input
              type="text"
              inputMode="numeric"
              className="input num"
              value={matricola}
              onChange={(e) => setMatricola(e.target.value.replace(/\D/g, '').slice(0, 4))}
              maxLength={4}
              placeholder="0000"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">{t('userEditor.inail')}</label>
            <input
              type="text"
              className="input num"
              value={inail}
              onChange={(e) => setInail(e.target.value.toUpperCase().slice(0, 1))}
              maxLength={1}
            />
          </div>
          <div>
            <label className="label">{t('userEditor.qualifica')}</label>
            <input
              type="text"
              className="input num"
              value={qualifica}
              onChange={(e) => setQualifica(e.target.value.toUpperCase().slice(0, 1))}
              maxLength={1}
            />
          </div>
          <div>
            <label className="label">{t('userEditor.qualifica2')}</label>
            <input
              type="text"
              className="input num"
              value={qualifica2}
              onChange={(e) => setQualifica2(e.target.value.toUpperCase().slice(0, 1))}
              maxLength={1}
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('common:state.saving') : t('common:btn.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

function BulkBranchesDialog({
  mode,
  count,
  branches,
  onClose,
  onConfirm,
}: {
  mode: 'add' | 'remove';
  count: number;
  branches: BranchOption[];
  onClose: () => void;
  onConfirm: (ids: string[]) => Promise<void> | void;
}) {
  const { t } = useTranslation(['users', 'common']);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const title = mode === 'add' ? t('bulk.addTitle') : t('bulk.removeTitle');
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <div className="card w-full max-w-md space-y-3">
        <h2 className="section-title">{title}</h2>
        <p className="text-xs muted">
          {t(mode === 'add' ? 'bulk.messageAdded' : 'bulk.messageRemoved', { count })}
        </p>
        {branches.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            {t('bulk.noBranches')}
          </p>
        ) : (
          <ul
            className="space-y-2 max-h-72 overflow-auto"
            style={{ paddingLeft: 0, listStyle: 'none' }}
          >
            {branches.map((b) => (
              <li key={b.id}>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={picked.has(b.id)}
                    onChange={() =>
                      setPicked((cur) => {
                        const next = new Set(cur);
                        if (next.has(b.id)) next.delete(b.id);
                        else next.add(b.id);
                        return next;
                      })
                    }
                  />
                  <span>{b.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button
            type="button"
            className={mode === 'remove' ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={busy || picked.size === 0}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(Array.from(picked));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('common:state.saving') : mode === 'add' ? t('bulk.assign') : t('bulk.remove')}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkResetDialog({
  count,
  onClose,
  onConfirm,
}: {
  count: number;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const { t } = useTranslation(['users', 'common']);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <div className="card w-full max-w-md space-y-3">
        <h2 className="section-title">{t('bulkReset.title')}</h2>
        <p className="text-sm muted">{t('bulkReset.message', { count })}</p>
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('common:state.saving') : t('bulkReset.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkShiftDialog({
  count,
  templates,
  onClose,
  onConfirm,
}: {
  count: number;
  templates: ShiftTemplateOption[];
  onClose: () => void;
  onConfirm: (templateId: string | null, validFrom: string) => Promise<void> | void;
}) {
  const { t } = useTranslation(['users', 'common']);
  const [templateId, setTemplateId] = useState('');
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <div className="card w-full max-w-md space-y-4">
        <h2 className="section-title">{t('bulkShift.title')}</h2>
        <p className="text-xs muted">{t('bulkShift.message', { count })}</p>
        <div>
          <label className="label">{t('shift.label')}</label>
          <select
            className="input"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">{t('shift.none')}</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('shift.validFrom')}</label>
          <input
            type="date"
            className="input"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
          <p className="text-xs text-neutral-500 mt-1">{t('shift.validFromHint')}</p>
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(templateId || null, validFrom);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('common:state.saving') : t('common:btn.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkModesDialog({
  count,
  onClose,
  onConfirm,
}: {
  count: number;
  onClose: () => void;
  onConfirm: (modes: Array<'gps' | 'remote'>) => Promise<void> | void;
}) {
  const { t } = useTranslation(['users', 'common']);
  const [gps, setGps] = useState(false);
  const [remote, setRemote] = useState(false);
  const [busy, setBusy] = useState(false);
  const modes: Array<'gps' | 'remote'> = [
    ...(gps ? (['gps'] as const) : []),
    ...(remote ? (['remote'] as const) : []),
  ];
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <div className="card w-full max-w-md space-y-3">
        <h2 className="section-title">{t('bulkModes.title')}</h2>
        <p className="text-xs muted">{t('bulkModes.message', { count })}</p>
        <ul className="space-y-2" style={{ paddingLeft: 0, listStyle: 'none' }}>
          <li>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={gps} onChange={(e) => setGps(e.target.checked)} />
              <span>
                <strong>{t('modes.gpsLabel')}</strong> {t('modes.gpsDesc')}
              </span>
            </label>
          </li>
          <li>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={remote}
                onChange={(e) => setRemote(e.target.checked)}
              />
              <span>
                <strong>{t('modes.remoteLabel')}</strong> {t('modes.remoteDesc')}
              </span>
            </label>
          </li>
        </ul>
        {modes.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            {t('bulkModes.noneSelected')}
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(modes);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('common:state.saving') : t('common:btn.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkApproversDialog({
  kind,
  count,
  allUsers,
  onClose,
  onConfirm,
}: {
  kind: ApproverKind;
  count: number;
  allUsers: UserRow[];
  onClose: () => void;
  onConfirm: (ids: string[]) => Promise<void> | void;
}) {
  const { t } = useTranslation(['users', 'common']);
  const meta = APPROVER_KIND_META[kind];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <div className="card w-full max-w-md space-y-3">
        <h2 className="section-title">
          {t('bulkApprovers.title', { suffix: t(meta.suffixKey), count })}
        </h2>
        <p className="text-xs muted">{t('bulkApprovers.message', { count })}</p>
        {allUsers.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            {t('approver.noUsers')}
          </p>
        ) : (
          <ul
            className="space-y-2 max-h-72 overflow-auto"
            style={{ paddingLeft: 0, listStyle: 'none' }}
          >
            {allUsers.map((u) => (
              <li key={u.user_id}>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(u.user_id)}
                    onChange={() => toggle(u.user_id)}
                  />
                  <span>{u.display_name || u.email}</span>
                  <span className="muted text-xs">
                    {u.role === 'admin' ? t('approver.roleAdmin') : t('approver.roleUser')}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(Array.from(selected));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('common:state.saving') : t('common:btn.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModesEditor({
  user,
  onClose,
  onSave,
}: {
  user: UserRow;
  onClose: () => void;
  onSave: (modes: Array<'gps' | 'remote'>) => Promise<void> | void;
}) {
  const { t } = useTranslation(['users', 'common']);
  const [gps, setGps] = useState(user.stamp_modes?.includes('gps') ?? false);
  const [remote, setRemote] = useState(user.stamp_modes?.includes('remote') ?? false);
  const [busy, setBusy] = useState(false);

  const modes: Array<'gps' | 'remote'> = [
    ...(gps ? (['gps'] as const) : []),
    ...(remote ? (['remote'] as const) : []),
  ];

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <div className="card w-full max-w-md space-y-3">
        <h2 className="section-title">
          {t('modes.title', { name: user.display_name || user.email })}
        </h2>
        <p className="text-xs muted">
          {t('modes.explainer')}
        </p>
        <ul className="space-y-2" style={{ paddingLeft: 0, listStyle: 'none' }}>
          <li>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={gps} onChange={(e) => setGps(e.target.checked)} />
              <span>
                <strong>{t('modes.gpsLabel')}</strong> {t('modes.gpsDesc')}
              </span>
            </label>
          </li>
          <li>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={remote}
                onChange={(e) => setRemote(e.target.checked)}
              />
              <span>
                <strong>{t('modes.remoteLabel')}</strong> {t('modes.remoteDesc')}
              </span>
            </label>
          </li>
        </ul>
        {modes.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            {t('modes.noneSelected')}
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(modes);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('common:state.saving') : t('common:btn.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function BranchEditor({
  user,
  branches,
  onClose,
  onSave,
}: {
  user: UserRow;
  branches: BranchOption[];
  onClose: () => void;
  onSave: (ids: string[]) => Promise<void> | void;
}) {
  const { t } = useTranslation(['users', 'common']);
  const [selected, setSelected] = useState<Set<string>>(new Set(user.branch_ids ?? []));
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <div className="card w-full max-w-md space-y-3">
        <h2 className="section-title">{t('branchEditor.title', { email: user.email })}</h2>
        <p className="text-xs muted">
          {t('branchEditor.explainer')}
        </p>
        {branches.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            {t('branchEditor.empty')}
          </p>
        ) : (
          <ul className="space-y-2 max-h-72 overflow-auto" style={{ paddingLeft: 0, listStyle: 'none' }}>
            {branches.map((b) => (
              <li key={b.id}>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(b.id)}
                    onChange={() => toggle(b.id)}
                  />
                  <span>{b.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(Array.from(selected));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('common:state.saving') : t('common:btn.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function InviteForm({
  branches,
  onClose,
  onInvited,
}: {
  branches: BranchOption[];
  onClose: () => void;
  onInvited: () => void;
}) {
  const { t } = useTranslation(['users', 'common']);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [branchIds, setBranchIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleBranch(id: string) {
    setBranchIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/v1/users/invite', {
        method: 'POST',
        json: {
          email,
          role,
          first_name: firstName.trim() || undefined,
          last_name: lastName.trim() || undefined,
          branch_ids: Array.from(branchIds),
        },
      });
      onInvited();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-md space-y-3">
        <h2 className="section-title">{t('invite.title')}</h2>
        <p className="text-xs muted">{t('invite.subtitle')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">{t('invite.firstName')} <span className="muted">{t('invite.optional')}</span></label>
            <input
              type="text"
              className="input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              maxLength={80}
            />
          </div>
          <div>
            <label className="label">{t('invite.lastName')} <span className="muted">{t('invite.optional')}</span></label>
            <input
              type="text"
              className="input"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              maxLength={80}
            />
          </div>
        </div>
        <div>
          <label className="label">{t('invite.email')}</label>
          <input type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">{t('invite.role')}</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')}>
            <option value="user">{t('invite.roleUser')}</option>
            <option value="admin">{t('common:role.admin')}</option>
          </select>
        </div>
        <div>
          <label className="label">{t('invite.branches')}</label>
          {branches.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-error)' }}>
              {t('invite.noBranches')}
            </p>
          ) : (
            <ul className="space-y-1 max-h-48 overflow-auto" style={{ paddingLeft: 0, listStyle: 'none' }}>
              {branches.map((b) => (
                <li key={b.id}>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={branchIds.has(b.id)}
                      onChange={() => toggleBranch(b.id)}
                    />
                    <span>{b.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs muted mt-1">{t('invite.branchesHint')}</p>
        </div>
        {err && <div className="rounded-md px-3 py-2 text-sm" style={{ background: '#fde4e4', color: 'var(--color-error)' }}>{err}</div>}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t('common:btn.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('invite.sending') : t('invite.submit')}</button>
        </div>
      </form>
    </div>
  );
}

interface UsersDataGridProps {
  list: UserRow[];
  me: ReturnType<typeof useSession.getState>['me'];
  adminsCount: number;
  atAdminLimit: boolean;
  maxAdmins: number | undefined;
  shiftAssignments: ShiftAssignmentRow[];
  rowSelection: GridRowSelectionModel;
  onRowSelectionChange: (m: GridRowSelectionModel) => void;
  onSetRole: (u: UserRow, role: 'admin' | 'user') => void;
  onEditModes: (u: UserRow) => void;
  onEditBranches: (u: UserRow) => void;
  onEditShift: (u: UserRow) => void;
  onEditApprovers: (u: UserRow, kind: ApproverKind) => void;
  onEditUser: (u: UserRow) => void;
  onResetPassword: (u: UserRow) => void;
  onToggleActive: (u: UserRow) => void;
  onDelete: (u: UserRow) => void;
}

function UsersDataGrid({
  list,
  me,
  adminsCount,
  atAdminLimit,
  maxAdmins,
  shiftAssignments,
  rowSelection,
  onRowSelectionChange,
  onSetRole,
  onEditModes,
  onEditBranches,
  onEditShift,
  onEditApprovers,
  onEditUser,
  onResetPassword,
  onToggleActive,
  onDelete,
}: UsersDataGridProps) {
  const { t } = useTranslation(['users', 'common']);
  const columns = useMemo<GridColDef<UserRow>[]>(
    () => [
      { field: 'email', headerName: t('col.email'), flex: 1.4, minWidth: 200 },
      {
        field: 'first_name',
        headerName: t('col.firstName'),
        flex: 0.8,
        minWidth: 120,
        valueGetter: (_v, row) => row.first_name?.trim() ?? '',
        renderCell: (p) =>
          p.value || <span style={{ color: 'var(--color-on-surface-variant)' }}>—</span>,
      },
      {
        field: 'last_name',
        headerName: t('col.lastName'),
        flex: 0.8,
        minWidth: 120,
        valueGetter: (_v, row) => row.last_name?.trim() ?? '',
        renderCell: (p) =>
          p.value || <span style={{ color: 'var(--color-on-surface-variant)' }}>—</span>,
      },
      {
        field: 'codice_fiscale',
        headerName: t('col.codiceFiscale'),
        flex: 0.9,
        minWidth: 150,
        valueGetter: (_v, row) => row.codice_fiscale?.trim() ?? '',
        renderCell: (p) =>
          p.value ? (
            <span className="num">{p.value}</span>
          ) : (
            <span style={{ color: 'var(--color-on-surface-variant)' }}>—</span>
          ),
      },
      {
        field: 'role',
        headerName: t('col.role'),
        width: 130,
        type: 'singleSelect',
        valueOptions: [
          { value: 'user', label: t('role.userShort') },
          { value: 'admin', label: t('role.adminShort') },
        ],
        renderCell: (p) => {
          const u = p.row;
          return (
            <select
              className="input"
              style={{ minHeight: '1.875rem', padding: '0 0.5rem', fontSize: '0.75rem' }}
              value={u.role}
              onChange={(e) => onSetRole(u, e.target.value as 'admin' | 'user')}
              disabled={u.user_id === me?.user.id}
              title={
                u.user_id === me?.user.id
                  ? t('grid.selfRoleTitle')
                  : atAdminLimit && u.role !== 'admin'
                    ? t('grid.adminLimitTitle', { count: adminsCount, max: maxAdmins })
                    : undefined
              }
            >
              <option value="user">{t('role.userShort')}</option>
              <option value="admin" disabled={atAdminLimit && u.role !== 'admin'}>
                {t('role.adminShort')}
              </option>
            </select>
          );
        },
      },
      {
        field: 'active',
        headerName: t('col.state'),
        width: 110,
        type: 'boolean',
        align: 'left',
        headerAlign: 'left',
        renderCell: (p) =>
          p.value ? (
            <span className="badge badge-ok">{t('state.active')}</span>
          ) : (
            <span className="badge badge-muted">{t('state.inactive')}</span>
          ),
      },
      {
        field: 'branch_ids',
        headerName: t('col.branches'),
        width: 160,
        sortable: false,
        filterable: false,
        valueGetter: (_v, row) => (row.branch_ids ?? []).length,
        renderCell: (p) => {
          const n = p.value as number;
          return (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onEditBranches(p.row)}
              title={t('grid.branchesTitle')}
            >
              {n === 0 ? (
                <span style={{ color: 'var(--color-error)' }}>{t('grid.branchesNone')}</span>
              ) : (
                t('grid.branchesCount', { count: n })
              )}
            </button>
          );
        },
      },
      {
        field: 'shift',
        headerName: t('col.shift'),
        width: 170,
        sortable: false,
        filterable: false,
        valueGetter: (_v, row) => {
          const a = shiftAssignments.find(
            (x) => x.user_id === row.user_id && x.valid_to === null
          );
          return a?.template_name ?? '';
        },
        renderCell: (p) => (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onEditShift(p.row)}
            title={t('grid.shiftTitle')}
          >
            {p.value ? (
              p.value
            ) : (
              <span style={{ color: 'var(--color-error)' }}>{t('grid.shiftNone')}</span>
            )}
          </button>
        ),
      },
      {
        field: 'stamp_modes',
        headerName: t('col.stampModes'),
        width: 180,
        sortable: false,
        filterable: false,
        valueGetter: (_v, row) => (row.stamp_modes ?? []).join(','),
        renderCell: (p) => {
          const modes = p.row.stamp_modes ?? [];
          const label =
            modes.length === 0
              ? t('grid.modesNone')
              : modes.map((m) => (m === 'gps' ? t('modes.gpsLabel') : t('grid.modeRemote'))).join(' · ');
          return (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onEditModes(p.row)}
              title={t('grid.modesTitle')}
            >
              {modes.length === 0 ? (
                <span style={{ color: 'var(--color-error)' }}>{t('grid.modesEdit', { label })}</span>
              ) : (
                t('grid.modesEdit', { label })
              )}
            </button>
          );
        },
      },
      {
        field: 'leave_approvers',
        headerName: t('col.leaveApprovers'),
        width: 150,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onEditApprovers(p.row, 'leave')}
            title={t('grid.leaveApproversTitle')}
          >
            {t('grid.approversEdit')}
          </button>
        ),
      },
      {
        field: 'correction_approvers',
        headerName: t('col.correctionApprovers'),
        width: 170,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onEditApprovers(p.row, 'correction')}
            title={t('grid.correctionApproversTitle')}
          >
            {t('grid.approversEdit')}
          </button>
        ),
      },
      {
        field: 'last_stamp_at',
        headerName: t('col.lastStamp'),
        width: 170,
        type: 'dateTime',
        valueGetter: (_v, row) => (row.last_stamp_at ? new Date(row.last_stamp_at) : null),
        renderCell: (p) =>
          p.value ? (
            <span className="text-xs num">{fmtDateTime(p.value as Date)}</span>
          ) : (
            <span className="text-xs num">—</span>
          ),
      },
      {
        field: 'actions',
        headerName: t('col.actions'),
        width: 160,
        sortable: false,
        filterable: false,
        renderCell: (p) => {
          const u = p.row;
          const isSelf = u.user_id === me?.user.id;
          return (
            <div className="flex gap-1">
              <IconButton
                kind="edit"
                title={t('actions.editName')}
                onClick={() => onEditUser(u)}
              />
              <IconButton
                kind="reset-password"
                title={t('actions.resetPassword')}
                onClick={() => onResetPassword(u)}
              />
              <IconButton
                kind={u.active ? 'deactivate' : 'reactivate'}
                disabled={isSelf}
                title={
                  isSelf
                    ? t('actions.cannotDeactivateSelf')
                    : u.active
                    ? t('actions.deactivate')
                    : t('actions.reactivate')
                }
                onClick={() => onToggleActive(u)}
              />
              <IconButton
                kind="delete"
                disabled={isSelf}
                title={
                  isSelf
                    ? t('actions.cannotDeleteSelf')
                    : t('actions.delete')
                }
                onClick={() => onDelete(u)}
              />
            </div>
          );
        },
      },
    ],
    [
      t,
      adminsCount,
      atAdminLimit,
      maxAdmins,
      me?.user.id,
      shiftAssignments,
      onSetRole,
      onEditModes,
      onEditBranches,
      onEditShift,
      onEditApprovers,
      onEditUser,
      onResetPassword,
      onToggleActive,
      onDelete,
    ]
  );

  return (
    <DataGrid<UserRow>
      rows={list}
      columns={columns}
      getRowId={(r) => r.user_id}
      checkboxSelection
      rowSelectionModel={rowSelection}
      onRowSelectionModelChange={onRowSelectionChange}
      sx={dataGridSx}
      {...dataGridDefaults}
    />
  );
}
