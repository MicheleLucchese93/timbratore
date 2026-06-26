import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';
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

// Change-password dialog opened from Settings → Sicurezza. Lives OUTSIDE the
// settings <form> so it can use a real <form> of its own.
export function ChangePasswordModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation(['settings', 'common']);
  useEscapeKey(onClose);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && RULES.every((r) => r.test(next)) && next === confirm && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      await api('/api/v1/me/change-password', {
        method: 'POST',
        json: { current_password: current, new_password: next },
      });
      onDone();
    } catch (e2) {
      const code = (e2 as { code?: string } | null)?.code;
      setErr(t(code === 'INVALID_CURRENT_PASSWORD' ? 'password.errWrongCurrent' : 'password.errGeneric'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <form
        className="card w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className="section-title">{t('password.title')}</h2>

        <div>
          <label className="label" htmlFor="cp-current">{t('password.current')}</label>
          <PasswordInput id="cp-current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>

        <div>
          <label className="label" htmlFor="cp-new">{t('password.new')}</label>
          <PasswordInput id="cp-new" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
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
          <PasswordInput id="cp-confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {mismatch && <p className="field-hint" style={{ color: 'var(--color-error)' }}>{t('password.mismatch')}</p>}
        </div>

        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {busy ? t('password.submitting') : t('password.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
