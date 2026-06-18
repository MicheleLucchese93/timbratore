import { useEffect, useRef } from 'react';

// Module-level stack of open dismissibles (modals, popovers, confirm dialogs).
// Only the topmost (most recently opened) handler fires on Escape, so pressing
// Escape with a confirm dialog layered over a modal cancels the confirm only —
// it does not also close the modal underneath. A single shared window listener
// serves every consumer.
const stack: Array<() => void> = [];
let listening = false;

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  const top = stack[stack.length - 1];
  if (top) top();
}

/**
 * Dismiss a modal/popup when the user presses Escape. Pass the same handler the
 * backdrop/Cancel button uses. Pass `enabled=false` to opt out (e.g. while the
 * dialog is mid-submit). When several dismissibles are open at once, Escape only
 * closes the one opened last.
 */
export function useEscapeKey(onClose: () => void, enabled = true): void {
  // Keep the latest handler in a ref so the stack entry stays stable while the
  // effect runs only when `enabled` flips — no re-subscribe churn each render.
  const ref = useRef(onClose);
  ref.current = onClose;

  useEffect(() => {
    if (!enabled) return;
    const entry = () => ref.current();
    stack.push(entry);
    if (!listening) {
      window.addEventListener('keydown', onKey);
      listening = true;
    }
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [enabled]);
}
