import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isAuthConfigured, loginWithDevToken, loginWithPassword } from '../lib/api.ts';
import { useSession } from '../store/session.ts';
import { HeroAnimation } from '../components/HeroAnimation.tsx';
import { PasswordInput } from '../components/PasswordInput.tsx';
import { LanguageToggle } from '../components/LanguageSwitcher.tsx';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useTranslation(['login', 'common']);
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
      // Credentials were valid but the user has no active company — e.g. their
      // company was suspended, or they have no membership. Show the SAME generic
      // error as a wrong password (never reveal suspension → no account
      // enumeration). The multi-company chooser (tenants.length > 1) is a valid
      // state and must not trip this.
      const s = useSession.getState();
      if (!s.me && s.tenants.length === 0) {
        setErr(t('errors.invalid_credentials', { defaultValue: t('errors.default') }));
        return;
      }
      onLoggedIn();
    } catch (err) {
      // Map GoTrue's machine error code to a localized message; fall back to a
      // generic localized string — never surface GoTrue's raw English text.
      const code = (err as { code?: string } | null)?.code;
      setErr(t(`errors.${code ?? 'default'}`, { defaultValue: t('errors.default') }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative h-screen overflow-hidden">
      {/* Animated blue brand background fills the whole page. */}
      <div className="absolute inset-0">
        <HeroAnimation />
      </div>

      <div className="absolute right-4 top-4 z-20">
        <LanguageToggle />
      </div>

      {/* Login card floats over the blue: centered on small screens,
          pinned to the right on large ones. */}
      <div className="relative z-10 flex h-full items-center justify-center overflow-y-auto px-4 py-8 sm:px-8 lg:justify-end lg:px-16 xl:pr-32">
        <div className="w-full max-w-lg">
          <form onSubmit={submit} className="card space-y-6 p-8 shadow-2xl sm:p-10">
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
                className="mb-4 h-20 w-20"
              />
              <div className="text-4xl font-extrabold tracking-tight" style={{ color: 'var(--color-primary)' }}>
                sono<span style={{ color: 'var(--color-on-primary-container)' }}>Qui</span>
              </div>
              <p className="mt-2 text-base text-neutral-600">
                {t('tagline')}
              </p>
            </div>

            <div>
              <label className="label" htmlFor="email">{t('email')}</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="input h-12 text-base"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('emailPlaceholder')}
              />
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <label className="label" htmlFor="password">{t('password')}</label>
                <Link to="/forgot-password" className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
                  {t('forgotPassword')}
                </Link>
              </div>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                required={isAuthConfigured()}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12 text-base"
              />
            </div>

            {err && (
              <div className="rounded-md px-3 py-2 text-sm" style={{ background: 'var(--color-error-tint)', color: 'var(--color-error)' }}>
                {err}
              </div>
            )}

            <button className="btn btn-primary w-full py-3 text-base" disabled={busy} type="submit">
              {busy ? t('signingIn') : t('signIn')}
            </button>

            <p className="text-center text-sm">
              <a
                href="https://sonoqui.pro"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline-offset-4 hover:underline"
                style={{ color: 'var(--color-primary)' }}
              >
                {t('discoverSite')} →
              </a>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
