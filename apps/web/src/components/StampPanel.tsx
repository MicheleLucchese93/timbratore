import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { stateFromLastEvent } from '@sonoqui/shared';
import type { StampEventType } from '@sonoqui/shared';
import { api } from '../lib/api.ts';
import { useSession } from '../store/session.ts';
import { fmtTime } from '../i18n/format.ts';
import { formatDuration, isoDay, type DayStamp } from '@sonoqui/shared';
import {
  computeCountedDay,
  type ActiveAssignment,
  type LeaveInterval,
} from '@sonoqui/shared';
import { WeekScheduleModal } from './WeekScheduleModal.tsx';

const APP_VERSION = '0.1.0';

interface CurrentState {
  state: 'nothing' | 'clocked_in' | 'on_break' | 'on_lunch';
  lastEvent: StampEventType | null;
  lastEventAt: string | null;
}

interface ButtonSpec {
  event: StampEventType;
  label: string;
  variant: 'primary' | 'secondary';
}

/**
 * Employee self-stamping for the web app, at parity with the mobile
 * TimbratureScreen (clock in/out, break, lunch, undo, today + weekly schedule).
 *
 * Web is "remote" stamping only: the backend rejects web clock-in unless the
 * user has the `remote` stamp mode (WEB_CLOCK_IN_DISABLED) and never enforces
 * the branch geofence for web, so — unlike mobile — no GPS is collected here.
 */
