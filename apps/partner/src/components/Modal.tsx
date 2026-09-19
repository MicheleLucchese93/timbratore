import { type ReactNode, useEffect, useRef } from 'react';

// Open dialogs, oldest first. Esc closes only the topmost one: a confirmation
// opened over another dialog must not take its parent down with it.
const openStack: number[] = [];
let nextModalId = 1;

/** Lightweight modal dialog. Children supply `.modal-body` + `.modal-foot`. */
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  testId,
}: {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** Widen to 960px for tall two-column forms so they fit without scrolling. */
  wide?: boolean;
  testId?: string;
}) {
  // Latest onClose without re-registering: re-running the effect would move
  // this dialog to the top of the stack on every parent re-render.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const id = nextModalId++;
    openStack.push(id);
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === id) closeRef.current();
    };
    window.addEventListener('keydown', h);
    return () => {
      window.removeEventListener('keydown', h);
      const i = openStack.indexOf(id);
      if (i >= 0) openStack.splice(i, 1);
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={wide ? 'modal wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        data-testid={testId}
      >
        <div className="modal-head">{title}</div>
        {children}
      </div>
    </div>
  );
}
