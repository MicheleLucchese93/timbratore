import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { PlaceSearchInput, type PlaceDetail } from '../components/PlaceSearchInput.tsx';
import { BranchMapPreview } from '../components/BranchMapPreview.tsx';

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
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Sedi</h1>
          <p className="muted text-sm mt-0.5">Luoghi di lavoro. Smart working è una sede senza GPS.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Nuova sede</button>
      </header>
      {err && <div className="card text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
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
              <div className="flex gap-2 shrink-0">
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(b)}>Modifica</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(b.id)}>Elimina</button>
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
  const [lat, setLat] = useState<number | null>(initial?.latitude ?? null);
  const [lng, setLng] = useState<number | null>(initial?.longitude ?? null);
  const [radius, setRadius] = useState(initial?.radius_m ?? 300);
  const [smartWorking, setSmartWorking] = useState(initial?.smart_working ?? false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function handlePlace(detail: PlaceDetail) {
    setAddress(detail.formatted_address ?? detail.description);
    if (detail.geometry) {
      setLat(detail.geometry.location.lat);
      setLng(detail.geometry.location.lng);
    }
  }

  function handleAddressChange(next: string) {
    setAddress(next);
    if (next.trim() === '') {
      setLat(null);
      setLng(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        name,
        address: address || undefined,
        latitude: lat ?? undefined,
        longitude: lng ?? undefined,
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
          <PlaceSearchInput
            value={address}
            onChange={handleAddressChange}
            onSelect={handlePlace}
            placeholder="Cerca su Google Maps: es. Piazza Venezia, Roma"
            disabled={smartWorking}
          />
          <p className="text-xs text-neutral-500 mt-1">
            Scrivi almeno 3 caratteri e seleziona un risultato per impostare le coordinate.
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
            <div>
              <label className="label">Anteprima</label>
              <BranchMapPreview lat={lat} lng={lng} radiusM={radius} />
              {lat !== null && lng !== null ? (
                <p className="text-xs text-neutral-500 mt-1">
                  {lat.toFixed(5)}, {lng.toFixed(5)} · tolleranza {radius}m
                </p>
              ) : (
                <p className="text-xs text-neutral-500 mt-1">
                  Seleziona un indirizzo per visualizzare la sede sulla mappa.
                </p>
              )}
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
