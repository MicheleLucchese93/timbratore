import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, type GridColDef, type GridRowSelectionModel } from '@mui/x-data-grid';
import { api, apiUrl, getToken } from '../lib/api.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';
import { useSession } from '../store/session.ts';
import { IconButton } from '../components/IconButton.tsx';

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
  const selectedCount = rowSelection.ids.size;
  const selectedIdsArray = useMemo(
    () => Array.from(rowSelection.ids) as string[],
    [rowSelection]
  );
  const [bulkMode, setBulkMode] = useState<'add' | 'remove' | null>(null);
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
      setErr(e instanceof Error ? e.message : 'errore');
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
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  async function deleteUser(u: UserRow) {
    try {
      await api(`/api/v1/users/${u.user_id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  async function resetPassword(u: UserRow) {
    setErr(null);
    setInfo(null);
    try {
      await api(`/api/v1/users/${u.user_id}/reset-password`, { method: 'POST' });
      setInfo(`Email per reimpostare la password inviata a ${u.email}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
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
      setErr(e instanceof Error ? e.message : 'errore');
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
      const verb = mode === 'add' ? 'assegnate' : 'rimosse';
      const n = branch_ids.length;
      setInfo(`${n} ${n === 1 ? 'sede' : 'sedi'} ${verb} a ${user_ids.length} utenti.`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  async function saveUser(u: UserRow, patch: { first_name?: string | null; last_name?: string | null }) {
    try {
      await api(`/api/v1/users/${u.user_id}`, { method: 'PATCH', json: patch });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  async function setRole(u: UserRow, role: 'admin' | 'user') {
    try {
      await api(`/api/v1/users/${u.user_id}`, { method: 'PATCH', json: { role } });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
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
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  async function exportXlsx() {
    setErr(null);
    setInfo(null);
    try {
      const r = await fetch(apiUrl('/api/v1/users/export.xlsx'), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!r.ok) throw new Error('Export fallito');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `utenti_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore export');
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
        const message = parsed?.error?.message ?? 'Import fallito';
        const details = parsed?.error?.details?.errors as
          | Array<{ row: number; message: string }>
          | undefined;
        if (details && details.length) {
          throw new Error(
            `${message}\n${details
              .slice(0, 5)
              .map((d) => `riga ${d.row}: ${d.message}`)
              .join('\n')}${details.length > 5 ? `\n… +${details.length - 5} altri` : ''}`
          );
        }
        throw new Error(message);
      }
      const data = parsed.data as ImportResult;
      setInfo(
        `Importate ${data.processed} righe — ${data.created} nuove, ${data.reactivated} riattivate, ${data.updated} aggiornate.`
      );
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore import');
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
        <h1 className="sr-only">Utenti</h1>
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
            title="Scarica l'elenco utenti in formato Excel"
          >
            Esporta XLSX
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            title="Carica un file Excel per creare/aggiornare più utenti — chiave: email"
          >
            {importing ? 'Importazione…' : 'Importa XLSX'}
          </button>
          <button
            className="btn btn-primary"
            disabled={atUserLimit}
            title={atUserLimit ? 'Limite raggiunto — contatta supporto' : ''}
            onClick={() => setShowInvite(true)}
          >
            Invita utente
          </button>
        </div>
      </header>

      {usage && (
        <div className="card flex gap-6 text-sm flex-wrap">
          <div>
            <span className="muted">Utenti: </span>
            <strong className="num">{usersCount}</strong> / {usage.max_users}
          </div>
          <div>
            <span className="muted">Amministratori: </span>
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
              {selectedCount === 1 ? 'utente selezionato' : 'utenti selezionati'}
            </div>
            <div className="bulk-bar-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setBulkMode('add')}
              >
                Assegna sedi
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setBulkMode('remove')}
              >
                Rimuovi sedi
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setRowSelection({ type: 'include', ids: new Set() })}
              >
                Annulla
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
          onInvited={async () => { setShowInvite(false); await load(); }}
        />
      )}

      {confirmDeactivate && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
          <div className="card w-full max-w-md space-y-3">
            <h2 className="section-title">Disattivare utente?</h2>
            <p className="text-sm muted">
              L'utente <strong>{confirmDeactivate.email}</strong> non potrà più accedere finché non sarà
              riattivato. Il posto rimane occupato — per liberarlo elimina l'utente.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmDeactivate(null)}
              >
                Annulla
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
                Disattiva
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
          <div className="card w-full max-w-md space-y-3">
            <h2 className="section-title">Eliminare utente?</h2>
            <p className="text-sm muted">
              L'utente <strong>{confirmDelete.email}</strong> verrà rimosso dall'azienda e il posto
              sarà liberato. Le timbrature passate restano per legge. L'azione non è reversibile —
              per riattivarlo dovrai invitarlo di nuovo.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmDelete(null)}
              >
                Annulla
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
                Elimina
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
  { path: string; titleSuffix: string; explainer: string }
> = {
  leave: {
    path: 'approvers',
    titleSuffix: 'ferie/permessi',
    explainer:
      'Solo gli utenti selezionati possono approvare ferie/permessi di questo dipendente. ' +
      'Se nessuno è configurato, gli admin possono decidere. Vince il primo che decide.',
  },
  correction: {
    path: 'correction-approvers',
    titleSuffix: 'correzioni',
    explainer:
      'Solo gli utenti selezionati possono approvare le richieste di correzione timbrature di questo dipendente. ' +
      'Se nessuno è configurato, gli admin possono decidere. Vince il primo che decide.',
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
        setErr(e instanceof Error ? e.message : 'errore');
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
      setErr(e instanceof Error ? e.message : 'errore');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <div className="card w-full max-w-md space-y-3">
        <h2 className="section-title">
          Approvatori {meta.titleSuffix} di {user.display_name || user.email}
        </h2>
        <p className="text-xs muted">{meta.explainer}</p>
        {loading ? (
          <div className="text-sm muted">Caricamento…</div>
        ) : allUsers.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            Nessun altro utente attivo disponibile.
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
                    {u.role === 'admin' ? '(admin)' : '(utente)'}
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
            Annulla
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Salvataggio…' : 'Salva'}
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
      setErr(e instanceof Error ? e.message : 'errore');
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
        <h2 className="text-lg font-semibold">Orario di {user.display_name || user.email}</h2>

        <div>
          <label className="label">Orario</label>
          <select
            className="input"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">— Nessuno —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {templates.length === 0 && (
            <p className="text-xs text-neutral-500 mt-1">
              Nessun orario configurato. Vai in <strong>Orari</strong> per crearne uno.
            </p>
          )}
        </div>

        <div>
          <label className="label">Valido dal</label>
          <input
            type="date"
            className="input"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
          <p className="text-xs text-neutral-500 mt-1">
            L'assegnazione precedente verrà chiusa al giorno prima di questa data.
          </p>
        </div>

        {err && (
          <div className="text-sm" style={{ color: 'var(--color-error)' }}>
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Annulla
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Salvataggio…' : 'Salva'}
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
  onSave: (patch: { first_name: string | null; last_name: string | null }) => Promise<void> | void;
}) {
  const [firstName, setFirstName] = useState(user.first_name ?? '');
  const [lastName, setLastName] = useState(user.last_name ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave({
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-md space-y-3">
        <h2 className="section-title">Modifica utente</h2>
        <p className="text-xs muted">
          {user.email} — l'email non è modificabile.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Nome</label>
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
            <label className="label">Cognome</label>
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
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Annulla
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Salvataggio…' : 'Salva'}
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
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const title = mode === 'add' ? 'Assegna sedi' : 'Rimuovi sedi';
  const verb = mode === 'add' ? 'aggiunte' : 'rimosse';
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <div className="card w-full max-w-md space-y-3">
        <h2 className="section-title">{title}</h2>
        <p className="text-xs muted">
          Le sedi selezionate verranno {verb} a {count} {count === 1 ? 'utente' : 'utenti'}.
          {mode === 'add'
            ? ' Le assegnazioni esistenti restano invariate.'
            : ' Le altre assegnazioni restano invariate.'}
        </p>
        {branches.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            Nessuna sede disponibile.
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
            Annulla
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
            {busy ? 'Salvataggio…' : mode === 'add' ? 'Assegna' : 'Rimuovi'}
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
          Metodi di timbratura di {user.display_name || user.email}
        </h2>
        <p className="text-xs muted">
          Scegli con quali metodi l'utente può timbrare. Nessun metodo selezionato = l'utente non
          può timbrare.
        </p>
        <ul className="space-y-2" style={{ paddingLeft: 0, listStyle: 'none' }}>
          <li>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={gps} onChange={(e) => setGps(e.target.checked)} />
              <span>
                <strong>GPS</strong> — da app mobile, presso la sede (geofence)
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
                <strong>Da remoto</strong> — da web, senza verifica della posizione
              </span>
            </label>
          </li>
        </ul>
        {modes.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            Nessun metodo selezionato: l'utente non potrà timbrare.
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Annulla
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
            {busy ? 'Salvataggio…' : 'Salva'}
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
        <h2 className="section-title">Sedi di {user.email}</h2>
        <p className="text-xs muted">
          Senza almeno una sede l'utente non potrà timbrare né da app né da web.
        </p>
        {branches.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            Nessuna sede creata. Vai in "Sedi" per crearne una prima.
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
            Annulla
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
            {busy ? 'Salvataggio…' : 'Salva'}
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
      setErr(e instanceof Error ? e.message : 'errore');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-md space-y-3">
        <h2 className="section-title">Invita utente</h2>
        <p className="text-xs muted">Riceverà un'email per impostare la password e accedere.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Nome <span className="muted">(facoltativo)</span></label>
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
            <label className="label">Cognome <span className="muted">(facoltativo)</span></label>
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
          <label className="label">Email</label>
          <input type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Ruolo</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')}>
            <option value="user">Utente</option>
            <option value="admin">Amministratore</option>
          </select>
        </div>
        <div>
          <label className="label">Sedi assegnate</label>
          {branches.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-error)' }}>
              Nessuna sede creata. Senza sedi l'utente non potrà timbrare.
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
          <p className="text-xs muted mt-1">Puoi assegnare altre sedi anche dopo l'invito.</p>
        </div>
        {err && <div className="rounded-md px-3 py-2 text-sm" style={{ background: '#fde4e4', color: 'var(--color-error)' }}>{err}</div>}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annulla</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Invio…' : 'Invita'}</button>
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
  const columns = useMemo<GridColDef<UserRow>[]>(
    () => [
      { field: 'email', headerName: 'Email', flex: 1.4, minWidth: 200 },
      {
        field: 'first_name',
        headerName: 'Nome',
        flex: 0.8,
        minWidth: 120,
        valueGetter: (_v, row) => row.first_name?.trim() ?? '',
        renderCell: (p) =>
          p.value || <span style={{ color: 'var(--color-on-surface-variant)' }}>—</span>,
      },
      {
        field: 'last_name',
        headerName: 'Cognome',
        flex: 0.8,
        minWidth: 120,
        valueGetter: (_v, row) => row.last_name?.trim() ?? '',
        renderCell: (p) =>
          p.value || <span style={{ color: 'var(--color-on-surface-variant)' }}>—</span>,
      },
      {
        field: 'role',
        headerName: 'Ruolo',
        width: 130,
        type: 'singleSelect',
        valueOptions: [
          { value: 'user', label: 'Utente' },
          { value: 'admin', label: 'Admin' },
        ],
        renderCell: (p) => {
          const u = p.row;
          return (
            <select
              className="input"
              style={{ minHeight: '1.875rem', padding: '0 0.5rem', fontSize: '0.75rem' }}
              value={u.role}
              onChange={(e) => onSetRole(u, e.target.value as 'admin' | 'user')}
              disabled={u.user_id === me?.user.id && u.role === 'admin' && adminsCount === 1}
              title={
                atAdminLimit && u.role !== 'admin'
                  ? `Limite admin raggiunto (${adminsCount}/${maxAdmins})`
                  : undefined
              }
            >
              <option value="user">Utente</option>
              <option value="admin" disabled={atAdminLimit && u.role !== 'admin'}>
                Admin
              </option>
            </select>
          );
        },
      },
      {
        field: 'active',
        headerName: 'Stato',
        width: 110,
        type: 'boolean',
        align: 'left',
        headerAlign: 'left',
        renderCell: (p) =>
          p.value ? (
            <span className="badge badge-ok">Attivo</span>
          ) : (
            <span className="badge badge-muted">Disattivato</span>
          ),
      },
      {
        field: 'branch_ids',
        headerName: 'Sedi',
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
              title="Modifica sedi assegnate"
            >
              {n === 0 ? (
                <span style={{ color: 'var(--color-error)' }}>Nessuna · Assegna</span>
              ) : (
                <>
                  {n} {n === 1 ? 'sede' : 'sedi'} · Modifica
                </>
              )}
            </button>
          );
        },
      },
      {
        field: 'shift',
        headerName: 'Orario',
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
            title="Assegna o cambia orario"
          >
            {p.value ? (
              p.value
            ) : (
              <span style={{ color: 'var(--color-error)' }}>Nessuno · Assegna</span>
            )}
          </button>
        ),
      },
      {
        field: 'stamp_modes',
        headerName: 'Timbratura',
        width: 180,
        sortable: false,
        filterable: false,
        valueGetter: (_v, row) => (row.stamp_modes ?? []).join(','),
        renderCell: (p) => {
          const modes = p.row.stamp_modes ?? [];
          const label =
            modes.length === 0
              ? 'Non timbra'
              : modes.map((m) => (m === 'gps' ? 'GPS' : 'Remoto')).join(' · ');
          return (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onEditModes(p.row)}
              title="Scegli con quali metodi l'utente può timbrare"
            >
              {modes.length === 0 ? (
                <span style={{ color: 'var(--color-error)' }}>{label} · Modifica</span>
              ) : (
                <>{label} · Modifica</>
              )}
            </button>
          );
        },
      },
      {
        field: 'leave_approvers',
        headerName: 'Approvatori ferie',
        width: 150,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onEditApprovers(p.row, 'leave')}
            title="Configura chi può approvare ferie/permessi di questo utente"
          >
            Modifica
          </button>
        ),
      },
      {
        field: 'correction_approvers',
        headerName: 'Approvatori correzioni',
        width: 170,
        sortable: false,
        filterable: false,
        renderCell: (p) => (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onEditApprovers(p.row, 'correction')}
            title="Configura chi può approvare le richieste di correzione di questo utente"
          >
            Modifica
          </button>
        ),
      },
      {
        field: 'last_stamp_at',
        headerName: 'Ultima timbratura',
        width: 170,
        type: 'dateTime',
        valueGetter: (_v, row) => (row.last_stamp_at ? new Date(row.last_stamp_at) : null),
        renderCell: (p) =>
          p.value ? (
            <span className="text-xs num">{(p.value as Date).toLocaleString('it-IT')}</span>
          ) : (
            <span className="text-xs num">—</span>
          ),
      },
      {
        field: 'actions',
        headerName: 'Azioni',
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
                title="Modifica nome / cognome"
                onClick={() => onEditUser(u)}
              />
              <IconButton
                kind="reset-password"
                title="Invia email per reimpostare la password"
                onClick={() => onResetPassword(u)}
              />
              <IconButton
                kind={u.active ? 'deactivate' : 'reactivate'}
                disabled={isSelf}
                title={
                  isSelf
                    ? 'Non puoi disattivare il tuo account'
                    : u.active
                    ? 'Disattiva utente (mantiene posto)'
                    : 'Riattiva utente'
                }
                onClick={() => onToggleActive(u)}
              />
              <IconButton
                kind="delete"
                disabled={isSelf}
                title={
                  isSelf
                    ? 'Non puoi eliminare il tuo account'
                    : 'Elimina utente (libera il posto)'
                }
                onClick={() => onDelete(u)}
              />
            </div>
          );
        },
      },
    ],
    [
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
