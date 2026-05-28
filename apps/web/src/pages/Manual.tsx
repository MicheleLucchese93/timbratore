export function Manual() {
  return (
    <div
      style={{
        margin: '-1.5rem -2rem -2.5rem',
        height: 'calc(100vh)',
        display: 'flex',
      }}
    >
      <iframe
        src="/manuale-utente.html"
        title="Manuale Utente"
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          border: 'none',
          background: 'transparent',
          display: 'block',
        }}
      />
    </div>
  );
}