export function StampPanel({ onStamped }: { onStamped?: () => void }) {
  const { t } = useTranslation(['timbrature', 'common']);
  const me = useSession((s) => s.me);

  const [state, setState] = useState<CurrentState | null>(null);
  const [todayStamps, setTodayStamps] = useState<DayStamp[]>([]);
  const [assignment, setAssignment] = useState<ActiveAssignment | null>(null);
  const [leaves, setLeaves] = useState<LeaveInterval[]>([]);
  const [working, setWorking] = useState<StampEventType | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [lastSubmittedAt, setLastSubmittedAt] = useState<Date | null>(null);
  const [lastUndoId, setLastUndoId] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [weekOpen, setWeekOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const branches = useMemo(() => me?.branches ?? [], [me]);
  const stampModes = me?.user.stamp_modes ?? [];
  const hasAnyMode = stampModes.length > 0;
  const canStampWeb = stampModes.includes('remote');

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === selectedBranchId) ?? branches[0] ?? null,
    [branches, selectedBranchId]
  );

  const fetchAll = useCallback(async () => {
    const today = isoDay(new Date());
    try {
      const [s, list, a, lv] = await Promise.all([
        api<CurrentState>('/api/v1/stamps/me/current-state'),
        api<DayStamp[]>(`/api/v1/stamps/me?from=${today}&to=${today}`),
        api<ActiveAssignment | null>('/api/v1/shifts/assignments/me').catch(() => null),
        api<LeaveInterval[]>(
          `/api/v1/leaves?scope=mine&status=approved&from=${today}&to=${today}`
        ).catch(() => []),
      ]);
      setState(s);
      setTodayStamps(list);
      setAssignment(a);
      setLeaves(lv);
    } catch {
      /* ignore — keep last known state */
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selectedBranchId && branches.length > 0) setSelectedBranchId(branches[0]!.id);
  }, [branches, selectedBranchId]);

  // While a shift is open, lock the branch to the one the clock-in was recorded
  // against — mirrors mobile so the user can't switch sede mid-shift.
  useEffect(() => {
    if ((state?.state ?? 'nothing') === 'nothing') return;
    const locked = openShiftBranchId(todayStamps);
    if (locked && selectedBranchId !== locked) setSelectedBranchId(locked);
  }, [state, todayStamps, selectedBranchId]);

  async function stamp(event: StampEventType) {
    if (working || !canStampWeb || !selectedBranch) return;
    setWorking(event);
    setErr(null);
    const occurredAt = new Date();
    try {
      const created = await api<{ id: string }>('/api/v1/stamps', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        json: {
          event_type: event,
          occurred_at: occurredAt.toISOString(),
          device_platform: 'web',
          device_app_version: APP_VERSION,
          branch_id: selectedBranch.id,
        },
      });
      setLastSubmittedAt(occurredAt);
      setLastUndoId(created.id);
      await fetchAll();
      onStamped?.();
    } catch (e) {
      setErr(humanError(e, t));
    } finally {
      setWorking(null);
    }
  }

  async function undo() {
    if (!lastUndoId) return;
    setErr(null);
    try {
      await api(`/api/v1/stamps/${lastUndoId}`, { method: 'DELETE' });
      setLastUndoId(null);
      setLastSubmittedAt(null);
      await fetchAll();
      onStamped?.();
    } catch (e) {
      setErr(humanError(e, t));
    }
  }

  if (!me) return null;

  const currentState = state?.state ?? stateFromLastEvent(null);
  const branchLocked = currentState !== 'nothing';
  const totals = computeCountedDay(todayStamps, assignment, now, leaves);

  const todayDow = now.getDay() === 0 ? 7 : now.getDay();
  const todaySlots = (assignment?.slots ?? [])
    .filter((s) => s.day_of_week === todayDow)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const expectedMin = todaySlots.reduce((acc, s) => acc + slotMinutes(s.start_time, s.end_time), 0);
  const autoLunchToday = (assignment?.day_lunch ?? []).some(
    (d) => d.day_of_week === todayDow && d.lunch_min > 0
  );

  const buttons: ButtonSpec[] = [];
  if (currentState === 'nothing') {
    buttons.push({ event: 'clock_in', label: t('action.clockIn'), variant: 'primary' });
  } else if (currentState === 'clocked_in') {
    buttons.push({ event: 'clock_out', label: t('action.clockOut'), variant: 'primary' });
    buttons.push({ event: 'break_start', label: t('action.breakStart'), variant: 'secondary' });
    if (!autoLunchToday) {
      buttons.push({ event: 'lunch_start', label: t('action.lunchStart'), variant: 'secondary' });
    }
  } else if (currentState === 'on_break') {
    buttons.push({ event: 'break_end', label: t('action.breakEnd'), variant: 'primary' });
  } else if (currentState === 'on_lunch') {
    buttons.push({ event: 'lunch_end', label: t('action.lunchEnd'), variant: 'primary' });
  }

  const undoVisible =
    !!lastUndoId && !!lastSubmittedAt && Date.now() - lastSubmittedAt.getTime() < 60_000;

  const stateLabel =
    currentState === 'clocked_in' ? t('common:workState.working')
    : currentState === 'on_break' ? t('common:workState.on_break')
    : currentState === 'on_lunch' ? t('common:workState.on_lunch')
    : t('common:workState.off');
  const stateTone =
    currentState === 'clocked_in' ? 'badge-ok'
    : currentState === 'on_break' || currentState === 'on_lunch' ? 'badge-warn'
    : 'badge-muted';

  return (
    <section className="space-y-4">
      {/* Hero: worked / counted + first-in / breaks / last-out */}
      <div className="card" style={{ background: 'var(--color-primary)', color: 'white' }}>
        <div className="flex items-center justify-between gap-3">
          <span className={`badge ${stateTone}`}>{stateLabel}</span>
        </div>
        <div className="grid grid-cols-2 gap-4 mt-3">
          <div>
            <div className="text-xs uppercase tracking-wide" style={{ opacity: 0.75 }}>
              {t('hero.workedHours')}
            </div>
            <div className="text-3xl font-bold num mt-1">{formatDuration(totals.workedMs)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide" style={{ opacity: 0.75 }}>
              {t('hero.countedHours')}
            </div>
            <div className="text-3xl font-bold num mt-1">
              {assignment ? formatDuration(totals.countedTotalMs) : '—'}
            </div>
          </div>
        </div>
        <hr className="my-4" style={{ borderColor: 'rgba(255,255,255,0.15)' }} />
        <div className="grid grid-cols-3 text-center">
          <HeroStat
            label={t('common:stampEvent.clock_in')}
            value={totals.firstInAt ? fmtTime(totals.firstInAt, { hour: '2-digit', minute: '2-digit' }) : '—'}
          />
          <HeroStat label={t('hero.breaks')} value={formatDuration(totals.breakMs)} />
          <HeroStat
            label={t('common:stampEvent.clock_out')}
            value={totals.lastOutAt && !totals.isOpen ? fmtTime(totals.lastOutAt, { hour: '2-digit', minute: '2-digit' }) : '—'}
          />
        </div>
      </div>

      {/* Today's schedule + weekly view */}
      {assignment && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="section-title m-0">{t('schedule.title')}</h3>
            <div className="flex items-center gap-3">
              {todaySlots.length > 0 && (
                <span className="text-sm font-semibold num" style={{ color: 'var(--color-primary)' }}>
                  {t('schedule.total', { duration: formatDuration(expectedMin * 60_000) })}
                </span>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setWeekOpen(true)}
                aria-label={t('schedule.viewWeekA11y')}
              >
                📅 {t('schedule.weekBtn')}
              </button>
            </div>
          </div>
          {todaySlots.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {todaySlots.map((s, i) => (
                <span
                  key={i}
                  className="text-sm font-semibold num rounded-full px-3 py-1.5"
                  style={{ background: 'var(--color-primary-container, #e6eefb)', color: 'var(--color-primary)' }}
                >
                  {s.start_time}–{s.end_time}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm muted m-0">{t('schedule.restDay')}</p>
          )}
        </div>
      )}

      {/* Branch selector */}
      {branches.length > 1 && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="section-title m-0">{t('branch.title')}</h3>
            {branchLocked && <span className="text-xs muted">🔒 {t('branch.lockedUntilExit')}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {branches.map((b) => {
              const sel = b.id === selectedBranch?.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  className={`btn btn-sm ${sel ? 'btn-primary' : 'btn-secondary'}`}
                  disabled={branchLocked && !sel}
                  onClick={() => !branchLocked && setSelectedBranchId(b.id)}
                >
                  {b.name}
                  {b.smart_working ? ` · ${t('branch.offSite')}` : ''}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {branches.length === 1 && selectedBranch && (
        <div className="text-sm muted">
          {selectedBranch.name}
          {selectedBranch.smart_working && ` · ${t('branch.offSite')}`}
        </div>
      )}

      {err && (
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
      )}

      {/* Actions, or a notice when web stamping isn't available for this user */}
      {!hasAnyMode ? (
        <div className="card text-sm muted">{t('disabledNotice')}</div>
      ) : !canStampWeb ? (
        <div className="card text-sm muted">{t('webDisabledNotice')}</div>
      ) : (
        <div className="space-y-2">
          {buttons.map((b) => (
            <button
              key={b.event}
              type="button"
              className={`btn btn-block ${b.variant === 'primary' ? 'btn-primary' : 'btn-secondary'}`}
              disabled={working !== null}
              onClick={() => stamp(b.event)}
            >
              {working === b.event ? `${b.label}…` : b.label}
            </button>
          ))}
          {undoVisible && (
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-block"
              style={{ color: 'var(--color-error)' }}
              onClick={undo}
            >
              ↶ {t('undoLast')}
            </button>
          )}
        </div>
      )}

      {state?.lastEventAt && (
        <p className="text-xs muted text-center m-0">
          {t('lastEvent', {
            event: state.lastEvent ? t(`common:stampEvent.${state.lastEvent}`) : '–',
            time: fmtTime(state.lastEventAt, { hour: '2-digit', minute: '2-digit' }),
          })}
        </p>
      )}

      {weekOpen && assignment && (
        <WeekScheduleModal
          assignment={assignment}
          todayDow={todayDow}
          onClose={() => setWeekOpen(false)}
        />
      )}
    </section>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide" style={{ opacity: 0.7 }}>{label}</div>
      <div className="text-base font-semibold num mt-1">{value}</div>
    </div>
  );
}

function openShiftBranchId(stamps: DayStamp[]): string | null {
  const sorted = [...stamps].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );
  let openBranch: string | null = null;
  for (const s of sorted) {
    if (s.event_type === 'clock_in') openBranch = s.branch_id;
    else if (s.event_type === 'clock_out') openBranch = null;
  }
  return openBranch;
}

// Minutes between two "HH:MM" slot bounds (same day, end ≥ start).
function slotMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number) as [number, number];
  const [eh, em] = end.split(':').map(Number) as [number, number];
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

function humanError(err: unknown, t: TFunction): string {
  const e = err as { code?: string; message?: string };
  const known = [
    'INVALID_TRANSITION',
    'DUPLICATE_TOO_FAST',
    'STAMPING_DISABLED',
    'WEB_CLOCK_IN_DISABLED',
    'CLOCK_SKEW',
    'UNDO_WINDOW_EXPIRED',
    'OUT_OF_GEOFENCE',
    'GPS_REQUIRED',
    'MOCK_LOCATION_BLOCKED',
  ];
  if (e.code && known.includes(e.code)) return t(`common:errors.${e.code}`);
  return e.message ?? t('error.unknown');
}
