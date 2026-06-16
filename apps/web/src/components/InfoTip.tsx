import { useId, useRef, useState } from 'react';

/**
 * Small "(i)" info marker placed next to a field label. Hovering or focusing it
 * surfaces `text` in a styled popover — enough for short hints (e.g. what a
 * Centro Paghe "qualifica" code is) without pulling in a tooltip library.
 *
 * The bubble is `position: fixed` so it escapes any scrollable/overflow-hidden
 * ancestor (e.g. the modal form's `overflow-y-auto`) instead of being clipped,
 * and its text styles are reset because labels apply uppercase/letter-spacing
 * that would otherwise bleed into the hint.
 */
export function InfoTip({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const id = useId();

  function show() {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const maxWidth = 260;
    const margin = 8;
    const left = Math.max(
      margin,
      Math.min(r.left, window.innerWidth - maxWidth - margin),
    );
    setPos({ top: r.bottom + 6, left });
  }
  function hide() {
    setPos(null);
  }

  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        role="img"
        aria-label={text}
        aria-describedby={pos ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex items-center justify-center align-middle cursor-help select-none shrink-0"
        style={{
          marginLeft: 4,
          width: 15,
          height: 15,
          borderRadius: '9999px',
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1,
          fontStyle: 'italic',
          background: 'var(--color-primary)',
          color: '#fff',
        }}
      >
        i
      </span>
      {pos && (
        <span
          id={id}
          role="tooltip"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            zIndex: 100,
            maxWidth: 260,
            padding: '6px 9px',
            borderRadius: 8,
            background: 'var(--color-on-surface, #1f2937)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 400,
            fontStyle: 'normal',
            lineHeight: 1.35,
            letterSpacing: 'normal',
            textTransform: 'none',
            whiteSpace: 'normal',
            boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
            pointerEvents: 'none',
          }}
        >
          {text}
        </span>
      )}
    </>
  );
}
