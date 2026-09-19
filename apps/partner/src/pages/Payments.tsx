import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { useMediaQuery } from '@mui/material';
import { api, downloadFile, type ApiError } from '../lib/api.ts';
import {
  copyText,
  deferredDeadlineOfMonth,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtMonth,
  fmtPeriod,
  invoiceDeadlines,
  romeMonthOf,
  romeThisMonth,
  romeToday,
} from '../lib/billing.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmProvider.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { GridEmptyOverlay } from '../components/GridEmptyOverlay.tsx';
import { MCard, MCardList } from '../components/MobileCards.tsx';
import { Modal } from '../components/Modal.tsx';
import { IconButton } from '../components/IconButton.tsx';
import { IconCopy, IconDownload, IconEye, IconReceipt, IconRefresh, IconUndo } from '../components/icons.tsx';

/**
 * Pagamenti: the "da fatturare" ledger, super-user only (D11).
 *
 * Stripe takes the money; the fattura elettronica is issued OUTSIDE sonoQui by
 * the seller. Every successful charge lands here with a frozen snapshot of the
 * customer's billing data (what the fattura must say), and the operator marks it
 * invoiced once the fattura exists. Grouping per company per Rome month is the
 * shape of a fattura differita: one document for all of a month's charges.
 */

type PayStatus = 'to_invoice' | 'invoiced' | 'all';

interface PaymentLine {
  label: string | null;
  description: string | null;
  amount_cents: number;
  proration: boolean;
  period_start: string | null;
  period_end: string | null;
  price_id: string | null;
  lookup_key: string | null;
}

interface BillingSnapshot {
  ragione_sociale?: string | null;
  legal_name?: string | null;
  partita_iva?: string | null;
  codice_fiscale?: string | null;
  address?: string | null;
  cap?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  sdi_code?: string | null;
  pec?: string | null;
  billing_email?: string | null;
  vat_status?: string | null;
}

interface PaymentRow {
  id: string;
  tenant_id: string;
  ragione_sociale: string;
  stripe_invoice_id: string;
  stripe_charge_id: string | null;
  livemode: boolean;
  paid_at: string;
  currency: string;
  net_cents: number;
  tax_cents: number;
  total_cents: number;
  fee_cents: number | null;
  period_start: string | null;
  period_end: string | null;
  lines: PaymentLine[] | null;
  billing_snapshot: BillingSnapshot | null;
  refunded_cents: number;
  disputed: boolean;
  invoiced_at: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  note: string | null;
}

interface Totals {
  count: number;
  net_cents: number;
  tax_cents: number;
  total_cents: number;
  fee_cents: number;
  to_invoice: number;
}

/** Charges of one company in one Rome month: the scope of one fattura differita. */
interface PaymentGroup {
  key: string;
  tenant_id: string;
  month: string;
  name: string;
  piva: string | null;
  livemode: boolean;
  currency: string;
  rows: PaymentRow[];
  net_cents: number;
  tax_cents: number;
  total_cents: number;
  fee_cents: number;
  to_invoice: number;
}

const STATUSES: PayStatus[] = ['to_invoice', 'invoiced', 'all'];

// Fields of the billing snapshot, in the order they are typed into a fattura.
const SNAPSHOT_FIELDS = [
  'legal_name',
  'partita_iva',
  'codice_fiscale',
  'address',
  'cap',
  'city',
  'province',
  'country',
  'sdi_code',
  'pec',
  'billing_email',
] as const;

function errMsg(t: (k: string, o?: Record<string, unknown>) => string, e: unknown): string {
  const code = (e as ApiError | null)?.code;
  return t(`errors.${code ?? 'default'}`, { defaultValue: t('errors.default') });
}

function companyName(r: PaymentRow): string {
  return r.billing_snapshot?.legal_name || r.billing_snapshot?.ragione_sociale || r.ragione_sociale;
}

function lineText(l: PaymentLine): string {
  return l.label ?? l.description ?? '';
}

