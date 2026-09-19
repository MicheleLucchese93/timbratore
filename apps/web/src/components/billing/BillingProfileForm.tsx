import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  billingProfileGaps,
  isValidCap,
  isValidCodiceFiscale,
  isValidProvincia,
  isValidSdiCode,
} from '@sonoqui/shared';
import type { ApiError } from '../../lib/api.ts';
import { saveBillingProfile, type BillingProfile } from '../../lib/billing.ts';

/**
 * The data a fattura elettronica needs (Specs/SELF_SERVICE_BILLING.md §3.6).
 * The P.IVA is shown read-only: it identifies the company, was checked on VIES
 * at registration, and changing it would make this a different customer.
 */
export function BillingProfileForm({
  profile,
  onSaved,
  submitLabel,
  readOnly,
}: {
  profile: BillingProfile;
  onSaved: (p: BillingProfile) => void;
  submitLabel?: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation('billing');
  const [f, setF] = useState({
    legal_name: profile.legal_name ?? '',
    codice_fiscale: profile.codice_fiscale ?? '',
    address: profile.address ?? '',
    cap: profile.cap ?? '',
    city: profile.city ?? '',
    province: profile.province ?? '',
    sdi_code: profile.sdi_code ?? '',
    pec: profile.pec ?? '',
    billing_email: profile.billing_email ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const invalid = {
    codice_fiscale: !!f.codice_fiscale && !isValidCodiceFiscale(f.codice_fiscale),
    cap: !!f.cap && !isValidCap(f.cap),
    province: !!f.province && !isValidProvincia(f.province),
    sdi_code: !!f.sdi_code && !isValidSdiCode(f.sdi_code),
    pec: !!f.pec && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.pec),
  };
  const gaps = billingProfileGaps({ ...f, partita_iva: profile.partita_iva });

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.values(invalid).some(Boolean)) return;
    setBusy(true);
    setErr(null);
    try {
      const saved = await saveBillingProfile({
        legal_name: f.legal_name.trim(),
        codice_fiscale: f.codice_fiscale.trim() || null,
        address: f.address.trim(),
        cap: f.cap.trim(),
        city: f.city.trim(),
        province: f.province.trim().toUpperCase(),
        sdi_code: f.sdi_code.trim() || null,
        pec: f.pec.trim() || null,
        billing_email: f.billing_email.trim(),
      });
      onSaved(saved);
    } catch (e2) {
      const code = (e2 as ApiError).code;
      setErr(t(`errors.${code ?? 'default'}`, { defaultValue: t('errors.default') }));
    } finally {
      setBusy(false);
    }
  }

  const fieldErr = (k: keyof typeof invalid) => (touched || f[k] ? invalid[k] : false);

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="billing-profile-form">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="bp-legal">{t('profile.legalName')}</label>
          <input id="bp-legal" className="input" value={f.legal_name} onChange={set('legal_name')} disabled={readOnly} required />
        </div>
        <div>
          <label className="label" htmlFor="bp-piva">{t('profile.piva')}</label>
          <input id="bp-piva" className="input num" value={profile.partita_iva} readOnly disabled />
          <p className="field-hint">
            {t('profile.pivaHint')} · {t(`profile.vat.${profile.vat_status}`)}
          </p>
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="bp-address">{t('profile.address')}</label>
          <input id="bp-address" className="input" value={f.address} onChange={set('address')} disabled={readOnly} autoComplete="street-address" />
        </div>
        <div className="grid grid-cols-3 gap-3 md:col-span-2">
          <div>
            <label className="label" htmlFor="bp-cap">{t('profile.cap')}</label>
            <input id="bp-cap" className="input num" inputMode="numeric" maxLength={5} value={f.cap} onChange={set('cap')} disabled={readOnly} aria-invalid={fieldErr('cap')} autoComplete="postal-code" />
          </div>
          <div>
            <label className="label" htmlFor="bp-city">{t('profile.city')}</label>
            <input id="bp-city" className="input" value={f.city} onChange={set('city')} disabled={readOnly} autoComplete="address-level2" />
          </div>
          <div>
            <label className="label" htmlFor="bp-prov">{t('profile.province')}</label>
            <input id="bp-prov" className="input" maxLength={2} value={f.province} onChange={(e) => setF((p) => ({ ...p, province: e.target.value.toUpperCase() }))} disabled={readOnly} aria-invalid={fieldErr('province')} placeholder="VR" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="bp-sdi">{t('profile.sdi')}</label>
          <input id="bp-sdi" className="input num" maxLength={7} value={f.sdi_code} onChange={(e) => setF((p) => ({ ...p, sdi_code: e.target.value.toUpperCase() }))} disabled={readOnly} aria-invalid={fieldErr('sdi_code')} data-testid="bp-sdi" />
          <p className="field-hint">{t('profile.sdiHint')}</p>
        </div>
        <div>
          <label className="label" htmlFor="bp-pec">{t('profile.pec')}</label>
          <input id="bp-pec" className="input" type="email" value={f.pec} onChange={set('pec')} disabled={readOnly} aria-invalid={fieldErr('pec')} />
          <p className="field-hint">{t('profile.pecHint')}</p>
        </div>
        <div>
          <label className="label" htmlFor="bp-cf">{t('profile.cf')}</label>
          <input id="bp-cf" className="input num" maxLength={16} value={f.codice_fiscale} onChange={(e) => setF((p) => ({ ...p, codice_fiscale: e.target.value.toUpperCase() }))} disabled={readOnly} aria-invalid={fieldErr('codice_fiscale')} />
          <p className="field-hint">{t('profile.cfHint')}</p>
        </div>
        <div>
          <label className="label" htmlFor="bp-email">{t('profile.billingEmail')}</label>
          <input id="bp-email" className="input" type="email" value={f.billing_email} onChange={set('billing_email')} disabled={readOnly} autoComplete="email" />
          <p className="field-hint">{t('profile.billingEmailHint')}</p>
        </div>
      </div>
      {gaps.length > 0 && (
        <p className="field-hint" role="note">
          {t('profile.missingList', { list: gaps.map((g) => t(`profile.missing.${g}`)).join(', ') })}
        </p>
      )}
      {err && <p className="text-sm text-[color:var(--color-error)]" role="alert">{err}</p>}
      {!readOnly && (
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="bp-save">
          {submitLabel ?? t('profile.save')}
        </button>
      )}
    </form>
  );
}
