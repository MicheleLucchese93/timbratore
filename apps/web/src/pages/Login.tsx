import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { isAuthConfigured, loginWithDevToken, loginWithPassword } from '../lib/api.ts';
import { useSession } from '../store/session.ts';
import { HeroAnimation } from '../components/HeroAnimation.tsx';
import { PasswordInput } from '../components/PasswordInput.tsx';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const refresh = useSession((s) => s.refresh);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (isAuthConfigured()) {
        await loginWithPassword(email.trim().toLowerCase(), password);
      } else {
        // Local dev fallback when GoTrue not provisioned; password is ignored.
        await loginWithDevToken(email.trim().toLowerCase());
      }
      await refresh();
      onLoggedIn();
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Accesso fallito');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-screen overflow-hidden bg-[color:var(--color-surface)]">
      <div className="hidden md:flex md:w-1/2 xl:w-3/5">
        <HeroAnimation />
      </div>
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-6 sm:px-8">
        <div className="w-full max-w-md">
          <form onSubmit={submit} className="card space-y-4">
            <div className="text-center mb-2 flex flex-col items-center">
              {/* Logo on top, same surface background as the rest of the
                  card — mirrors the mobile login layout. */}
              {/* No explicit background — the form card is already `white`,
                  and the icon PNG ships with its own opaque tile, so they
                  blend without a visible seam. */}
              <img
                src="/icon-192.png"
                alt=""
                aria-hidden="true"
                className="mb-3 h-16 w-16"
              />
              <div className="text-3xl font-extrabold tracking-tight" style={{ color: 'var(--color-primary)' }}>
                sono<span style={{ color: 'var(--color-on-primary-container)' }}>Qui</span>
              </div>
              <p className="mt-1 text-sm text-neutral-600">
                Il tempo che lavori, semplice come dirlo.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="input"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@azienda.it"
              />
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <label className="label" htmlFor="password">Password</label>
                <Link to="/forgot-password" className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
                  Password dimenticata?
                </Link>
              </div>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                required={isAuthConfigured()}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {err && (
              <div className="rounded-md px-3 py-2 text-sm" style={{ background: '#fde4e4', color: 'var(--color-error)' }}>
                {err}
              </div>
            )}

            <button className="btn btn-primary w-full" disabled={busy} type="submit">
              {busy ? 'Accesso in corso…' : 'Accedi'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
