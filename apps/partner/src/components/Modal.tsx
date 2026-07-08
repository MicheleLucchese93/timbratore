import { type ReactNode, useEffect } from 'react';

/** Lightweight modal dialog. Children supply `.modal-body` + `.modal-foot`. */
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** Widen to 960px for tall two-column forms so they fit without scrolling. */
  wide?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">{title}</div>
        {children}
      </div>
    </div>
  );
}
