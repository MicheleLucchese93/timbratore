import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

interface Branch {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
  smart_working: boolean;
  active: boolean;
}

export function Branches() {
  const [list, setList] = useState<Branch[]>([]);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setList(await api<Branch[]>('/api/v1/branches'));
  }
  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, []);

  async function remove(id: string) {
    if (!confirm('Eliminare questa sede?')) return;
    await api(`/api/v1/branches/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sedi</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          Nuova sede
        </button>
      </div>
      {err && <div className="card text-sm text-[color:var(--color-error)]">{err}</div>}
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {list.map((b) => (
          <li key={b.id} className="card">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">{b.name}</div>
                <div className="text-xs text-neutral-600">{b.address ?? '—'}</div>
                <div className="text-xs text-neutral-500 mt-1">
                  {b.smart_working ? (
                    <span className="badge badge-muted">Smart working</span>
                  ) : (
                    <>
                      {b.latitude?.toFixed(4)}, {b.longitude?.toFixed(4)} · raggio {b.radius_m}m
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-secondary" onClick={() => setEditing(b)}>Modifica</button>
                <button className="btn btn-danger" onClick={() => remove(b.id)}>Elimina</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {(showCreate || editing) && (
        <BranchForm
          initial={editing ?? undefined}
          onClose={() => {
            setShowCreate(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setShowCreate(false);
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function BranchForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Branch;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [lat, setLat] = useState(initial?.latitude?.toString() ?? '');
  const [lng, setLng] = useState(initial?.longitude?.toString() ?? '');
  const [radius, setRadius] = useState(initial?.radius_m ?? 300);
  const [smartWorking, setSmartWorking] = useState(initial?.smart_working ?? false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        name,
        address: address || undefined,
        latitude: lat ? Number(lat) : undefined,
        longitude: lng ? Number(lng) : undefined,
        radius_m: Number(radius),
        smart_working: smartWorking,
      };
      if (initial) {
        await api(`/api/v1/branches/${initial.id}`, { method: 'PATCH', json: payload });
      } else {
        await api(`/api/v1/branches`, { method: 'POST', json: payload });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-lg space-y-3 max-h-[90vh] overflow-auto">
        <h2 className="text-lg font-semibold">{initial ? 'Modifica sede' : 'Nuova sede'}</h2>
        <div>
          <label className="label">Nome</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Indirizzo</label>
          <input
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="es. Piazza Venezia, 00187 Roma"
          />
          <p className="text-xs text-neutral-500 mt-1">
            Se latitudine/longitudine vuote, prova a risolvere via geocoding (Nominatim).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="sw"
            type="checkbox"
            checked={smartWorking}
            onChange={(e) => setSmartWorking(e.target.checked)}
          />
          <label htmlFor="sw" className="text-sm">Smart working (timbratura senza GPS)</label>
        </div>
        {!smartWorking && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Latitudine</label>
                <input className="input" value={lat} onChange={(e) => setLat(e.target.value)} />
              </div>
              <div>
                <label className="label">Longitudine</label>
                <input className="input" value={lng} onChange={(e) => setLng(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">Raggio (50–1500 m): {radius}m</label>
              <input
                type="range"
                min={50}
                max={1500}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </>
        )}
        {err && <div className="text-sm text-[color:var(--color-error)]">{err}</div>}
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annulla</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </form>
    </div>
  );
}
