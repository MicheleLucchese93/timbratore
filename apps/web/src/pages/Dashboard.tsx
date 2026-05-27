import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useSession } from '../store/session.ts';
import { useRealtimePolling } from '../hooks/useRealtimePolling.ts';
import { IconButton } from '../components/IconButton.tsx';

interface Usage {
  active_users: string | number;
  active_admins: string | number;
  max_users: number;
  max_admins: number;
  branches_count: string | number;
}

interface Presence {
  clocked_in: string | number;
  on_break: string | number;
  off: string | number;
}

interface PendingCounts {
  corrections: string | number;
  leaves: string | number;
  leave_cancellations: string | number;
}

type LeaveType = 'ferie' | 'permessi' | 'malattia';

interface AbsentLeave {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  type: LeaveType;
  from_ts: string;
  to_ts: string;
  duration_hours: number;
}

type AnomalyKind =
  | 'missing_clock_in'
  | 'missing_clock_out'
  | 'late_clock_in'
  | 'early_clock_out'
  | 'worked_on_rest_day'
  | 'break_too_short'
  | 'break_too_long';

interface Anomaly {
  date: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  kind: AnomalyKind;
  delta_minutes: number | null;
  details: string | null;
}

interface Summary {
  usage: Usage;
  presence: Presence;
  pending: PendingCounts;
  absent_now: AbsentLeave[];
  upcoming_leaves: AbsentLeave[];
  anomalies_7d: {
    total: number;
    by_kind: Record<AnomalyKind, number>;
    recent: Anomaly[];
  };
}

interface UserCard {
  user_id: string;
  email: string;
  role: 'admin' | 'user';
  state: 'nothing' | 'clocked_in' | 'on_break';
  last_event: string | null;
  last_event_at: string | null;
  branch_name: string | null;
}

interface PendingCorrection {
  id: string;
  user_email: string;
  user_display_name: string | null;
  claimed_event_type: string;
  claimed_occurred_at: string;
  justification: string;
}

interface PendingLeave {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  type: LeaveType;
  status: 'pending' | 'cancellation_pending';
  from_ts: string;
  to_ts: string;
  duration_hours: number;
  inps_protocol: string | null;
  user_note: string | null;
  cancellation_reason: string | null;
}

type GroupMode = 'list' | 'by_branch';
type InboxTab = 'corrections' | 'leaves' | 'revocations';

const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  ferie: 'Ferie',
  permessi: 'Permesso',
  malattia: 'Malattia',
};

const ANOMALY_LABEL: Record<AnomalyKind, string> = {
  missing_clock_in: 'Entrata mancante',
  missing_clock_out: 'Uscita mancante',
  late_clock_in: 'Entrata in ritardo',
  early_clock_out: 'Uscita anticipata',
  worked_on_rest_day: 'Lavoro in giorno di riposo',
  break_too_short: 'Pausa troppo breve',
  break_too_long: 'Pausa troppo lunga',
};

