import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';
import { LeaveCalendar, type CalendarEvent } from '../components/LeaveCalendar.tsx';
import { NewLeaveModal } from '../components/NewLeaveModal.tsx';
import { leaveTypeLabel } from '@sonoqui/shared';

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
}

interface QuotaSummary {
  type: 'ferie' | 'permessi';
  used_approved: number;
  used_pending: number;
  residual_strict: number;
  residual_with_pending: number;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'In attesa',
  approved: 'Approvata',
  rejected: 'Rifiutata',
  cancelled: 'Annullata',
  cancellation_pending: 'Annullamento richiesto',
  cancelled_post_approval: 'Annullata',
  superseded_by_malattia: 'Sostituita da malattia',
};

function fmtRange(from: string, to: string, type: string): string {
  const f = new Date(from);
  const t = new Date(to);
  const sameDay = f.toDateString() === t.toDateString();
  const d: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
  const h: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (type === 'permessi' && sameDay) {
    return `${f.toLocaleDateString('it-IT', d)} ${f.toLocaleTimeString('it-IT', h)}–${t.toLocaleTimeString('it-IT', h)}`;
  }
  if (sameDay) return f.toLocaleDateString('it-IT', d);
  return `${f.toLocaleDateString('it-IT', d)} → ${t.toLocaleDateString('it-IT', d)}`;
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
  const [tab, setTab] = useState<'mine' | 'calendar' | 'inbox'>('mine');
  const [mine, setMine] = useState<LeaveRequest[]>([]);
  const [inbox, setInbox] = useState<LeaveRequest[]>([]);
  const [quotas, setQuotas] = useState<QuotaSummary[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const loadMine = useCallback(async () => {
    try {
      const [list, q] = await Promise.all([
        api<LeaveRequest[]>('/api/v1/leaves?scope=mine'),
        api<QuotaSummary[]>('/api/v1/leave-quotas/me/summary').catch(() => [] as QuotaSummary[]),
      ]);
      setMine(list);
      setQuotas(q);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }, []);
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

  // KPI counts over my own requests: how many I've asked, by outcome.
  const mineStats = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    for (const r of mine) {
      if (r.status === 'pending' || r.status === 'cancellation_pending') pending += 1;
      else if (r.status === 'approved') approved += 1;
      else if (r.status === 'rejected') rejected += 1;
    }
    return { pending, approved, rejected };
  }, [mine]);
  const ferieQuota = quotas.find((q) => q.type === 'ferie');
  const permessiQuota = quotas.find((q) => q.type === 'permessi');

  async function act(path: string, json?: unknown) {
    setErr(null);
    try {
      await api(path, { method: 'POST', json });
      await Promise.all([loadMine(), loadInbox()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="sr-only">Ferie & Permessi</h1>

      <div className="card p-0">
        <div className="flex border-b" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
          <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>Le mie</TabButton>
          <TabButton active={tab === 'calendar'} onClick={() => setTab('calendar')}>Calendario</TabButton>
          {pendingInbox.length > 0 && (
            <TabButton active={tab === 'inbox'} onClick={() => setTab('inbox')}>
              Da approvare ({pendingInbox.length})
            </TabButton>
          )}
        </div>

        <div className="p-4">
          {err && <div className="mb-3 text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

          {tab === 'mine' && (
            <div className="space-y-3">
              <div className="stat-grid">
                {ferieQuota && (
                  <Kpi
                    label="Ferie residue"
                    value={fmtH(ferieQuota.residual_strict)}
                    sub={`Richieste ${fmtH(ferieQuota.used_approved + ferieQuota.used_pending)}`}
                    icon={<IconSun />}
                    tone="ferie"
                  />
                )}
                {permessiQuota && (
                  <Kpi
                    label="Permessi residui"
                    value={fmtH(permessiQuota.residual_strict)}
                    sub={`Richieste ${fmtH(permessiQuota.used_approved + permessiQuota.used_pending)}`}
                    icon={<IconClock />}
                    tone="permessi"
                  />
                )}
                <Kpi label="In attesa" value={String(mineStats.pending)} icon={<IconHourglass />} tone="warn" />
                <Kpi label="Approvate" value={String(mineStats.approved)} icon={<IconCheck />} tone="ok" />
                <Kpi label="Rifiutate" value={String(mineStats.rejected)} icon={<IconX />} tone="err" />
              </div>
              <div className="flex justify-end">
                <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>+ Nuova richiesta</button>
              </div>
              {mine.length === 0 ? (
                <p className="muted text-sm">Nessuna richiesta.</p>
              ) : (
                <div className="space-y-2">
                  {mine.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2.5" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
                      <div>
                        <div className="text-sm font-medium">
                          {r.title || leaveTypeLabel(r.type)}
                          <span className="ml-2 text-xs opacity-70">{fmtRange(r.from_ts, r.to_ts, r.type)}</span>
                        </div>
                        <div className="text-xs opacity-70">
                          {r.duration_hours}h · {STATUS_LABEL[r.status] ?? r.status}
                          {r.rejection_reason ? ` · ${r.rejection_reason}` : ''}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {r.status === 'pending' && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => act(`/api/v1/leaves/${r.id}/cancel`)}>Annulla</button>
                        )}
                        {r.status === 'approved' && r.type !== 'malattia' && r.type !== 'chiusura' && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              const reason = window.prompt('Motivo della richiesta di annullamento:');
                              if (reason && reason.trim()) act(`/api/v1/leaves/${r.id}/request-cancellation`, { cancellation_reason: reason.trim() });
                            }}
                          >
                            Richiedi annullamento
                          </button>
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
                <p className="muted text-sm">Niente da approvare.</p>
              ) : (
                pendingInbox.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2.5" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
                    <div>
                      <div className="text-sm font-medium">
                        {r.user_display_name || r.user_email} · {leaveTypeLabel(r.type)}
                      </div>
                      <div className="text-xs opacity-70">{fmtRange(r.from_ts, r.to_ts, r.type)} · {r.duration_hours}h</div>
                    </div>
                    <div className="flex gap-2">
                      {r.status === 'pending' ? (
                        <>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => act(`/api/v1/leaves/${r.id}/approve`)}>Approva</button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => {
                              const reason = window.prompt('Motivo del rifiuto:');
                              if (reason && reason.trim()) act(`/api/v1/leaves/${r.id}/reject`, { rejection_reason: reason.trim() });
                            }}
                          >
                            Rifiuta
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => act(`/api/v1/leaves/${r.id}/decide-cancellation`, { approve: true })}>Accetta annull.</button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => act(`/api/v1/leaves/${r.id}/decide-cancellation`, { approve: false })}>Rifiuta annull.</button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
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
      style={{ borderColor: active ? 'var(--color-primary, #2563eb)' : 'transparent' }}
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
  icon,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  tone: keyof typeof KPI_TONES;
}) {
  const t = KPI_TONES[tone];
  return (
    <div className="stat-card">
      <div className="stat-card-icon" style={{ background: t.bg, color: t.fg }}>{icon}</div>
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

function IconSun() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function IconHourglass() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12M6 21h12M7 3c0 5 4 6 5 9 1-3 5-4 5-9M7 21c0-5 4-6 5-9 1 3 5 4 5 9" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
function IconX() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
