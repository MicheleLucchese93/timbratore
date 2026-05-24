import { apiUrl, getToken } from '../lib/api.ts';

const docs: Array<{ key: string; title: string; description: string }> = [
  { key: 'dpia', title: 'DPIA — Valutazione di impatto', description: 'Documento precompilato con i dati della tua azienda. Da rivedere con un consulente legale.' },
  { key: 'privacy-notice', title: 'Informativa privacy', description: 'Informativa ex art. 13 GDPR per i dipendenti.' },
  { key: 'art4-checklist', title: 'Checklist art. 4 Statuto dei Lavoratori', description: 'Passi per adempiere all\'art. 4 (accordo aziendale o istanza ITL).' },
];

export function Compliance() {
  return (
    <div className="space-y-5 max-w-3xl">
      <header>
        <h1 className="page-title">Conformità</h1>
        <p className="muted text-sm mt-0.5">Modelli precompilati per privacy e art. 4.</p>
      </header>
      <p className="text-sm text-neutral-700">
        Modelli pre-compilati per gli adempimenti privacy e art. 4. <strong>Sono modelli</strong>: rivedili con il tuo legale prima della firma.
      </p>
      <ul className="space-y-3">
        {docs.map((d) => (
          <li key={d.key} className="card flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">{d.title}</div>
              <div className="text-xs text-neutral-600 mt-1">{d.description}</div>
            </div>
            <a
              className="btn btn-primary"
              href={`/api/v1/compliance/${d.key}.html`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.preventDefault();
                const token = getToken();
                if (!token) return;
                fetch(apiUrl(`/api/v1/compliance/${d.key}.html`), { headers: { Authorization: `Bearer ${token}` } })
                  .then((r) => r.text())
                  .then((html) => {
                    const w = window.open('', '_blank');
                    if (w) { w.document.write(html); w.document.close(); }
                  });
              }}
            >
              Apri
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
