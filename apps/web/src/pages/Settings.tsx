import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

interface TenantSettings {
  id: string;
  ragione_sociale: string;
  country: string;
  timezone: string;
  language: 'it' | 'en';
  retention_years: number;
  geofence_policy: 'lenient' | 'strict';
  gps_accuracy_ceiling_m: number;
  mock_location_action: 'allow' | 'flag' | 'block';
  break_paid_threshold_min: number;
  max_shift_hours: number;
  max_break_hours: number;
  disable_desktop_clock_in: boolean;
}

export function Settings() {
  const [s, setS] = useState<TenantSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setS(await api<TenantSettings>('/api/v1/settings'));
  }
  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      await api('/api/v1/settings', { method: 'PATCH', json: {
        ragione_sociale: s.ragione_sociale,
        timezone: s.timezone,
        language: s.language,
        retention_years: s.retention_years,
        geofence_policy: s.geofence_policy,
        gps_accuracy_ceiling_m: s.gps_accuracy_ceiling_m,
        mock_location_action: s.mock_location_action,
        break_paid_threshold_min: s.break_paid_threshold_min,
        max_shift_hours: s.max_shift_hours,
        max_break_hours: s.max_break_hours,
        disable_desktop_clock_in: s.disable_desktop_clock_in,
      } });
      setMsg('Impostazioni salvate.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <div className="card text-sm">Caricamento…</div>;

  return (
    <form onSubmit={submit} className="space-y-5 max-w-2xl">
      <header>
        <h1 className="page-title">Impostazioni</h1>
        <p className="muted text-sm mt-0.5">Configurazione della tua azienda.</p>
      </header>
      {err && <div className="card text-sm text-[color:var(--color-error)]">{err}</div>}
      {msg && <div className="card text-sm text-[color:var(--color-success)]">{msg}</div>}

      <Section title="Generali">
        <Field label="Ragione sociale">
          <input className="input" value={s.ragione_sociale} onChange={(e) => setS({ ...s, ragione_sociale: e.target.value })} />
        </Field>
        <Field label="Timezone">
          <input className="input" value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} />
        </Field>
        <Field label="Lingua">
          <select className="input" value={s.language} onChange={(e) => setS({ ...s, language: e.target.value as 'it' | 'en' })}>
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select>
        </Field>
        <Field label="Conservazione (anni)">
          <input type="number" min={1} max={10} className="input" value={s.retention_years} onChange={(e) => setS({ ...s, retention_years: Number(e.target.value) })} />
        </Field>
      </Section>

      <Section title="Timbrature">
        <Field label="Politica geofence">
          <select className="input" value={s.geofence_policy} onChange={(e) => setS({ ...s, geofence_policy: e.target.value as 'lenient' | 'strict' })}>
            <option value="lenient">Permissiva (tolleranza accuracy)</option>
            <option value="strict">Stretta</option>
          </select>
        </Field>
        <Field label="Accuratezza GPS massima (m)">
          <input type="number" className="input" value={s.gps_accuracy_ceiling_m} onChange={(e) => setS({ ...s, gps_accuracy_ceiling_m: Number(e.target.value) })} />
        </Field>
        <Field label="Mock location">
          <select className="input" value={s.mock_location_action} onChange={(e) => setS({ ...s, mock_location_action: e.target.value as 'allow' | 'flag' | 'block' })}>
            <option value="allow">Consenti</option>
            <option value="flag">Segnala</option>
            <option value="block">Blocca</option>
          </select>
        </Field>
        <Field label="Soglia pausa retribuita (minuti)">
          <input type="number" className="input" value={s.break_paid_threshold_min} onChange={(e) => setS({ ...s, break_paid_threshold_min: Number(e.target.value) })} />
        </Field>
        <Field label="Turno massimo (ore)">
          <input type="number" className="input" value={s.max_shift_hours} onChange={(e) => setS({ ...s, max_shift_hours: Number(e.target.value) })} />
        </Field>
        <Field label="Pausa massima (ore)">
          <input type="number" className="input" value={s.max_break_hours} onChange={(e) => setS({ ...s, max_break_hours: Number(e.target.value) })} />
        </Field>
        <div className="flex items-center gap-2 col-span-full">
          <input id="ddci" type="checkbox" checked={s.disable_desktop_clock_in} onChange={(e) => setS({ ...s, disable_desktop_clock_in: e.target.checked })} />
          <label htmlFor="ddci" className="text-sm">Disabilita timbratura dal web (solo mobile)</label>
        </div>
      </Section>

      <button className="btn btn-primary" disabled={busy} type="submit">{busy ? 'Salvataggio…' : 'Salva'}</button>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="card space-y-3">
      <legend className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</legend>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>
    </fieldset>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
