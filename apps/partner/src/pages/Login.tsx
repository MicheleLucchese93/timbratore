import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isAuthConfigured, loginWithDevToken, loginWithPassword } from '../lib/api.ts';
import { useSession } from '../store/session.ts';
import { LanguageToggle } from '../components/LanguageToggle.tsx';
import { PartnerHero } from '../components/PartnerHero.tsx';

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
    <main className="relative h-screen overflow-hidden">
      {/* Animated blue brand hero fills the whole page. */}
      <div className="absolute inset-0">
        <PartnerHero />
      </div>

      <div className="absolute right-4 top-4 z-20">
        <LanguageToggle />
      </div>

      {/* Login card floats over the blue: centered on small screens,
          pinned to the right on large ones. Mirrors the webapp login. */}
      <div className="relative z-10 flex h-full items-center justify-center overflow-y-auto px-4 py-8 sm:px-8 lg:justify-end lg:px-16 xl:pr-32">
        <div className="w-full max-w-md">
          <form
            onSubmit={submit}
            className="card p-8 shadow-2xl sm:p-10"
            style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
          >
            <div className="flex flex-col items-center text-center">
              <img src="/icon-192.png" alt="" aria-hidden="true" className="mb-4 h-20 w-20" />
              <div className="text-4xl font-extrabold tracking-tight" style={{ color: 'var(--color-primary)' }}>
                sono<span style={{ color: 'var(--color-on-primary-container)' }}>Qui</span>
              </div>
              <p className="mt-2 text-base" style={{ color: 'var(--color-on-surface-variant)' }}>
                {t('login.tagline')}
              </p>
            </div>

            <div>
              <label className="label" htmlFor="email">{t('login.email')}</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="input h-12 text-base"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login.emailPlaceholder')}
              />
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <label className="label" htmlFor="password">{t('login.password')}</label>
                <Link to="/forgot-password" className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
                  {t('login.forgot')}
                </Link>
              </div>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="input h-12 text-base"
                required={isAuthConfigured()}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {shownError && <div className="form-err">{shownError}</div>}

            <button className="btn btn-primary w-full py-3 text-base" disabled={busy} type="submit">
              {busy ? t('login.signingIn') : t('login.signIn')}
            </button>

            <p className="text-center text-sm">
              <a
                href="https://sonoqui.pro"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline-offset-4 hover:underline"
                style={{ color: 'var(--color-primary)' }}
              >
                {t('login.discoverSite')} →
              </a>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
