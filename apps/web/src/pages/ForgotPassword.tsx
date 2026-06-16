import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { HeroAnimation } from '../components/HeroAnimation.tsx';

export function ForgotPassword() {
  const { t } = useTranslation(['forgotPassword', 'common']);
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
    <main className="relative h-screen overflow-hidden">
      {/* Animated blue brand background fills the whole page. */}
      <div className="absolute inset-0">
        <HeroAnimation />
      </div>

      <div className="relative z-10 flex h-full items-center justify-center overflow-y-auto px-4 py-8 sm:px-8 lg:justify-end lg:px-16 xl:pr-32">
        <div className="w-full max-w-lg">
          <form onSubmit={submit} className="card space-y-6 p-8 shadow-2xl sm:p-10">
            <div className="text-center mb-2 flex flex-col items-center">
              <img
                src="/icon-192.png"
                alt=""
                aria-hidden="true"
                className="mb-4 h-20 w-20"
              />
              <div className="text-4xl font-extrabold tracking-tight" style={{ color: 'var(--color-primary)' }}>
                sono<span style={{ color: 'var(--color-on-primary-container)' }}>Qui</span>
              </div>
              <p className="mt-2 text-base text-neutral-600">{t('tagline')}</p>
            </div>

            {done ? (
              <div className="rounded-md px-3 py-3 text-sm" style={{ background: '#e8f3ec', color: 'var(--color-success)' }}>
                {t('sent')}
              </div>
            ) : (
              <>
                <p className="text-sm muted">{t('instructions')}</p>
                <div>
                  <label className="label" htmlFor="email">{t('email')}</label>
                  <input id="email" type="email" required className="input h-12 text-base" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <button className="btn btn-primary w-full py-3 text-base" disabled={busy} type="submit">
                  {busy ? t('sending') : t('submit')}
                </button>
              </>
            )}

            <div className="text-center text-sm pt-2 border-t border-neutral-100">
              <Link to="/login" style={{ color: 'var(--color-primary)' }} className="font-medium">{t('backToLogin')}</Link>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
