import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Push = (msg: string, err?: boolean) => void;
interface ToastItem { id: number; msg: string; err?: boolean }

const ToastCtx = createContext<Push>(() => {});
export function useToast(): Push {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback<Push>((msg, err) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.err ? 'toast-err' : ''}`} role="status">
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
