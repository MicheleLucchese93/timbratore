// Formatting + date rules shared by the super-user billing surfaces (Aziende
// billing columns/dialog, Registrazioni, Pagamenti). Everything money-related is
// read in Europe/Rome: that is the calendar the fattura and the ledger's month
// filter use, whatever time zone the operator's browser is in.
import { parseLookupKey, type PlanKey } from '@sonoqui/shared';

export type VatStatus = 'valid' | 'not_in_vies' | 'unavailable';
export type SignupSource = 'partner' | 'self_service';
export type BillingModeKey = 'managed' | 'stripe';
export type { PlanKey };

type T = (key: string, opts?: Record<string, unknown>) => string;

const ROME = 'Europe/Rome';

/** i18n language → Intl locale (en-GB keeps day/month/year order). */
export function intlLocale(lang: string): string {
  return lang === 'en' ? 'en-GB' : 'it-IT';
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Calendar date an instant falls on in Europe/Rome. */
function romeParts(d: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROME,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { y: get('year'), m: get('month'), d: get('day') };
}

function ymdFromUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Today in Europe/Rome, `YYYY-MM-DD`. */
export function romeToday(): string {
  const p = romeParts(new Date());
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** This month in Europe/Rome, `YYYY-MM` (the ledger's default month). */
export function romeThisMonth(): string {
  return romeToday().slice(0, 7);
}

/** `YYYY-MM` an instant belongs to, Rome time — the same bucket the server's month filter uses. */
export function romeMonthOf(iso: string): string {
  const p = romeParts(new Date(iso));
  return `${p.y}-${pad(p.m)}`;
}

/**
 * When the fattura for a charge is due (DPR 633/72 art. 21 c.4 — to be confirmed
 * with the commercialista): an immediate invoice within 12 days of the payment,
 * or a deferred one (one per customer per month) by the 15th of the month after.
 */
export function invoiceDeadlines(paidAtIso: string): { immediate: string; deferred: string } {
  const p = romeParts(new Date(paidAtIso));
  return {
    immediate: ymdFromUtc(Date.UTC(p.y, p.m - 1, p.d + 12)),
    deferred: ymdFromUtc(Date.UTC(p.y, p.m, 15)),
  };
}

/** Deadline of the fattura differita covering a `YYYY-MM` month. */
export function deferredDeadlineOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return ymdFromUtc(Date.UTC(y ?? 1970, m ?? 1, 15));
}

/** A date (`YYYY-MM-DD` as-is, or an instant read in Rome time) → `15/10/2026`. */
export function fmtDate(value: string | null | undefined, lang: string): string {
  if (!value) return '—';
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(intlLocale(lang), { timeZone: ROME, day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** An instant in Rome time → `15/10/2026, 14:05`. */
export function fmtDateTime(value: string | null | undefined, lang: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(intlLocale(lang), {
    timeZone: ROME,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** `2026-09` → `settembre 2026` / `September 2026`. */
export function fmtMonth(month: string, lang: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(intlLocale(lang), {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });
}

/** Cents → `1.234,56 €` (it) / `€1,234.56` (en). */
export function fmtMoney(cents: number | null | undefined, lang: string, currency = 'eur'): string {
  if (cents == null) return '—';
  try {
    return new Intl.NumberFormat(intlLocale(lang), { style: 'currency', currency: currency.toUpperCase() }).format(
      cents / 100
    );
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** A service period `01/09/2026 – 01/10/2026` (either end may be missing). */
export function fmtPeriod(start: string | null | undefined, end: string | null | undefined, lang: string): string {
  if (!start && !end) return '—';
  return `${fmtDate(start, lang)} – ${fmtDate(end, lang)}`;
}

// ---- badges / labels ----------------------------------------------------------

/** Badge class for a Stripe subscription status. */
export function subStatusTone(status: string | null | undefined): string {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'badge-ok';
    case 'past_due':
    case 'unpaid':
      return 'badge-caution';
    default:
      return 'badge-muted';
  }
}

export function vatTone(status: VatStatus | null | undefined): string {
  switch (status) {
    case 'valid':
      return 'badge-ok';
    case 'not_in_vies':
      return 'badge-caution';
    default:
      return 'badge-muted';
  }
}

/** A P.IVA a human still has to look at (D2): not in VIES / unverifiable and not yet reviewed. */
export function needsVatReview(row: { vat_status?: VatStatus | null; vat_reviewed_at?: string | null }): boolean {
  return (row.vat_status === 'not_in_vies' || row.vat_status === 'unavailable') && !row.vat_reviewed_at;
}

/** "Piano Piccola · mensile" / "Modulo Cantieri · mensile" for a subscription row. */
export function subscriptionLabel(
  t: T,
  sub: { product_line: string; price_lookup_key: string | null; billing_interval?: string | null }
): string {
  const parsed = parseLookupKey(sub.price_lookup_key);
  const interval = parsed?.kind === 'plan' ? parsed.interval : (sub.billing_interval ?? null);
  const intervalLabel =
    interval === 'month' || interval === 'year' ? ` · ${t(`billing.subs.interval.${interval}`)}` : '';
  if (parsed?.kind === 'plan') return `${t('billing.subs.plan', { plan: t(`billing.plan.${parsed.plan}`) })}${intervalLabel}`;
  if (parsed?.kind === 'module') {
    return `${t('billing.subs.module', { module: t(`modules.${parsed.module}.name`) })}${intervalLabel}`;
  }
  if (sub.product_line === 'plan') return `${t('billing.subs.planGeneric')}${intervalLabel}`;
  const mod = /^module:(.+)$/.exec(sub.product_line);
  if (mod?.[1]) {
    return `${t('billing.subs.module', { module: t(`modules.${mod[1]}.name`, { defaultValue: mod[1] }) })}${intervalLabel}`;
  }
  return sub.product_line;
}

/** The campaign source of a signup (`utm_source`, else the first value) + a full `k=v` tooltip. */
export function utmSummary(utm: Record<string, string> | null | undefined): { source: string | null; full: string } {
  if (!utm || typeof utm !== 'object') return { source: null, full: '' };
  const entries = Object.entries(utm).filter(([, v]) => typeof v === 'string' && v.trim() !== '');
  if (entries.length === 0) return { source: null, full: '' };
  const source = utm.utm_source ?? utm.source ?? entries[0]?.[1] ?? null;
  return { source, full: entries.map(([k, v]) => `${k}=${v}`).join(' · ') };
}

/** Copy text to the clipboard; falls back to a hidden textarea where the async API is missing. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
