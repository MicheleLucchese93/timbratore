import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CENTRO_PAGHE_CODES,
  CENTRO_PAGHE_MAP_KEYS,
  effectiveCentroPagheMap,
} from '@sonoqui/shared';
import { api } from '../lib/api.ts';
import { useSession } from '../store/session.ts';
import { LanguageSelect } from '../components/LanguageSwitcher.tsx';
import { PageHeader } from '../components/PageHeader.tsx';

interface TenantSettings {
  id: string;
  ragione_sociale: string;
  partita_iva: string | null;
  country: string;
  timezone: string;
  language: 'it' | 'en';
  retention_years: number;
  mock_location_action: 'allow' | 'flag' | 'block';
  // Centro Paghe export config (migration 040).
  codice_ditta: string | null;
  cp_code_len: 2 | 4;
  cp_donazione_cf: string | null;
  cp_giustificativo_map: Record<string, string> | null;
}

type AutoSaveKey = 'timezone';

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
  language: 'it' | 'en' | null;
  email_notifications_enabled: boolean;
  push_token_registered: boolean;
  notification_preferences?: Record<string, boolean>;
}

// Per-category email toggles, mirroring the push split (migration 030).
const EMAIL_PREFS: Array<{ key: string; i18nKey: string }> = [
  { key: 'email_leave_decisions', i18nKey: 'emailLeaveDecisions' },
  { key: 'email_leave_submissions', i18nKey: 'emailLeaveSubmissions' },
  { key: 'email_correction_decisions', i18nKey: 'emailCorrectionDecisions' },
  { key: 'email_correction_submissions', i18nKey: 'emailCorrectionSubmissions' },
  { key: 'email_leave_reminders', i18nKey: 'emailLeaveReminders' },
  // New HR document available. Note: this key defaults ON server-side (the only
  // email pref that does), so the toggle shows on for users who never touched it.
  { key: 'email_documents', i18nKey: 'emailDocuments' },
];

interface MeResponse {
  preferences?: MePrefs;
}

