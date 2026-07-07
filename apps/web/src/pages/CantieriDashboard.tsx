import { useCallback, useEffect, useState, type FormEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type {
  CantiereEntryRecord,
  CantiereRecord,
  CantiereStatus,
  CantieriFieldDef,
} from '@sonoqui/shared';
import { CANTIERE_REPORT_RECIPIENTS_MAX, cantieriIntervalMinutes } from '@sonoqui/shared';
import { api, apiUrl, getToken, getTenantId } from '../lib/api.ts';
import { PageHeader } from '../components/PageHeader.tsx';
import { CantieriTabs } from '../components/CantieriTabs.tsx';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';
import { fmtDate } from '../i18n/format.ts';

interface DashboardSite {
  id: string;
  name: string;
  address: string | null;
  status: CantiereStatus;
  entries_count: number;
  users_count: number;
  travel_minutes: number;
  activity_minutes: number;
  last_entry_date: string | null;
}

interface SiteEntriesResponse {
  site: CantiereRecord;
  fields: CantieriFieldDef[];
  entries: Array<CantiereEntryRecord & { user_name: string; mezzo_name: string | null }>;
}

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function monthParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Minutes → "h:mm" (aggregates can exceed 24h, so no Date involved).
function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// "08:00–12:30 (4:30)" for a HH:MM interval; tolerates missing bounds.
function rangeCell(start: string | null, end: string | null): string {
  if (!start && !end) return '—';
  const mins = cantieriIntervalMinutes(start, end);
  const range = `${start ?? '—'}–${end ?? '—'}`;
  return mins === null ? range : `${range} (${hm(mins)})`;
}

export function CantieriDashboard() {
  const { t } = useTranslation(['cantieri', 'common']);
  const navigate = useNavigate();
  const [month, setMonth] = useState<Date>(() => firstOfMonth(new Date()));
  const [sites, setSites] = useState<DashboardSite[]>([]);
  const [openSiteId, setOpenSiteId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SiteEntriesResponse | null>(null);
  const [emailFor, setEmailFor] = useState<DashboardSite | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const mp = monthParam(month);

  const load = useCallback(async () => {
    try {
      const r = await api<{ month: string; sites: DashboardSite[] }>(
        `/api/v1/cantieri/dashboard?month=${mp}`
      );
      setSites(r.sites);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }, [mp, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Load the drill-in entries when a card is opened or the month changes.
  useEffect(() => {
    if (!openSiteId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    api<SiteEntriesResponse>(`/api/v1/cantieri/sites/${openSiteId}/entries?month=${mp}`)
      .then((r) => {
        if (!cancelled) setDetail(r);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : t('common:state.error'));
      });
    return () => {
      cancelled = true;
    };
  }, [openSiteId, mp, t]);

  async function downloadPdf(e: MouseEvent, site: DashboardSite) {
    e.stopPropagation();
    setErr(null);
    setInfo(null);
    try {
      // Raw fetch (blob response): must carry Authorization + X-Tenant-Id, the
      // api helper only covers JSON calls. Mirrors Users.tsx exportXlsx.
      const headers: Record<string, string> = { Authorization: `Bearer ${getToken()}` };
      const tid = getTenantId();
      if (tid) headers['X-Tenant-Id'] = tid;
      const r = await fetch(apiUrl(`/api/v1/cantieri/sites/${site.id}/report?month=${mp}`), {
        headers,
      });
      if (!r.ok) throw new Error(t('dashboard.downloadFailed'));
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safe = site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cantiere';
      a.href = url;
      a.download = `cantiere-${safe}-${mp}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('dashboard.downloadFailed'));
    }
  }

  const monthLabel = fmtDate(month, { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-5">
      <CantieriTabs />
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setMonth((m) => addMonths(m, -1))}
              aria-label={t('dashboard.prevMonth')}
              title={t('dashboard.prevMonth')}
            >
              ‹
            </button>
            <span className="text-sm font-semibold" style={{ minWidth: '9rem', textAlign: 'center' }}>
              {monthLabel}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setMonth((m) => addMonths(m, 1))}
              aria-label={t('dashboard.nextMonth')}
              title={t('dashboard.nextMonth')}
            >
              ›
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setMonth(firstOfMonth(new Date()))}
            >
              {t('dashboard.currentMonth')}
            </button>
          </div>
        }
      />

      {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
      {info && <div className="text-sm" style={{ color: 'var(--color-success)' }}>{info}</div>}

      {sites.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <IconHardHat />
          </div>
          <div className="empty-state-title">{t('dashboard.empty')}</div>
          <div className="empty-state-hint">{t('dashboard.emptyHint')}</div>
          <button
            type="button"
            className="btn btn-primary btn-sm mt-2"
            onClick={() => navigate('/cantieri/sites')}
          >
            {t('dashboard.emptyCta')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {sites.map((s) => (
            <div
              key={s.id}
              className="card space-y-2"
              style={{ cursor: 'pointer', outline: openSiteId === s.id ? '2px solid var(--color-primary)' : undefined }}
              role="button"
              tabIndex={0}
              onClick={() => setOpenSiteId((cur) => (cur === s.id ? null : s.id))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenSiteId((cur) => (cur === s.id ? null : s.id));
                }
              }}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm truncate" title={s.name}>{s.name}</span>
                <span className={`badge ${s.status === 'open' ? 'badge-ok' : 'badge-muted'}`}>
                  {t(`status.${s.status}`)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="muted">{t('dashboard.entries')}</span>
                <span className="num">{s.entries_count}</span>
                <span className="muted">{t('dashboard.users')}</span>
                <span className="num">{s.users_count}</span>
                <span className="muted">{t('dashboard.travel')}</span>
                <span className="num">{hm(s.travel_minutes)}</span>
                <span className="muted">{t('dashboard.activity')}</span>
                <span className="num">{hm(s.activity_minutes)}</span>
                <span className="muted">{t('dashboard.lastEntry')}</span>
                <span className="num">
                  {s.last_entry_date
                    ? fmtDate(s.last_entry_date, { day: '2-digit', month: '2-digit', year: 'numeric' })
                    : '—'}
                </span>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={(e) => downloadPdf(e, s)}
                >
                  {t('dashboard.downloadPdf')}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setInfo(null);
                    setEmailFor(s);
                  }}
                >
                  {t('dashboard.sendEmail')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {openSiteId && detail && (
        <EntriesDetail detail={detail} onClose={() => setOpenSiteId(null)} />
      )}

      {emailFor && (
        <EmailReportModal
          site={emailFor}
          month={mp}
          monthLabel={monthLabel}
          onClose={() => setEmailFor(null)}
          onSent={() => {
            setEmailFor(null);
            setInfo(t('dashboard.emailDialog.sent'));
          }}
        />
      )}
    </div>
  );
}

function IconHardHat() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1z" />
      <path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5" />
      <path d="M4 15v-3a6 6 0 0 1 6-6" />
      <path d="M14 6a6 6 0 0 1 6 6v3" />
    </svg>
  );
}

/* ---------------- Entries drill-in ---------------- */

function EntriesDetail({
  detail,
  onClose,
}: {
  detail: SiteEntriesResponse;
  onClose: () => void;
}) {
  const { t } = useTranslation(['cantieri', 'common']);

  function customCell(def: CantieriFieldDef, entry: CantiereEntryRecord): string {
    const v = entry.custom_values[def.key];
    if (v === undefined || v === null || v === '') return '—';
    if (def.field_type === 'boolean') return v === true ? t('common:btn.yes') : t('common:btn.no');
    return String(v);
  }

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-title">
          {t('dashboard.detail.title', { name: detail.site.name })}
        </h2>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          {t('common:btn.close')}
        </button>
      </div>
      {detail.entries.length === 0 ? (
        <div className="text-sm muted">{t('dashboard.detail.empty')}</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('dashboard.detail.colDate')}</th>
                <th>{t('dashboard.detail.colUser')}</th>
                <th>{t('dashboard.detail.colTravel')}</th>
                <th>{t('dashboard.detail.colActivity')}</th>
                <th>{t('dashboard.detail.colActivityText')}</th>
                <th>{t('dashboard.detail.colMezzo')}</th>
                {detail.fields.map((f) => (
                  <th key={f.id}>{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.entries.map((en) => (
                <tr key={en.id}>
                  <td className="num nowrap">
                    {fmtDate(en.entry_date, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </td>
                  <td>{en.user_name}</td>
                  <td className="num nowrap">{rangeCell(en.travel_start, en.travel_end)}</td>
                  <td className="num nowrap">{rangeCell(en.activity_start, en.activity_end)}</td>
                  <td style={{ maxWidth: '22rem', whiteSpace: 'pre-wrap' }}>
                    {en.activity_text || '—'}
                  </td>
                  <td>{en.mezzo_name ?? '—'}</td>
                  {detail.fields.map((f) => (
                    <td key={f.id}>{customCell(f, en)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------------- Send-report-by-email dialog ---------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function EmailReportModal({
  site,
  month,
  monthLabel,
  onClose,
  onSent,
}: {
  site: DashboardSite;
  month: string;
  monthLabel: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useTranslation(['cantieri', 'common']);
  useEscapeKey(onClose);
  const [recipients, setRecipients] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function setAt(i: number, value: string) {
    setRecipients((cur) => cur.map((r, idx) => (idx === i ? value : r)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const to = recipients.map((r) => r.trim()).filter((r) => r.length > 0);
    if (to.length === 0) return setErr(t('dashboard.emailDialog.errorEmailRequired'));
    if (to.some((r) => !EMAIL_RE.test(r))) {
      return setErr(t('dashboard.emailDialog.errorEmailInvalid'));
    }
    setBusy(true);
    try {
      await api(`/api/v1/cantieri/sites/${site.id}/report/email`, {
        method: 'POST',
        json: { month, to },
      });
      onSent();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('common:state.error'));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-md space-y-3">
        <h2 className="section-title">{t('dashboard.emailDialog.title')}</h2>
        <p className="text-xs muted">
          {t('dashboard.emailDialog.hint', {
            name: site.name,
            month: monthLabel,
            max: CANTIERE_REPORT_RECIPIENTS_MAX,
          })}
        </p>

        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

        <div className="space-y-2">
          {recipients.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="email"
                className="input"
                value={r}
                placeholder={t('dashboard.emailDialog.placeholder')}
                onChange={(e) => setAt(i, e.target.value)}
                autoFocus={i === 0}
              />
              {recipients.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setRecipients((cur) => cur.filter((_, idx) => idx !== i))}
                  aria-label={t('dashboard.emailDialog.remove')}
                  title={t('dashboard.emailDialog.remove')}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        {recipients.length < CANTIERE_REPORT_RECIPIENTS_MAX && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setRecipients((cur) => [...cur, ''])}
          >
            {t('dashboard.emailDialog.addRecipient')}
          </button>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('dashboard.emailDialog.sending') : t('dashboard.emailDialog.send')}
          </button>
        </div>
      </form>
    </div>
  );
}
