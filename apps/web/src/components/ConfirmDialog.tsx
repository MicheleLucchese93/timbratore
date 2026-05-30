import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface ConfirmOptions {
  /** Heading of the dialog. */
  title: string;
  /** Optional body text/markup explaining the consequence. */
  message?: ReactNode;
  /** Label of the confirm button. Default "Conferma". */
  confirmLabel?: string;
  /** Label of the cancel button. Default "Annulla". */
  cancelLabel?: string;
  /** Render the confirm button in the danger style (destructive action). */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/**
 * App-wide confirmation dialog. Provides an imperative, promise-based
 * `confirm()` via {@link useConfirm} as a drop-in replacement for the native
 * `window.confirm`, styled to match the rest of the app.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);
  const pendingRef = useRef<PendingState | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        const next = { ...opts, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    []
  );

  const close = useCallback((ok: boolean) => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    p?.resolve(ok);
  }, []);

  // Focus the confirm button when the dialog opens, and wire Escape to cancel.
  useEffect(() => {
    if (!pending) return;
    confirmBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50"
          onClick={() => close(false)}
        >
          <div
            className="card w-full max-w-md space-y-3"
            role="alertdialog"
            aria-modal="true"
            aria-label={pending.title}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="section-title">{pending.title}</h2>
            {pending.message != null && (
              <div className="text-sm muted">{pending.message}</div>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn btn-secondary" onClick={() => close(false)}>
                {pending.cancelLabel ?? 'Annulla'}
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                className={pending.danger ? 'btn btn-danger' : 'btn btn-primary'}
                onClick={() => close(true)}
              >
                {pending.confirmLabel ?? 'Conferma'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * Returns an async `confirm(opts)` that resolves to `true` when the user
 * confirms and `false` when they cancel/dismiss. Drop-in replacement for
 * `window.confirm`:
 *
 * ```ts
 * if (!(await confirm({ title: 'Eliminare?', danger: true }))) return;
 * ```
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return ctx;
}
