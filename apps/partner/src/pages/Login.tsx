import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isAuthConfigured, loginWithDevToken, loginWithPassword } from '../lib/api.ts';
import { useSession } from '../store/session.ts';
import { LanguageToggle } from '../components/LanguageToggle.tsx';

export function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const refresh = useSession((s) => s.refresh);
  // Surfaced when a valid login resolves to a non-partner account (403).
  const sessionError = useSession((s) => s.error);

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
      // App re-routes on `me`; if still no me, the store error renders below.
    } catch (e2) {
      const code = (e2 as { code?: string } | null)?.code;
      setErr(t(`login.errors.${code ?? 'default'}`, { defaultValue: t('login.errors.default') }));
    } finally {
      setBusy(false);
    }
  }

  const shownError =
    err ??
    (sessionError
      ? t(`login.errors.${sessionError}`, { defaultValue: t('login.errors.default') })
      : null);

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
              {t('login.tagline')}
            </p>
          </div>

          <div>
            <label className="label" htmlFor="email">{t('login.email')}</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="input"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('login.emailPlaceholder')}
            />
          </div>

          <div>
            <label className="label" htmlFor="password">{t('login.password')}</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="input"
              required={isAuthConfigured()}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <div style={{ textAlign: 'right', marginTop: '0.375rem' }}>
              <Link to="/forgot-password" className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
                {t('login.forgot')}
              </Link>
            </div>
          </div>

          {shownError && <div className="form-err">{shownError}</div>}

          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? t('login.signingIn') : t('login.signIn')}
          </button>
        </form>
      </div>
    </main>
  );
}