/** The last `n` Rome months, newest first (`YYYY-MM`). */
function recentMonths(n: number): string[] {
  const [y, m] = romeThisMonth().split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

type MoneyField = 'net_cents' | 'tax_cents' | 'total_cents' | 'fee_cents';
interface MoneyRow {
  currency: string;
  net_cents: number;
  tax_cents: number;
  total_cents: number;
  fee_cents: number | null;
}

/** Right-aligned euro column; sorts on the cents, shows them formatted. */
function moneyCol<R extends MoneyRow>(field: MoneyField, headerName: string, lang: string, width = 110): GridColDef<R> {
  return {
    field,
    headerName,
    type: 'number',
    width,
    align: 'right',
    headerAlign: 'right',
    valueGetter: (_v, row) => row[field] ?? 0,
    renderCell: (p) => fmtMoney(p.row[field], lang, p.row.currency),
  };
}

export function Payments() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const toast = useToast();
  const confirm = useConfirm();
  const isMobile = useMediaQuery('(max-width: 768px)', { noSsr: true });

  // ?tenant_id=&tenant= (from a company's Abbonamento dialog) opens the ledger on
  // that one company, every month and every state.
  const [tenantFilter, setTenantFilter] = useState<{ id: string; name: string } | null>(() => {
    const p = new URLSearchParams(window.location.search);
    const id = p.get('tenant_id');
    return id ? { id, name: p.get('tenant') ?? '' } : null;
  });
  const [status, setStatus] = useState<PayStatus>(() => (tenantFilter ? 'all' : 'to_invoice'));
  const [month, setMonth] = useState<string>(() => (tenantFilter ? '' : romeThisMonth()));
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [grouped, setGrouped] = useState(false);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [stripeMode, setStripeMode] = useState<'sandbox' | 'live' | null>(null);
  const [otherMonthsToInvoice, setOtherMonthsToInvoice] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  // Dialogs hold ids, so they read the refreshed rows after every change.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [marking, setMarking] = useState<string[] | null>(null);
  // Only the latest request may paint: a slow answer to an older filter must not
  // overwrite a newer one.
  const reqSeq = useRef(0);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('tenant_id')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const h = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(h);
  }, [qInput]);

  const months = useMemo(() => recentMonths(36), []);

  const query = useMemo(() => {
    const p = new URLSearchParams({ status });
    if (month) p.set('month', month);
    if (tenantFilter) p.set('tenant_id', tenantFilter.id);
    if (q) p.set('q', q);
    return p.toString();
  }, [status, month, tenantFilter, q]);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      // With a month picked, also count what is still to invoice in the OTHER
      // months: last month's charges are due by the 15th and must not hide
      // behind the default "this month" view.
      const wantOthers = month !== '' && status !== 'invoiced';
      const othersQuery = new URLSearchParams({ status: 'to_invoice' });
      if (tenantFilter) othersQuery.set('tenant_id', tenantFilter.id);
      if (q) othersQuery.set('q', q);
      const [r, all] = await Promise.all([
        api<{ items: PaymentRow[]; totals: Totals; stripe_mode?: 'sandbox' | 'live' }>(
          `/api/v1/partnership/billing/payments?${query}`
        ),
        wantOthers
          ? api<{ totals: Totals }>(`/api/v1/partnership/billing/payments?${othersQuery}`)
          : Promise.resolve(null),
      ]);
      if (seq !== reqSeq.current) return;
      setRows(r.items);
      setTotals(r.totals);
      setStripeMode(r.stripe_mode ?? null);
      setOtherMonthsToInvoice(all ? Math.max(0, all.totals.to_invoice - r.totals.to_invoice) : 0);
    } catch (e) {
      if (seq === reqSeq.current) toast(errMsg(t, e), true);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [query, month, status, tenantFilter, q, t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, PaymentGroup>();
    for (const r of rows) {
      const m = romeMonthOf(r.paid_at);
      const key = `${r.tenant_id}-${m}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          tenant_id: r.tenant_id,
          month: m,
          name: companyName(r),
          piva: r.billing_snapshot?.partita_iva ?? null,
          livemode: r.livemode,
          currency: r.currency,
          rows: [],
          net_cents: 0,
          tax_cents: 0,
          total_cents: 0,
          fee_cents: 0,
          to_invoice: 0,
        };
        map.set(key, g);
      }
      g.rows.push(r);
      g.net_cents += r.net_cents;
      g.tax_cents += r.tax_cents;
      g.total_cents += r.total_cents;
      g.fee_cents += r.fee_cents ?? 0;
      if (!r.invoiced_at) g.to_invoice += 1;
    }
    return [...map.values()].sort((a, b) =>
      a.month === b.month ? a.name.localeCompare(b.name) : a.month < b.month ? 1 : -1
    );
  }, [rows]);

  const detailRow = detailId ? rows.find((r) => r.id === detailId) ?? null : null;
  const openGroup = groupKey ? groups.find((g) => g.key === groupKey) ?? null : null;

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadFile(
        `/api/v1/partnership/billing/payments/export.csv?${query}`,
        `pagamenti-sonoqui-${month || 'tutti'}.csv`
      );
    } catch (e) {
      toast(errMsg(t, e), true);
    } finally {
      setExporting(false);
    }
  }

  async function unmark(r: PaymentRow) {
    const ok = await confirm({
      message: t('payments.unmark.confirm', { number: r.invoice_number ?? '—' }),
      confirmLabel: t('payments.unmark.label'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/v1/partnership/billing/payments/${r.id}`, { method: 'PATCH', json: { invoiced: false } });
      toast(t('payments.unmark.done'));
      await load();
    } catch (e) {
      toast(errMsg(t, e), true);
    }
  }

  const isDefaultView = status === 'to_invoice' && month === romeThisMonth() && q === '' && !tenantFilter;
  const emptyArt = isDefaultView ? 'documents' : 'search';
  const emptyTitle = t(isDefaultView ? 'payments.empty' : 'payments.emptyFiltered');
  const emptyHint = t(isDefaultView ? 'payments.emptyHint' : 'payments.emptyFilteredHint');

  // ---- cells shared by the grid and the phone cards ----------------------------

  const statusBadges = (r: PaymentRow) => (
    <span className="badge-line">
      {r.invoiced_at ? (
        <span className="badge badge-ok" title={r.note ?? undefined}>
          {t('payments.status.invoiced', {
            number: r.invoice_number ?? '—',
            date: fmtDate(r.invoice_date ?? r.invoiced_at, lang),
          })}
        </span>
      ) : (
        <span className="badge badge-caution">{t('payments.status.to_invoice')}</span>
      )}
      {r.refunded_cents > 0 && (
        <span className="badge badge-warn">
          {r.refunded_cents >= r.total_cents
            ? t('payments.status.refunded')
            : t('payments.status.refundedPartial', { amount: fmtMoney(r.refunded_cents, lang, r.currency) })}
        </span>
      )}
      {r.disputed && <span className="badge badge-warn">{t('payments.status.disputed')}</span>}
      {!r.livemode && <span className="badge badge-muted">{t('payments.test')}</span>}
    </span>
  );

  const dueCell = (r: PaymentRow) => {
    if (r.invoiced_at) return <span className="muted">—</span>;
    const d = invoiceDeadlines(r.paid_at);
    const today = romeToday();
    return (
      <span className="cell-stack">
        <span className={`small${today > d.immediate ? ' muted strike' : ''}`}>
          {t('payments.due.immediate', { date: fmtDate(d.immediate, lang) })}
        </span>
        <span className={`small${today > d.deferred ? ' text-error' : ''}`}>
          {t('payments.due.deferred', { date: fmtDate(d.deferred, lang) })}
        </span>
      </span>
    );
  };

  const linesCell = (r: PaymentRow) => {
    const lines = r.lines ?? [];
    const text = lines.map(lineText).filter(Boolean).join(' · ') || '—';
    const prorated = lines.some((l) => l.proration);
    return (
      <span className="cell-stack">
        <span className="cell-ellipsis" title={text}>
          {text}
          {prorated && <span className="muted small"> ({t('payments.proration')})</span>}
        </span>
        <span className="muted small">{fmtPeriod(r.period_start, r.period_end, lang)}</span>
      </span>
    );
  };

  // Both when both exist: SDI 0000000 means "deliver via PEC / cassetto fiscale".
  const recipient = (s: BillingSnapshot | null | undefined): string =>
    [s?.sdi_code ? `SDI ${s.sdi_code}` : null, s?.pec ? `PEC ${s.pec}` : null].filter(Boolean).join(' · ') || '—';

  const rowActions = (r: PaymentRow) => (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: '100%' }}>
      <IconButton
        label={t('payments.detail.open')}
        testId={`payment-detail-${r.id}`}
        icon={<IconEye />}
        onClick={() => setDetailId(r.id)}
      />
      {r.invoiced_at ? (
        <IconButton
          label={t('payments.unmark.label')}
          testId={`payment-unmark-${r.id}`}
          icon={<IconUndo />}
          onClick={() => void unmark(r)}
        />
      ) : (
        <IconButton
          label={t('payments.mark.label')}
          testId={`payment-mark-${r.id}`}
          primary
          icon={<IconReceipt />}
          onClick={() => setMarking([r.id])}
        />
      )}
    </div>
  );

  const groupActions = (g: PaymentGroup) => (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: '100%' }}>
      <IconButton
        label={t('payments.group.open')}
        testId={`payment-group-detail-${g.key}`}
        icon={<IconEye />}
        onClick={() => setGroupKey(g.key)}
      />
      {g.to_invoice > 0 && (
        <IconButton
          label={t('payments.group.mark', { count: g.to_invoice })}
          testId={`payment-group-mark-${g.key}`}
          primary
          icon={<IconReceipt />}
          onClick={() => setMarking(g.rows.filter((r) => !r.invoiced_at).map((r) => r.id))}
        />
      )}
    </div>
  );

  const columns: GridColDef<PaymentRow>[] = [
    {
      field: 'paid_at',
      headerName: t('payments.col.paidAt'),
      width: 150,
      renderCell: (p) => fmtDateTime(p.row.paid_at, lang),
    },
    {
      field: 'ragione_sociale',
      headerName: t('payments.col.company'),
      flex: 1,
      minWidth: 180,
      valueGetter: (_v, row) => companyName(row),
      renderCell: (p) => (
        <span className="cell-ellipsis" title={companyName(p.row)}>
          {companyName(p.row)}
        </span>
      ),
    },
    {
      field: 'piva',
      headerName: t('payments.col.piva'),
      width: 130,
      valueGetter: (_v, row) => row.billing_snapshot?.partita_iva ?? '',
      renderCell: (p) => (
        <span className="mono" title={p.row.billing_snapshot?.codice_fiscale ?? undefined}>
          {p.row.billing_snapshot?.partita_iva || '—'}
        </span>
      ),
    },
    {
      field: 'recipient',
      headerName: t('payments.col.recipient'),
      width: 170,
      valueGetter: (_v, row) => recipient(row.billing_snapshot),
      renderCell: (p) => (
        <span className="cell-ellipsis" title={recipient(p.row.billing_snapshot)}>
          {recipient(p.row.billing_snapshot)}
        </span>
      ),
    },
    {
      field: 'lines',
      headerName: t('payments.col.lines'),
      flex: 1.4,
      minWidth: 220,
      sortable: false,
      filterable: false,
      renderCell: (p) => linesCell(p.row),
    },
    moneyCol<PaymentRow>('net_cents', t('payments.col.net'), lang),
    moneyCol<PaymentRow>('tax_cents', t('payments.col.tax'), lang, 100),
    moneyCol<PaymentRow>('total_cents', t('payments.col.total'), lang),
    moneyCol<PaymentRow>('fee_cents', t('payments.col.fee'), lang, 110),
    {
      field: 'status',
      headerName: t('payments.col.status'),
      width: 240,
      sortable: false,
      filterable: false,
      renderCell: (p) => <span className="cell-badge">{statusBadges(p.row)}</span>,
    },
    {
      field: 'due',
      headerName: t('payments.col.due'),
      width: 170,
      sortable: false,
      filterable: false,
      renderCell: (p) => dueCell(p.row),
    },
    {
      field: 'actions',
      headerName: t('tenants.col.actions'),
      width: 100,
      sortable: false,
      filterable: false,
      renderCell: (p) => rowActions(p.row),
    },
  ];

  const groupColumns: GridColDef<PaymentGroup>[] = [
    {
      field: 'name',
      headerName: t('payments.col.company'),
      flex: 1,
      minWidth: 200,
      renderCell: (p) => (
        <span className="cell-stack">
          <span className="cell-ellipsis" title={p.row.name}>
            {p.row.name}
            {!p.row.livemode && <span className="muted small"> · {t('payments.test')}</span>}
          </span>
          <span className="muted small mono">{p.row.piva || '—'}</span>
        </span>
      ),
    },
    {
      field: 'month',
      headerName: t('payments.col.month'),
      width: 150,
      renderCell: (p) => fmtMonth(p.row.month, lang),
    },
    {
      field: 'count',
      headerName: t('payments.col.count'),
      type: 'number',
      width: 90,
      valueGetter: (_v, row) => row.rows.length,
    },
    moneyCol<PaymentGroup>('net_cents', t('payments.col.net'), lang),
    moneyCol<PaymentGroup>('tax_cents', t('payments.col.tax'), lang, 100),
    moneyCol<PaymentGroup>('total_cents', t('payments.col.total'), lang),
    moneyCol<PaymentGroup>('fee_cents', t('payments.col.fee'), lang, 110),
    {
      field: 'to_invoice',
      headerName: t('payments.col.status'),
      width: 170,
      renderCell: (p) => (
        <span className="cell-badge">
          {p.row.to_invoice > 0 ? (
            <span className="badge badge-caution">{t('payments.group.toInvoice', { count: p.row.to_invoice })}</span>
          ) : (
            <span className="badge badge-ok">{t('payments.group.allInvoiced')}</span>
          )}
        </span>
      ),
    },
    {
      field: 'due',
      headerName: t('payments.col.due'),
      width: 170,
      sortable: false,
      filterable: false,
      renderCell: (p) => {
        if (p.row.to_invoice === 0) return <span className="muted">—</span>;
        const due = deferredDeadlineOfMonth(p.row.month);
        return (
          <span className={`small${romeToday() > due ? ' text-error' : ''}`}>
            {t('payments.due.deferred', { date: fmtDate(due, lang) })}
          </span>
        );
      },
    },
    {
      field: 'actions',
      headerName: t('tenants.col.actions'),
      width: 100,
      sortable: false,
      filterable: false,
      renderCell: (p) => groupActions(p.row),
    },
  ];

  const TOTAL_CARDS: { key: keyof Totals; label: string; money: boolean }[] = [
    { key: 'net_cents', label: t('payments.totals.net'), money: true },
    { key: 'tax_cents', label: t('payments.totals.tax'), money: true },
    { key: 'total_cents', label: t('payments.totals.total'), money: true },
    { key: 'fee_cents', label: t('payments.totals.fee'), money: true },
    { key: 'to_invoice', label: t('payments.totals.toInvoice'), money: false },
  ];

  return (
    <div className="page-stack" data-testid="payments-page">
      <PageHeader
        title={t('payments.title')}
        subtitle={t('payments.subtitle')}
        actions={
          <>
            <IconButton label={t('actions.refresh')} icon={<IconRefresh />} onClick={() => void load()} />
            <IconButton
              label={t('payments.export')}
              testId="payments-export"
              icon={<IconDownload />}
              disabled={exporting}
              onClick={() => void exportCsv()}
            />
          </>
        }
      />

      <div className="filter-row">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-secondary'}`}
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            data-testid={`payments-filter-${s}`}
          >
            {t(`payments.filter.${s}`)}
          </button>
        ))}
        <select
          className="input filter-month"
          aria-label={t('payments.month')}
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          data-testid="payments-month"
        >
          <option value="">{t('payments.allMonths')}</option>
          {month !== '' && !months.includes(month) && <option value={month}>{fmtMonth(month, lang)}</option>}
          {months.map((m) => (
            <option key={m} value={m}>
              {fmtMonth(m, lang)}
            </option>
          ))}
        </select>
        <input
          className="input filter-search"
          type="search"
          placeholder={t('payments.searchPlaceholder')}
          aria-label={t('payments.searchPlaceholder')}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          data-testid="payments-search"
        />
        {tenantFilter && (
          <span className="filter-chip" data-testid="payments-tenant-filter">
            {t('payments.tenantFilter', { name: tenantFilter.name || '—' })}
            <button
              type="button"
              aria-label={t('payments.tenantFilterClear')}
              title={t('payments.tenantFilterClear')}
              onClick={() => setTenantFilter(null)}
              data-testid="payments-tenant-clear"
            >
              ×
            </button>
          </span>
        )}
        <label className="checkbox-row inline-check filter-toggle">
          <input
            type="checkbox"
            role="switch"
            checked={grouped}
            onChange={(e) => setGrouped(e.target.checked)}
            data-testid="payments-group-toggle"
          />
          <span>{t('payments.group.toggle')}</span>
        </label>
      </div>

      {otherMonthsToInvoice > 0 && (
        <div className="notice notice-row" data-testid="payments-other-months">
          <span>{t('payments.otherMonths', { count: otherMonthsToInvoice })}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setMonth('');
              setStatus('to_invoice');
            }}
          >
            {t('payments.showAllMonths')}
          </button>
        </div>
      )}

      {stripeMode === 'sandbox' && (
        <div className="notice" data-testid="payments-sandbox">
          {t('payments.sandboxNotice')}
        </div>
      )}

      <div className="stat-cards" data-testid="payments-totals">
        {TOTAL_CARDS.map((c) => (
          <div className="stat-card" key={c.key} data-testid={`payments-total-${c.key}`}>
            <div className="stat-label">{c.label}</div>
            <div className="stat-value">
              {totals == null ? '—' : c.money ? fmtMoney(totals[c.key], lang) : totals[c.key]}
            </div>
            <div className="stat-sub">
              {c.key === 'to_invoice' && totals ? t('payments.totals.ofCount', { count: totals.count }) : ' '}
            </div>
          </div>
        ))}
      </div>

      <p className="muted small ledger-rule">{t('payments.rule')}</p>

      {isMobile ? (
        <MCardList
          loading={loading}
          empty={!loading && rows.length === 0}
          art={emptyArt}
          emptyTitle={emptyTitle}
          emptyHint={emptyHint}
        >
          {grouped
            ? groups.map((g) => (
                <MCard
                  key={g.key}
                  title={g.name}
                  badge={
                    g.to_invoice > 0 ? (
                      <span className="badge badge-caution">{t('payments.group.toInvoice', { count: g.to_invoice })}</span>
                    ) : (
                      <span className="badge badge-ok">{t('payments.group.allInvoiced')}</span>
                    )
                  }
                  fields={[
                    { label: t('payments.col.month'), value: fmtMonth(g.month, lang) },
                    { label: t('payments.col.piva'), value: g.piva || '—' },
                    { label: t('payments.col.count'), value: g.rows.length },
                    { label: t('payments.col.net'), value: fmtMoney(g.net_cents, lang, g.currency) },
                    { label: t('payments.col.total'), value: fmtMoney(g.total_cents, lang, g.currency) },
                    ...(g.to_invoice > 0
                      ? [
                          {
                            label: t('payments.col.due'),
                            value: t('payments.due.deferred', { date: fmtDate(deferredDeadlineOfMonth(g.month), lang) }),
                          },
                        ]
                      : []),
                  ]}
                  actions={groupActions(g)}
                />
              ))
            : rows.map((r) => (
                <MCard
                  key={r.id}
                  title={companyName(r)}
                  badge={statusBadges(r)}
                  fields={[
                    { label: t('payments.col.paidAt'), value: fmtDateTime(r.paid_at, lang) },
                    { label: t('payments.col.piva'), value: r.billing_snapshot?.partita_iva || '—' },
                    { label: t('payments.col.recipient'), value: recipient(r.billing_snapshot) },
                    { label: t('payments.col.lines'), value: (r.lines ?? []).map(lineText).filter(Boolean).join(' · ') || '—' },
                    { label: t('payments.col.net'), value: fmtMoney(r.net_cents, lang, r.currency) },
                    { label: t('payments.col.tax'), value: fmtMoney(r.tax_cents, lang, r.currency) },
                    { label: t('payments.col.total'), value: fmtMoney(r.total_cents, lang, r.currency) },
                    { label: t('payments.col.fee'), value: fmtMoney(r.fee_cents, lang, r.currency) },
                    ...(r.invoiced_at ? [] : [{ label: t('payments.col.due'), value: dueCell(r) }]),
                  ]}
                  actions={rowActions(r)}
                />
              ))}
        </MCardList>
      ) : grouped ? (
        <div className="grid-wrap card">
          <DataGrid
            key="groups"
            rows={groups}
            columns={groupColumns}
            getRowId={(g) => g.key}
            loading={loading}
            disableRowSelectionOnClick
            density="compact"
            rowHeight={52}
            initialState={{ pagination: { paginationModel: { pageSize: 50 } } }}
            pageSizeOptions={[50, 100]}
            sx={{ border: 0, '--DataGrid-overlayHeight': '17rem' }}
            slots={{ noRowsOverlay: GridEmptyOverlay }}
            slotProps={{ noRowsOverlay: { art: emptyArt, title: emptyTitle, hint: emptyHint } }}
          />
        </div>
      ) : (
        <div className="grid-wrap card">
          <DataGrid
            key="payments"
            rows={rows}
            columns={columns}
            loading={loading}
            disableRowSelectionOnClick
            density="compact"
            rowHeight={52}
            initialState={{ pagination: { paginationModel: { pageSize: 50 } } }}
            pageSizeOptions={[50, 100]}
            sx={{ border: 0, '--DataGrid-overlayHeight': '17rem' }}
            slots={{ noRowsOverlay: GridEmptyOverlay }}
            slotProps={{ noRowsOverlay: { art: emptyArt, title: emptyTitle, hint: emptyHint } }}
          />
        </div>
      )}

      {openGroup && (
        <GroupDialog
          group={openGroup}
          onClose={() => setGroupKey(null)}
          onDetail={(id) => setDetailId(id)}
          onMark={(ids) => setMarking(ids)}
          onUnmark={(r) => void unmark(r)}
        />
      )}
      {detailRow && (
        <PaymentDetail
          row={detailRow}
          onClose={() => setDetailId(null)}
          onMark={() => setMarking([detailRow.id])}
          onUnmark={() => void unmark(detailRow)}
        />
      )}
      {marking && (
        <MarkInvoiced
          ids={marking}
          onClose={() => setMarking(null)}
          onDone={async () => {
            setMarking(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// ---- dialogs -------------------------------------------------------------------

/** One company-month: its charges, and one fattura differita for all of them. */
function GroupDialog({
  group,
  onClose,
  onDetail,
  onMark,
  onUnmark,
}: {
  group: PaymentGroup;
  onClose: () => void;
  onDetail: (id: string) => void;
  onMark: (ids: string[]) => void;
  onUnmark: (r: PaymentRow) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const pending = group.rows.filter((r) => !r.invoiced_at);
  const due = deferredDeadlineOfMonth(group.month);
  return (
    <Modal title={`${group.name} · ${fmtMonth(group.month, lang)}`} onClose={onClose} wide testId="payment-group-dialog">
      <div className="modal-body">
        <dl className="kv-grid">
          <dt>{t('payments.col.piva')}</dt>
          <dd className="mono">{group.piva || '—'}</dd>
          <dt>{t('payments.col.net')}</dt>
          <dd>{fmtMoney(group.net_cents, lang, group.currency)}</dd>
          <dt>{t('payments.col.tax')}</dt>
          <dd>{fmtMoney(group.tax_cents, lang, group.currency)}</dd>
          <dt>{t('payments.col.total')}</dt>
          <dd>
            <strong>{fmtMoney(group.total_cents, lang, group.currency)}</strong>
          </dd>
          <dt>{t('payments.col.fee')}</dt>
          <dd>{fmtMoney(group.fee_cents, lang, group.currency)}</dd>
          {pending.length > 0 && (
            <>
              <dt>{t('payments.col.due')}</dt>
              <dd>{t('payments.due.deferred', { date: fmtDate(due, lang) })}</dd>
            </>
          )}
        </dl>
        <p className="muted">{t('payments.group.hint')}</p>
        <div className="admin-list">
          {group.rows.map((r) => (
            <div className="entity-row" key={r.id}>
              <span className="entity-row-main">
                <span className="entity-row-name">
                  {fmtDateTime(r.paid_at, lang)} · {fmtMoney(r.total_cents, lang, r.currency)}
                </span>
                <span className="entity-row-sub">{(r.lines ?? []).map(lineText).filter(Boolean).join(' · ') || '—'}</span>
              </span>
              <span className="entity-row-badges">
                {r.invoiced_at ? (
                  <span className="badge badge-ok">
                    {t('payments.status.invoiced', {
                      number: r.invoice_number ?? '—',
                      date: fmtDate(r.invoice_date ?? r.invoiced_at, lang),
                    })}
                  </span>
                ) : (
                  <span className="badge badge-caution">{t('payments.status.to_invoice')}</span>
                )}
                <IconButton label={t('payments.detail.open')} icon={<IconEye />} onClick={() => onDetail(r.id)} />
                {r.invoiced_at ? (
                  <IconButton label={t('payments.unmark.label')} icon={<IconUndo />} onClick={() => onUnmark(r)} />
                ) : (
                  <IconButton label={t('payments.mark.label')} icon={<IconReceipt />} onClick={() => onMark([r.id])} />
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t('actions.close')}
        </button>
        {pending.length > 0 && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onMark(pending.map((r) => r.id))}
            data-testid="payment-group-mark-all"
          >
            {t('payments.group.mark', { count: pending.length })}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Everything needed to type the fattura, one copy button per field. */
function PaymentDetail({
  row,
  onClose,
  onMark,
  onUnmark,
}: {
  row: PaymentRow;
  onClose: () => void;
  onMark: () => void;
  onUnmark: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const toast = useToast();
  const snap = row.billing_snapshot ?? {};
  const lines = row.lines ?? [];
  const valueOf = (f: (typeof SNAPSHOT_FIELDS)[number]): string =>
    (f === 'legal_name' ? snap.legal_name || snap.ragione_sociale || row.ragione_sociale : snap[f]) ?? '';

  async function copy(text: string) {
    const ok = await copyText(text);
    toast(ok ? t('payments.detail.copied') : t('payments.detail.copyFailed'), !ok);
  }

  const allText = SNAPSHOT_FIELDS.map((f) => [t(`billing.profile.${f}`), valueOf(f)] as const)
    .filter(([, v]) => v.trim() !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const linesText = lines
    .map((l) => `${lineText(l)}${l.period_start || l.period_end ? ` (${fmtPeriod(l.period_start, l.period_end, lang)})` : ''}`)
    .join('\n');
  const deadlines = invoiceDeadlines(row.paid_at);

  return (
    <Modal
      title={`${t('payments.detail.title')} · ${companyName(row)} · ${fmtDate(row.paid_at, lang)}`}
      onClose={onClose}
      wide
      testId="payment-detail"
    >
      <div className="modal-body">
        <div className="form-cols">
          <div className="col-group">
            <section className="dlg-section">
              <div className="dlg-title-row">
                <h3 className="dlg-title">{t('payments.detail.invoiceData')}</h3>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void copy(allText)}
                  data-testid="payment-copy-all"
                >
                  <IconCopy /> {t('payments.detail.copyAll')}
                </button>
              </div>
              <div className="copy-list">
                {SNAPSHOT_FIELDS.map((f) => {
                  const v = valueOf(f);
                  return (
                    <div className="copy-row" key={f}>
                      <span className="copy-label">{t(`billing.profile.${f}`)}</span>
                      <span className="copy-value">{v || <span className="muted">—</span>}</span>
                      {v ? (
                        <IconButton
                          label={t('payments.detail.copy', { field: t(`billing.profile.${f}`) })}
                          testId={`payment-copy-${f}`}
                          icon={<IconCopy />}
                          onClick={() => void copy(v)}
                        />
                      ) : (
                        <span className="copy-spacer" />
                      )}
                    </div>
                  );
                })}
              </div>
              {snap.vat_status && (
                <span className="muted small">
                  {t('payments.detail.vatAtPayment', {
                    status: t(`billing.vat.${snap.vat_status}`, { defaultValue: snap.vat_status }),
                  })}
                </span>
              )}
            </section>
          </div>

          <div className="col-group">
            <section className="dlg-section">
              <div className="dlg-title-row">
                <h3 className="dlg-title">{t('payments.col.lines')}</h3>
                {linesText && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void copy(linesText)}
                    data-testid="payment-copy-lines"
                  >
                    <IconCopy /> {t('payments.detail.copyLines')}
                  </button>
                )}
              </div>
              {lines.length === 0 ? (
                <div className="muted">—</div>
              ) : (
                <div className="admin-list">
                  {lines.map((l, i) => (
                    <div className="entity-row" key={i}>
                      <span className="entity-row-main">
                        <span className="entity-row-name">
                          {lineText(l) || '—'}
                          {l.proration && <span className="muted small"> ({t('payments.proration')})</span>}
                        </span>
                        <span className="entity-row-sub">{fmtPeriod(l.period_start, l.period_end, lang)}</span>
                      </span>
                      <span className="entity-row-badges">{fmtMoney(l.amount_cents, lang, row.currency)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="dlg-section">
              <h3 className="dlg-title">{t('payments.detail.amounts')}</h3>
              <dl className="kv-grid">
                <dt>{t('payments.col.net')}</dt>
                <dd className="copy-inline">
                  {fmtMoney(row.net_cents, lang, row.currency)}
                  <button
                    type="button"
                    className="link-inline"
                    onClick={() => void copy((row.net_cents / 100).toFixed(2).replace('.', ','))}
                    aria-label={t('payments.detail.copy', { field: t('payments.col.net') })}
                  >
                    <IconCopy />
                  </button>
                </dd>
                <dt>{t('payments.col.tax')}</dt>
                <dd>{fmtMoney(row.tax_cents, lang, row.currency)}</dd>
                <dt>{t('payments.col.total')}</dt>
                <dd>
                  <strong>{fmtMoney(row.total_cents, lang, row.currency)}</strong>
                </dd>
                <dt>{t('payments.col.fee')}</dt>
                <dd>{fmtMoney(row.fee_cents, lang, row.currency)}</dd>
                <dt>{t('payments.detail.netReceived')}</dt>
                <dd>{fmtMoney(row.total_cents - (row.fee_cents ?? 0), lang, row.currency)}</dd>
                {row.refunded_cents > 0 && (
                  <>
                    <dt>{t('payments.status.refunded')}</dt>
                    <dd className="text-error">{fmtMoney(row.refunded_cents, lang, row.currency)}</dd>
                  </>
                )}
                {row.disputed && (
                  <>
                    <dt>{t('payments.status.disputed')}</dt>
                    <dd className="text-error">{t('common.yes')}</dd>
                  </>
                )}
                <dt>{t('payments.col.paidAt')}</dt>
                <dd>{fmtDateTime(row.paid_at, lang)}</dd>
                <dt>{t('payments.detail.period')}</dt>
                <dd>{fmtPeriod(row.period_start, row.period_end, lang)}</dd>
              </dl>
            </section>
          </div>
        </div>

        <section className="dlg-section">
          <h3 className="dlg-title">{t('payments.detail.invoicing')}</h3>
          <dl className="kv-grid">
            <dt>{t('payments.col.status')}</dt>
            <dd>
              {row.invoiced_at
                ? t('payments.status.invoiced', {
                    number: row.invoice_number ?? '—',
                    date: fmtDate(row.invoice_date ?? row.invoiced_at, lang),
                  })
                : t('payments.status.to_invoice')}
            </dd>
            {row.invoiced_at ? (
              <>
                <dt>{t('payments.detail.markedAt')}</dt>
                <dd>{fmtDateTime(row.invoiced_at, lang)}</dd>
              </>
            ) : (
              <>
                <dt>{t('payments.col.due')}</dt>
                <dd>
                  {t('payments.due.immediate', { date: fmtDate(deadlines.immediate, lang) })} ·{' '}
                  {t('payments.due.deferred', { date: fmtDate(deadlines.deferred, lang) })}
                </dd>
              </>
            )}
            {row.note && (
              <>
                <dt>{t('payments.mark.note')}</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{row.note}</dd>
              </>
            )}
            <dt>{t('payments.detail.stripeInvoice')}</dt>
            <dd className="mono">{row.stripe_invoice_id}</dd>
            <dt>{t('payments.detail.stripeCharge')}</dt>
            <dd className="mono">{row.stripe_charge_id || '—'}</dd>
            <dt>{t('payments.detail.mode')}</dt>
            <dd>{row.livemode ? t('payments.detail.live') : t('payments.test')}</dd>
          </dl>
        </section>
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t('actions.close')}
        </button>
        {row.invoiced_at ? (
          <button type="button" className="btn btn-secondary" onClick={onUnmark} data-testid="payment-detail-unmark">
            {t('payments.unmark.label')}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onMark} data-testid="payment-detail-mark">
            {t('payments.mark.label')}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Invoice number + date (+ note) for one charge or a whole company-month. */
function MarkInvoiced({
  ids,
  onClose,
  onDone,
}: {
  ids: string[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(romeToday());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const many = ids.length > 1;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const num = number.trim();
    if (!num) {
      setErr(t('payments.mark.numberRequired'));
      return;
    }
    setBusy(true);
    setErr(null);
    let failed = 0;
    let lastErr: unknown = null;
    // One PATCH per charge: a fattura differita carries the same number on all.
    for (const id of ids) {
      try {
        await api(`/api/v1/partnership/billing/payments/${id}`, {
          method: 'PATCH',
          json: {
            invoiced: true,
            invoice_number: num,
            invoice_date: date || null,
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        });
      } catch (e2) {
        failed += 1;
        lastErr = e2;
      }
    }
    setBusy(false);
    if (failed === ids.length) {
      setErr(errMsg(t, lastErr));
      return;
    }
    if (failed > 0) toast(t('payments.mark.partial', { failed, count: ids.length }), true);
    else toast(many ? t('payments.mark.doneMany', { count: ids.length, number: num }) : t('payments.mark.done', { number: num }));
    await onDone();
  }

  return (
    <Modal
      title={many ? t('payments.mark.titleMany', { count: ids.length }) : t('payments.mark.title')}
      onClose={onClose}
      testId="payment-mark-dialog"
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <p className="muted">{many ? t('payments.mark.introMany') : t('payments.mark.intro')}</p>
          <div className="grid-2">
            <div>
              <label className="label" htmlFor="pm-number">
                {t('payments.mark.number')}
              </label>
              <input
                id="pm-number"
                className="input"
                required
                maxLength={60}
                autoFocus
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder={t('payments.mark.numberPh')}
                data-testid="payment-invoice-number"
              />
            </div>
            <div>
              <label className="label" htmlFor="pm-date">
                {t('payments.mark.date')}
              </label>
              <input
                id="pm-date"
                className="input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                data-testid="payment-invoice-date"
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="pm-note">
              {t('payments.mark.note')}
            </label>
            <textarea
              id="pm-note"
              className="input"
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              data-testid="payment-invoice-note"
            />
          </div>
          {err && <div className="form-err">{err}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('actions.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="payment-invoice-save">
            {busy ? t('common.saving') : t('payments.mark.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
