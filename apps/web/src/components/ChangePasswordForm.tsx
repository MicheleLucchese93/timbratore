import { type KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { PasswordInput } from './PasswordInput.tsx';

// Complexity rules — mirror the backend (apps/backend/src/lib/password.ts) and
// the static set-password page. Each lights up live as the user types, like the
// reset-password flow.
const RULES = [
  { id: 'length', test: (p: string) => p.length >= 8 },
  { id: 'lower', test: (p: string) => /[a-z]/.test(p) },
  { id: 'upper', test: (p: string) => /[A-Z]/.test(p) },
  { id: 'digit', test: (p: string) => /[0-9]/.test(p) },
  { id: 'symbol', test: (p: string) => /[^a-zA-Z0-9]/.test(p) },
] as const;

type Status = { kind: 'ok' | 'err'; text: string } | null;

export function ChangePasswordForm() {
  const { t } = useTranslation(['settings', 'common']);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const allPass = RULES.every((r) => r.test(next));
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && allPass && next === confirm && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setStatus(null);
    try {
      await api('/api/v1/me/change-password', {
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

  // Settings already wraps the page in a <form>; this section lives inside it as
  // a <div> (nested forms are invalid). Enter on any field submits.
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="space-y-4 max-w-md" onKeyDown={onKeyDown}>
      <div>
        <label className="label" htmlFor="cp-current">{t('password.current')}</label>
        <PasswordInput
          id="cp-current"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="cp-new">{t('password.new')}</label>
        <PasswordInput
          id="cp-new"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
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
        <PasswordInput
          id="cp-confirm"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch && <p className="field-hint" style={{ color: 'var(--color-error)' }}>{t('password.mismatch')}</p>}
      </div>

      {status && (
        <div
          className="rounded-md px-3 py-2 text-sm"
          role="status"
          style={
            status.kind === 'ok'
              ? { background: 'color-mix(in oklab, var(--color-success) 14%, transparent)', color: 'var(--color-success)' }
              : { background: 'var(--color-error-tint)', color: 'var(--color-error)' }
          }
        >
          {status.text}
        </div>
      )}

      <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={() => void submit()}>
        {busy ? t('password.submitting') : t('password.submit')}
      </button>
    </div>
  );
}
