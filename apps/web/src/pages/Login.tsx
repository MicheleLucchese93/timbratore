import { type FormEvent, useState } from 'react';
import { devLogin } from '../lib/api.ts';
import { useSession } from '../store/session.ts';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('admin@demo.cisono.local');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const refresh = useSession((s) => s.refresh);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await devLogin(email);
      await refresh();
      onLoggedIn();
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">ciSono — Accesso amministratore</h1>
        <p className="text-sm text-neutral-600">
          Modalità sviluppo: inserisci email amministratore.
        </p>
        <div>
          <label className="label">Email</label>
          <input
            type="email"
            className="input"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@azienda.it"
          />
        </div>
        {err && <div className="text-sm text-[color:var(--color-error)]">{err}</div>}
        <button className="btn btn-primary w-full" disabled={busy} type="submit">
          {busy ? 'Accesso…' : 'Accedi'}
        </button>
        <p className="text-xs text-neutral-500">
          Account seed: <code className="bg-neutral-100 px-1 rounded">admin@demo.cisono.local</code>
        </p>
      </form>
    </div>
  );
}
