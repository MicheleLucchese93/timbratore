import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { HeroAnimation } from '../components/HeroAnimation.tsx';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/v1/auth/recover', { method: 'POST', json: { email: email.trim().toLowerCase() } });
    } catch { /* ignore — server returns 200 regardless */ }
    setDone(true);
    setBusy(false);
  }

  return (
    <main className="flex h-screen overflow-hidden bg-[color:var(--color-surface)]">
      <div className="hidden md:flex md:w-1/2 xl:w-3/5">
        <HeroAnimation />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-6 sm:px-8">
        <div className="w-full max-w-md">
          <form onSubmit={submit} className="card space-y-4">
            <div className="text-center mb-2 flex flex-col items-center">
              <img
                src="/icon-192.png"
                alt=""
                aria-hidden="true"
                className="mb-3 h-16 w-16"
                style={{ background: 'var(--color-surface)' }}
              />
              <div className="text-3xl font-extrabold tracking-tight" style={{ color: 'var(--color-primary)' }}>
                sono<span style={{ color: 'var(--color-on-primary-container)' }}>Qui</span>
              </div>
              <p className="mt-1 text-sm text-neutral-600">Password dimenticata</p>
            </div>

            {done ? (
              <div className="rounded-md px-3 py-3 text-sm" style={{ background: '#e8f3ec', color: 'var(--color-success)' }}>
                Se l'email esiste, ti abbiamo inviato un link per reimpostare la password. Controlla la casella di posta.
              </div>
            ) : (
              <>
                <p className="text-sm muted">Inserisci la tua email. Ti invieremo un link per reimpostare la password.</p>
                <div>
                  <label className="label" htmlFor="email">Email</label>
                  <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <button className="btn btn-primary w-full" disabled={busy} type="submit">
                  {busy ? 'Invio…' : 'Invia link di reset'}
                </button>
              </>
            )}

            <div className="text-center text-sm pt-2 border-t border-neutral-100">
              <Link to="/login" style={{ color: 'var(--color-primary)' }} className="font-medium">Torna al login</Link>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
