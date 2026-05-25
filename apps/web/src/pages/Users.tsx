import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { api, apiUrl, getToken } from '../lib/api.ts';
import { useSession } from '../store/session.ts';

interface UserRow {
  membership_id: string;
  user_id: string;
  email: string;
  role: 'admin' | 'user';
  active: boolean;
  disable_desktop_clock_in: boolean;
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

interface ImportResult {
  processed: number;
  created: number;
  updated: number;
  reactivated: number;
}

function fullName(u: { first_name: string | null; last_name: string | null; display_name: string | null }): string {
  if (u.display_name && u.display_name.trim()) return u.display_name.trim();
  return [u.first_name, u.last_name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
}

export function Users() {
  const me = useSession((s) => s.me);
  const [list, setList] = useState<UserRow[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<UserRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);
  const [branchEditor, setBranchEditor] = useState<UserRow | null>(null);
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

  async function setRole(u: UserRow, role: 'admin' | 'user') {
    try {
      await api(`/api/v1/users/${u.user_id}`, { method: 'PATCH', json: { role } });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  async function setWebDisabled(u: UserRow, disable_desktop_clock_in: boolean) {
    const prev = u.disable_desktop_clock_in;
    setList((cur) =>
      cur.map((row) => (row.user_id === u.user_id ? { ...row, disable_desktop_clock_in } : row))
    );
    try {
      await api(`/api/v1/users/${u.user_id}`, {
        method: 'PATCH',
        json: { disable_desktop_clock_in },
      });
    } catch (e) {
      setList((cur) =>
        cur.map((row) =>
          row.user_id === u.user_id ? { ...row, disable_desktop_clock_in: prev } : row
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

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Utenti</h1>
          <p className="muted text-sm mt-0.5">Gestisci ruoli, sedi e attivazione.</p>
        </div>
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

      <div className="card p-0">
        <div className="table-wrap">
          <table className="table">
            <colgroup>
              <col />
              <col />
              <col style={{ width: '9rem' }} />
              <col style={{ width: '7rem' }} />
              <col style={{ width: '9rem' }} />
              <col style={{ width: '10rem' }} />
              <col style={{ width: '11rem' }} />
              <col style={{ width: '7rem' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Email</th>
                <th>Nome</th>
                <th>Ruolo</th>
                <th>Stato</th>
                <th title="Sedi assegnate. Senza almeno una sede l'utente non può timbrare.">
                  Sedi
                </th>
                <th title="Se attivo, l'utente non può timbrare dal web — solo dall'app mobile.">
                  Timbratura web
                </th>
                <th>Ultima timbratura</th>
                <th className="text-center">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.membership_id}>
                  <td className="truncate">{u.email}</td>
                  <td className="truncate muted">{fullName(u) || '—'}</td>
                  <td>
                    <select
                      className="input"
                      style={{ minHeight: '2rem', padding: '0 0.5rem', fontSize: '0.75rem' }}
                      value={u.role}
                      onChange={(e) => setRole(u, e.target.value as 'admin' | 'user')}
                      disabled={u.user_id === me?.user.id && u.role === 'admin' && adminsCount === 1}
                    >
                      <option value="user">Utente</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>
                    {u.active
                      ? <span className="badge badge-ok">Attivo</span>
                      : <span className="badge badge-muted">Disattivato</span>}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setBranchEditor(u)}
                      title="Modifica sedi assegnate"
                    >
                      {(u.branch_ids ?? []).length === 0
                        ? <span style={{ color: 'var(--color-error)' }}>Nessuna · Assegna</span>
                        : <>{(u.branch_ids ?? []).length} {(u.branch_ids ?? []).length === 1 ? 'sede' : 'sedi'} · Modifica</>}
                    </button>
                  </td>
                  <td>
                    <label className="switch" title="Disabilita timbratura dal web per questo utente">
                      <input
                        type="checkbox"
                        checked={u.disable_desktop_clock_in}
                        onChange={(e) => setWebDisabled(u, e.target.checked)}
                      />
                      <span className="switch-track">
                        <span className="switch-thumb" />
                      </span>
                      <span className="text-xs">
                        {u.disable_desktop_clock_in ? 'Disabilitata' : 'Abilitata'}
                      </span>
                    </label>
                  </td>
                  <td className="text-xs num">{u.last_stamp_at ? new Date(u.last_stamp_at).toLocaleString('it-IT') : '—'}</td>
                  <td>
                    <div className="flex justify-center gap-1">
                      <IconButton
                        kind={u.active ? 'deactivate' : 'reactivate'}
                        disabled={u.user_id === me?.user.id}
                        title={
                          u.user_id === me?.user.id
                            ? 'Non puoi disattivare il tuo account'
                            : u.active
                            ? 'Disattiva utente (mantiene posto)'
                            : 'Riattiva utente'
                        }
                        onClick={() => (u.active ? setConfirmDeactivate(u) : toggleActive(u))}
                      />
                      <IconButton
                        kind="delete"
                        disabled={u.user_id === me?.user.id}
                        title={
                          u.user_id === me?.user.id
                            ? 'Non puoi eliminare il tuo account'
                            : 'Elimina utente (libera il posto)'
                        }
                        onClick={() => setConfirmDelete(u)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    </div>
  );
}

function IconButton({
  kind,
  onClick,
  disabled,
  title,
}: {
  kind: 'deactivate' | 'reactivate' | 'delete';
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const danger = kind === 'delete';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="btn btn-ghost btn-sm"
      style={{
        padding: '0.375rem',
        minWidth: '2rem',
        color: danger ? 'var(--color-error)' : undefined,
      }}
    >
      {kind === 'deactivate' && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
          <line x1="12" y1="2" x2="12" y2="12" />
        </svg>
      )}
      {kind === 'reactivate' && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="6 4 20 12 6 20 6 4" />
        </svg>
      )}
      {kind === 'delete' && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        </svg>
      )}
    </button>
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
