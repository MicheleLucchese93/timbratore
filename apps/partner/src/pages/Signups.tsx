import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { DataGrid, type GridColDef, type GridPaginationModel } from '@mui/x-data-grid';
import { useMediaQuery } from '@mui/material';
import { api, type ApiError } from '../lib/api.ts';
import { fmtDate, fmtDateTime, utmSummary, type PlanKey, type VatStatus } from '../lib/billing.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmProvider.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { GridEmptyOverlay } from '../components/GridEmptyOverlay.tsx';
import { MCard, MCardList } from '../components/MobileCards.tsx';
import { Modal } from '../components/Modal.tsx';
import { IconButton } from '../components/IconButton.tsx';
import { PivaCell } from '../components/BillingBadges.tsx';
import { IconBan, IconBuilding, IconMail, IconRefresh } from '../components/icons.tsx';

/**
 * Registrazioni: the self-service signup funnel, super-user only (D11).
 *
 * One row per request from the website form, from "email da confermare" to a
 * company that stamps and pays. The funnel cards count the last 90 days and do
 * not follow the filters: they are the health of the channel, not of the page.
 */

type SignupStatus = 'pending' | 'email_confirmed' | 'company_created' | 'expired' | 'rejected';
type SignupFilter = 'all' | SignupStatus;

interface SignupRow {
  id: string;
  status: SignupStatus;
  mode: 'new' | 'existing';
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  plan_hint: 'piccola' | 'media' | null;
  utm: Record<string, string> | null;
  language: string;
  created_at: string;
  expires_at: string;
  send_count: number;
  email_confirmed_at: string | null;
  company_created_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  /** Still 'pending' but past its link expiry (the nightly job flips it later). */
  expired: boolean;
  tenant_id: string | null;
  ragione_sociale: string | null;
  partita_iva: string | null;
  plan: PlanKey | null;
  billing_mode: string | null;
  vat_status: VatStatus | null;
  vies_request_id: string | null;
  vat_reviewed_at: string | null;
  headcount_band: string | null;
  paying: boolean;
  last_stamp_at: string | null;
}

interface Funnel {
  requested: number;
  confirmed: number;
  companies: number;
  stamping: number;
  paying: number;
}

const FILTERS: SignupFilter[] = ['all', 'pending', 'email_confirmed', 'company_created', 'expired', 'rejected'];
const FUNNEL_STEPS: (keyof Funnel)[] = ['requested', 'confirmed', 'companies', 'stamping', 'paying'];

function errMsg(t: (k: string, o?: Record<string, unknown>) => string, e: unknown): string {
  const code = (e as ApiError | null)?.code;
  return t(`errors.${code ?? 'default'}`, { defaultValue: t('errors.default') });
}

/** What the row really is today: a pending link past its expiry reads "scaduta". */
function effectiveStatus(r: SignupRow): SignupStatus {
  return r.status === 'pending' && r.expired ? 'expired' : r.status;
}

function statusTone(s: SignupStatus): string {
  switch (s) {
    case 'company_created':
      return 'badge-ok';
    case 'email_confirmed':
      return 'badge-info';
    case 'expired':
      return 'badge-caution';
    case 'rejected':
      return 'badge-warn';
    default:
      return 'badge-muted';
  }
}

const canResend = (r: SignupRow): boolean => r.status === 'pending' || r.status === 'expired';
const canReject = (r: SignupRow): boolean =>
  r.status === 'pending' || r.status === 'email_confirmed' || r.status === 'expired';

