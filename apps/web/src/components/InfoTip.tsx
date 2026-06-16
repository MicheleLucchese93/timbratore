/**
 * Small "(i)" info marker placed next to a field label. Hovering or focusing it
 * surfaces `text` as a native tooltip — enough for short hints (e.g. what a
 * Centro Paghe "qualifica" code is) without pulling in a tooltip library.
 */
export function InfoTip({ text }: { text: string }) {
  return (
    <span
      tabIndex={0}
      role="img"
      aria-label={text}
      title={text}
      className="inline-flex items-center justify-center align-middle cursor-help select-none"
      style={{
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
  );
}