export function Settings() {
  const { t } = useTranslation(['settings', 'common']);
  const [s, setS] = useState<TenantSettings | null>(null);
  const [piva, setPiva] = useState('');
  const [prefs, setPrefs] = useState<MePrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const tenants = useSession((st) => st.tenants);
  const activeTenantId = useSession((st) => st.activeTenantId);
  const chooseTenant = useSession((st) => st.chooseTenant);
  const [switching, setSwitching] = useState(false);
  const isAdmin = tenants.find((tn) => tn.tenant_id === activeTenantId)?.role === 'admin';

  async function onSwitchTenant(id: string) {
    if (id === activeTenantId || switching) return;
    setSwitching(true);
    // chooseTenant reloads the whole session for the new company. Role may
    // change (admin↔user), so App re-routes; if the new role has no /settings,
    // the catch-all sends us to the dashboard. No need to clear `switching`
    // on success — the component unmounts.
    try {
      await chooseTenant(id);
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : t('common:state.error') });
      setSwitching(false);
    }
  }

  async function load() {
    const [data, me] = await Promise.all([
      api<TenantSettings>('/api/v1/settings'),
      api<MeResponse>('/api/v1/me'),
    ]);
    setS(data);
    setPiva(data.partita_iva ?? '');
    setPrefs(me.preferences ?? null);
  }
  useEffect(() => {
    load().catch((e) => setToast({ kind: 'err', text: e.message }));
  }, []);

  async function savePiva() {
    if (!s) return;
    const next = piva.trim();
    if (next === (s.partita_iva ?? '')) return;
    const okSave = await patchSettings({ partita_iva: next || null });
    if (!okSave) setPiva(s.partita_iva ?? '');
  }

  async function saveNotifPref(key: string, next: boolean) {
    if (!prefs) return;
    const np = { ...(prefs.notification_preferences ?? {}) };
    const prev = np[key];
    setPrefs({ ...prefs, notification_preferences: { ...np, [key]: next } });
    try {
      await api('/api/v1/me', {
        method: 'PATCH',
        json: { notification_preferences: { [key]: next } },
      });
      setToast({ kind: 'ok', text: t('common:state.prefSaved') });
    } catch (e) {
      setPrefs((cur) =>
        cur ? { ...cur, notification_preferences: { ...cur.notification_preferences, [key]: !!prev } } : cur
      );
      setToast({ kind: 'err', text: e instanceof Error ? e.message : t('common:state.error') });
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
      setToast({ kind: 'ok', text: t('common:state.saved') });
      return true;
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : t('common:state.saveError') });
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
    <form onSubmit={onFormSubmit} className="max-w-7xl">
      <PageHeader title={t('title')} />

      <SettingsRow
        icon={<IconBuilding />}
        title={t('section.profile')}
        description={t('section.profileDesc')}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t('ragioneSociale')}>
            <input
              className="input"
              value={s.ragione_sociale}
              readOnly
              disabled
            />
            <p className="field-hint">{t('readOnlyHint')}</p>
          </Field>
          <Field label={t('partitaIva')}>
            {isAdmin ? (
              <>
                <input
                  className="input num"
                  aria-label={t('partitaIva')}
                  value={piva}
                  maxLength={11}
                  inputMode="numeric"
                  disabled={busy}
                  onChange={(e) => setPiva(e.target.value.replace(/\D/g, ''))}
                  onBlur={() => void savePiva()}
                  placeholder="—"
                />
                <p className="field-hint">{t('partitaIvaHint')}</p>
              </>
            ) : (
              <>
                <input
                  className="input"
                  value={s.partita_iva ?? ''}
                  readOnly
                  disabled
                  placeholder="—"
                />
                <p className="field-hint">{t('readOnlyHint')}</p>
              </>
            )}
          </Field>
          <Field label={t('timezone')}>
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
            <p className="field-hint">{t('timezoneHint')}</p>
          </Field>
          <Field label={t('common:lang.interfaceLabel')}>
            <LanguageSelect />
            <p className="field-hint">{t('languageHint')}</p>
          </Field>
        </div>
      </SettingsRow>

      {isAdmin && (
        <CentroPagheSection s={s} onPatch={patchSettings} />
      )}

      {tenants.length > 1 && (
        <SettingsRow
            icon={<IconBuilding />}
            title={t('section.activeCompany')}
            description={t('section.activeCompanyDesc')}
          >
            <Field label={t('company')}>
              <select
                className="input"
                value={activeTenantId ?? ''}
                disabled={switching}
                onChange={(e) => void onSwitchTenant(e.target.value)}
              >
                {tenants.map((tn) => (
                  <option key={tn.tenant_id} value={tn.tenant_id}>
                    {tn.ragione_sociale}{' '}
                    {tn.role === 'admin' ? `(${t('common:role.admin')})` : `(${t('common:role.user')})`}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                {switching ? t('switching') : t('switchHint')}
              </p>
            </Field>
          </SettingsRow>
      )}

      <SettingsRow
        icon={<IconBell />}
        title={t('section.emailNotif')}
        description={t('section.emailNotifDesc')}
      >
        <div className="space-y-2.5">
          {EMAIL_PREFS.map((p) => {
            const on = prefs?.notification_preferences?.[p.key] ?? false;
            return (
              <div key={p.key} className="flex items-center justify-between gap-4">
                <div className="text-sm flex-1">{t(`emailPref.${p.i18nKey}`)}</div>
                <label className="switch" title={on ? t('toggleOn') : t('toggleOff')}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!prefs}
                    onChange={(e) => void saveNotifPref(p.key, e.target.checked)}
                  />
                  <span className="switch-track">
                    <span className="switch-thumb" />
                  </span>
                </label>
              </div>
            );
          })}
        </div>
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

function CentroPagheSection({
  s,
  onPatch,
}: {
  s: TenantSettings;
  onPatch: (patch: Partial<TenantSettings>) => Promise<boolean>;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const [codiceDitta, setCodiceDitta] = useState(s.codice_ditta ?? '');
  const [donazioneCf, setDonazioneCf] = useState(s.cp_donazione_cf ?? '');
  const [map, setMap] = useState<Record<string, string>>(() =>
    effectiveCentroPagheMap(s.cp_giustificativo_map)
  );

  const codeOptions = useMemo(
    () =>
      CENTRO_PAGHE_CODES.map((c) => ({
        value: c.inp,
        label: `${c.inp} · ${c.out} — ${c.descr}`,
      })),
    []
  );

  function changeMap(key: string, inp: string) {
    const next = { ...map, [key]: inp };
    setMap(next);
    void onPatch({ cp_giustificativo_map: next });
  }

  function saveText(field: 'codice_ditta' | 'cp_donazione_cf', value: string) {
    const trimmed = value.trim();
    const cur = (field === 'codice_ditta' ? s.codice_ditta : s.cp_donazione_cf) ?? '';
    if (trimmed === cur) return;
    void onPatch({ [field]: trimmed || null } as Partial<TenantSettings>);
  }

  return (
    <SettingsRow icon={<IconBuilding />} title={t('section.centroPaghe')} description={t('section.centroPagheDesc')}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={t('cp.codiceDitta')}>
          <input
            className="input num"
            value={codiceDitta}
            maxLength={7}
            style={{ textTransform: 'uppercase' }}
            onChange={(e) => setCodiceDitta(e.target.value.toUpperCase())}
            onBlur={(e) => saveText('codice_ditta', e.target.value)}
            placeholder="AA1A001"
          />
          <p className="field-hint">{t('cp.codiceDittaHint')}</p>
        </Field>
        <Field label={t('cp.codeLen')}>
          <select
            className="input"
            value={s.cp_code_len}
            onChange={(e) => void onPatch({ cp_code_len: Number(e.target.value) === 2 ? 2 : 4 })}
          >
            <option value={4}>{t('cp.codeLen4')}</option>
            <option value={2}>{t('cp.codeLen2')}</option>
          </select>
          <p className="field-hint">{t('cp.codeLenHint')}</p>
        </Field>
        <Field label={t('cp.donazioneCf')}>
          <input
            className="input num"
            value={donazioneCf}
            maxLength={11}
            onChange={(e) => setDonazioneCf(e.target.value)}
            onBlur={(e) => saveText('cp_donazione_cf', e.target.value)}
            placeholder="—"
          />
          <p className="field-hint">{t('cp.donazioneCfHint')}</p>
        </Field>
      </div>

      <div className="mt-5">
        <h4 className="label" style={{ marginBottom: 4 }}>{t('cp.mapTitle')}</h4>
        <p className="field-hint" style={{ marginTop: 0 }}>{t('cp.mapDesc')}</p>
        <div className="space-y-2 mt-3">
          {CENTRO_PAGHE_MAP_KEYS.map(({ key, i18nKey }) => (
            <div key={key} className="grid grid-cols-1 md:grid-cols-2 gap-2 items-center">
              <label className="text-sm" htmlFor={`cpmap-${key}`}>
                {t(`cp.mapKey.${i18nKey}`)}
              </label>
              <select
                id={`cpmap-${key}`}
                className="input"
                value={map[key] ?? ''}
                onChange={(e) => changeMap(key, e.target.value)}
              >
                <option value="">{t('cp.mapNone')}</option>
                {codeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    </SettingsRow>
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