export function Signups() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 768px)', { noSsr: true });

  const [status, setStatus] = useState<SignupFilter>('all');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [rows, setRows] = useState<SignupRow[]>([]);
  const [total, setTotal] = useState(0);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState<SignupRow | null>(null);
  // Only the latest request may paint (fast typing / paging).
  const reqSeq = useRef(0);

  // Debounced search; a new query starts again from the first page (one fetch).
  useEffect(() => {
    const h = setTimeout(() => {
      setQ(qInput.trim());
      setPagination((p) => (p.page === 0 ? p : { ...p, page: 0 }));
    }, 300);
    return () => clearTimeout(h);
  }, [qInput]);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status,
        limit: String(pagination.pageSize),
        offset: String(pagination.page * pagination.pageSize),
      });
      if (q) params.set('q', q);
      const r = await api<{ items: SignupRow[]; total: number; funnel: Funnel }>(
        `/api/v1/partnership/billing/signups?${params}`
      );
      if (seq !== reqSeq.current) return;
      setRows(r.items);
      setTotal(r.total);
      setFunnel(r.funnel);
    } catch (e) {
      if (seq === reqSeq.current) toast(errMsg(t, e), true);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [status, q, pagination.page, pagination.pageSize, t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function pickStatus(s: SignupFilter) {
    setStatus(s);
    setPagination((p) => (p.page === 0 ? p : { ...p, page: 0 }));
  }

  async function resend(r: SignupRow) {
    const ok = await confirm({
      message: t('signups.resend.confirm', { email: r.email }),
      confirmLabel: t('signups.resend.label'),
    });
    if (!ok) return;
    try {
      const res = await api<{ sent: boolean }>(`/api/v1/partnership/billing/signups/${r.id}/resend`, { method: 'POST' });
      if (res.sent) toast(t('signups.resend.done', { email: r.email }));
      else toast(t('signups.resend.notSent'), true);
      await load();
    } catch (e) {
      toast(errMsg(t, e), true);
    }
  }

  function openCompany(r: SignupRow) {
    const needle = r.partita_iva || r.ragione_sociale || '';
    navigate(needle ? `/?q=${encodeURIComponent(needle)}` : '/');
  }

  const isDefaultView = status === 'all' && q === '';
  const emptyArt = isDefaultView ? 'people' : 'search';
  const emptyTitle = t(isDefaultView ? 'signups.empty' : 'signups.emptyFiltered');
  const emptyHint = t(isDefaultView ? 'signups.emptyHint' : 'signups.emptyFilteredHint');

  const statusBadges = (r: SignupRow) => {
    const s = effectiveStatus(r);
    return (
      <span className="badge-line">
        <span
          className={`badge ${statusTone(s)}`}
          title={s === 'rejected' && r.reject_reason ? t('signups.rejectedBecause', { reason: r.reject_reason }) : undefined}
        >
          {t(`signups.status.${s}`)}
        </span>
        {r.paying && <span className="badge badge-ok">{t('signups.paying')}</span>}
      </span>
    );
  };

  const planHint = (r: SignupRow) => (
    <span className={`badge ${r.plan_hint ? 'badge-info' : 'badge-muted'}`}>{t(`billing.plan.${r.plan_hint ?? 'free'}`)}</span>
  );

  const renderActions = (r: SignupRow) => (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: '100%' }}>
      {canResend(r) && (
        <IconButton
          label={t('signups.resend.label')}
          testId={`signup-resend-${r.id}`}
          icon={<IconMail />}
          onClick={() => void resend(r)}
        />
      )}
      {canReject(r) && (
        <IconButton
          label={t('signups.reject.label')}
          testId={`signup-reject-${r.id}`}
          danger
          icon={<IconBan />}
          onClick={() => setRejecting(r)}
        />
      )}
      {r.tenant_id && (
        <IconButton
          label={t('signups.openCompany')}
          testId={`signup-open-${r.id}`}
          icon={<IconBuilding />}
          onClick={() => openCompany(r)}
        />
      )}
    </div>
  );

  const columns: GridColDef<SignupRow>[] = [
    {
      field: 'created_at',
      headerName: t('signups.col.created'),
      width: 150,
      renderCell: (p) => fmtDateTime(p.row.created_at, lang),
    },
    {
      field: 'name',
      headerName: t('signups.col.name'),
      flex: 1,
      minWidth: 150,
      renderCell: (p) => (
        <span className="cell-stack">
          <span className="cell-ellipsis">{`${p.row.first_name} ${p.row.last_name}`.trim()}</span>
          {p.row.mode === 'existing' && <span className="muted small">{t('signups.existingAccount')}</span>}
        </span>
      ),
    },
    {
      field: 'email',
      headerName: t('signups.col.email'),
      flex: 1.2,
      minWidth: 200,
      renderCell: (p) => (
        <span className="cell-stack">
          <span className="cell-ellipsis" title={p.row.email}>{p.row.email}</span>
          {effectiveStatus(p.row) === 'pending' ? (
            <span className="muted small">{t('signups.expiresOn', { date: fmtDate(p.row.expires_at, lang) })}</span>
          ) : p.row.send_count > 1 ? (
            <span className="muted small">{t('signups.sentTimes', { count: p.row.send_count })}</span>
          ) : null}
        </span>
      ),
    },
    {
      field: 'phone',
      headerName: t('signups.col.phone'),
      width: 130,
      renderCell: (p) => p.row.phone || <span className="muted">—</span>,
    },
    {
      field: 'plan_hint',
      headerName: t('signups.col.plan'),
      width: 120,
      renderCell: (p) => <span className="cell-badge">{planHint(p.row)}</span>,
    },
    {
      field: 'status',
      headerName: t('signups.col.status'),
      width: 200,
      renderCell: (p) => <span className="cell-badge">{statusBadges(p.row)}</span>,
    },
    {
      field: 'company',
      headerName: t('signups.col.company'),
      flex: 1.4,
      minWidth: 240,
      renderCell: (p) =>
        p.row.tenant_id ? (
          <span className="cell-stack">
            <span className="cell-ellipsis" title={p.row.ragione_sociale ?? undefined}>
              {p.row.ragione_sociale}
              {p.row.headcount_band && (
                <span className="muted small"> · {t('signups.headcount', { band: p.row.headcount_band })}</span>
              )}
            </span>
            <PivaCell
              piva={p.row.partita_iva}
              status={p.row.vat_status}
              reviewedAt={p.row.vat_reviewed_at}
              requestId={p.row.vies_request_id}
            />
          </span>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      field: 'last_stamp_at',
      headerName: t('signups.col.stamps'),
      width: 130,
      renderCell: (p) =>
        p.row.last_stamp_at ? (
          <span title={t('signups.lastStamp', { date: fmtDateTime(p.row.last_stamp_at, lang) })}>
            {fmtDate(p.row.last_stamp_at, lang)}
          </span>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      field: 'utm',
      headerName: t('signups.col.utm'),
      width: 140,
      renderCell: (p) => {
        const u = utmSummary(p.row.utm);
        return u.source ? (
          <span className="cell-ellipsis" title={u.full}>
            {u.source}
          </span>
        ) : (
          <span className="muted">—</span>
        );
      },
    },
    {
      field: 'actions',
      headerName: t('tenants.col.actions'),
      width: 140,
      renderCell: (p) => renderActions(p.row),
    },
  ];

  const from = total === 0 ? 0 : pagination.page * pagination.pageSize + 1;
  const to = Math.min(total, (pagination.page + 1) * pagination.pageSize);

  return (
    <div className="page-stack" data-testid="signups-page">
      <PageHeader
        title={t('signups.title')}
        subtitle={t('signups.subtitle', { count: total })}
        actions={<IconButton label={t('actions.refresh')} icon={<IconRefresh />} onClick={() => void load()} />}
      />

      <div className="stat-cards" data-testid="signups-funnel" aria-label={t('signups.funnel.title')}>
        {FUNNEL_STEPS.map((k) => {
          const n = funnel?.[k] ?? null;
          const base = funnel?.requested ?? 0;
          return (
            <div className="stat-card" key={k} data-testid={`funnel-${k}`}>
              <div className="stat-label">{t(`signups.funnel.${k}`)}</div>
              <div className="stat-value">{n ?? '—'}</div>
              <div className="stat-sub">
                {k === 'requested'
                  ? t('signups.funnel.window')
                  : n != null && base > 0
                    ? t('signups.funnel.ofRequested', { pct: Math.round((n / base) * 100) })
                    : ' '}
              </div>
            </div>
          );
        })}
      </div>

      <div className="filter-row">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`btn btn-sm ${status === f ? 'btn-primary' : 'btn-secondary'}`}
            aria-pressed={status === f}
            onClick={() => pickStatus(f)}
            data-testid={`signups-filter-${f}`}
          >
            {t(`signups.filter.${f}`)}
          </button>
        ))}
        <input
          className="input filter-search"
          type="search"
          placeholder={t('signups.searchPlaceholder')}
          aria-label={t('signups.searchPlaceholder')}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          data-testid="signups-search"
        />
      </div>

      {isMobile ? (
        <>
          <MCardList
            loading={loading}
            empty={!loading && rows.length === 0}
            art={emptyArt}
            emptyTitle={emptyTitle}
            emptyHint={emptyHint}
          >
            {rows.map((r) => {
              const u = utmSummary(r.utm);
              return (
                <MCard
                  key={r.id}
                  title={`${r.first_name} ${r.last_name}`.trim() || r.email}
                  badge={statusBadges(r)}
                  fields={[
                    { label: t('signups.col.email'), value: r.email },
                    ...(r.phone ? [{ label: t('signups.col.phone'), value: r.phone }] : []),
                    { label: t('signups.col.created'), value: fmtDateTime(r.created_at, lang) },
                    { label: t('signups.col.plan'), value: planHint(r) },
                    ...(r.tenant_id
                      ? [
                          { label: t('signups.col.company'), value: r.ragione_sociale ?? '—' },
                          {
                            label: t('tenants.col.piva'),
                            value: (
                              <PivaCell
                                piva={r.partita_iva}
                                status={r.vat_status}
                                reviewedAt={r.vat_reviewed_at}
                                requestId={r.vies_request_id}
                              />
                            ),
                          },
                        ]
                      : []),
                    ...(r.last_stamp_at
                      ? [{ label: t('signups.col.stamps'), value: fmtDate(r.last_stamp_at, lang) }]
                      : []),
                    ...(u.source ? [{ label: t('signups.col.utm'), value: u.full }] : []),
                  ]}
                  actions={canResend(r) || canReject(r) || r.tenant_id ? renderActions(r) : undefined}
                />
              );
            })}
          </MCardList>
          {total > pagination.pageSize && (
            <div className="m-pager">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={pagination.page === 0 || loading}
                onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
              >
                {t('common.prev')}
              </button>
              <span className="muted">{t('common.range', { from, to, total })}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={to >= total || loading}
                onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
              >
                {t('common.next')}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="grid-wrap card">
          <DataGrid
            rows={rows}
            columns={columns}
            loading={loading}
            rowCount={total}
            paginationMode="server"
            paginationModel={pagination}
            onPaginationModelChange={setPagination}
            pageSizeOptions={[25, 50, 100]}
            disableRowSelectionOnClick
            disableColumnSorting
            disableColumnFilter
            density="compact"
            rowHeight={56}
            sx={{ border: 0, '--DataGrid-overlayHeight': '17rem' }}
            slots={{ noRowsOverlay: GridEmptyOverlay }}
            slotProps={{ noRowsOverlay: { art: emptyArt, title: emptyTitle, hint: emptyHint } }}
          />
        </div>
      )}

      {rejecting && (
        <RejectSignup
          row={rejecting}
          onClose={() => setRejecting(null)}
          onDone={async () => {
            setRejecting(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// Reject/block a request that has not become a company yet. The reason is
// optional and stays in the platform's activity log, never shown to the requester.
function RejectSignup({
  row,
  onClose,
  onDone,
}: {
  row: SignupRow;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const why = reason.trim();
      await api(`/api/v1/partnership/billing/signups/${row.id}/reject`, {
        method: 'POST',
        json: why ? { reason: why } : {},
      });
      toast(t('signups.reject.done', { email: row.email }));
      await onDone();
    } catch (e2) {
      setErr(errMsg(t, e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${t('signups.reject.title')} · ${row.email}`} onClose={onClose} testId="signup-reject-dialog">
      <form onSubmit={submit}>
        <div className="modal-body">
          <p className="muted">{t('signups.reject.intro')}</p>
          <div>
            <label className="label" htmlFor="sr-reason">
              {t('signups.reject.reason')}
            </label>
            <textarea
              id="sr-reason"
              className="input"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              placeholder={t('signups.reject.reasonPh')}
              data-testid="signup-reject-reason"
            />
          </div>
          {err && <div className="form-err">{err}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('actions.cancel')}
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy} data-testid="signup-reject-submit">
            {busy ? t('common.saving') : t('signups.reject.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
