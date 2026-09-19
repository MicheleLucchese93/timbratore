import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, loginWithDevToken, loginWithPassword, isAuthConfigured, type ApiError } from '../lib/api.ts';
import { useSession } from '../store/session.ts';
import { PasswordInput } from '../components/PasswordInput.tsx';
import { LanguageToggle } from '../components/LanguageSwitcher.tsx';

// Same rules as the server-side passwordSchema (lib/password.ts).
const RULES = [
  { id: 'length', test: (p: string) => p.length >= 8 },
  { id: 'lower', test: (p: string) => /[a-z]/.test(p) },
  { id: 'upper', test: (p: string) => /[A-Z]/.test(p) },
  { id: 'digit', test: (p: string) => /[0-9]/.test(p) },
  { id: 'symbol', test: (p: string) => /[^a-zA-Z0-9]/.test(p) },
] as const;

const WEBSITE = (import.meta.env.VITE_WEBSITE_URL || 'https://sonoqui.pro').replace(/\/$/, '');

interface Preview {
  email: string;
  first_name: string;
  mode: 'new' | 'existing';
  plan_hint: 'piccola' | 'media' | null;
  language: 'it' | 'en';
}

/**
 * /registrazione/conferma#t=<token> — step 2 of the self-service registration
 * (Specs/SELF_SERVICE_BILLING.md §3.2). The token rides in the URL fragment, so
 * it never reaches a server log or a Referer; it is read once and wiped from
 * the address bar. A NEW address chooses its password here (proving the
 * mailbox is what makes the account exist); an EXISTING account signs in with
 * its current password and claims the registration — its credentials are
 * never touched by this flow.
 */
export function SignupConfirm() {
  const { t, i18n } = useTranslation(['signup', 'settings', 'login']);
  const nav = useNavigate();
  const refresh = useSession((s) => s.refresh);
  const tokenRef = useRef<string | null>(null);
  const [state, setState] = useState<'loading' | 'new' | 'existing' | 'invalid' | 'used'>('loading');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const m = /[#&]t=([^&]+)/.exec(window.location.hash);
    const token = m ? decodeURIComponent(m[1] ?? '') : null;
    // Wipe the token from the address bar and history straight away.
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setState('invalid');
      return;
    }
    tokenRef.current = token;
    api<Preview>('/api/v1/signup/preview', { method: 'POST', json: { token }, noTenant: true })
      .then((p) => {
        setPreview(p);
        if (p.language && p.language !== i18n.language) void i18n.changeLanguage(p.language);
        setState(p.mode);
      })
      .catch((e: ApiError) => setState(e.code === 'SIGNUP_TOKEN_USED' ? 'used' : 'invalid'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enterApp() {
    // Land on "/" so App renders the onboarding wizard for this account.
    nav('/', { replace: true });
    await refresh();
  }

  async function submitNew(e: FormEvent) {
    e.preventDefault();
    if (!preview || !tokenRef.current) return;
    if (pw !== pw2) {
      setErr(t('confirm.mismatch'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api('/api/v1/signup/confirm', {
        method: 'POST',
        json: { token: tokenRef.current, password: pw },
        noTenant: true,
      });
      if (isAuthConfigured()) await loginWithPassword(preview.email, pw);
      else await loginWithDevToken(preview.email);
      await enterApp();
    } catch (e2) {
      const code = (e2 as ApiError).code;
      if (code === 'USE_LOGIN') setState('existing');
      else if (code === 'SIGNUP_TOKEN_USED') setState('used');
      else if (code === 'SIGNUP_TOKEN_INVALID') setState('invalid');
      else setErr(t('confirm.error'));
    } finally {
      setBusy(false);
    }
  }

  async function submitExisting(e: FormEvent) {
    e.preventDefault();
    if (!preview || !tokenRef.current) return;
    setBusy(true);
    setErr(null);
    try {
      if (isAuthConfigured()) await loginWithPassword(preview.email, pw);
      else await loginWithDevToken(preview.email);
      await api('/api/v1/onboarding/claim', { method: 'POST', json: { token: tokenRef.current }, noTenant: true });
      await enterApp();
    } catch (e2) {
      const code = (e2 as ApiError).code;
      if (code === 'SIGNUP_EMAIL_MISMATCH') setErr(t('confirm.mismatchAccount'));
      else if (code === 'SIGNUP_TOKEN_INVALID') setState('invalid');
      else setErr(t(`login:errors.${code ?? 'default'}`, { defaultValue: t('login:errors.default') }));
    } finally {
      setBusy(false);
    }
  }

  const rulesOk = RULES.every((r) => r.test(pw));

  return (
    <main className="signup-shell">
      <div className="signup-card card space-y-4" data-testid="signup-confirm">
        <div className="flex items-center justify-between">
          <div className="signup-brand">
            <img src="/icon-192.png" alt="" width={32} height={32} />
            <span>sono<span className="text-[color:var(--color-primary)]">Qui</span></span>
          </div>
          <LanguageToggle />
        </div>

        {state === 'loading' && <p className="muted">{t('confirm.loading')}</p>}

        {state === 'new' && preview && (
          <form onSubmit={submitNew} className="space-y-4">
            <div>
              <h1 className="page-title">{t('confirm.title')}</h1>
              <p className="muted">{t('confirm.subtitle', { name: preview.first_name, email: preview.email })}</p>
            </div>
            <div>
              <label className="label" htmlFor="su-pw">{t('confirm.password')}</label>
              <PasswordInput id="su-pw" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="signup-password" />
              <ul className="pw-requirements" aria-label={t('confirm.rules')}>
                {RULES.map((r) => (
                  <li key={r.id} className={r.test(pw) ? 'valid' : ''}>
                    {t(`settings:password.rule.${r.id}`)}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <label className="label" htmlFor="su-pw2">{t('confirm.passwordRepeat')}</label>
              <PasswordInput id="su-pw2" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="signup-password-repeat" />
            </div>
            {err && <p className="text-sm text-[color:var(--color-error)]" role="alert">{err}</p>}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy || !rulesOk || !pw2} data-testid="signup-confirm-submit">
              {t('confirm.submit')}
            </button>
          </form>
        )}

        {state === 'existing' && preview && (
          <form onSubmit={submitExisting} className="space-y-4">
            <div>
              <h1 className="page-title">{t('confirm.existingTitle')}</h1>
              <p className="muted">{t('confirm.existingText', { email: preview.email })}</p>
            </div>
            <div>
              <label className="label" htmlFor="su-epw">{t('confirm.existingPassword')}</label>
              <PasswordInput id="su-epw" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
            {err && <p className="text-sm text-[color:var(--color-error)]" role="alert">{err}</p>}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy || !pw}>
              {t('confirm.login')}
            </button>
            <Link to="/forgot-password" className="icon-link text-sm">{t('confirm.forgot')}</Link>
          </form>
        )}

        {(state === 'invalid' || state === 'used') && (
          <div className="space-y-3" data-testid={`signup-${state}`}>
            <h1 className="page-title">{state === 'used' ? t('confirm.usedTitle') : t('confirm.invalidTitle')}</h1>
            <p className="muted">{state === 'used' ? t('confirm.usedText') : t('confirm.invalidText')}</p>
            <div className="flex flex-wrap gap-2">
              <Link to="/login" className="btn btn-primary">{t('confirm.toLogin')}</Link>
              {state === 'invalid' && (
                <a href={`${WEBSITE}/it/registrazione/`} className="btn btn-secondary">{t('confirm.toSignup')}</a>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
