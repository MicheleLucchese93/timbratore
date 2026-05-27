import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

interface TenantSettings {
  id: string;
  ragione_sociale: string;
  partita_iva: string | null;
  country: string;
  timezone: string;
  language: 'it' | 'en';
  retention_years: number;
  mock_location_action: 'allow' | 'flag' | 'block';
}

type AutoSaveKey = 'timezone' | 'language';

const TIMEZONE_OPTIONS = [
  'Europe/Rome',
  'Europe/London',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Berlin',
  'Europe/Lisbon',
  'Europe/Athens',
  'Europe/Zurich',
  'UTC',
];

type Toast = { kind: 'ok' | 'err'; text: string } | null;

interface MePrefs {
  language: 'it' | 'en';
  email_notifications_enabled: boolean;
  push_token_registered: boolean;
}

interface MeResponse {
  preferences?: MePrefs;
}

export function Settings() {
  const [s, setS] = useState<TenantSettings | null>(null);
  const [prefs, setPrefs] = useState<MePrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  async function load() {
    const [data, me] = await Promise.all([
      api<TenantSettings>('/api/v1/settings'),
      api<MeResponse>('/api/v1/me'),
    ]);
    setS(data);
    setPrefs(me.preferences ?? null);
  }
  useEffect(() => {
    load().catch((e) => setToast({ kind: 'err', text: e.message }));
  }, []);

  async function saveEmailPref(next: boolean) {
    if (!prefs) return;
    const prev = prefs.email_notifications_enabled;
    setPrefs({ ...prefs, email_notifications_enabled: next });
    try {
      await api('/api/v1/me', {
        method: 'PATCH',
        json: { email_notifications_enabled: next },
      });
      setToast({
        kind: 'ok',
        text: next ? 'Notifiche email attivate.' : 'Notifiche email disattivate.',
      });
    } catch (e) {
      setPrefs((cur) => (cur ? { ...cur, email_notifications_enabled: prev } : cur));
      setToast({ kind: 'err', text: e instanceof Error ? e.message : 'Errore' });
    }
  }

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  async function patchSettings(patch: Partial<TenantSettings>): Promise<boolean> {
    setBusy(true);
    try {
      const updated = await api<TenantSettings>('/api/v1/settings', {
        method: 'PATCH',
        json: patch,
      });
      setS(updated);
      setToast({ kind: 'ok', text: 'Impostazione salvata.' });
      return true;
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : 'Errore di salvataggio' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function autoSave<K extends AutoSaveKey>(key: K, value: TenantSettings[K]) {
    if (!s) return;
    const prev = s[key];
    setS({ ...s, [key]: value });
    const ok = await patchSettings({ [key]: value } as Partial<TenantSettings>);
    if (!ok) setS((cur) => (cur ? { ...cur, [key]: prev } : cur));
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
  }

  if (!s) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-[color:var(--color-surface-variant)] rounded" />
        <div className="h-4 w-72 bg-[color:var(--color-surface-variant)] rounded" />
        <div className="card h-64" />
      </div>
    );
  }

  return (
    <form onSubmit={onFormSubmit} className="max-w-5xl">
      <header className="mb-2">
        <h1 className="page-title">Impostazioni</h1>
        <p className="muted text-sm mt-1">Configurazione globale dell'azienda. Le modifiche si applicano a tutti gli utenti.</p>
      </header>

      <div className="hairline my-6" />

      <SettingsRow
        icon={<IconBuilding />}
        title="Anagrafica e localizzazione"
        description="Dati base dell'azienda e lingua di sistema. La ragione sociale e la partita IVA sono impostate al provisioning del tenant."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Ragione sociale">
            <input
              className="input"
              value={s.ragione_sociale}
              readOnly
              disabled
            />
            <p className="field-hint">Solo lettura. Modificabile dal provider.</p>
          </Field>
          <Field label="Partita IVA">
            <input
              className="input"
              value={s.partita_iva ?? ''}
              readOnly
              disabled
              placeholder="—"
            />
            <p className="field-hint">Solo lettura. Modificabile dal provider.</p>
          </Field>
          <Field label="Timezone">
            <select
              className="input"
              value={s.timezone}
              disabled={busy}
              onChange={(e) => void autoSave('timezone', e.target.value)}
            >
              {!TIMEZONE_OPTIONS.includes(s.timezone) && (
                <option value={s.timezone}>{s.timezone}</option>
              )}
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <p className="field-hint">Influenza i fusi nei report.</p>
          </Field>
          <Field label="Lingua interfaccia">
            <select
              className="input"
              value={s.language}
              disabled={busy}
              onChange={(e) => void autoSave('language', e.target.value as 'it' | 'en')}
            >
              <option value="it">Italiano</option>
              <option value="en">English</option>
            </select>
          </Field>
        </div>
      </SettingsRow>

      <div className="hairline my-6" />

      <SettingsRow
        icon={<IconBell />}
        title="Notifiche personali"
        description="Le notifiche push sono sempre attive se hai installato l'app mobile. L'email è disattivata di default — accendila se vuoi ricevere anche le notifiche via posta elettronica."
      >
        <label className="flex items-center gap-3 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={prefs?.email_notifications_enabled ?? false}
            disabled={!prefs}
            onChange={(e) => void saveEmailPref(e.target.checked)}
          />
          <span>
            Invia notifiche via email per correzioni, ferie, permessi e malattia
          </span>
        </label>
        {prefs && (
          <p className="field-hint">
            Push:{' '}
            {prefs.push_token_registered
              ? 'dispositivo mobile registrato'
              : 'nessun dispositivo mobile registrato (apri l\'app per attivarlo)'}.
          </p>
        )}
      </SettingsRow>

      {toast && (
        <div className={`toast ${toast.kind === 'ok' ? 'toast-ok' : 'toast-err'}`} role="status">
          {toast.kind === 'ok' ? <IconCheck /> : <IconAlert />}
          <span>{toast.text}</span>
        </div>
      )}
    </form>
  );
}

function SettingsRow({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-row">
      <div className="settings-row-head">
        <h3>
          <span className="text-[color:var(--color-primary)]">{icon}</span>
          {title}
        </h3>
        <p>{description}</p>
      </div>
      <div className="settings-row-body">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

/* Icons (inline, no dep) ------------------------------------------------ */
function IconBell() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
function IconBuilding() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function IconAlert() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}
