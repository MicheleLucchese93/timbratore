import { type FormEvent, useState } from 'react';
import { isAuthConfigured, loginWithDevToken, loginWithPassword } from '../lib/api.ts';
import { useSession } from '../store/session.ts';

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
        await loginWithDevToken(email.trim().toLowerCase());
      }
      await refresh();
      onLoggedIn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Accesso fallito';
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-screen overflow-hidden bg-[color:var(--color-surface)]">
      <HeroPanel />
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-6 sm:px-8">
        <div className="w-full max-w-md">
          <form onSubmit={submit} className="card space-y-4">
            <div className="text-center mb-2">
              <div className="text-3xl font-extrabold tracking-tight" style={{ color: 'var(--color-primary)' }}>
                ciSono
              </div>
              <p className="mt-1 text-sm text-neutral-600">
                Accedi al pannello amministratore
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

            {isAuthConfigured() && (
              <div>
                <label className="label" htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className="input"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            )}

            {err && (
              <div className="rounded-md px-3 py-2 text-sm" style={{ background: '#fde4e4', color: 'var(--color-error)' }}>
                {err}
              </div>
            )}

            <button className="btn btn-primary w-full" disabled={busy} type="submit">
              {busy ? 'Accesso in corso…' : 'Accedi'}
            </button>

            <p className="text-xs text-neutral-500 text-center pt-2 border-t border-neutral-100">
              Il pannello web è riservato agli amministratori. Per timbrare usa l'app mobile.
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}

function HeroPanel() {
  return (
    <div
      className="hidden md:flex md:w-1/2 xl:w-3/5 items-center justify-center relative overflow-hidden"
      style={{
        background:
          'linear-gradient(135deg, #b25500 0%, #d97706 50%, #92400e 100%)',
      }}
    >
      <div className="absolute inset-0 opacity-20" style={{
        backgroundImage:
          'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.4) 0%, transparent 40%),' +
          'radial-gradient(circle at 80% 70%, rgba(255,255,255,0.3) 0%, transparent 40%)',
      }} />
      <div className="relative z-10 max-w-md text-white px-12 py-16">
        <div className="text-5xl font-extrabold tracking-tight mb-3">ciSono</div>
        <p className="text-xl font-medium opacity-90 leading-snug">
          Una timbratura semplice.<br />Per chi c'è.
        </p>
        <div className="mt-12 space-y-4">
          <HeroFeature title="GPS solo al timbro" body="Mai tracciamento in background. Conforme all'art. 4 dello Statuto dei Lavoratori." />
          <HeroFeature title="Multi-sede" body="Ogni dipendente associato alle sue sedi, con tolleranza configurabile." />
          <HeroFeature title="Esportazioni pronte" body="XLSX e JSON per il commercialista, generati in un clic." />
        </div>
      </div>
    </div>
  );
}

function HeroFeature({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="mt-1 h-2 w-2 rounded-full bg-white shrink-0" />
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm opacity-80 leading-snug">{body}</div>
      </div>
    </div>
  );
}
