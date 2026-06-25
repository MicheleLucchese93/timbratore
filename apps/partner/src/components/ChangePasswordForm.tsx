import { type FormEvent, type InputHTMLAttributes, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';

// Complexity rules — mirror the backend (apps/backend/src/lib/password.ts) and
// the static set-password page. Each lights up live as the user types.
const RULES = [
  { id: 'length', test: (p: string) => p.length >= 8 },
  { id: 'lower', test: (p: string) => /[a-z]/.test(p) },
  { id: 'upper', test: (p: string) => /[A-Z]/.test(p) },
  { id: 'digit', test: (p: string) => /[0-9]/.test(p) },
  { id: 'symbol', test: (p: string) => /[^a-zA-Z0-9]/.test(p) },
] as const;

type Status = { kind: 'ok' | 'err'; text: string } | null;

export function ChangePasswordForm() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && RULES.every((r) => r.test(next)) && next === confirm && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setStatus(null);
    try {
      await api('/api/v1/partnership/change-password', {
        method: 'POST',
        json: { current_password: current, new_password: next },
      });
      setStatus({ kind: 'ok', text: t('password.success') });
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      const key = code === 'INVALID_CURRENT_PASSWORD' ? 'password.errWrongCurrent' : 'password.errGeneric';
      setStatus({ kind: 'err', text: t(key) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 380 }}>
      <div>
        <label className="label" htmlFor="cp-current">{t('password.current')}</label>
        <PasswordField id="cp-current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>

      <div>
        <label className="label" htmlFor="cp-new">{t('password.new')}</label>
        <PasswordField id="cp-new" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <ul className="pw-requirements" aria-label={t('password.requirementsTitle')}>
          {RULES.map((r) => (
            <li key={r.id} className={r.test(next) ? 'valid' : ''}>
              {t(`password.rule.${r.id}`)}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <label className="label" htmlFor="cp-confirm">{t('password.confirm')}</label>
        <PasswordField id="cp-confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {mismatch && <p className="muted" style={{ color: 'var(--color-error)', marginTop: '0.375rem' }}>{t('password.mismatch')}</p>}
      </div>

      {status && (
        status.kind === 'err'
          ? <div className="form-err">{status.text}</div>
          : <div className="form-ok">{status.text}</div>
      )}

      <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
        {busy ? t('password.submitting') : t('password.submit')}
      </button>
    </form>
  );
}

// Local password input with show/hide toggle (the partner app has no shared
// PasswordInput component; login uses a plain input).
type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { id: string };
function PasswordField({ id, ...rest }: FieldProps) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <div className="pw-wrap">
      <input id={id} type={shown ? 'text' : 'password'} className="input" {...rest} />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? t('password.hide') : t('password.show')}
        tabIndex={-1}
      >
        {shown ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}
function Eye() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOff() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-10-7-10-7a19.77 19.77 0 0 1 4.22-5.42" />
      <path d="M22.54 12.88A18.49 18.49 0 0 0 22 12s-3-7-10-7a10.97 10.97 0 0 0-1.59.12" />
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
    </svg>
  );
}
