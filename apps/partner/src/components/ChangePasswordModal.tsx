import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import type { ApiError } from '../lib/api.ts';
import { Modal } from './Modal.tsx';
import { PasswordField } from './PasswordField.tsx';
import { useToast } from './Toast.tsx';

// Complexity rules — mirror the backend (apps/backend/src/lib/password.ts) and
// the static set-password page. Each lights up live as the user types.
const RULES = [
  { id: 'length', test: (p: string) => p.length >= 8 },
  { id: 'lower', test: (p: string) => /[a-z]/.test(p) },
  { id: 'upper', test: (p: string) => /[A-Z]/.test(p) },
  { id: 'digit', test: (p: string) => /[0-9]/.test(p) },
  { id: 'symbol', test: (p: string) => /[^a-zA-Z0-9]/.test(p) },
] as const;

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
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
      await api('/api/v1/partnership/change-password', {
        method: 'POST',
        json: { current_password: current, new_password: next },
      });
      toast(t('password.success'));
      onClose();
    } catch (e2) {
      const code = (e2 as ApiError | null)?.code;
      setErr(t(code === 'INVALID_CURRENT_PASSWORD' ? 'password.errWrongCurrent' : 'password.errGeneric'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('password.title')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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

          {err && <div className="form-err">{err}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('actions.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {busy ? t('password.submitting') : t('password.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
