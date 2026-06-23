import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal.tsx';

export interface ConfirmOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn>(async () => false);
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmCtx);
}

// In-app replacement for window.confirm — promise-based, styled like the rest of
// the app (no native browser popup). Resolves true on confirm, false on
// cancel / backdrop / Esc.
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(v: boolean) => void>(() => {});

  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOpts(o);
      }),
    []
  );

  const settle = (v: boolean) => {
    setOpts(null);
    resolver.current(v);
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {opts && (
        <Modal title={opts.title ?? t('confirm.title')} onClose={() => settle(false)}>
          <div className="modal-body">
            <p style={{ fontSize: '0.9rem', color: 'var(--color-on-surface)' }}>{opts.message}</p>
          </div>
          <div className="modal-foot">
            <button className="btn btn-ghost" data-testid="confirm-cancel" onClick={() => settle(false)}>
              {opts.cancelLabel ?? t('actions.cancel')}
            </button>
            <button
              className={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`}
              data-testid="confirm-ok"
              onClick={() => settle(true)}
            >
              {opts.confirmLabel ?? t('actions.confirm')}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}