export function Dashboard() {
  const me = useSession((s) => s.me);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cards, setCards] = useState<UserCard[]>([]);
  const [pendingCorrections, setPendingCorrections] = useState<PendingCorrection[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState<PendingLeave[]>([]);
  const [cancellationLeaves, setCancellationLeaves] = useState<PendingLeave[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [groupMode, setGroupMode] = useState<GroupMode>('list');
  const [inboxTab, setInboxTab] = useState<InboxTab>('corrections');
  const [err, setErr] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<
    | { kind: 'correction'; row: PendingCorrection }
    | { kind: 'leave'; row: PendingLeave }
    | null
  >(null);

  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      api<Summary>('/api/v1/dashboard/summary'),
      api<UserCard[]>('/api/v1/dashboard/cards'),
      api<PendingCorrection[]>('/api/v1/correction-requests?status=pending'),
      api<PendingLeave[]>('/api/v1/leaves?scope=all&status=pending'),
      api<PendingLeave[]>('/api/v1/leaves?scope=all&status=cancellation_pending'),
    ]);
    const [s, c, pc, pl, pcan] = results;
    if (s.status === 'fulfilled') setSummary(s.value);
    if (c.status === 'fulfilled') setCards(c.value);
    if (pc.status === 'fulfilled') setPendingCorrections(pc.value);
    if (pl.status === 'fulfilled') setPendingLeaves(pl.value);
    if (pcan.status === 'fulfilled') setCancellationLeaves(pcan.value);
    // Surface load error only if EVERYTHING failed (offline / auth).
    // A single endpoint missing (e.g. /summary pre-deploy) degrades silently.
    const allFailed = results.every((r) => r.status === 'rejected');
    if (allFailed) {
      const first = results[0];
      if (first.status === 'rejected') {
        const reason = first.reason;
        setErr(reason instanceof Error ? reason.message : 'errore');
      }
    } else {
      setErr(null);
    }
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load, refreshTick]);

  useRealtimePolling(() => setRefreshTick((t) => t + 1));

  async function approveCorrection(r: PendingCorrection) {
    setErr(null);
    try {
      await api(`/api/v1/correction-requests/${r.id}/approve`, { method: 'POST', json: {} });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  async function approveLeave(r: PendingLeave) {
    setErr(null);
    try {
      await api(`/api/v1/leaves/${r.id}/approve`, { method: 'POST' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  async function decideCancellation(r: PendingLeave, approveCancel: boolean) {
    setErr(null);
    try {
      await api(`/api/v1/leaves/${r.id}/decide-cancellation`, {
        method: 'POST',
        json: { approve: approveCancel },
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  if (!me) return null;

  const pendingTotal =
    pendingCorrections.length + pendingLeaves.length + cancellationLeaves.length;

  return (
    <div className="space-y-6">
      <header className="page-header">
        <div className="page-header-title">
          <h1>Dashboard</h1>
          <p>Stato in tempo reale, richieste in coda e anomalie della settimana.</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary" onClick={load}>
            <IconRefresh /> Aggiorna
          </button>
        </div>
      </header>

      {err && (
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
      )}

      <section className="dash-stat-grid">
        <StatCard
          label="Presenti ora"
          value={String(summary?.presence.clocked_in ?? '–')}
          suffix={`/ ${summary?.usage.active_users ?? '–'}`}
          icon={<IconUsers />}
        />
        <StatCard
          label="In pausa"
          value={String(summary?.presence.on_break ?? '–')}
          icon={<IconCoffee />}
        />
        <StatCard
          label="Assenti oggi"
          value={String(summary?.absent_now.length ?? '–')}
          icon={<IconCalendar />}
          accent={summary && summary.absent_now.length > 0 ? 'warn' : undefined}
        />
        <StatCard
          label="Da approvare"
          value={String(pendingTotal)}
          icon={<IconInbox />}
          accent={pendingTotal > 0 ? 'warn' : undefined}
        />
        <StatCard
          label="Anomalie 7 gg"
          value={String(summary?.anomalies_7d.total ?? '–')}
          icon={<IconAlert />}
          accent={summary && summary.anomalies_7d.total > 0 ? 'warn' : undefined}
        />
        <StatCard
          label="Sedi"
          value={String(summary?.usage.branches_count ?? '–')}
          icon={<IconMapPin />}
        />
      </section>

      <section>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="section-title">Da approvare</h2>
          <div className="text-xs muted">Totale: {pendingTotal}</div>
        </div>
        <div className="card p-0">
          <div className="flex border-b" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
            <InboxTabButton
              active={inboxTab === 'corrections'}
              onClick={() => setInboxTab('corrections')}
              label="Correzioni"
              count={pendingCorrections.length}
            />
            <InboxTabButton
              active={inboxTab === 'leaves'}
              onClick={() => setInboxTab('leaves')}
              label="Ferie / permessi / malattia"
              count={pendingLeaves.length}
            />
            <InboxTabButton
              active={inboxTab === 'revocations'}
              onClick={() => setInboxTab('revocations')}
              label="Revoche"
              count={cancellationLeaves.length}
            />
          </div>
          <div className="p-3">
            {inboxTab === 'corrections' && (
              <CorrectionsInbox
                rows={pendingCorrections}
                onApprove={approveCorrection}
                onReject={(row) => setRejectTarget({ kind: 'correction', row })}
              />
            )}
            {inboxTab === 'leaves' && (
              <LeavesInbox
                rows={pendingLeaves}
                onApprove={approveLeave}
                onReject={(row) => setRejectTarget({ kind: 'leave', row })}
              />
            )}
            {inboxTab === 'revocations' && (
              <RevocationsInbox
                rows={cancellationLeaves}
                onDecide={decideCancellation}
              />
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h2 className="section-title mb-3">Assenti ora</h2>
          {summary && summary.absent_now.length > 0 ? (
            <ul className="space-y-2">
              {summary.absent_now.map((a) => (
                <AbsenceRow key={a.id} row={a} mode="now" />
              ))}
            </ul>
          ) : (
            <EmptyState icon={<IconCalendar />} title="Nessuna assenza in corso" />
          )}
        </div>
        <div>
          <h2 className="section-title mb-3">Prossime 14 giorni</h2>
          {summary && summary.upcoming_leaves.length > 0 ? (
            <ul className="space-y-2">
              {summary.upcoming_leaves.map((a) => (
                <AbsenceRow key={a.id} row={a} mode="upcoming" />
              ))}
            </ul>
          ) : (
            <EmptyState icon={<IconCalendar />} title="Nessuna assenza programmata" />
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h2 className="section-title">Stato attuale</h2>
          <ViewToggle value={groupMode} onChange={setGroupMode} />
        </div>
        {cards.length === 0 ? (
          <EmptyState
            icon={<IconUsers />}
            title="Nessun dipendente ancora"
            hint="Invita il primo collaboratore dalla sezione Utenti."
          />
        ) : groupMode === 'list' ? (
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {cards.map((c) => (
              <UserStatusCard key={c.user_id} card={c} showBranch />
            ))}
          </ul>
        ) : (
          <BranchGroups cards={cards} />
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h2 className="section-title">Anomalie ultimi 7 giorni</h2>
          <Link to="/anomalies" className="btn btn-ghost btn-sm">
            Vedi tutte →
          </Link>
        </div>
        {summary && summary.anomalies_7d.total > 0 ? (
          <div className="card space-y-4">
            <AnomalyBreakdown by_kind={summary.anomalies_7d.by_kind} />
            <div>
              <div className="dash-subheading">Più recenti</div>
              <ul className="dash-row-list">
                {summary.anomalies_7d.recent.map((a, idx) => (
                  <li key={`${a.user_id}-${a.date}-${a.kind}-${idx}`} className="dash-row">
                    <span className="dash-row-badge">
                      <span className="badge badge-warn">{ANOMALY_LABEL[a.kind]}</span>
                    </span>
                    <span className="dash-row-name">
                      {a.user_display_name || a.user_email}
                    </span>
                    <span className="dash-row-meta num">
                      {new Date(a.date + 'T00:00:00').toLocaleDateString('it-IT', {
                        weekday: 'short',
                        day: '2-digit',
                        month: '2-digit',
                      })}
                      {a.delta_minutes != null && ` · ${a.delta_minutes}m`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <EmptyState icon={<IconAlert />} title="Nessuna anomalia negli ultimi 7 giorni" />
        )}
      </section>

      {rejectTarget && (
        <ReasonDialog
          title={rejectTarget.kind === 'leave' ? 'Rifiuta richiesta' : 'Rifiuta correzione'}
          label={rejectTarget.kind === 'leave' ? 'Motivo del rifiuto' : 'Nota di rifiuto (opzionale)'}
          required={rejectTarget.kind === 'leave'}
          onClose={() => setRejectTarget(null)}
          onSubmit={async (reason) => {
            try {
              if (rejectTarget.kind === 'leave') {
                await api(`/api/v1/leaves/${rejectTarget.row.id}/reject`, {
                  method: 'POST',
                  json: { rejection_reason: reason },
                });
              } else {
                await api(`/api/v1/correction-requests/${rejectTarget.row.id}/reject`, {
                  method: 'POST',
                  json: reason ? { resolution_note: reason } : {},
                });
              }
              setRejectTarget(null);
              await load();
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'errore');
            }
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Inbox sub-views ---------------- */

function CorrectionsInbox({
  rows,
  onApprove,
  onReject,
}: {
  rows: PendingCorrection[];
  onApprove: (r: PendingCorrection) => void;
  onReject: (r: PendingCorrection) => void;
}) {
  if (rows.length === 0) {
    return <EmptyState icon={<IconInbox />} title="Nessuna correzione in coda" />;
  }
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.id} className="inbox-row">
          <div className="min-w-0 flex-1">
            <div className="font-medium text-sm">{r.user_display_name || r.user_email}</div>
            <div className="text-xs muted num">
              {labelEvent(r.claimed_event_type)} ·{' '}
              {new Date(r.claimed_occurred_at).toLocaleString('it-IT')}
            </div>
            {r.justification && (
              <div className="text-xs muted mt-0.5 truncate" title={r.justification}>
                {r.justification}
              </div>
            )}
          </div>
          <div className="inbox-actions">
            <IconButton kind="approve" title="Approva" onClick={() => onApprove(r)} />
            <IconButton kind="reject" title="Rifiuta" onClick={() => onReject(r)} />
            <Link to="/corrections" className="icon-link" title="Apri dettaglio" aria-label="Apri dettaglio">
              <IconOpen />
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

function LeavesInbox({
  rows,
  onApprove,
  onReject,
}: {
  rows: PendingLeave[];
  onApprove: (r: PendingLeave) => void;
  onReject: (r: PendingLeave) => void;
}) {
  if (rows.length === 0) {
    return <EmptyState icon={<IconInbox />} title="Nessuna richiesta in coda" />;
  }
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.id} className="inbox-row">
          <div className="min-w-0 flex-1 flex items-start gap-2">
            <span className={`badge ${r.type === 'malattia' ? 'badge-warn' : 'badge-muted'} shrink-0 mt-0.5`}>
              {LEAVE_TYPE_LABEL[r.type]}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium">{r.user_display_name || r.user_email}</div>
              <div className="text-xs muted num">
                {fmtRange(r.from_ts, r.to_ts, r.type)} · {Number(r.duration_hours).toFixed(2)}h
              </div>
              {r.user_note && (
                <div className="text-xs muted mt-0.5 truncate" title={r.user_note}>
                  {r.user_note}
                </div>
              )}
              {r.inps_protocol && (
                <div className="text-xs muted">INPS: {r.inps_protocol}</div>
              )}
            </div>
          </div>
          <div className="inbox-actions">
            <IconButton kind="approve" title="Approva" onClick={() => onApprove(r)} />
            <IconButton kind="reject" title="Rifiuta" onClick={() => onReject(r)} />
            <Link to="/leaves" className="icon-link" title="Apri dettaglio" aria-label="Apri dettaglio">
              <IconOpen />
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

function RevocationsInbox({
  rows,
  onDecide,
}: {
  rows: PendingLeave[];
  onDecide: (r: PendingLeave, approveCancel: boolean) => void;
}) {
  if (rows.length === 0) {
    return <EmptyState icon={<IconInbox />} title="Nessuna revoca da decidere" />;
  }
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.id} className="inbox-row">
          <div className="min-w-0 flex-1 flex items-start gap-2">
            <span className={`badge ${r.type === 'malattia' ? 'badge-warn' : 'badge-muted'} shrink-0 mt-0.5`}>
              {LEAVE_TYPE_LABEL[r.type]}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium">{r.user_display_name || r.user_email}</div>
              <div className="text-xs muted num">
                {fmtRange(r.from_ts, r.to_ts, r.type)} · {Number(r.duration_hours).toFixed(2)}h
              </div>
              {r.cancellation_reason && (
                <div className="text-xs muted mt-0.5">Motivo: {r.cancellation_reason}</div>
              )}
            </div>
          </div>
          <div className="inbox-actions">
            <IconButton
              kind="approve"
              title="Accetta annullamento"
              onClick={() => onDecide(r, true)}
            />
            <IconButton
              kind="reject"
              title="Rifiuta annullamento"
              onClick={() => onDecide(r, false)}
            />
            <Link to="/leaves" className="icon-link" title="Apri dettaglio" aria-label="Apri dettaglio">
              <IconOpen />
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Absence row ---------------- */

function AbsenceRow({
  row,
  mode,
}: {
  row: AbsentLeave;
  mode: 'now' | 'upcoming';
}) {
  return (
    <li className="absence-row">
      <span className="absence-row-badge">
        <span className={`badge ${row.type === 'malattia' ? 'badge-warn' : 'badge-muted'}`}>
          {LEAVE_TYPE_LABEL[row.type]}
        </span>
      </span>
      <span className="absence-row-body">
        <span className="absence-row-name">{row.user_display_name || row.user_email}</span>
        <span className="absence-row-meta">
          {mode === 'now'
            ? `Fino al ${fmtDateShort(row.to_ts)}`
            : fmtRange(row.from_ts, row.to_ts, row.type)}
        </span>
      </span>
      <span className="absence-row-hours num">{Number(row.duration_hours).toFixed(2)}h</span>
    </li>
  );
}

/* ---------------- Anomaly breakdown ---------------- */

function AnomalyBreakdown({ by_kind }: { by_kind: Record<AnomalyKind, number> }) {
  const entries = (Object.keys(by_kind) as AnomalyKind[])
    .map((k) => ({ kind: k, n: by_kind[k] }))
    .filter((e) => e.n > 0)
    .sort((a, b) => b.n - a.n);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map((e) => (
        <span key={e.kind} className="badge badge-muted">
          {ANOMALY_LABEL[e.kind]}: <strong className="ml-1">{e.n}</strong>
        </span>
      ))}
    </div>
  );
}

/* ---------------- Reason dialog ---------------- */

function ReasonDialog({
  title,
  label,
  required,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  required: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (required && !reason.trim()) return;
    setBusy(true);
    try {
      await onSubmit(reason.trim());
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-md space-y-3">
        <h2 className="section-title">{title}</h2>
        <div>
          <label className="label">{label}</label>
          <textarea
            className="input"
            rows={3}
            required={required}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Annulla
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy || (required && !reason.trim())}>
            {busy ? 'Salvataggio…' : 'Conferma'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- Presence sub-views (unchanged from prior) ---------------- */

function ViewToggle({
  value,
  onChange,
}: {
  value: GroupMode;
  onChange: (v: GroupMode) => void;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: 'inline-flex',
        padding: '2px',
        background: 'var(--color-surface-variant)',
        borderRadius: '0.5rem',
        gap: '2px',
      }}
    >
      {(['list', 'by_branch'] as const).map((k) => {
        const active = value === k;
        return (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(k)}
            style={{
              padding: '0.25rem 0.75rem',
              borderRadius: '0.375rem',
              fontSize: '0.75rem',
              fontWeight: 600,
              background: active ? 'white' : 'transparent',
              color: active ? 'var(--color-on-surface)' : 'var(--color-on-surface-variant)',
              border: 0,
              cursor: 'pointer',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            {k === 'list' ? 'Elenco' : 'Per sede'}
          </button>
        );
      })}
    </div>
  );
}

function InboxTabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      className={`px-4 py-2 text-sm border-b-2 flex items-center gap-2 ${active ? 'font-semibold' : 'opacity-70'}`}
      style={{
        borderColor: active ? 'var(--color-primary, #2563eb)' : 'transparent',
      }}
      onClick={onClick}
    >
      <span>{label}</span>
      <span className={`badge ${count > 0 ? 'badge-warn' : 'badge-muted'}`}>{count}</span>
    </button>
  );
}

function UserStatusCard({ card, showBranch }: { card: UserCard; showBranch: boolean }) {
  return (
    <li className="status-card">
      <div className="status-card-head">
        <div className="status-card-identity">
          <div className="status-card-avatar" aria-hidden="true">
            {initialsFor(card.email)}
          </div>
          <div className="status-card-name" title={card.email}>
            {card.email}
          </div>
        </div>
        <StateBadge state={card.state} />
      </div>
      <div className="status-card-meta">
        {showBranch && card.branch_name && <div>Sede: {card.branch_name}</div>}
        {card.last_event_at ? (
          <div>
            Ultimo: {labelEvent(card.last_event)}{' '}
            <span className="num">
              {new Date(card.last_event_at).toLocaleTimeString('it-IT', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        ) : (
          <div className="status-card-meta-empty">Nessuna attività oggi</div>
        )}
      </div>
    </li>
  );
}

function BranchGroups({ cards }: { cards: UserCard[] }) {
  const present = cards.filter((c) => c.state !== 'nothing');
  const off = cards.filter((c) => c.state === 'nothing');
  const byBranch = new Map<string, UserCard[]>();
  for (const c of present) {
    const key = c.branch_name ?? '__none__';
    if (!byBranch.has(key)) byBranch.set(key, []);
    byBranch.get(key)!.push(c);
  }
  const branchKeys = Array.from(byBranch.keys()).sort((a, b) => {
    if (a === '__none__') return 1;
    if (b === '__none__') return -1;
    return a.localeCompare(b, 'it');
  });
  return (
    <div className="space-y-5">
      {branchKeys.length === 0 && (
        <EmptyState
          icon={<IconMapPin />}
          title="Nessuno presente"
          hint="Nessun dipendente ha timbrato l'ingresso al momento."
        />
      )}
      {branchKeys.map((key) => {
        const group = byBranch.get(key)!;
        const label = key === '__none__' ? 'Senza sede' : key;
        return (
          <div key={key}>
            <div
              className="flex items-center gap-2 mb-2"
              style={{ color: 'var(--color-on-surface-variant)' }}
            >
              <IconMapPin />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-on-surface)' }}>
                {label}
              </h3>
              <span className="badge badge-muted">{group.length}</span>
            </div>
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.map((c) => (
                <UserStatusCard key={c.user_id} card={c} showBranch={false} />
              ))}
            </ul>
          </div>
        );
      })}
      {off.length > 0 && (
        <div>
          <div
            className="flex items-center gap-2 mb-2"
            style={{ color: 'var(--color-on-surface-variant)' }}
          >
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-on-surface)' }}>
              Fuori servizio
            </h3>
            <span className="badge badge-muted">{off.length}</span>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {off.map((c) => (
              <UserStatusCard key={c.user_id} card={c} showBranch={false} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  icon,
  accent,
}: {
  label: string;
  value: string;
  suffix?: string;
  icon: React.ReactNode;
  accent?: 'warn';
}) {
  return (
    <div className={`stat-card ${accent === 'warn' ? 'stat-card-warn' : ''}`}>
      <div className="stat-card-icon">{icon}</div>
      <div className="stat-card-body">
        <div className="stat-card-label">{label}</div>
        <div className="stat-card-value">
          {value}
          {suffix && <span className="stat-card-value-muted"> {suffix}</span>}
        </div>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: UserCard['state'] }) {
  if (state === 'clocked_in') return <span className="badge badge-ok">Al lavoro</span>;
  if (state === 'on_break') return <span className="badge badge-warn">In pausa</span>;
  return <span className="badge badge-muted">Fuori servizio</span>;
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
    </div>
  );
}

function initialsFor(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
  return letters || local.slice(0, 2).toUpperCase() || '?';
}

function labelEvent(e: string | null): string {
  switch (e) {
    case 'clock_in': return 'Ingresso';
    case 'clock_out': return 'Uscita';
    case 'break_start': return 'Inizio pausa';
    case 'break_end': return 'Fine pausa';
    default: return '–';
  }
}

function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function fmtRange(from: string, to: string, type: LeaveType): string {
  const f = new Date(from);
  const t = new Date(to);
  const sameDay = f.toDateString() === t.toDateString();
  const d: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: '2-digit' };
  const h: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (type === 'permessi' && sameDay) {
    return `${f.toLocaleDateString('it-IT', d)} ${f.toLocaleTimeString('it-IT', h)}–${t.toLocaleTimeString('it-IT', h)}`;
  }
  if (sameDay) return f.toLocaleDateString('it-IT', d);
  return `${f.toLocaleDateString('it-IT', d)} → ${t.toLocaleDateString('it-IT', d)}`;
}

/* Icons -------------------------------------------------------------- */
const I = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};
function IconUsers() {
  return (
    <svg {...I}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconMapPin() {
  return (
    <svg {...I}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
function IconInbox() {
  return (
    <svg {...I}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </svg>
  );
}
function IconRefresh() {
  return (
    <svg {...I} width={16} height={16}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg {...I}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function IconAlert() {
  return (
    <svg {...I}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12" y2="17.01" />
    </svg>
  );
}
function IconOpen() {
  return (
    <svg {...I} width={14} height={14}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}
function IconCoffee() {
  return (
    <svg {...I}>
      <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4Z" />
      <line x1="6" y1="1" x2="6" y2="4" />
      <line x1="10" y1="1" x2="10" y2="4" />
      <line x1="14" y1="1" x2="14" y2="4" />
    </svg>
  );
}
