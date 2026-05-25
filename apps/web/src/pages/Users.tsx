import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
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
}

interface Usage {
  active_users: number | string;
  active_admins: number | string;
  max_users: number;
  max_admins: number;
}

export function Users() {
  const me = useSession((s) => s.me);
  const [list, setList] = useState<UserRow[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<UserRow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const [u, l] = await Promise.all([
      api<Usage>('/api/v1/settings/usage'),
      api<UserRow[]>('/api/v1/users'),
    ]);
    setUsage(u);
    setList(l);
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
        <button
          className="btn btn-primary"
          disabled={atUserLimit}
          title={atUserLimit ? 'Limite raggiunto — contatta supporto' : ''}
          onClick={() => setShowInvite(true)}
        >
          Invita utente
        </button>
      </header>

      {usage && (
        <div className="card flex gap-6 text-sm flex-wrap">
          <div>
            <span className="muted">Utenti attivi: </span>
            <strong className="num">{usersCount}</strong> / {usage.max_users}
          </div>
          <div>
            <span className="muted">Amministratori: </span>
            <strong className="num">{adminsCount}</strong> / {usage.max_admins}
          </div>
        </div>
      )}

      {err && <div className="card text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

      <div className="card p-0">
        <div className="table-wrap">
          <table className="table">
            <colgroup>
              <col />
              <col style={{ width: '9rem' }} />
              <col style={{ width: '7rem' }} />
              <col style={{ width: '10rem' }} />
              <col style={{ width: '11rem' }} />
              <col style={{ width: '8rem' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Email</th>
                <th>Ruolo</th>
                <th>Stato</th>
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
                    <div className="flex justify-center">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => (u.active ? setConfirmDeactivate(u) : toggleActive(u))}
                        disabled={u.user_id === me?.user.id}
                        title={u.user_id === me?.user.id ? 'Non puoi disattivare il tuo account' : ''}
                      >
                        {u.active ? 'Disattiva' : 'Riattiva'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showInvite && (
        <InviteForm onClose={() => setShowInvite(false)} onInvited={async () => { setShowInvite(false); await load(); }} />
      )}

      {confirmDeactivate && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
          <div className="card w-full max-w-md space-y-3">
            <h2 className="section-title">Disattivare utente?</h2>
            <p className="text-sm muted">
              L'utente <strong>{confirmDeactivate.email}</strong> non potrà più accedere finché non sarà
              riattivato. L'azione è reversibile.
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
    </div>
  );
}

function InviteForm({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/v1/users/invite', { method: 'POST', json: { email, role } });
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
        {err && <div className="rounded-md px-3 py-2 text-sm" style={{ background: '#fde4e4', color: 'var(--color-error)' }}>{err}</div>}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annulla</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Invio…' : 'Invita'}</button>
        </div>
      </form>
    </div>
  );
}
