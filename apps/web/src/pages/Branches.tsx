import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { PlaceSearchInput, type PlaceDetail } from '../components/PlaceSearchInput.tsx';
import { BranchMapPreview } from '../components/BranchMapPreview.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';

interface Branch {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
  enforce_radius: boolean;
  smart_working: boolean;
  geofence_policy: 'lenient' | 'strict';
  gps_accuracy_ceiling_m: number;
  active: boolean;
}

export function Branches() {
  const [list, setList] = useState<Branch[]>([]);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const confirm = useConfirm();

  async function load() {
    setList(await api<Branch[]>('/api/v1/branches'));
  }
  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, []);

  async function remove(id: string) {
    if (!(await confirm({ title: 'Eliminare questa sede?', danger: true, confirmLabel: 'Elimina' }))) return;
    await api(`/api/v1/branches/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-end gap-4 flex-wrap">
        <h1 className="sr-only">Sedi</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Nuova sede</button>
      </header>
      {err && <div className="card text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {list.map((b) => (
          <li key={b.id} className="card flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{b.name}</div>
                <div className="text-xs text-neutral-600 truncate">{b.address ?? '—'}</div>
                <div className="text-xs text-neutral-500 mt-1">
                  {b.smart_working ? (
                    <span className="badge badge-muted">Smart working</span>
                  ) : (
                    <>
                      {b.latitude?.toFixed(4)}, {b.longitude?.toFixed(4)}
                      {b.enforce_radius ? ` · raggio ${b.radius_m}m` : ' · senza raggio'}
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(b)}>Modifica</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(b.id)}>Elimina</button>
              </div>
            </div>
            {!b.smart_working && b.latitude !== null && b.longitude !== null && (
              <BranchMapPreview
                lat={b.latitude}
                lng={b.longitude}
                radiusM={b.radius_m}
                showRadius={b.enforce_radius}
                height={280}
                interactive
              />
            )}
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
  const [enforceRadius, setEnforceRadius] = useState(initial?.enforce_radius ?? true);
  const [smartWorking, setSmartWorking] = useState(initial?.smart_working ?? false);
  const [geofencePolicy, setGeofencePolicy] = useState<'lenient' | 'strict'>(
    initial?.geofence_policy ?? 'lenient'
  );
  const [accuracyCeiling, setAccuracyCeiling] = useState(
    initial?.gps_accuracy_ceiling_m ?? 100
  );
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
        enforce_radius: enforceRadius,
        smart_working: smartWorking,
        geofence_policy: geofencePolicy,
        gps_accuracy_ceiling_m: Number(accuracyCeiling),
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
      <form
        onSubmit={submit}
        className="card w-full max-w-5xl max-h-[90vh] flex flex-col gap-4"
      >
        <h2 className="text-lg font-semibold">{initial ? 'Modifica sede' : 'Nuova sede'}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="label">Nome</label>
              <input
                className="input"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
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
              <label htmlFor="sw" className="text-sm">
                Smart working (timbratura senza GPS)
              </label>
            </div>
            {!smartWorking && (
              <>
                <div className="flex items-center gap-2">
                  <input
                    id="er"
                    type="checkbox"
                    checked={enforceRadius}
                    onChange={(e) => setEnforceRadius(e.target.checked)}
                  />
                  <label htmlFor="er" className="text-sm">
                    Limita timbratura entro un raggio
                  </label>
                </div>
                <p className="text-xs text-neutral-500 -mt-2">
                  Se disattivato: GPS viene comunque registrato sulla timbratura, ma senza
                  controllo di distanza. La sede dovrà essere selezionata manualmente
                  dall'utente (no auto-detect).
                </p>
                {enforceRadius && (
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
                      <label className="label">Politica geofence</label>
                      <select
                        className="input"
                        value={geofencePolicy}
                        onChange={(e) =>
                          setGeofencePolicy(e.target.value as 'lenient' | 'strict')
                        }
                      >
                        <option value="lenient">Permissiva (tollera accuracy)</option>
                        <option value="strict">Stretta</option>
                      </select>
                      <p className="text-xs text-neutral-500 mt-1">
                        Permissiva: accetta entro <em>raggio + accuracy</em>. Stretta: solo entro il raggio.
                      </p>
                    </div>
                    <div>
                      <label className="label">Accuratezza GPS massima (m)</label>
                      <input
                        type="number"
                        className="input"
                        min={10}
                        max={2000}
                        value={accuracyCeiling}
                        onChange={(e) => setAccuracyCeiling(Number(e.target.value))}
                      />
                      <p className="text-xs text-neutral-500 mt-1">
                        Sopra questa soglia la timbratura è respinta.
                      </p>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
          {!smartWorking && (
            <div className="flex flex-col">
              <label className="label">Anteprima</label>
              <BranchMapPreview
                lat={lat}
                lng={lng}
                radiusM={radius}
                showRadius={enforceRadius}
              />
              {lat !== null && lng !== null ? (
                <p className="text-xs text-neutral-500 mt-2">
                  {lat.toFixed(5)}, {lng.toFixed(5)}
                  {enforceRadius ? ` · tolleranza ${radius}m` : ' · senza raggio'}
                </p>
              ) : (
                <p className="text-xs text-neutral-500 mt-2">
                  Seleziona un indirizzo per visualizzare la sede sulla mappa.
                </p>
              )}
            </div>
          )}
        </div>
        {err && <div className="text-sm text-[color:var(--color-error)]">{err}</div>}
        <div className="flex gap-2 justify-end pt-2 mt-auto">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annulla</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </form>
    </div>
  );
}
