import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../store/session.ts';
import { useToast } from './Toast.tsx';
import { Modal } from './Modal.tsx';
import type { ApiError } from '../lib/api.ts';

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const me = useSession((s) => s.me);
  const updateProfile = useSession((s) => s.updateProfile);
  const [first, setFirst] = useState(me?.first_name ?? '');
  const [last, setLast] = useState(me?.last_name ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await updateProfile({ first_name: first.trim() || null, last_name: last.trim() || null });
      toast(t('profile.saved'));
      onClose();
    } catch (e2) {
      const code = (e2 as ApiError | null)?.code;
      setErr(t(`errors.${code ?? 'default'}`, { defaultValue: t('errors.default') }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('profile.title')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <div>
            <label className="label">{t('profile.email')}</label>
            <input className="input" value={me?.email ?? ''} disabled />
          </div>
          <div className="grid-2">
            <div>
              <label className="label" htmlFor="pf-first">{t('profile.first_name')}</label>
              <input id="pf-first" className="input" value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="pf-last">{t('profile.last_name')}</label>
              <input id="pf-last" className="input" value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
          </div>
          {err && <div className="form-err">{err}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('actions.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="profile-submit">
            {busy ? t('common.saving') : t('actions.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
