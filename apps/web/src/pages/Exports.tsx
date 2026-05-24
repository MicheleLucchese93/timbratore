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
      await api('/api/v1/exports', {
        method: 'POST',
        json: { format, period_from: from, period_to: to, filters: {} },
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function download(j: ExportJob) {
    const r = await fetch(apiUrl(`/api/v1/exports/${j.id}/download`), {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!r.ok) {
      alert('Download fallito');
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${j.id}.${j.format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Esportazioni</h1>
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
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Invio…' : 'Genera'}</button>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-neutral-500 uppercase">
            <tr>
              <th className="py-2">Periodo</th>
              <th className="py-2">Formato</th>
              <th className="py-2">Stato</th>
              <th className="py-2">Creata</th>
              <th className="py-2 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={5} className="py-4 text-center text-neutral-500">Nessuna esportazione ancora.</td></tr>
            ) : list.map((j) => (
              <tr key={j.id} className="border-t border-neutral-100">
                <td className="py-2">{j.period_from} → {j.period_to}</td>
                <td className="py-2">{j.format.toUpperCase()}</td>
                <td className="py-2"><StatusBadge status={j.status} /></td>
                <td className="py-2 text-xs">{new Date(j.created_at).toLocaleString('it-IT')}</td>
                <td className="py-2 text-right">
                  {j.status === 'ready' && (
                    <button className="btn btn-secondary text-xs" onClick={() => download(j)}>Scarica</button>
                  )}
                  {j.status === 'failed' && j.error && (
                    <span className="text-xs text-[color:var(--color-error)]">{j.error}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
