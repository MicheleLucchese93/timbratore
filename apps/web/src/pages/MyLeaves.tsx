import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { LeaveCalendar, type CalendarEvent } from '../components/LeaveCalendar.tsx';
import { NewLeaveModal } from '../components/NewLeaveModal.tsx';
import { MyResidui } from './Residui.tsx';
import { localeTag } from '../i18n/format.ts';
import { PageHeader } from '../components/PageHeader.tsx';
import { IconButton } from '../components/IconButton.tsx';
import { useSession } from '../store/session.ts';

type LeaveType = 'ferie' | 'permessi' | 'malattia' | 'assenza';

interface LeaveRequest {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  type: LeaveType | 'chiusura';
  status: string;
  from_ts: string;
  to_ts: string;
  duration_hours: number;
  inps_protocol: string | null;
  user_note: string | null;
  title: string | null;
  rejection_reason: string | null;
  decided_by: string | null;
  decided_by_display_name: string | null;
  decided_by_email: string | null;
}

interface Approver {
  user_id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'user' | null;
}

interface QuotaSummary {
  type: 'ferie' | 'permessi';
  initial_balance: number;
  accrued_total: number;
  used_approved: number;
  used_pending: number;
  residual_strict: number;
  residual_with_pending: number;
}

// Maps a request status to an i18n key (resolved with t() at render).
const STATUS_LABEL_KEY: Record<string, string> = {
  pending: 'common:status.pending',
  approved: 'common:status.approved',
  rejected: 'common:status.rejected',
  cancelled: 'common:status.cancelled',
  cancellation_pending: 'common:status.cancel_requested',
  cancelled_post_approval: 'common:status.cancelled',
  superseded_by_malattia: 'status.supersededByMalattia',
};

function fmtRange(from: string, to: string, type: string): string {
  const f = new Date(from);
  const t = new Date(to);
  const sameDay = f.toDateString() === t.toDateString();
  const d: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
  const h: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (type === 'permessi' && sameDay) {
    return `${f.toLocaleDateString(localeTag(), d)} ${f.toLocaleTimeString(localeTag(), h)}–${t.toLocaleTimeString(localeTag(), h)}`;
  }
  if (sameDay) return f.toLocaleDateString(localeTag(), d);
  return `${f.toLocaleDateString(localeTag(), d)} → ${t.toLocaleDateString(localeTag(), d)}`;
}

function toCalEvent(r: LeaveRequest): CalendarEvent {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    from_ts: r.from_ts,
    to_ts: r.to_ts,
    title: r.title,
  };
}

