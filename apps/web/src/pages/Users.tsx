import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { useSession } from '../store/session.ts';

interface UserRow {
  membership_id: string;
  user_id: string;
  email: string;
  role: 'admin' | 'user';
  active: boolean;
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

  const usersCount = Number(usage?.active_users ?? 0);
  const adminsCount = Number(usage?.active_admins ?? 0);
  const atUserLimit = !!usage && usersCount >= usage.max_users;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Utenti</h1>
        <button
          className="btn btn-primary"
          disabled={atUserLimit}
          title={atUserLimit ? 'Limite raggiunto — contatta supporto' : ''}
          onClick={() => setShowInvite(true)}
        >
          Invita utente
        </button>
      </div>

      {usage && (
        <div className="card flex gap-6 text-sm">
          <div>
            <span className="text-neutral-500">Utenti attivi: </span>
            <strong>{usersCount}</strong> / {usage.max_users}
          </div>
          <div>
            <span className="text-neutral-500">Amministratori: </span>
            <strong>{adminsCount}</strong> / {usage.max_admins}
          </div>
        </div>
      )}

      {err && <div className="card text-sm text-[color:var(--color-error)]">{err}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-neutral-500 uppercase">
            <tr>
              <th className="py-2">Email</th>
              <th className="py-2">Ruolo</th>
              <th className="py-2">Stato</th>
              <th className="py-2">Ultima timbratura</th>
              <th className="py-2 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.membership_id} className="border-t border-neutral-100">
                <td className="py-2">{u.email}</td>
                <td className="py-2">
                  <select
                    className="input py-1 text-xs"
                    value={u.role}
                    onChange={(e) => setRole(u, e.target.value as 'admin' | 'user')}
                    disabled={u.user_id === me?.user.id && u.role === 'admin' && adminsCount === 1}
                  >
                    <option value="user">Utente</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="py-2">
                  {u.active ? (
                    <span className="badge badge-ok">Attivo</span>
                  ) : (
                    <span className="badge badge-muted">Disattivato</span>
                  )}
                </td>
                <td className="py-2 text-xs">
                  {u.last_stamp_at ? new Date(u.last_stamp_at).toLocaleString('it-IT') : '—'}
                </td>
                <td className="py-2 text-right">
                  <button className="btn btn-secondary text-xs" onClick={() => toggleActive(u)}>
                    {u.active ? 'Disattiva' : 'Riattiva'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showInvite && (
        <InviteForm
          onClose={() => setShowInvite(false)}
          onInvited={async () => {
            setShowInvite(false);
            await load();
          }}
        />
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
        <h2 className="text-lg font-semibold">Invita utente</h2>
        <p className="text-xs text-neutral-500">
          In MVP l'utente viene creato direttamente. In produzione GoTrue invia l'email di invito.
        </p>
        <div>
          <label className="label">Email</label>
          <input
            type="email"
            className="input"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Ruolo</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')}>
            <option value="user">Utente</option>
            <option value="admin">Amministratore</option>
          </select>
        </div>
        {err && <div className="text-sm text-[color:var(--color-error)]">{err}</div>}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annulla</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Invio…' : 'Invita'}
          </button>
        </div>
      </form>
    </div>
  );
}
