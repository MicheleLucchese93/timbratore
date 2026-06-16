import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import {
  PlaceSearchInput,
  type PlaceDetail,
  type PlaceSearchHandle,
} from '../components/PlaceSearchInput.tsx';
import { BranchMapPreview } from '../components/BranchMapPreview.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { IconButton } from '../components/IconButton.tsx';

interface Branch {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
  enforce_radius: boolean;
  smart_working: boolean;
  active: boolean;
}

interface Usage {
  branches_count: number | string;
  max_branches: number;
}

export function Branches() {
  const { t } = useTranslation(['branches', 'common']);
  const [list, setList] = useState<Branch[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const confirm = useConfirm();

  async function load() {
    const [branches, u] = await Promise.all([
      api<Branch[]>('/api/v1/branches'),
      api<Usage>('/api/v1/settings/usage'),
    ]);
    setList(branches);
    setUsage(u);
  }
  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, []);

  const branchesCount = Number(usage?.branches_count ?? list.length);
  const atLimit = !!usage && branchesCount >= usage.max_branches;

  async function remove(id: string) {
    if (!(await confirm({ title: t('deleteConfirm.title'), danger: true, confirmLabel: t('common:btn.delete') }))) return;
    await api(`/api/v1/branches/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('title')}
        subtitle={
          usage ? (
            <>
              <span className="muted">{t('count')}</span>
              <strong className="num">{branchesCount}</strong> / {usage.max_branches}
            </>
          ) : undefined
        }
        actions={
          <button
            className="btn btn-primary"
            disabled={atLimit}
            title={atLimit ? t('limitReachedTitle') : ''}
            onClick={() => setShowCreate(true)}
          >
            {t('new')}
          </button>
        }
      />
      {err && <div className="card text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {list.map((b) => (
          <li key={b.id} className="card flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{b.name}</div>
                <div className="text-xs muted truncate">{b.address ?? '—'}</div>
                <div className="text-xs muted mt-1">
                  {b.smart_working ? (
                    <span className="badge badge-muted">{t('offSite')}</span>
                  ) : (
                    <>
                      {b.latitude?.toFixed(4)}, {b.longitude?.toFixed(4)}
                      {b.enforce_radius ? ` · ${t('radius', { count: b.radius_m })}` : ` · ${t('noRadius')}`}
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-1 items-center shrink-0">
                <IconButton kind="edit" onClick={() => setEditing(b)} title={t('common:btn.edit')} />
                <IconButton kind="delete" onClick={() => remove(b.id)} title={t('common:btn.delete')} />
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
  const { t } = useTranslation(['branches', 'common']);
  const [name, setName] = useState(initial?.name ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [lat, setLat] = useState<number | null>(initial?.latitude ?? null);
  const [lng, setLng] = useState<number | null>(initial?.longitude ?? null);
  const [radius, setRadius] = useState(initial?.radius_m ?? 300);
  const [enforceRadius, setEnforceRadius] = useState(initial?.enforce_radius ?? true);
  const [smartWorking, setSmartWorking] = useState(initial?.smart_working ?? false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geoError, setGeoError] = useState(false);
  const placeRef = useRef<PlaceSearchHandle>(null);
  const geoReqRef = useRef(0);

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

  // The pin is now authoritative: move the marker immediately, then reverse-geocode
  // the point to fill the address field (use case: autocomplete result is imprecise).
  async function handleMapLocationSelect(point: { lat: number; lng: number }) {
    setLat(point.lat);
    setLng(point.lng);
    const myReq = ++geoReqRef.current;
    setGeocoding(true);
    setGeoError(false);
    try {
      const r = await api<{ address: string }>(
        `/api/v1/places/reverse?lat=${point.lat}&lng=${point.lng}`
      );
      if (myReq !== geoReqRef.current) return;
      if (r.address) {
        placeRef.current?.suppressNextSearch();
        setAddress(r.address);
      }
    } catch {
      if (myReq !== geoReqRef.current) return;
      setGeoError(true);
    } finally {
      if (myReq === geoReqRef.current) setGeocoding(false);
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
      };
      if (initial) {
        await api(`/api/v1/branches/${initial.id}`, { method: 'PATCH', json: payload });
      } else {
        await api(`/api/v1/branches`, { method: 'POST', json: payload });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
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
        <h2 className="text-lg font-semibold">{initial ? t('form.editTitle') : t('new')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="label">{t('form.name')}</label>
              <input
                className="input"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="label">{t('form.address')}</label>
              <PlaceSearchInput
                ref={placeRef}
                value={address}
                onChange={handleAddressChange}
                onSelect={handlePlace}
                placeholder={t('form.addressPlaceholder')}
                disabled={smartWorking}
                busy={geocoding}
              />
              {geocoding ? (
                <p className="text-xs muted mt-1">{t('form.geocoding')}</p>
              ) : geoError ? (
                <p className="text-xs text-[color:var(--color-error)] mt-1">
                  {t('form.geocodeError')}
                </p>
              ) : (
                <p className="text-xs muted mt-1">{t('form.addressHint')}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                id="sw"
                type="checkbox"
                checked={smartWorking}
                onChange={(e) => setSmartWorking(e.target.checked)}
              />
              <label htmlFor="sw" className="text-sm">
                {t('form.smartWorking')}
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
                    {t('form.enforceRadius')}
                  </label>
                </div>
                <p className="text-xs muted -mt-2">
                  {t('form.enforceRadiusHint')}
                </p>
                {enforceRadius && (
                  <>
                    <div>
                      <label className="label">{t('form.radiusLabel', { radius })}</label>
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
              </>
            )}
          </div>
          {!smartWorking && (
            <div className="flex flex-col">
              <label className="label">{t('form.preview')}</label>
              <BranchMapPreview
                lat={lat}
                lng={lng}
                radiusM={radius}
                showRadius={enforceRadius}
                onLocationSelect={handleMapLocationSelect}
              />
              {lat !== null && lng !== null ? (
                <p className="text-xs muted mt-2">
                  {lat.toFixed(5)}, {lng.toFixed(5)}
                  {enforceRadius ? ` · ${t('form.tolerance', { radius })}` : ` · ${t('noRadius')}`}
                </p>
              ) : (
                <p className="text-xs muted mt-2">
                  {t('form.previewEmpty')}
                </p>
              )}
            </div>
          )}
        </div>
        {err && <div className="text-sm text-[color:var(--color-error)]">{err}</div>}
        <div className="flex gap-2 justify-end pt-2 mt-auto">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t('common:btn.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('common:state.saving') : t('common:btn.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
