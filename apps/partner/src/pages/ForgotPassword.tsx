import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { LanguageToggle } from '../components/LanguageToggle.tsx';

export function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/v1/auth/recover', {
        method: 'POST',
        // redirect_to sends the post-reset "sign in" link back to this console
        // instead of the default web app. Path-bearing so it matches GoTrue's
        // `<origin>/**` redirect allow-list.
        json: { email: email.trim().toLowerCase(), redirect_to: `${window.location.origin}/login` },
      });
    } catch {
      // Ignore — the backend returns 200 regardless to avoid account enumeration.
    }
    // Always show the same confirmation, whether or not the email is registered.
    setDone(true);
    setBusy(false);
  }

  return (
    <main className="login-wrap">
      <div className="login-card">
        <div className="absolute right-4 top-4">
          <LanguageToggle />
        </div>
        <form onSubmit={submit} className="card p-8 shadow-2xl" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="text-3xl font-extrabold tracking-tight" style={{ color: 'var(--color-primary)' }}>
              sono<span style={{ color: 'var(--color-on-primary-container)' }}>Qui</span>
            </div>
            <p className="text-sm" style={{ color: 'var(--color-on-surface-variant)', marginTop: '0.25rem' }}>
              {t('forgotPassword.tagline')}
            </p>
          </div>

          {done ? (
            <div className="rounded-md px-3 py-3 text-sm" style={{ background: 'var(--color-success-tint, #e8f3ec)', color: 'var(--color-success)' }}>
              {t('forgotPassword.sent')}
            </div>
          ) : (
            <>
              <p className="text-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
                {t('forgotPassword.instructions')}
              </p>
              <div>
                <label className="label" htmlFor="email">{t('forgotPassword.email')}</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  className="input"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <button className="btn btn-primary" disabled={busy} type="submit">
                {busy ? t('forgotPassword.sending') : t('forgotPassword.submit')}
              </button>
            </>
          )}

          <div style={{ textAlign: 'center' }}>
            <Link to="/login" className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
              {t('forgotPassword.backToLogin')}
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