export function MyLeaves() {
  const { t } = useTranslation(['myLeaves', 'common']);
  const statusLabel = (s: string): string => {
    const key = STATUS_LABEL_KEY[s];
    return key ? t(key) : s;
  };
  const { me } = useSession();
  const myUserId = me?.user.id ?? null;
  const [tab, setTab] = useState<'mine' | 'calendar' | 'inbox' | 'residui'>('mine');
  const [mine, setMine] = useState<LeaveRequest[]>([]);
  const [inbox, setInbox] = useState<LeaveRequest[]>([]);
  const [quotas, setQuotas] = useState<QuotaSummary[]>([]);
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const loadMine = useCallback(async () => {
    try {
      const [list, q, appr] = await Promise.all([
        api<LeaveRequest[]>('/api/v1/leaves?scope=mine'),
        api<QuotaSummary[]>('/api/v1/leave-quotas/me/summary').catch(() => [] as QuotaSummary[]),
        myUserId
          ? api<Approver[]>(`/api/v1/users/${myUserId}/approvers`).catch(() => [] as Approver[])
          : Promise.resolve([] as Approver[]),
      ]);
      setMine(list);
      setQuotas(q);
      setApprovers(appr);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }, [t, myUserId]);
  const loadInbox = useCallback(async () => {
    try {
      setInbox(await api<LeaveRequest[]>('/api/v1/leaves?scope=inbox'));
    } catch {
      /* non-approvers simply get nothing */
    }
  }, []);

  useEffect(() => {
    void loadMine();
    void loadInbox();
  }, [loadMine, loadInbox]);

  const calEvents = useMemo(() => mine.map(toCalEvent), [mine]);
  const pendingInbox = inbox.filter((r) => r.status === 'pending' || r.status === 'cancellation_pending');

  // KPI sub-line: "Totale X · Usate Y", plus "· In attesa: Zh" only when the
  // quota has hours pending approval (used_pending > 0).
  const quotaSub = (q: QuotaSummary): string => {
    const base = t('quota.totalUsed', {
      total: fmtH(q.initial_balance + q.accrued_total),
      used: fmtH(q.used_approved),
    });
    return q.used_pending > 0
      ? `${base} · ${t('kpiPending', { pending: fmtH(q.used_pending) })}`
      : base;
  };
  const approverNames = useMemo(
    () => approvers.map((a) => a.display_name || a.email).join(', '),
    [approvers]
  );
  // Who approves / decided an own request (non-malattia / non-chiusura). Decided
  // requests show the decider; otherwise the configured approver(s).
  const approverLine = (r: LeaveRequest): string => {
    const decidedName = r.decided_by_display_name || r.decided_by_email;
    if (r.status === 'approved' && decidedName) return t('card.approvedBy', { name: decidedName });
    if (r.status === 'rejected' && decidedName) return t('card.rejectedBy', { name: decidedName });
    return approverNames ? t('card.approver', { names: approverNames }) : t('card.noApprover');
  };
  const ferieQuota = quotas.find((q) => q.type === 'ferie');
  const permessiQuota = quotas.find((q) => q.type === 'permessi');

  async function act(path: string, json?: unknown) {
    setErr(null);
    try {
      await api(path, { method: 'POST', json });
      await Promise.all([loadMine(), loadInbox()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('heading')} />

      <div className="card p-0">
        <div className="flex border-b" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
          <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>{t('tab.mine')}</TabButton>
          <TabButton active={tab === 'calendar'} onClick={() => setTab('calendar')}>{t('tab.calendar')}</TabButton>
          {pendingInbox.length > 0 && (
            <TabButton active={tab === 'inbox'} onClick={() => setTab('inbox')}>
              {t('tab.inbox', { count: pendingInbox.length })}
            </TabButton>
          )}
          <TabButton active={tab === 'residui'} onClick={() => setTab('residui')}>{t('tab.residui')}</TabButton>
        </div>

        <div className="p-4">
          {err && <div className="mb-3 text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

          {tab === 'mine' && (
            <div className="space-y-3">
              <div className="stat-grid">
                <Kpi
                  label={t('common:leaveType.ferie')}
                  value={ferieQuota ? fmtH(ferieQuota.residual_strict) : '—'}
                  sub={ferieQuota ? quotaSub(ferieQuota) : t('quota.none')}
                  tone="ferie"
                />
                <Kpi
                  label={t('kpiPermessi')}
                  value={permessiQuota ? fmtH(permessiQuota.residual_strict) : '—'}
                  sub={permessiQuota ? quotaSub(permessiQuota) : t('quota.none')}
                  tone="permessi"
                />
              </div>
              <div className="flex justify-end">
                <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>{t('newRequest')}</button>
              </div>
              {mine.length === 0 ? (
                <p className="muted text-sm">{t('empty.mine')}</p>
              ) : (
                <div className="space-y-2">
                  {mine.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2.5" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
                      <div>
                        <div className="text-sm font-medium">
                          {r.title || t(`common:leaveType.${r.type}`)}
                          <span className="ml-2 text-xs opacity-70">{fmtRange(r.from_ts, r.to_ts, r.type)}</span>
                        </div>
                        <div className="text-xs opacity-70">
                          {r.duration_hours}{t('common:unit.hoursShort')} · {statusLabel(r.status)}
                          {r.rejection_reason ? ` · ${r.rejection_reason}` : ''}
                        </div>
                        {r.type !== 'malattia' && r.type !== 'chiusura' && (
                          <div className="text-xs opacity-70">{approverLine(r)}</div>
                        )}
                      </div>
                      <div className="flex gap-1 items-center">
                        {r.status === 'pending' && (
                          <IconButton kind="cancel" onClick={() => act(`/api/v1/leaves/${r.id}/cancel`)} />
                        )}
                        {r.status === 'approved' && r.type !== 'malattia' && r.type !== 'chiusura' && (
                          <IconButton
                            kind="revoke"
                            title={t('action.requestCancellation')}
                            onClick={() => {
                              const reason = window.prompt(t('prompt.cancellationReason'));
                              if (reason && reason.trim()) act(`/api/v1/leaves/${r.id}/request-cancellation`, { cancellation_reason: reason.trim() });
                            }}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'calendar' && <LeaveCalendar events={calEvents} />}

          {tab === 'inbox' && (
            <div className="space-y-2">
              {pendingInbox.length === 0 ? (
                <p className="muted text-sm">{t('empty.inbox')}</p>
              ) : (
                pendingInbox.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2.5" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
                    <div>
                      <div className="text-sm font-medium">
                        {r.user_display_name || r.user_email} · {t(`common:leaveType.${r.type}`)}
                      </div>
                      <div className="text-xs opacity-70">{fmtRange(r.from_ts, r.to_ts, r.type)} · {r.duration_hours}{t('common:unit.hoursShort')}</div>
                    </div>
                    <div className="flex gap-1 items-center">
                      {r.status === 'pending' ? (
                        <>
                          <IconButton kind="approve" onClick={() => act(`/api/v1/leaves/${r.id}/approve`)} />
                          <IconButton
                            kind="reject"
                            onClick={() => {
                              const reason = window.prompt(t('prompt.rejectReason'));
                              if (reason && reason.trim()) act(`/api/v1/leaves/${r.id}/reject`, { rejection_reason: reason.trim() });
                            }}
                          />
                        </>
                      ) : (
                        <>
                          <IconButton kind="approve" title={t('action.acceptCancellation')} onClick={() => act(`/api/v1/leaves/${r.id}/decide-cancellation`, { approve: true })} />
                          <IconButton kind="reject" title={t('action.rejectCancellation')} onClick={() => act(`/api/v1/leaves/${r.id}/decide-cancellation`, { approve: false })} />
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'residui' && <MyResidui />}
        </div>
      </div>

      {showNew && (
        <NewLeaveModal
          onClose={() => setShowNew(false)}
          onDone={() => { setShowNew(false); void loadMine(); }}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`px-4 py-2 text-sm border-b-2 ${active ? 'font-semibold' : 'opacity-70'}`}
      style={{ borderColor: active ? 'var(--color-primary)' : 'transparent' }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const KPI_TONES = {
  ferie: { bg: '#e0f2fe', fg: '#0369a1' },
  permessi: { bg: '#fff3d1', fg: 'var(--color-warning)' },
  warn: { bg: '#fff3d1', fg: 'var(--color-warning)' },
  ok: { bg: '#e8f3ec', fg: 'var(--color-success)' },
  err: { bg: '#fde4e4', fg: 'var(--color-error)' },
} as const;

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: keyof typeof KPI_TONES;
}) {
  const t = KPI_TONES[tone];
  return (
    <div className="stat-card">
      <div className="stat-card-body">
        <div className="stat-card-label">{label}</div>
        <div className="stat-card-value" style={{ color: t.fg }}>{value}</div>
        {sub && <div className="text-xs muted" style={{ marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

// Hours, trimmed: 120 → "120h", 15.75 → "15.75h".
function fmtH(n: number): string {
  const r = Math.round(n * 100) / 100;
  return `${Number.isInteger(r) ? r : r.toFixed(2)}h`;
}
