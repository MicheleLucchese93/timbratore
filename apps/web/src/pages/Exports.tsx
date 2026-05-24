import { type FormEvent, useEffect, useState } from 'react';
import { api, getToken, apiUrl } from '../lib/api.ts';

interface ExportJob {
  id: string;
  format: 'xlsx' | 'json';
  period_from: string;
  period_to: string;
  status: 'pending' | 'running' | 'ready' | 'failed';
  r2_key: string | null;
  error: string | null;
  created_at: string;
}

export function Exports() {
  const [list, setList] = useState<ExportJob[]>([]);
  const [from, setFrom] = useState(() => firstOfPrevMonth());
  const [to, setTo] = useState(() => lastOfPrevMonth());
  const [format, setFormat] = useState<'xlsx' | 'json'>('xlsx');
  const [busy, setBusy] = useState(false);

  async function load() {
    setList(await api<ExportJob[]>('/api/v1/exports'));
  }
  useEffect(() => {
    load().catch(() => {});
    const id = setInterval(() => load().catch(() => {}), 2000);
    return () => clearInterval(id);
  }, []);

  async function enqueue(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/v1/exports', { method: 'POST', json: { format, period_from: from, period_to: to, filters: {} } });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function download(j: ExportJob) {
    const r = await fetch(apiUrl(`/api/v1/exports/${j.id}/download`), {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!r.ok) { alert('Download fallito'); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${j.id}.${j.format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="page-title">Esportazioni</h1>
        <p className="muted text-sm mt-0.5">XLSX commercialista o JSON, sull'intero tenant.</p>
      </header>

      <form onSubmit={enqueue} className="card grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="label">Dal</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </div>
        <div>
          <label className="label">Al</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} required />
        </div>
        <div>
          <label className="label">Formato</label>
          <select className="input" value={format} onChange={(e) => setFormat(e.target.value as 'xlsx' | 'json')}>
            <option value="xlsx">XLSX (commercialista)</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Invio…' : 'Genera'}</button>
      </form>

      <div className="card p-0">
        <div className="table-wrap">
          <table className="table">
            <colgroup>
              <col style={{ width: '14rem' }} />
              <col style={{ width: '6rem' }} />
              <col style={{ width: '9rem' }} />
              <col style={{ width: '12rem' }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Formato</th>
                <th>Stato</th>
                <th>Creata</th>
                <th className="text-right">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr><td colSpan={5} className="py-6 text-center muted">Nessuna esportazione ancora.</td></tr>
              ) : list.map((j) => (
                <tr key={j.id}>
                  <td className="num nowrap text-xs">{j.period_from} → {j.period_to}</td>
                  <td>{j.format.toUpperCase()}</td>
                  <td><StatusBadge status={j.status} /></td>
                  <td className="text-xs num">{new Date(j.created_at).toLocaleString('it-IT')}</td>
                  <td>
                    <div className="table-actions">
                      {j.status === 'ready' && (
                        <button className="btn btn-secondary btn-sm" onClick={() => download(j)}>Scarica</button>
                      )}
                      {j.status === 'failed' && j.error && (
                        <span className="text-xs" style={{ color: 'var(--color-error)' }}>{j.error}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ExportJob['status'] }) {
  if (status === 'ready') return <span className="badge badge-ok">pronta</span>;
  if (status === 'failed') return <span className="badge badge-err">errore</span>;
  if (status === 'running') return <span className="badge badge-warn">in elaborazione</span>;
  return <span className="badge badge-muted">in coda</span>;
}

function firstOfPrevMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}
function lastOfPrevMonth(): string {
  const d = new Date();
  d.setDate(0);
  return d.toISOString().slice(0, 10);
}
