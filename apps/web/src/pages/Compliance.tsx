import { useState } from 'react';
import { apiUrl, getToken } from '../lib/api.ts';

const docs: Array<{ key: string; title: string; description: string }> = [
  { key: 'dpia', title: 'DPIA — Valutazione di impatto', description: 'Documento precompilato con i dati della tua azienda. Da rivedere con un consulente legale.' },
  { key: 'privacy-notice', title: 'Informativa privacy', description: 'Informativa ex art. 13 GDPR per i dipendenti.' },
  { key: 'art4-checklist', title: 'Checklist art. 4 Statuto dei Lavoratori', description: 'Passi per adempiere all\'art. 4 (accordo aziendale o istanza ITL).' },
];

async function authedFetch(path: string): Promise<Response> {
  const token = getToken();
  if (!token) throw new Error('Sessione scaduta, effettua di nuovo il login.');
  const r = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    let detail = '';
    try { detail = (await r.clone().text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`Errore ${r.status} dal server${detail ? ': ' + detail : ''}`);
  }
  return r;
}

async function downloadDocx(key: string): Promise<void> {
  const res = await authedFetch(`/api/v1/compliance/${key}.docx`);
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? `${key}.docx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function openPrintWindow(key: string): Promise<void> {
  const res = await authedFetch(`/api/v1/compliance/${key}.html`);
  const html = await res.text();
  const w = window.open('', '_blank');
  if (!w) throw new Error('Impossibile aprire una nuova scheda. Controlla il blocco popup del browser.');
  const withPrint = html.replace(
    '</body>',
    '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300));<\/script></body>'
  );
  w.document.open();
  w.document.write(withPrint);
  w.document.close();
}

export function Compliance() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: 'pdf' | 'docx', key: string): Promise<void> {
    setBusy(`${key}:${action}`);
    setError(null);
    try {
      if (action === 'docx') await downloadDocx(key);
      else await openPrintWindow(key);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Errore sconosciuto';
      setError(msg);
      console.error('[Compliance]', action, key, e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <header>
        <h1 className="page-title">Conformità</h1>
        <p className="muted text-sm mt-0.5">Modelli precompilati per privacy e art. 4.</p>
      </header>
      <p className="text-sm text-neutral-700">
        Modelli pre-compilati per gli adempimenti privacy e art. 4. <strong>Sono modelli</strong>: scarica il file Word, rivedilo con il tuo legale e personalizzalo prima della firma.
      </p>
      {error && (
        <div className="card bg-red-50 border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}
      <ul className="space-y-3">
        {docs.map((d) => {
          const pdfBusy = busy === `${d.key}:pdf`;
          const docxBusy = busy === `${d.key}:docx`;
          return (
            <li key={d.key} className="card flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{d.title}</div>
                <div className="text-xs text-neutral-600 mt-1">{d.description}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { void run('pdf', d.key); }}
                  disabled={pdfBusy || docxBusy}
                  title="Apri in nuova scheda e stampa in PDF"
                >
                  {pdfBusy ? '…' : 'PDF'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => { void run('docx', d.key); }}
                  disabled={pdfBusy || docxBusy}
                  title="Scarica come Word modificabile"
                >
                  {docxBusy ? 'Scarico…' : 'Scarica DOCX'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
