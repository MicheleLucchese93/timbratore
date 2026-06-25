// Monthly attendance grid: one axis = employees, the other = days of the
// chosen month, raw stamps shown at each intersection. Default orientation is
// users-as-columns / days-as-rows (as requested); a pivot button flips the
// axes. Clicking a cell opens a per-day editor that adds / edits / deletes that
// employee's punches via the existing admin-stamps endpoints. The list view
// (Stamps.tsx) is kept untouched alongside it.
import { type CSSProperties, type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { computeDayTotals, formatDuration, italianHolidays, type DayStamp } from '@sonoqui/shared';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';
import { api } from '../lib/api.ts';
import { fmtDate } from '../i18n/format.ts';
import { type Stamp, type Branch, type UserRow, userLabel, EVENT_TYPES } from '../lib/stamp-types.ts';

/* ---------------- date helpers (local time) ---------------- */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function isoLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function daysOfMonth(year: number, monthIndex: number): Date[] {
  const out: Date[] = [];
  const last = new Date(year, monthIndex + 1, 0).getDate();
  for (let day = 1; day <= last; day++) out.push(new Date(year, monthIndex, day));
  return out;
}
function localHHMM(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
// Combine a local YYYY-MM-DD + HH:MM into an absolute ISO instant.
function combineIso(dateIso: string, hhmm: string): string {
  const [y, mo, da] = dateIso.split('-').map(Number) as [number, number, number];
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(y, mo - 1, da, h, m, 0, 0).toISOString();
}
function isWeekend(d: Date): boolean {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

/* ---------------- cell status ---------------- */
type CellStatus = 'empty' | 'ok' | 'open' | 'weekend' | 'holiday';

const STATUS_BG: Record<CellStatus, string | undefined> = {
  empty: undefined,
  ok: undefined,
  open: 'color-mix(in oklab, #f59e0b 18%, white)',
  weekend: 'color-mix(in oklab, var(--color-surface-variant) 40%, white)',
  holiday: 'color-mix(in oklab, var(--color-primary-container) 30%, white)',
};

// In/out pairs for the compact cell summary. A clock_in with no following
// clock_out renders as "08:30–·" (open shift). Break/lunch don't create pairs
// but are flagged with a marker.
function inOutPairs(stamps: Stamp[]): Array<[string, string | null]> {
  const sorted = [...stamps].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );
  const pairs: Array<[string, string | null]> = [];
  let open: string | null = null;
  for (const s of sorted) {
    if (s.event_type === 'clock_in') {
      if (open) pairs.push([open, null]);
      open = localHHMM(s.occurred_at);
    } else if (s.event_type === 'clock_out') {
      pairs.push([open ?? '·', localHHMM(s.occurred_at)]);
      open = null;
    }
  }
  if (open) pairs.push([open, null]);
  return pairs;
}

export function StampMonthGrid({ users, branches }: { users: UserRow[]; branches: Branch[] }) {
  const { t } = useTranslation(['stamps', 'common']);
  const [month, setMonth] = useState<Date>(() => firstOfMonth(new Date()));
  const [pivot, setPivot] = useState(false);
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const [loading, setLoading] = useState(false);
  const [capped, setCapped] = useState(false);
  const [editor, setEditor] = useState<{ userId: string; dateIso: string } | null>(null);

  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const days = useMemo(() => daysOfMonth(year, monthIndex), [year, monthIndex]);
  const fromIso = isoLocalDate(new Date(year, monthIndex, 1));
  const toIso = isoLocalDate(new Date(year, monthIndex + 1, 0));

  async function load() {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set('from', fromIso);
      p.set('to', toIso);
      p.set('limit', '1000');
      if (branchId) p.set('branch_id', branchId);
      const rows = await api<Stamp[]>(`/api/v1/stamps?${p}`);
      setStamps(rows);
      setCapped(rows.length >= 1000);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromIso, toIso, branchId]);

  // userId → dateIso → stamps (local-day bucketed).
  const index = useMemo(() => {
    const m = new Map<string, Map<string, Stamp[]>>();
    for (const s of stamps) {
      const dIso = isoLocalDate(new Date(s.occurred_at));
      let byDay = m.get(s.user_id);
      if (!byDay) {
        byDay = new Map();
        m.set(s.user_id, byDay);
      }
      const arr = byDay.get(dIso);
      if (arr) arr.push(s);
      else byDay.set(dIso, [s]);
    }
    return m;
  }, [stamps]);

  const holidays = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of italianHolidays(year)) map.set(h.date, h.name);
    return map;
  }, [year]);

  const shownUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? users.filter(
          (u) =>
            userLabel(u).toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q) ||
            (u.external_id ?? '').toLowerCase().includes(q)
        )
      : users;
    return [...filtered].sort((a, b) => userLabel(a).localeCompare(b ? userLabel(b) : ''));
  }, [users, search]);

  const todayIso = isoLocalDate(new Date());

  function cellStamps(userId: string, dateIso: string): Stamp[] {
    return index.get(userId)?.get(dateIso) ?? [];
  }
  function cellStatus(dateIso: string, date: Date, arr: Stamp[]): CellStatus {
    if (arr.length > 0) {
      const totals = computeDayTotals(arr as DayStamp[], undefined, false);
      // A still-open shift on a past day = missing clock-out anomaly. Today's
      // open shift is normal (employee may still be working).
      if (totals.isOpen && dateIso < todayIso) return 'open';
      return 'ok';
    }
    if (holidays.has(dateIso)) return 'holiday';
    if (isWeekend(date)) return 'weekend';
    return 'empty';
  }
  function userMonthMs(userId: string): number {
    const byDay = index.get(userId);
    if (!byDay) return 0;
    let ms = 0;
    for (const day of days) {
      const arr = byDay.get(isoLocalDate(day));
      if (arr) ms += computeDayTotals(arr as DayStamp[], undefined, false).workedMs;
    }
    return ms;
  }
  // Worked minutes across all shown employees for one day (cross-axis total).
  function dayTotalMs(dateIso: string): number {
    let ms = 0;
    for (const u of shownUsers) {
      const arr = cellStamps(u.user_id, dateIso);
      if (arr.length) ms += computeDayTotals(arr as DayStamp[], undefined, false).workedMs;
    }
    return ms;
  }
  const grandTotalMs = shownUsers.reduce((sum, u) => sum + userMonthMs(u.user_id), 0);

  const editorUser = editor ? users.find((u) => u.user_id === editor.userId) ?? null : null;
  const editorStamps = editor ? cellStamps(editor.userId, editor.dateIso) : [];

  const monthLabel = fmtDate(month, { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setMonth((m) => addMonths(m, -1))}
            aria-label={t('grid.prevMonth')}
            title={t('grid.prevMonth')}
          >
            ‹
          </button>
          <span className="font-medium capitalize" style={{ minWidth: 150, textAlign: 'center' }}>
            {monthLabel}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setMonth((m) => addMonths(m, 1))}
            aria-label={t('grid.nextMonth')}
            title={t('grid.nextMonth')}
          >
            ›
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setMonth(firstOfMonth(new Date()))}>
            {t('grid.today')}
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <input
            className="input"
            style={{ width: 180 }}
            placeholder={t('grid.searchUser')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input" style={{ width: 170 }} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">{t('grid.allBranches')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" onClick={() => setPivot((v) => !v)} title={t('grid.pivot')}>
            {t('grid.pivot')}
          </button>
        </div>
      </div>

      {capped && <div className="badge badge-warn">{t('grid.tooMany')}</div>}

      {shownUsers.length === 0 ? (
        <div className="card text-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
          {t('grid.noUsers')}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 230px)' }}>
          <table data-testid="stamp-grid" className="stamp-grid" style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.8rem' }}>
            <thead>
              <tr>
                <th style={cornerCellStyle}>{pivot ? t('grid.userCol') : t('grid.dayCol')}</th>
                {pivot
                  ? days.map((d) => {
                      const iso = isoLocalDate(d);
                      const hol = holidays.get(iso);
                      return (
                        <th key={iso} style={headCellStyle} title={hol ?? undefined}>
                          <div className="num">{d.getDate()}</div>
                          <div style={{ fontSize: '0.65rem', opacity: 0.7 }}>{fmtDate(d, { weekday: 'short' })}</div>
                        </th>
                      );
                    })
                  : shownUsers.map((u) => (
                      <th key={u.user_id} style={headCellStyle} title={u.email}>
                        <UserHead u={u} t={t} />
                      </th>
                    ))}
                <th style={{ ...headCellStyle, ...stickyRightStyle }}>{t('grid.total')}</th>
              </tr>
            </thead>
            <tbody>
              {pivot
                ? shownUsers.map((u) => (
                    <tr key={u.user_id}>
                      <th style={rowHeadStyle} title={u.email}>
                        <UserHead u={u} t={t} />
                      </th>
                      {days.map((d) => {
                        const iso = isoLocalDate(d);
                        const arr = cellStamps(u.user_id, iso);
                        return (
                          <Cell
                            key={iso}
                            userId={u.user_id}
                            dateIso={iso}
                            arr={arr}
                            status={cellStatus(iso, d, arr)}
                            onClick={() => setEditor({ userId: u.user_id, dateIso: iso })}
                            t={t}
                          />
                        );
                      })}
                      <td style={{ ...totalCellStyle, ...stickyRightStyle }} className="num">
                        {formatDuration(userMonthMs(u.user_id))}
                      </td>
                    </tr>
                  ))
                : days.map((d) => {
                    const iso = isoLocalDate(d);
                    const hol = holidays.get(iso);
                    const we = isWeekend(d);
                    return (
                      <tr key={iso}>
                        <th
                          style={{
                            ...rowHeadStyle,
                            background: hol
                              ? STATUS_BG.holiday
                              : we
                                ? STATUS_BG.weekend
                                : rowHeadStyle.background,
                          }}
                          title={hol ?? undefined}
                        >
                          <span className="num">{d.getDate()}</span>{' '}
                          <span style={{ opacity: 0.7 }}>{fmtDate(d, { weekday: 'short' })}</span>
                        </th>
                        {shownUsers.map((u) => {
                          const arr = cellStamps(u.user_id, iso);
                          return (
                            <Cell
                              key={u.user_id}
                              userId={u.user_id}
                              dateIso={iso}
                              arr={arr}
                              status={cellStatus(iso, d, arr)}
                              onClick={() => setEditor({ userId: u.user_id, dateIso: iso })}
                              t={t}
                            />
                          );
                        })}
                        <td style={{ ...totalCellStyle, ...stickyRightStyle }} className="num">
                          {dayTotalMs(iso) > 0 ? formatDuration(dayTotalMs(iso)) : ''}
                        </td>
                      </tr>
                    );
                  })}
              {/* Per-user month totals as a footer row in the default orientation. */}
              {!pivot && (
                <tr>
                  <th style={{ ...rowHeadStyle, fontWeight: 700 }}>{t('grid.monthTotal')}</th>
                  {shownUsers.map((u) => (
                    <td key={u.user_id} style={totalCellStyle} className="num">
                      {formatDuration(userMonthMs(u.user_id))}
                    </td>
                  ))}
                  <td style={{ ...totalCellStyle, ...stickyRightStyle }} className="num">
                    {formatDuration(grandTotalMs)}
                  </td>
                </tr>
              )}
              {/* Per-day totals as a footer row in the pivot orientation. */}
              {pivot && (
                <tr>
                  <th style={{ ...rowHeadStyle, fontWeight: 700 }}>{t('grid.total')}</th>
                  {days.map((d) => {
                    const iso = isoLocalDate(d);
                    return (
                      <td key={iso} style={totalCellStyle} className="num">
                        {dayTotalMs(iso) > 0 ? formatDuration(dayTotalMs(iso)) : ''}
                      </td>
                    );
                  })}
                  <td style={{ ...totalCellStyle, ...stickyRightStyle }} className="num">
                    {formatDuration(grandTotalMs)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {loading && (
        <div className="text-xs" style={{ color: 'var(--color-on-surface-variant)' }}>
          {t('common:state.loading')}
        </div>
      )}

      {editor && editorUser && (
        <DayStampEditor
          user={editorUser}
          dateIso={editor.dateIso}
          existing={editorStamps}
          branches={branches}
          onChanged={() => load()}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

/* ---------------- user header ---------------- */
// The employee axis header shows, per the requirement, the full identity:
// name (display / first+last), email and the optional unique id. Rendered in
// both orientations (column header default, row header when pivoted).
function UserHead({ u, t }: { u: UserRow; t: (k: string) => string }) {
  const label = userLabel(u);
  const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  const nameLine = fullName || label;
  return (
    <div className="flex flex-col" style={{ textTransform: 'none', letterSpacing: 0, lineHeight: 1.3 }}>
      <span style={{ fontWeight: 600 }}>{nameLine}</span>
      {u.email !== nameLine && (
        <span style={{ fontSize: '0.68rem', opacity: 0.65, fontWeight: 400 }}>{u.email}</span>
      )}
      {u.external_id && (
        <span className="num" style={{ fontSize: '0.68rem', opacity: 0.65, fontWeight: 400 }}>
          {t('grid.idPrefix')} {u.external_id}
        </span>
      )}
    </div>
  );
}

/* ---------------- cell ---------------- */
function Cell({
  userId,
  dateIso,
  arr,
  status,
  onClick,
  t,
}: {
  userId: string;
  dateIso: string;
  arr: Stamp[];
  status: CellStatus;
  onClick: () => void;
  t: (k: string) => string;
}) {
  const pairs = arr.length ? inOutPairs(arr) : [];
  const hasBreak = arr.some((s) => s.event_type !== 'clock_in' && s.event_type !== 'clock_out');
  const worked = arr.length ? computeDayTotals(arr as DayStamp[], undefined, false).workedMs : 0;
  const titleParts: string[] = [];
  if (status === 'open') titleParts.push(t('grid.open'));
  if (status === 'weekend') titleParts.push(t('grid.weekend'));

  return (
    <td
      data-cell={`${userId}:${dateIso}`}
      style={{ ...dataCellStyle, background: STATUS_BG[status] ?? dataCellStyle.background, cursor: 'pointer' }}
      onClick={onClick}
      title={titleParts.join(' · ') || undefined}
    >
      {arr.length === 0 ? (
        <span style={{ opacity: 0.25 }}>+</span>
      ) : (
        <div className="flex flex-col" style={{ gap: 1, lineHeight: 1.2 }}>
          {pairs.map((p, i) => (
            <span key={i} className="num" style={{ whiteSpace: 'nowrap' }}>
              {p[0]}
              <span style={{ opacity: 0.5 }}>–</span>
              {p[1] ?? <span style={{ color: 'var(--color-error)' }}>·</span>}
            </span>
          ))}
          {pairs.length === 0 && <span className="num">{arr.map((s) => localHHMM(s.occurred_at)).join(' ')}</span>}
          {(hasBreak || worked > 0) && (
            <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>
              {hasBreak ? '☕ ' : ''}
              {worked > 0 ? formatDuration(worked) : ''}
            </span>
          )}
        </div>
      )}
    </td>
  );
}

/* ---------------- day editor ---------------- */
function DayStampEditor({
  user,
  dateIso,
  existing,
  branches,
  onChanged,
  onClose,
}: {
  user: UserRow;
  dateIso: string;
  existing: Stamp[];
  branches: Branch[];
  onChanged: () => Promise<void> | void;
  onClose: () => void;
}) {
  const { t } = useTranslation(['stamps', 'common']);
  useEscapeKey(onClose);
  const [reason, setReason] = useState(t('grid.reasonDefault'));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(
    () => [...existing].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()),
    [existing],
  );

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    } finally {
      setBusy(false);
    }
  }

  const reasonText = () => (reason.trim().length >= 3 ? reason.trim() : t('grid.reasonDefault'));

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <div data-testid="day-editor" className="card w-full max-w-lg space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title">
          {userLabel(user)} · {fmtDate(dateIso, { weekday: 'long', day: '2-digit', month: 'long' })}
        </h2>

        <div>
          <label className="label">{t('grid.reason')}</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>

        <div className="space-y-2">
          {sorted.length === 0 && (
            <div className="text-sm" style={{ color: 'var(--color-on-surface-variant)' }}>
              {t('grid.noStamps')}
            </div>
          )}
          {sorted.map((s) => (
            <ExistingRow
              key={s.id}
              stamp={s}
              branches={branches}
              busy={busy}
              onSave={(body) => run(() => api(`/api/v1/admin/stamps/${s.id}`, { method: 'PATCH', json: { ...body, justification: reasonText() } }))}
              onDelete={() => run(() => api(`/api/v1/admin/stamps/${s.id}`, { method: 'DELETE', json: { deletion_reason: reasonText() } }))}
            />
          ))}
        </div>

        <AddRow
          dateIso={dateIso}
          branches={branches}
          busy={busy}
          onAdd={(body) =>
            run(() =>
              api(`/api/v1/admin/stamps`, {
                method: 'POST',
                json: { user_id: user.user_id, ...body, justification: reasonText() },
              }),
            )
          }
        />

        {err && (
          <div className="rounded-md px-3 py-2 text-sm" style={{ background: 'var(--color-error-tint)', color: 'var(--color-error)' }}>
            {err}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common:btn.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

function EventSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation(['stamps', 'common']);
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 150 }}>
      {EVENT_TYPES.map((ev) => (
        <option key={ev} value={ev}>
          {t(`common:stampEvent.${ev}`)}
        </option>
      ))}
    </select>
  );
}

function BranchSelect({ value, onChange, branches }: { value: string; onChange: (v: string) => void; branches: Branch[] }) {
  const { t } = useTranslation(['stamps', 'common']);
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 140 }}>
      <option value="">{t('form.noBranch')}</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}

function ExistingRow({
  stamp,
  branches,
  busy,
  onSave,
  onDelete,
}: {
  stamp: Stamp;
  branches: Branch[];
  busy: boolean;
  onSave: (body: { event_type: string; occurred_at: string; branch_id: string | null }) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation(['stamps', 'common']);
  const [eventType, setEventType] = useState<string>(stamp.event_type);
  const [time, setTime] = useState(localHHMM(stamp.occurred_at));
  const [branchId, setBranchId] = useState(stamp.branch_id ?? '');
  const dateIso = isoLocalDate(new Date(stamp.occurred_at));

  function save(e: FormEvent) {
    e.preventDefault();
    onSave({ event_type: eventType, occurred_at: combineIso(dateIso, time), branch_id: branchId || null });
  }

  return (
    <form data-stamp-id={stamp.id} className="flex items-center gap-2 flex-wrap" onSubmit={save}>
      <EventSelect value={eventType} onChange={setEventType} />
      <input type="time" className="input" style={{ width: 110 }} value={time} onChange={(e) => setTime(e.target.value)} required />
      <BranchSelect value={branchId} onChange={setBranchId} branches={branches} />
      <button type="submit" className="btn btn-secondary" disabled={busy} title={t('common:btn.save')}>
        {t('common:btn.save')}
      </button>
      <button type="button" className="icon-btn icon-btn-danger" disabled={busy} onClick={onDelete} title={t('action.delete')} aria-label={t('action.delete')}>
        ✕
      </button>
    </form>
  );
}

function AddRow({
  dateIso,
  branches,
  busy,
  onAdd,
}: {
  dateIso: string;
  branches: Branch[];
  busy: boolean;
  onAdd: (body: { event_type: string; occurred_at: string; branch_id: string | null }) => void;
}) {
  const { t } = useTranslation(['stamps', 'common']);
  const [eventType, setEventType] = useState<string>('clock_in');
  const [time, setTime] = useState('09:00');
  const [branchId, setBranchId] = useState('');

  function add(e: FormEvent) {
    e.preventDefault();
    onAdd({ event_type: eventType, occurred_at: combineIso(dateIso, time), branch_id: branchId || null });
  }

  return (
    <form data-testid="add-stamp-form" className="flex items-center gap-2 flex-wrap pt-2" style={{ borderTop: '1px solid var(--color-outline-variant)' }} onSubmit={add}>
      <EventSelect value={eventType} onChange={setEventType} />
      <input type="time" className="input" style={{ width: 110 }} value={time} onChange={(e) => setTime(e.target.value)} required />
      <BranchSelect value={branchId} onChange={setBranchId} branches={branches} />
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {t('grid.addEvent')}
      </button>
    </form>
  );
}

/* ---------------- cell styles ---------------- */
const headBg = 'color-mix(in oklab, var(--color-surface-variant) 55%, white)';
const borderColor = 'var(--color-outline-variant)';

const headCellStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: headBg,
  borderBottom: `1px solid ${borderColor}`,
  borderRight: `1px solid ${borderColor}`,
  padding: '6px 8px',
  textAlign: 'center',
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
};
const cornerCellStyle: CSSProperties = {
  ...headCellStyle,
  left: 0,
  zIndex: 3,
  textAlign: 'left',
};
const rowHeadStyle: CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 1,
  background: 'var(--color-surface, white)',
  borderBottom: `1px solid ${borderColor}`,
  borderRight: `1px solid ${borderColor}`,
  padding: '4px 8px',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  fontWeight: 500,
};
const dataCellStyle: CSSProperties = {
  background: 'var(--color-surface, white)',
  borderBottom: `1px solid ${borderColor}`,
  borderRight: `1px solid ${borderColor}`,
  padding: '4px 6px',
  verticalAlign: 'top',
  minWidth: 96,
};
const totalCellStyle: CSSProperties = {
  background: 'color-mix(in oklab, var(--color-surface-variant) 30%, white)',
  borderBottom: `1px solid ${borderColor}`,
  padding: '4px 8px',
  textAlign: 'right',
  whiteSpace: 'nowrap',
  fontWeight: 600,
};
const stickyRightStyle: CSSProperties = {
  position: 'sticky',
  right: 0,
  zIndex: 1,
};
