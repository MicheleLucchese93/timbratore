import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { scheduledStartBefore, scheduledWindowParts } from '@sonoqui/shared';
import { api, type ApiError } from '../lib/api.ts';
import { isoLocalDate, isoLocalDaysAgo } from '../lib/dates.ts';
import { fmtDate as fmtDateI18n, fmtTime as fmtTimeI18n } from '../i18n/format.ts';
import { PageHeader } from '../components/PageHeader.tsx';
import { DayDossierModal } from '../components/StampTrail.tsx';

interface Anomaly {
  date: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  shift_template_id: string | null;
  shift_template_name: string | null;
  kind:
    | 'missing_clock_in'
    | 'missing_clock_out'
    | 'late_clock_in'
    | 'early_clock_out'
    | 'short_hours'
    | 'worked_on_rest_day'
    | 'break_too_short'
    | 'break_too_long'
    | 'lunch_too_short'
    | 'lunch_too_long'
    | 'lunch_outside_window'
    | 'clock_out_out_of_area';
  expected_start_at: string | null;
  expected_end_at: string | null;
  // The day's scheduled work fascia by fascia, approved leave already carved
  // out (backend uncoveredWorkIntervals). expected_start_at/expected_end_at are
  // the first slot's start and the last slot's end, so on an orario spezzato
  // the stretch between them contains the unpaid inter-fascia gap; these
  // intervals are what say where the gap is. Null on rows raised without a
  // resolved schedule (uscita fuori area, giorno di riposo).
  work_intervals: { from: string; to: string }[] | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  delta_minutes: number | null;
  break_total_min: number | null;
  lunch_total_min: number | null;
  details: string | null;
  justification_note: string | null;
  justified_at: string | null;
}

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
}

/** A half-open stretch of instants, ISO-8601 on both ends. */
interface TimeWindow {
  from: string;
  to: string;
}

const KIND_COLOR: Record<Anomaly['kind'], string> = {
  missing_clock_in: '#b91c1c',
  missing_clock_out: '#b91c1c',
  late_clock_in: '#d97706',
  early_clock_out: '#d97706',
  short_hours: '#d97706',
  worked_on_rest_day: '#7c3aed',
  break_too_short: '#0369a1',
  break_too_long: '#0369a1',
  lunch_too_short: '#0369a1',
  lunch_too_long: '#0369a1',
  lunch_outside_window: '#0369a1',
  clock_out_out_of_area: '#7c3aed',
};

// The anomaly kinds that describe unworked time, and can therefore carry a
// DAY-level correction (ferie / permesso) for the whole giornata.
//
// The order here is ONLY a tie-break for picking one representative row per
// day — which row collapseByDay keeps, and which one a ferie reads the
// scheduled day from. It is emphatically NOT how the proposed permesso window
// is chosen; that is buildDayCorrection()'s job.
//
// Reading this order as a window priority is precisely what broke the page.
// 'short_hours' sits first because its delta_minutes is the day's real
// shortfall, but proposeGap('short_hours') is END-anchored (the last `delta`
// minutes of scheduled work before the end of the turno).
// On a 09:00–13:00 / 14:00–18:00 schedule entered at 10:30 the day raises both
// late_clock_in and short_hours with delta 90, and letting 'short_hours' speak
// for the giornata proposed 16:30–18:00 — ninety minutes the employee had
// actually worked — while the 09:00–10:30 hole it was meant to cover stayed
// open and kept raising the anomaly.
//
// This used to be two lists holding the very same five kinds — a
// JUSTIFIABLE_KINDS set gating the per-row menu and a COLLAPSE_PRIORITY order
// driving the bulk bar — which is one list too many to keep in sync.
const DAY_LEVEL_KINDS: Anomaly['kind'][] = [
  'short_hours',
  'early_clock_out',
  'late_clock_in',
  'missing_clock_out',
  'missing_clock_in',
];

// WHERE in the day the unworked stretch sits: at the head of the shift
// (expected_start → actual_start) or at its tail (actual_end → expected_end).
//
// 'short_hours' is deliberately in neither list: it is a MAGNITUDE, not a
// position. It says four hours are missing, never at which end of the day they
// are missing — which is why it can only ever be the last resort for a window.
//
// These two lists are the KIND half of isPositionedGapRow: a row may keep its
// own window against the giornata's only if it appears here — and only if the
// punch that end is measured from was actually made, which is the other half.
// So the "last resort" rule holds for the row itself and not merely for the day.
const LEADING_GAP_KINDS: Anomaly['kind'][] = ['late_clock_in', 'missing_clock_in'];
const TRAILING_GAP_KINDS: Anomaly['kind'][] = ['early_clock_out', 'missing_clock_out'];

function dayLevelRank(kind: Anomaly['kind']): number {
  const i = DAY_LEVEL_KINDS.indexOf(kind);
  // Kinds outside the list never describe unworked time (pausa, fuori area,
  // giorno di riposo), so any rank past the end of the list will do.
  return i === -1 ? DAY_LEVEL_KINDS.length : i;
}

function defaultRange(): { from: string; to: string } {
  return { from: isoLocalDaysAgo(30), to: isoLocalDate() };
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return fmtTimeI18n(iso, { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(d: string): string {
  return fmtDateI18n(d + 'T00:00:00', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
}

export function Anomalies() {
  const { t } = useTranslation(['anomalies', 'common']);
  const def = defaultRange();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [userId, setUserId] = useState<string>('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [rows, setRows] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notDeployed, setNotDeployed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // A justified anomaly stays in the API response by design — the deviation
  // remains on record and in the exports. Hiding it here is a view filter, so
  // the page defaults to the work still to be handled.
  const [hideJustified, setHideJustified] = useState(true);

  useEffect(() => {
    api<UserRow[]>('/api/v1/users')
      .then((u) => setUsers(u))
      .catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    setErr(null);
    setNotDeployed(false);
    try {
      const q = new URLSearchParams({ from, to });
      if (userId) q.set('user_id', userId);
      const data = await api<Anomaly[]>(`/api/v1/shifts/anomalies?${q.toString()}`);
      setRows(data);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 404) setNotDeployed(true);
      else setErr(e instanceof Error ? e.message : t('common:state.error'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Everything below (grouping, selection, the bulk bar) runs on the visible
  // set, so a hidden row can never end up in a bulk correction.
  const visible = useMemo(
    () => (hideJustified ? rows.filter((r) => !r.justification_note) : rows),
    [rows, hideJustified]
  );
  const hiddenCount = rows.length - visible.length;

  // Deliberately keyed off `rows`, not `visible`: which absence a giornata can
  // take is a property of the day, and hiding a justified row must not change
  // the answer.
  const dayCorrections = useMemo(() => buildDays(rows), [rows]);

  // The giornate that describe unworked time and can take no absence at all,
  // with the minutes left over on each. Same reason as above for reading
  // `rows`: it is a property of the day, not of the rows left visible.
  const unbookableDays = useMemo(
    () => buildUnbookableDays(rows, dayCorrections),
    [rows, dayCorrections]
  );

  const grouped = useMemo(() => {
    const m = new Map<string, Anomaly[]>();
    for (const r of visible) {
      const key = r.date;
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    return [...m.entries()].sort(([a], [b]) => (a < b ? 1 : -1));
  }, [visible]);

  // Drop selection keys no longer in the list. After a refetch the resolved
  // rows disappear, so a bulk retry only re-hits rows that still fail — this
  // also neutralizes the non-idempotent leave endpoints on retry. Rows hidden
  // by the "nascondi giustificate" filter are dropped the same way.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(visible.map(keyOf));
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (present.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [visible]);

  const selectedRows = useMemo(
    () => visible.filter((r) => selected.has(keyOf(r))),
    [visible, selected]
  );
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(keyOf(r)));

  function toggleOne(k: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }
  function toggleAll() {
    setSelected(() => (allSelected ? new Set() : new Set(visible.map(keyOf))));
  }
  function toggleDay(items: Anomaly[]) {
    setSelected((prev) => {
      const n = new Set(prev);
      const allDay = items.every((a) => n.has(keyOf(a)));
      for (const a of items) {
        if (allDay) n.delete(keyOf(a));
        else n.add(keyOf(a));
      }
      return n;
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('heading')} />

      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">{t('filter.from')}</label>
          <input
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('filter.to')}</label>
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('filter.user')}</label>
          <select
            className="input"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">{t('filter.allUsers')}</option>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.display_name || u.email}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            load().catch(() => {});
          }}
          disabled={loading}
        >
          {loading ? t('common:state.loading') : t('common:btn.refresh')}
        </button>
        <label className="flex items-center gap-2 cursor-pointer text-sm pb-2">
          <input
            type="checkbox"
            data-testid="hide-justified"
            checked={hideJustified}
            onChange={(e) => setHideJustified(e.target.checked)}
          />
          <span>{t('filter.hideJustified')}</span>
          {hiddenCount > 0 && (
            <span className="muted">· {t('filter.hiddenCount', { n: hiddenCount })}</span>
          )}
        </label>
      </div>

      {notDeployed && (
        <div className="card text-sm" style={{ color: 'var(--color-on-tertiary-container, #92400e)', background: 'var(--color-tertiary-container, #fef3c7)' }}>
          {t('notDeployed')}
        </div>
      )}
      {err && (
        <div className="card text-sm" style={{ color: 'var(--color-error)' }}>
          {err}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="card text-sm muted">
          {t('empty')}
        </div>
      )}

      {/* Everything in range is justified: say so, rather than let the generic
          "no anomalies" message imply the days were clean. */}
      {!loading && rows.length > 0 && visible.length === 0 && (
        <div className="card text-sm muted">
          {t('emptyAllJustified', { n: hiddenCount })}
        </div>
      )}

      {visible.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            <span>{t('bulk.selectAllVisible', { n: visible.length })}</span>
          </label>
          {selected.size > 0 && (
            <span className="muted">· {t('bulk.selected', { n: selected.size })}</span>
          )}
        </div>
      )}

      <div className="space-y-4">
        {grouped.map(([day, items]) => (
          <div key={day} className="card">
            <label className="flex items-center gap-2 font-medium mb-2 w-fit cursor-pointer">
              <input
                type="checkbox"
                checked={items.every((a) => selected.has(keyOf(a)))}
                onChange={() => toggleDay(items)}
              />
              {fmtDate(day)}
            </label>
            <ul className="space-y-2">
              {items.map((a) => (
                <AnomalyItem
                  key={keyOf(a)}
                  a={a}
                  day={dayCorrections.get(dayKeyOf(a))}
                  unbookable={unbookableDays.get(dayKeyOf(a))}
                  selected={selected.has(keyOf(a))}
                  onToggle={() => toggleOne(keyOf(a))}
                  onDone={() => {
                    load().catch(() => {});
                  }}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {selectedRows.length > 0 && (
        <BulkCorrectBar
          items={selectedRows}
          days={dayCorrections}
          unbookable={unbookableDays}
          onDone={() => {
            load().catch(() => {});
          }}
          onClear={() => setSelected(new Set())}
        />
      )}
    </div>
  );
}

/* ----------------------- Correction menu per anomaly ----------------------- */

type CorrectionAction = 'standard' | 'ferie' | 'permesso' | 'note';

const ACTION_LABEL_KEY: Record<CorrectionAction, string> = {
  standard: 'action.standard',
  ferie: 'action.ferie',
  permesso: 'action.permesso',
  note: 'action.note',
};

const QUARTER_MS = 15 * 60 * 1000;

// The clock events that are absent for the day, to be added at the scheduled
// times. Additive only — present punches are never touched.
function missingEvents(a: Anomaly): { event_type: 'clock_in' | 'clock_out'; occurred_at: string }[] {
  const ev: { event_type: 'clock_in' | 'clock_out'; occurred_at: string }[] = [];
  if (!a.actual_start_at && a.expected_start_at)
    ev.push({ event_type: 'clock_in', occurred_at: a.expected_start_at });
  if (!a.actual_end_at && a.expected_end_at)
    ev.push({ event_type: 'clock_out', occurred_at: a.expected_end_at });
  return ev;
}

function floor15(ms: number): number {
  return Math.floor(ms / QUARTER_MS) * QUARTER_MS;
}
function ceil15(ms: number): number {
  return Math.ceil(ms / QUARTER_MS) * QUARTER_MS;
}

// The stretches of [from, to) that a permesso may actually be BOOKED over: the
// window intersected with the day's scheduled fasce (approved leave already
// carved out server-side), each piece snapped inward to the 15-minute grid.
//
// One window, several pieces, on every orario spezzato. Time System's "FULL
// TIME FLESSIBILE" is 08:00–12:00 + 13:00–17:00: a day left at 12:00 proposes
// 12:00 → 17:00, and the midday hour inside it is neither worked nor absence —
// it is simply not scheduled. Booking the span whole took an extra hour off the
// employee's permessi residuo and put it in the payroll export's "Ore
// permessi", while the day's own 'short_hours' delta said the shortfall was one
// hour smaller. Each piece is inserted as its own permesso instead.
//
// Delegates to @sonoqui/shared, whose uncoveredSlotIntervals produced
// work_intervals in the first place — the same rule the backend's late/early
// anomalies, the counted day and the export all judge presence with.
//
// A payload without work_intervals (an API older than the field, or a row
// raised with no schedule at all) leaves the window exactly as proposed: that
// is the previous behaviour, and it is the right answer on every schedule with
// a single fascia, where the intersection is the window itself.
function permessoParts(
  a: Anomaly,
  from: string,
  to: string
): { from: string; to: string }[] {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!(end > start)) return [];
  const fasce = workIntervalsMs(a);
  if (!fasce) return [{ from, to }];
  return scheduledWindowParts({ start, end }, fasce, QUARTER_MS).map((p) => ({
    from: new Date(p.start).toISOString(),
    to: new Date(p.end).toISOString(),
  }));
}

// The giornata's fasce as epoch-ms intervals, or null when the row carries no
// schedule at all (uscita fuori area, giorno di riposo, or an API older than
// the field). Null means "the schedule is UNKNOWN", and every caller here
// answers it by leaving the window exactly as proposed — never by treating the
// day as holding no scheduled work, which is what an empty array means.
function workIntervalsMs(a: Anomaly): { start: number; end: number }[] | null {
  if (!a.work_intervals) return null;
  return a.work_intervals.map((w) => ({
    start: new Date(w.from).getTime(),
    end: new Date(w.to).getTime(),
  }));
}

// The 15-minute instants the Dalle / Alle stepper may move a permesso window
// to: the quarter grid INSIDE each fascia, snapped the way scheduledWindowParts
// snaps the booking itself.
//
// The two ends get different ranges on purpose — a 'from' may not sit on a
// fascia's last grid point and a 'to' may not sit on its first — so any window
// between two admissible instants holds at least one bookable quarter in the
// fascia it starts in and in the fascia it ends in. That is what makes
// "what the recap shows" and "what permessoParts books" the same two instants.
//
// Null when the fasce are unknown: with nothing to clamp to the stepper stays
// free, which is also when permessoParts leaves the window untouched, so the
// two still cannot diverge.
function permStepBounds(a: Anomaly, which: 'from' | 'to'): { lo: number; hi: number }[] | null {
  const fasce = workIntervalsMs(a);
  if (!fasce) return null;
  const out: { lo: number; hi: number }[] = [];
  for (const iv of fasce) {
    const lo = ceil15(iv.start);
    const hi = floor15(iv.end);
    // A fascia that holds no whole quarter offers no instant at all — the very
    // slivers isUnbookableGapRow() is about.
    if (hi - lo < QUARTER_MS) continue;
    out.push(which === 'from' ? { lo, hi: hi - QUARTER_MS } : { lo: lo + QUARTER_MS, hi });
  }
  return out.sort((x, y) => x.lo - y.lo);
}

// One step of the stepper, CLAMPED to the fasce. Null at the outer edge of the
// schedule: there is no further instant a permesso could start or end at.
//
// A free stepper let the recap state something the booking would not do. On
// 09:00–13:00 + 14:00–18:00, eighteen clicks on "Dalle +" walked the window to
// 13:30 — an instant nobody is scheduled at — while permessoParts clipped the
// booking back to 14:00–18:00: the recap read "Dalle 13:30 · Alle 18:00 ·
// Durata 4h", a four-and-a-half-hour window against a four-hour duration, and
// the line that explains a shorter duration had switched itself off because the
// clipped window holds a single fascia. Stepping now jumps the unpaid gap whole
// (12:45 → 14:00), so the window can never leave the hours it books.
function nextPermInstant(
  a: Anomaly,
  cur: number,
  which: 'from' | 'to',
  dir: -1 | 1
): number | null {
  const bounds = permStepBounds(a, which);
  if (!bounds) return cur + dir * QUARTER_MS; // schedule unknown → free stepping
  const target = cur + dir * QUARTER_MS;
  if (bounds.some((b) => target >= b.lo && target <= b.hi)) return target;
  // Off the schedule: land on the nearest admissible instant in that direction
  // — the start of the next fascia, or the end of the previous one.
  if (dir === 1) return bounds.find((b) => b.lo > cur)?.lo ?? null;
  let prev: number | null = null;
  for (const b of bounds) if (b.hi < cur) prev = b.hi;
  return prev;
}

// Where the last `minutes` of SCHEDULED work before `endMs` begin.
//
// 'short_hours' is a magnitude — it says four hours are missing, never where —
// so its window is anchored at the end of the day and measured backwards. On a
// split shift plain subtraction measures through the unpaid gap and lands on an
// instant nobody is scheduled at, which then clips to less than the shortfall;
// walking the fasce lands on the instant that makes the two agree, and on the
// same window the day's 'early_clock_out' row proposes. Falls back to plain
// subtraction when the day's fasce are unknown.
function shortHoursStart(a: Anomaly, endMs: number, minutes: number): number {
  const durationMs = minutes * 60_000;
  const fasce = workIntervalsMs(a);
  if (!fasce || fasce.length === 0) return endMs - durationMs;
  return scheduledStartBefore(endMs, fasce, durationMs);
}

/** Total bookable minutes of a window — the pieces, never the raw span. */
function permessoMinutes(a: Anomaly, from: string | null, to: string | null): number {
  if (!from || !to) return 0;
  return permessoParts(a, from, to).reduce(
    (sum, p) => sum + Math.round((new Date(p.to).getTime() - new Date(p.from).getTime()) / 60_000),
    0
  );
}

// Default permesso window = the uncovered part of the scheduled day ("copri il
// gap mancante"), snapped to a 15-minute grid and then trimmed to the day's
// fasce. Admin can fine-tune in the recap.
//
// It stays ONE window on purpose: everything above (the day-level union, the
// split detection, the bulk bar) reasons about a single stretch, and the
// fasce inside it are subtracted again — from this very function's output — at
// the moment the permesso is posted. What the trimming changes here is the
// window's ENDS: a day left at 13:30 on 09:00–13:00 + 14:00–18:00 proposes
// 14:00 → 18:00, not 13:30 → 18:00, so the stepper never shows an instant the
// booking will not use. Null when the window holds no scheduled work at all.
function proposeGap(a: Anomaly): { from: string; to: string } | null {
  const raw = rawGapWindow(a);
  if (!raw) return null;
  const parts = permessoParts(a, new Date(raw.from).toISOString(), new Date(raw.to).toISOString());
  if (parts.length === 0) return null;
  return { from: parts[0]!.from, to: parts[parts.length - 1]!.to };
}

// The window a day-level row proposes BEFORE it is trimmed to the fasce: the
// two anchors its kind reads, widened to the quarter grid. Split out of
// proposeGap so the panel can still describe a giornata whose trimmed window
// comes back empty — see isUnbookableGapRow / unbookableSlivers, which is the
// only case where the untrimmed window is the interesting one.
function rawGapWindow(a: Anomaly): { from: number; to: number } | null {
  const es = a.expected_start_at ? new Date(a.expected_start_at).getTime() : null;
  const ee = a.expected_end_at ? new Date(a.expected_end_at).getTime() : null;
  const as = a.actual_start_at ? new Date(a.actual_start_at).getTime() : null;
  const ae = a.actual_end_at ? new Date(a.actual_end_at).getTime() : null;
  let from: number | null = null;
  let to: number | null = null;
  switch (a.kind) {
    case 'missing_clock_in':
    case 'late_clock_in':
      from = es;
      to = as ?? ee;
      break;
    case 'missing_clock_out':
    case 'early_clock_out':
      from = ae ?? es;
      to = ee;
      break;
    case 'short_hours':
      if (ee != null && a.delta_minutes) {
        from = shortHoursStart(a, ee, Math.abs(a.delta_minutes));
        to = ee;
      } else {
        from = es;
        to = ee;
      }
      break;
    default:
      from = es;
      to = ee;
  }
  if (from == null || to == null) return null;
  from = floor15(from);
  to = ceil15(to);
  if (to <= from) to = from + QUARTER_MS;
  return { from, to };
}

// A row that WOULD carry a day-level absence — a day-level kind with a resolved
// schedule — but whose proposed window holds no bookable quarter of scheduled
// work. isGapRow() therefore rejects it, its giornata gets no DayCorrection at
// all, and "Inserisci ferie" and "Inserisci permesso" vanish from EVERY row of
// that day with nothing on screen saying why.
//
// Not a theoretical branch: shift-template slot times are free-form (the admin
// form is an <input type="time"> with no step, apps/web/src/pages/Shifts.tsx,
// and the API validates only HH:MM), so 09:00–13:20 + 14:00–17:40 is a legal
// orario. Book an absent day on it once and 465 of the 480 minutes are covered
// — scheduledWindowParts snaps each part inward to the quarter grid — leaving
// 13:15–13:20 and 17:30–17:40 uncovered. The next load raises missing_clock_in
// and missing_clock_out again over those slivers, and now neither absence is
// offered on them: shorter than the 15 minutes a leave must be a multiple of,
// they produce no part at all. The admin is left with two red rows and a menu
// that lost both its absence entries between one visit and the next.
function isUnbookableGapRow(a: Anomaly): boolean {
  return (
    dayLevelRank(a.kind) < DAY_LEVEL_KINDS.length &&
    a.expected_start_at !== null &&
    a.expected_end_at !== null &&
    proposeGap(a) === null
  );
}

// What is left uncovered on such a day: the row's untrimmed window intersected
// with the fasce, WITHOUT the quarter-grid snap. Each stretch is shorter than a
// quarter of an hour — that is exactly why permessoParts dropped it — so naming
// them is what turns "no absence is available" into something the admin can act
// on (the slivers come from the orario's own slot times).
function unbookableSlivers(a: Anomaly): { from: string; to: string }[] {
  const raw = rawGapWindow(a);
  const fasce = workIntervalsMs(a);
  if (!raw || !fasce) return [];
  const out: { from: string; to: string }[] = [];
  for (const iv of fasce) {
    const start = Math.max(raw.from, iv.start);
    const end = Math.min(raw.to, iv.end);
    if (end > start) {
      out.push({ from: new Date(start).toISOString(), to: new Date(end).toISOString() });
    }
  }
  return out.sort((x, y) => x.from.localeCompare(y.from));
}

// A row that contributes unworked time to its giornata: a day-level kind,
// carrying the day's schedule, that proposeGap() can turn into a window.
//
// This is what makes a day correctible with an absence AT ALL — it is the
// filter buildDayCorrection starts from. It says nothing about whether the row
// may speak for itself; only isPositionedGapRow does.
function isGapRow(a: Anomaly): boolean {
  return (
    dayLevelRank(a.kind) < DAY_LEVEL_KINDS.length &&
    a.expected_start_at !== null &&
    a.expected_end_at !== null &&
    proposeGap(a) !== null
  );
}

// A gap row whose OWN punches place its hole, and which may therefore keep its
// own proposal against the giornata's.
//
// Two conditions, and the second is not a corollary of the first: the KIND has
// to name an end of the turno (LEADING/TRAILING_GAP_KINDS), and the PUNCH that
// end's window is measured from has to exist. proposeGap reads a leading window
// as expected_start → actual_start and a trailing one as actual_end →
// expected_end; with its own anchor null it falls back to the whole scheduled
// day — an assumption about the giornata, not a position inside it.
//
// Keeping the row's own window where it IS anchored is one half of the bug: on
// the 09:00–13:00 / 14:00–18:00 day entered at 10:30, the 'late_clock_in' row —
// whose own window is 09:00–10:30 — had started showing the day's end-anchored
// 16:30–18:00, so confirming it booked a permesso over hours that had been
// worked and left the late entry uncorrected.
//
// Reading the kind alone is the mirror image of that, and was the other half.
// 'missing_clock_in' and 'missing_clock_out' are raised precisely WHEN their own
// anchor is absent — buildAnomaly fills actual_start_at/actual_end_at from
// firstIn/lastOut, and each kind fires only when the one it would read is
// missing — so their "own" window is always the entire turno. On a 09:00–18:00
// day entered at 10:30 and never closed, the day raises late_clock_in AND
// missing_clock_out and its hole is 09:00–10:30, but the 'missing_clock_out' row
// proposed 09:00–18:00: six and a half worked hours booked off the residuo, from
// the row an admin opens exactly because the exit is what is missing. The
// missing punch is what 'Timbratura standard' is for; how much of the day it
// leaves uncovered is a question only the giornata can answer.
//
// 'short_hours' is excluded by kind, one step earlier and for the same reason.
// It is a MAGNITUDE (see LEADING/TRAILING_GAP_KINDS): it says four hours are
// missing, never at which end of the turno. Letting it speak for its own row put the
// identical defect back one row over — on a 09:00–18:00 day entered at 10:30
// and left at 16:30, buildDayCorrection correctly refuses a single permesso
// (`split`), but the 'short_hours' row went on offering its end-anchored
// 15:00–18:00: ninety of those minutes are hours the punches prove were worked,
// and both real holes stayed open. It now borrows the giornata's answer like a
// pausa row does, which on a split day is "no single window exists".
//
// On a day whose only gap row is one of the borrowers — 'short_hours' alone, or
// an unanchored 'missing_clock_in' alone — the borrowed answer is the very
// window that row would have proposed (buildDayCorrection falls back to it), so
// nothing is lost where the row is all the day knows.
function isPositionedGapRow(a: Anomaly): boolean {
  if (!isGapRow(a)) return false;
  // One anchor per end: without it there is no position to keep, only
  // proposeGap's whole-day fallback. Kinds in neither list ('short_hours',
  // pausa, fuori area, giorno di riposo) never keep a window of their own.
  if (LEADING_GAP_KINDS.includes(a.kind)) return a.actual_start_at !== null;
  if (TRAILING_GAP_KINDS.includes(a.kind)) return a.actual_end_at !== null;
  return false;
}

// What a DAY-level correction can do to one giornata, derived from that day's
// whole anomaly SET rather than from a single representative row.
//
// Time System, RAO Giuseppe, 14/08/2026: orario "FULL TIME FLESSIBILE"
// 08:00–12:00 + 13:00–17:00, punched in at 07:58 and out at 14:38 with no
// lunch stamped. The day raised several anomalies and the admin opened the one
// of kind 'lunch_too_short'; that row offered only "giustifica con nota",
// which they read as "the product won't let me insert a permesso". The 2h20 of
// unworked time is a fact about the GIORNATA, not about the row that happened
// to be clicked — hence this per-day object.
interface DayCorrection {
  // Any gap row of the day. Every kind of one giornata is built from the same
  // day of stamps and carries the same expected_start_at/expected_end_at, so
  // this is simply where 'ferie' reads the scheduled day from.
  schedule: Anomaly;
  // The day's genuinely un-worked window, or null when it cannot be expressed
  // as one (see `split`).
  gap: { from: string; to: string } | null;
  // The anomaly `gap` was read from — named in the recap, so "dalle 14:38 alle
  // 17:00" shown on a pausa row is not read as the length of the break.
  gapSource: Anomaly | null;
  // Set when the day is un-worked at BOTH ends AND the punches prove someone
  // was there in between: in late AND out early. Those are two disjoint
  // stretches; one permesso cannot cover them, and silently picking one would
  // book the other as worked. The day-level permesso is withheld and the admin
  // is pointed at the two rows, each of which proposes its own window.
  //
  // Two flagged ends are NOT enough on their own — see dayGapFromBothEnds.
  split: { leading: Anomaly; trailing: Anomaly } | null;
}

// Two windows that touch or overlap are ONE stretch, not two: their union.
// null when they are genuinely disjoint (worked time sits between them).
function unionWindow(
  a: { from: string; to: string },
  b: { from: string; to: string }
): { from: string; to: string } | null {
  const aFrom = new Date(a.from).getTime();
  const aTo = new Date(a.to).getTime();
  const bFrom = new Date(b.from).getTime();
  const bTo = new Date(b.to).getTime();
  if (aTo < bFrom || bTo < aFrom) return null;
  return {
    from: new Date(Math.min(aFrom, bFrom)).toISOString(),
    to: new Date(Math.max(aTo, bTo)).toISOString(),
  };
}

// A day flagged at BOTH ends, resolved into ONE window where the punches allow
// it. null means "cannot be expressed as a single window", which the caller
// turns into a `split` — the conservative answer, since a split only withholds
// the day-level permesso and leaves both rows correctable on their own.
//
// What decides it is not the PAIR OF KINDS but the two presence anchors:
//
//   leading.actual_start_at  → when presence is first evidenced (null: never in)
//   trailing.actual_end_at   → when presence is last evidenced  (null: never out)
//
// Reading "leading row + trailing row" as "two holes" is what broke a plain
// absence. A scheduled day with NO punches at all raises missing_clock_in AND
// missing_clock_out, and buildAnomaly leaves both anchors null; proposeGap's
// "no punch → assume the whole scheduled day" fallback then hands back the SAME
// 09:00–18:00 window twice. Calling that a split withheld the day-level
// permesso from an ordinary absent day — and, because the bulk bar intersected
// across the selection, from every other day selected together with it.
//
// The invariant the three branches share: the day's gap is whatever the day's
// REAL punches leave uncovered. Where a punch anchors one end, that end's
// window is the only stretch the day proves, and the other end's whole-day
// fallback must not be unioned into it — entrato alle 10:30 e mai uscito is
// 09:00–10:30, not 09:00–18:00; the missing exit is what "Timbratura standard"
// is for. It is also exactly the window the day would propose once that
// correction has run.
function dayGapFromBothEnds(
  leading: Anomaly,
  trailing: Anomaly
): { gap: { from: string; to: string }; gapSource: Anomaly } | null {
  const presenceFrom = leading.actual_start_at
    ? new Date(leading.actual_start_at).getTime()
    : null;
  const presenceTo = trailing.actual_end_at ? new Date(trailing.actual_end_at).getTime() : null;

  // In late AND out early: hours that were worked sit between the two holes, so
  // they are two stretches and one permesso genuinely cannot cover them.
  if (presenceFrom !== null && presenceTo !== null && presenceFrom < presenceTo) return null;

  // Exactly one end anchored by a real punch → that half is the day's window.
  if (presenceFrom !== null && presenceTo === null) {
    const gap = proposeGap(leading);
    return gap ? { gap, gapSource: leading } : null;
  }
  if (presenceTo !== null && presenceFrom === null) {
    const gap = proposeGap(trailing);
    return gap ? { gap, gapSource: trailing } : null;
  }

  // Neither end anchored (no punch on the day at all), or anchors that leave no
  // worked stretch between them: one continuous window. Both rows carry the
  // same schedule, so the union is the whole giornata — which is precisely what
  // an absence is. The null branches below are unreachable for rows that passed
  // isGapRow (proposeGap is non-null, and both windows share expected_start, so
  // they always overlap); they fall back to `split` rather than guess.
  const lead = proposeGap(leading);
  const trail = proposeGap(trailing);
  if (!lead || !trail) return null;
  const gap = unionWindow(lead, trail);
  return gap ? { gap, gapSource: leading } : null;
}

function bestByRank(rows: Anomaly[], kinds: Anomaly['kind'][]): Anomaly | null {
  let best: Anomaly | null = null;
  for (const a of rows) {
    if (!kinds.includes(a.kind)) continue;
    if (!best || dayLevelRank(a.kind) < dayLevelRank(best.kind)) best = a;
  }
  return best;
}

// The day's un-worked stretch, as the day's anomalies describe it TOGETHER:
//
//   leading gap only   → expected_start → actual_start   (late / missing in)
//   trailing gap only  → actual_end → expected_end       (early / missing out)
//   leading AND trailing → dayGapFromBothEnds: one window when the punches
//                          leave a single continuous stretch (an absent day is
//                          the whole giornata), `split` only when worked hours
//                          sit between the two holes
//   neither, 'short_hours' alone → the end-anchored shortfall, the only thing
//                                  a magnitude-only anomaly can say
//
// A day that raises 'late_clock_in' AND 'short_hours' therefore proposes the
// leading hole, not the shortfall: both have the same delta, but only the
// leading window points at time nobody worked.
function buildDayCorrection(items: Anomaly[]): DayCorrection | null {
  const gapRows = items.filter(isGapRow);
  // 'clock_out_out_of_area' and 'worked_on_rest_day' carry no schedule at all,
  // and a day whose only deviation is a short lunch has no unworked time: no
  // gap row, no day-level absence.
  if (gapRows.length === 0) return null;
  const schedule = gapRows.reduce((best, a) =>
    dayLevelRank(a.kind) < dayLevelRank(best.kind) ? a : best
  );
  const leading = bestByRank(gapRows, LEADING_GAP_KINDS);
  const trailing = bestByRank(gapRows, TRAILING_GAP_KINDS);
  if (leading && trailing) {
    const both = dayGapFromBothEnds(leading, trailing);
    if (both) return { schedule, gap: both.gap, gapSource: both.gapSource, split: null };
    return { schedule, gap: null, gapSource: null, split: { leading, trailing } };
  }
  const source = leading ?? trailing ?? gapRows.find((a) => a.kind === 'short_hours') ?? null;
  const gap = source ? proposeGap(source) : null;
  return { schedule, gap, gapSource: gap ? source : null, split: null };
}

// dayKeyOf → its DayCorrection, for every giornata that has one.
//
// Built from the FULL API response and not from the visible rows: justifying
// 'short_hours' with a note hides that row, it does not fill the gap the row
// described, and the pausa row left on screen must still offer the absence.
function buildDays(all: Anomaly[]): Map<string, DayCorrection> {
  const byDay = new Map<string, Anomaly[]>();
  for (const a of all) {
    const k = dayKeyOf(a);
    const arr = byDay.get(k) ?? [];
    arr.push(a);
    byDay.set(k, arr);
  }
  const out = new Map<string, DayCorrection>();
  for (const [k, items] of byDay) {
    const day = buildDayCorrection(items);
    if (day) out.set(k, day);
  }
  return out;
}

// The giornate that describe unworked time and can take NO absence at all,
// each mapped to the minutes left uncovered on it. The complement of buildDays:
// the day HAS gap rows, none of them survives isGapRow, so no DayCorrection is
// emitted and ferie/permesso are missing from every one of its rows.
//
// Per (user, date), like every other day-level property here, and that is the
// fix. Asking the question of the clicked ROW instead — `!day &&
// isUnbookableGapRow(a)` — required that row to be a day-level kind, so on the
// very same giornata the rows outside DAY_LEVEL_KINDS explained nothing: an
// orario 09:00–13:20 / 14:00–17:40 with pausa pranzo minima 30 minuti raises
// 'lunch_too_short' next to the two unbookable slivers, and that row lost ferie
// and permesso in silence — the case the bulk bar's counter already claimed to
// cover. The per-row panel and the bar now read this one map, so they cannot
// answer differently.
//
// The value is the union of what each unbookable gap row leaves over, merged:
// a day flagged at both ends describes the same slivers twice, and what the
// admin has to read is a list of stretches, not a list of rows.
function buildUnbookableDays(
  all: Anomaly[],
  days: Map<string, DayCorrection>
): Map<string, TimeWindow[]> {
  const byDay = new Map<string, Anomaly[]>();
  for (const a of all) {
    const k = dayKeyOf(a);
    const arr = byDay.get(k) ?? [];
    arr.push(a);
    byDay.set(k, arr);
  }
  const out = new Map<string, TimeWindow[]>();
  for (const [k, items] of byDay) {
    // The giornata can take an absence: there is nothing to explain.
    if (days.has(k)) continue;
    const rows = items.filter(isUnbookableGapRow);
    if (rows.length === 0) continue;
    out.set(k, mergeWindows(rows.flatMap((r) => unbookableSlivers(r))));
  }
  return out;
}

// Overlapping or touching stretches collapsed into one. Every end here is
// produced by toISOString(), so the strings are the same length and in the same
// zone: lexicographic order is chronological order.
function mergeWindows(ws: TimeWindow[]): TimeWindow[] {
  const sorted = [...ws].sort((a, b) => a.from.localeCompare(b.from));
  const out: TimeWindow[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.from <= last.to) {
      if (w.to > last.to) last.to = w.to;
    } else {
      out.push({ ...w });
    }
  }
  return out;
}

// The window the Correggi panel of THIS row proposes.
//
// A POSITIONED gap row — one whose own punch delimits its hole — keeps its own,
// always: that is the per-row behaviour the day-level work was never supposed to
// touch, and it is exactly what makes the two halves of a split day correctible
// one row at a time. A split is only ever late_clock_in + early_clock_out (both
// ends anchored by a real punch, by definition of `split`), so those two rows
// always have a window of their own to offer.
//
// Every other row borrows the giornata's: 'missing_clock_in' /
// 'missing_clock_out', which cannot delimit a hole with the punch they are
// reporting as absent; 'short_hours', which knows how much is missing but not
// where; and pausa / uscita fuori area / giorno di riposo, which describe no
// unworked time at all. On a split day there is nothing to borrow — day.gap is
// null — so none of them offers a permesso, and the panel
// says why (recap.permSplitDay) instead of proposing a window that would book
// worked hours as absence.
function rowWindow(
  a: Anomaly,
  day: DayCorrection | undefined
): { from: string; to: string } | null {
  if (isPositionedGapRow(a)) return proposeGap(a);
  return day?.gap ?? null;
}

// ferie/permesso are offered on EVERY row of a day that has unworked time,
// pausa rows included. A day with no gap row stays note-only: booking a full
// day of ferie on a giornata whose only sin is a 90-minute lunch — hours all
// worked — would not correct the payroll, it would falsify it.
function availableActions(a: Anomaly, day: DayCorrection | undefined): CorrectionAction[] {
  const acts: CorrectionAction[] = [];
  if (missingEvents(a).length > 0) acts.push('standard');
  if (day) {
    // 'ferie' books the scheduled day whole, so it never depends on WHERE the
    // gap is and stays offered even on a split day.
    acts.push('ferie');
    if (rowWindow(a, day)) acts.push('permesso');
  }
  acts.push('note');
  return acts;
}

// Which action the Correggi dropdown opens on.
//
// Unchanged for the kinds that describe the day: they keep opening on
// 'standard' (a punch is missing) or on 'ferie'. Rows that reach ferie/permesso
// only THROUGH the giornata — pausa, uscita fuori area, giorno di riposo — open
// on 'note' instead: preselecting "inserisci ferie" on a "pausa pranzo troppo
// breve" row would leave a whole day of absence one stray Conferma away.
function defaultActionFor(a: Anomaly, actions: CorrectionAction[]): CorrectionAction {
  if (dayLevelRank(a.kind) < DAY_LEVEL_KINDS.length) return actions[0] ?? 'note';
  return actions.includes('standard') ? 'standard' : 'note';
}

// What a correction is actually POSTed against.
//
// 'ferie' is re-targeted to read a schedule: the clicked row can be a
// 'clock_out_out_of_area' whose expected_* are null, which would post
// from_ts: null. 'standard' inserts the punches THAT row reports absent and
// 'note' is stored per (user, date, kind), so both stay on the clicked row.
//
// 'permesso' carries its window in pFrom/pTo and takes user_id from the row —
// and, since the window is subtracted against the day's fasce before it is
// posted, work_intervals as well. The rows raised before a schedule is
// resolved (uscita fuori area, giorno di riposo) have none, and they are
// exactly the rows that reach 'permesso' only by borrowing the giornata's
// window: posting from one of them would book the inter-fascia gap the
// borrowed window was already trimmed of. They read the day's schedule row,
// which is where the giornata's window came from.
function correctionTarget(
  action: CorrectionAction,
  a: Anomaly,
  day: DayCorrection | undefined
): Anomaly {
  if (!day) return a;
  if (action === 'ferie') return day.schedule;
  if (action === 'permesso' && !a.work_intervals) return day.schedule;
  return a;
}

// Identity of the proposal a Correggi panel is CURRENTLY describing: the row it
// belongs to, the two instants it proposes, and the fasce the stepper is
// clamped to and the booking is cut against (correctionTarget picks the row the
// permesso is actually posted from). Everything the admin can tune is valid
// only against this answer.
//
// It is what makes the panel's window a function of the anomaly on screen. The
// window used to be seeded in three places — at mount, when Correggi is opened,
// and after THIS row's own confirm was refused — so an already-open panel
// survived every other reload: correct one row of the day, apply a bulk action,
// press Aggiorna, and the recap went on stating a window computed against
// stamps that no longer existed, which is the one thing clamping it to the
// fasce was added to rule out. Comparing seeds instead re-proposes exactly when
// the giornata underneath moved, and leaves deliberate stepping alone when it
// did not — a refetch that changes nothing changes nothing here.
function permSeed(a: Anomaly, day: DayCorrection | undefined): string {
  const w = rowWindow(a, day);
  return JSON.stringify([
    keyOf(a),
    w?.from ?? null,
    w?.to ?? null,
    correctionTarget('permesso', a, day).work_intervals,
  ]);
}

// Refusals that leave the giornata EXACTLY as the panel is describing it, so
// the admin's tuned window is still the right thing to send.
//
// The backend answers every refusal with a machine code on the error envelope
// (apps/backend/src/errors/index.ts, surfaced as ApiError.code by lib/api.ts),
// and of the codes the leave endpoints raise only this one means "nothing was
// written, ask again": lockLeaveUser throws it when its 5s lock_timeout fires
// because the bulk bar (mapLimit, concurrency 4) or another admin is holding
// that employee's advisory lock. Its message ends in "Riprova tra qualche
// istante", and riprova has to mean retrying THE SAME THING — an admin who
// stepped Dalle to 14:00 so that only the afternoon fascia is booked must find
// 14:00 still on screen.
//
// Every other refusal is the server disagreeing about the STATE of the day —
// LEAVE_OVERLAP, the per-day capacity VALIDATION, a membership that is gone —
// and a window tuned against the state it disagrees with is not worth keeping.
const RETRYABLE_CONFLICT_CODES = new Set(['LEAVE_LOCK_TIMEOUT']);

function isRetryableConflict(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const { code } = e as ApiError;
  return code !== undefined && RETRYABLE_CONFLICT_CODES.has(code);
}

function fmtMins(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

type TFn = (key: string, options?: Record<string, unknown>) => string;

// Stable identity of a computed anomaly (there is no server id): user + day +
// kind. Used as the React key and as the selection key for bulk operations.
function keyOf(a: Anomaly): string {
  return `${a.user_id}|${a.date}|${a.kind}`;
}

// The unit a day-level correction actually acts on. One working day can raise
// several anomalies (the backend pushes e.g. 'early_clock_out' and
// 'short_hours' independently), but ferie/permesso/timbratura standard all
// describe THAT DAY, not that single deviation.
function dayKeyOf(a: Anomaly): string {
  return `${a.user_id}|${a.date}`;
}

// One anomaly per (user, day), picked by DAY_LEVEL_KINDS. Every field a
// day-level correction reads — expected_start_at/expected_end_at and the
// actual anchors — is built from the same day of stamps for every kind, so the
// representative only changes the PROPOSED WINDOW (proposeGap), never the
// target day or the punches inserted.
function collapseByDay(items: Anomaly[]): Anomaly[] {
  const best = new Map<string, Anomaly>();
  for (const a of items) {
    const k = dayKeyOf(a);
    const cur = best.get(k);
    if (!cur || dayLevelRank(a.kind) < dayLevelRank(cur.kind)) best.set(k, a);
  }
  return [...best.values()];
}

// The rows a bulk action actually POSTs.
//
// Everything except 'note' is a DAY-level correction and must run ONCE per
// (user, day). Time System, agosto 2026: a day that had raised both
// 'early_clock_out' and 'short_hours' was selected whole and corrected with
// "inserisci ferie"; the bar fired one POST /leaves/admin-create per selected
// row, in parallel, so two identical 8h ferie rows landed on the same day —
// 16h of ferie in the payroll export and a double bite out of the residuo (the
// server-side per-day cap read the pre-insert state in both transactions and
// let them through). 'ferie' uses the whole scheduled day
// (expected_start_at → expected_end_at) and 'standard' inserts the day's
// missing punches, so in both cases the second row is a pure duplicate.
//
// 'note' is the exception and stays per-row: a justification is stored per
// (user, date, kind), so collapsing it would leave the day's other kinds
// unjustified.
//
// ferie/permesso go one step further than collapsing: they are computed from
// the GIORNATA, which may well include rows the admin never selected (they
// ticked the pausa row; the hole is described by 'late_clock_in'). Collapsing
// the selection alone would hand 'permesso' a pausa row and propose the whole
// scheduled day.
//
// Day-scoped and not selection-scoped on purpose. Ticking only the
// 'short_hours' row of a day that also came in late still books that day's
// leading hole, because the end-anchored shortfall 'short_hours' would propose
// on its own covers hours that were worked. The bar says as much before the
// click ("la finestra è calcolata per ogni giornata"); fine-tuning one row's
// own window stays in the per-row Correggi panel.
interface BulkTarget {
  a: Anomaly;
  // 'permesso' only: the window computed for that giornata.
  gap: { from: string; to: string } | null;
}

function bulkTargets(
  action: CorrectionAction,
  items: Anomaly[],
  days: Map<string, DayCorrection>
): BulkTarget[] {
  if (action === 'note') return items.map((a) => ({ a, gap: null }));
  if (action === 'ferie' || action === 'permesso') {
    const byDay = new Map<string, BulkTarget>();
    for (const a of items) {
      const k = dayKeyOf(a);
      const day = days.get(k);
      // A day with no gap row cannot take a day-level absence at all, and a
      // split day cannot take one permesso. Skipping it here is the PRIMARY
      // mechanism, not a safety net: bulkActions offers ferie/permesso as soon
      // as one giornata supports them, and the bar reports the skipped count
      // before the click rather than withholding the action from the rest.
      if (!day) continue;
      if (action === 'permesso') {
        if (!day.gap) continue;
        byDay.set(k, { a: day.gapSource ?? day.schedule, gap: day.gap });
      } else {
        byDay.set(k, { a: day.schedule, gap: null });
      }
    }
    return [...byDay.values()];
  }
  return collapseByDay(items).map((a) => ({ a, gap: null }));
}

// Single source of truth for applying one correction to one anomaly. Both the
// per-row Correggi panel and the bulk bar call this, so the two paths never
// diverge. The payload is always derived from the anomaly's own fields.
async function applyCorrection(
  action: CorrectionAction,
  a: Anomaly,
  opts: { note?: string; pFrom?: string | null; pTo?: string | null; t: TFn }
): Promise<void> {
  const { t } = opts;
  const note = (opts.note ?? '').trim();
  if (action === 'standard') {
    const toAdd = missingEvents(a);
    if (toAdd.length === 0) throw new Error(t('errors.noMissingStamp'));
    await api('/api/v1/admin/stamps/fix-anomaly', {
      method: 'POST',
      json: {
        user_id: a.user_id,
        events: toAdd,
        justification: t('justificationStandard', { kind: t(`common:anomaly.${a.kind}`) }),
      },
    });
  } else if (action === 'ferie') {
    await api('/api/v1/leaves/admin-create', {
      method: 'POST',
      json: {
        user_id: a.user_id,
        type: 'ferie',
        from_ts: a.expected_start_at,
        to_ts: a.expected_end_at,
        user_note: note || undefined,
      },
    });
  } else if (action === 'permesso') {
    if (!opts.pFrom || !opts.pTo) throw new Error(t('errors.invalidPermWindow'));
    // One permesso per scheduled fascia inside the window, in ONE request. On a
    // single-fascia schedule that is a set of one with the window unchanged; on
    // an orario spezzato it is one row per fascia, and the unpaid gap between
    // them is charged to nobody. Both the per-row panel and the bulk bar land
    // here, so the two paths cannot diverge on what a window means — nor on how
    // many requests it costs.
    const parts = permessoParts(a, opts.pFrom, opts.pTo);
    if (parts.length === 0) throw new Error(t('errors.permMinDuration'));
    // POST /leaves/admin-create-day, not a loop over /admin-create: the whole
    // set is judged together under one advisory lock and written all-or-nothing,
    // with a single notification to the employee.
    //
    // The loop this replaced posted the fasce one at a time and each call read
    // the day's remaining capacity as it found it. Time System, 20/08/2026: a
    // giornata on 09:00–13:00 + 14:00–18:00 already carrying a one-hour
    // permesso, corrected with 4h + 4h — nine hours against an eight-hour day.
    // The morning fascia committed, the afternoon one was refused by the per-day
    // cap, and the day was left half-booked: half a permesso in the payroll, an
    // "assenza inserita" notification already sent, and a re-run refused as an
    // overlap on the fascia that HAD landed. The set is now accepted or refused
    // as one answer.
    await api('/api/v1/leaves/admin-create-day', {
      method: 'POST',
      json: {
        user_id: a.user_id,
        type: 'permessi',
        windows: parts.map((p) => ({ from_ts: p.from, to_ts: p.to })),
        user_note: note || undefined,
      },
    });
  } else {
    if (note.length < 1) throw new Error(t('errors.noteRequired'));
    await api('/api/v1/shifts/anomalies/justify', {
      method: 'POST',
      json: { user_id: a.user_id, date: a.date, kind: a.kind, note },
    });
  }
}

// The order the dropdown lists actions in, shared by the per-row panel and the
// bar so 'ferie' can never sort ahead of 'standard' in one and not the other.
const ACTION_ORDER: CorrectionAction[] = ['standard', 'ferie', 'permesso', 'note'];

// The two DAY-level absences. bulkTargets can drop a giornata from these
// cleanly (it simply emits no target for it), which is what lets the bar offer
// them on a partial selection — see bulkActions.
const DAY_ABSENCE_ACTIONS: CorrectionAction[] = ['ferie', 'permesso'];

// Actions offered for a bulk selection.
//
// 'standard' and 'note' are an INTERSECTION: they are properties of the row
// itself, and applyCorrection throws for a row that has nothing to add, so
// offering them on a partial selection would just manufacture failures.
//
// 'ferie' and 'permesso' are a UNION, and this is the fix to a defect that made
// the page unusable a month at a time: they are per-GIORNATA corrections that
// bulkTargets already skips a day for when the day cannot take them. Requiring
// every day to support them meant ONE absent Tuesday — or one lunch-only
// Friday — silently stripped "Inserisci permesso" from the other twenty-one
// days selected with it, with nothing on screen saying which day was to blame.
// They are now offered when at least one giornata supports them, and the bar
// states, before the click, how many are skipped (bulk.skippedNotice).
//
// Callers pass the COLLAPSED rows (see bulkTargets): a day-level action runs
// once per giornata, so it is the representative of each day that is judged.
function bulkActions(items: Anomaly[], days: Map<string, DayCorrection>): CorrectionAction[] {
  if (items.length === 0) return [];
  let every: CorrectionAction[] | null = null;
  const some = new Set<CorrectionAction>();
  for (const a of items) {
    const avail = bulkDayActions(a, days.get(dayKeyOf(a)));
    every = every === null ? avail : every.filter((x) => avail.includes(x));
    for (const x of avail) some.add(x);
  }
  const all = new Set(every ?? []);
  return ACTION_ORDER.filter((x) => (DAY_ABSENCE_ACTIONS.includes(x) ? some.has(x) : all.has(x)));
}

// Which action the BULK bar opens on: defaultActionFor()'s rule, applied to the
// selection as a whole.
//
// The bar used to preselect actions[0] regardless. Once ferie/permesso became
// available from ANY row of a day with unworked time, that meant ticking five
// 'lunch_too_short' rows — the very thing bulk.hint tells the admin to do —
// opened the bar on "Inserisci ferie" with Correggi already enabled: one click
// away from five whole days of ferie off the residuo and five "assenza
// inserita" notifications. A day-level absence is only preselected when EVERY
// giornata the bar will act on is represented by a row that describes unworked
// time itself.
function bulkDefaultAction(reps: Anomaly[], actions: CorrectionAction[]): CorrectionAction {
  if (actions.length === 0) return 'note';
  const everyRowIsDayLevel =
    reps.length > 0 && reps.every((a) => dayLevelRank(a.kind) < DAY_LEVEL_KINDS.length);
  if (everyRowIsDayLevel) return actions[0] ?? 'note';
  return actions.includes('standard') ? 'standard' : 'note';
}

// availableActions() judged per GIORNATA rather than per row, which is the unit
// the bar actually applies.
//
// The difference that matters is 'permesso' on a split day, and it is now the
// ONLY one: the per-row panel offers it on the 'late_clock_in' and
// 'early_clock_out' rows — the two that say where their own half of the day is
// — but the bar cannot, because it sends one correction per giornata and would
// have to choose a half. Such a day is skipped by bulkTargets and counted in
// bulk.permessoSplitDays, which says why and where to go instead; it no longer
// removes the action from the days around it.
//
// Every other row of that day agrees with the bar and offers no permesso,
// 'short_hours' included (see isPositionedGapRow). Judging the day by day.gap
// here and the row by rowWindow() there is what keeps the two in step: both
// read the same DayCorrection.
function bulkDayActions(rep: Anomaly, day: DayCorrection | undefined): CorrectionAction[] {
  const acts: CorrectionAction[] = [];
  if (missingEvents(rep).length > 0) acts.push('standard');
  if (day) {
    acts.push('ferie');
    if (day.gap) acts.push('permesso');
  }
  acts.push('note');
  return acts;
}

// Run fn over items with bounded concurrency; never rejects (per-item outcome
// captured like Promise.allSettled) so the bulk bar can report which rows failed.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (x: T, i: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      const item = items[i]!;
      try {
        results[i] = { status: 'fulfilled', value: await fn(item, i) };
      } catch (e) {
        results[i] = { status: 'rejected', reason: e };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function AnomalyItem({
  a,
  day,
  unbookable,
  selected,
  onToggle,
  onDone,
}: {
  a: Anomaly;
  // What this row's giornata can take (see buildDays); undefined when the day
  // has no unworked time to book an absence against.
  day: DayCorrection | undefined;
  // Set when the GIORNATA describes unworked time and can still take no absence
  // at all (buildUnbookableDays): the minutes left over, to name in the panel.
  // A property of the day, so every row of it explains itself — the pausa row
  // lost the same two actions as the missing-entrata row next to it.
  unbookable: TimeWindow[] | undefined;
  selected: boolean;
  onToggle: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(['anomalies', 'common']);
  const actions = useMemo(() => availableActions(a, day), [a, day]);
  // True when this row's own punches say WHERE its unworked stretch is. It then
  // keeps its own proposal and needs none of the "this covers the giornata" copy
  // below. Everything else borrows the day's — a pausa / fuori area / giorno di
  // riposo row, 'short_hours', which only knows how much is missing, and a
  // missing entrata/uscita, whose absent punch is the very anchor it would need.
  const ownWindow = useMemo(() => isPositionedGapRow(a), [a]);
  const gap0 = useMemo(() => rowWindow(a, day), [a, day]);
  const slivers = unbookable ?? [];
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<CorrectionAction>(defaultActionFor(a, actions));
  // The window the admin STEPPED to, tagged with the proposal it was stepped
  // from. Never the source of truth on its own: the two ends below fall back to
  // the current proposal the moment that tag stops matching, which is what
  // makes an open panel unable to outlive the anomaly it was derived from. A
  // tag that comes back — the giornata reverted to the state it was tuned
  // against — brings the tuning with it, which is the same answer the admin
  // gave to the same question.
  //
  // Plain derivation rather than an effect: no render can show one window and
  // book another, not even for the frame before an effect would have run.
  const [tuned, setTuned] = useState<{ seed: string; from: string; to: string } | null>(null);
  const seed = useMemo(() => permSeed(a, day), [a, day]);
  const fresh = tuned?.seed === seed ? tuned : null;
  const pFrom = fresh ? fresh.from : (gap0?.from ?? null);
  const pTo = fresh ? fresh.to : (gap0?.to ?? null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dossier, setDossier] = useState(false);

  // A correction elsewhere on the same giornata can change what this row is
  // allowed to do (its neighbour's 'short_hours' gets justified, the day's gap
  // is filled). Keep the chosen action valid, the way the bulk bar does.
  useEffect(() => {
    if (!actions.includes(action)) setAction(defaultActionFor(a, actions));
  }, [a, actions, action]);

  const toAdd = useMemo(() => missingEvents(a), [a]);
  // What the window will actually book, fascia by fascia — the same pieces
  // applyCorrection posts. On an orario spezzato this is shorter than
  // pTo − pFrom, which is the whole point: the unpaid gap is not absence.
  const permTarget = useMemo(() => correctionTarget('permesso', a, day), [a, day]);
  const permParts = useMemo(
    () => (pFrom && pTo ? permessoParts(permTarget, pFrom, pTo) : []),
    [permTarget, pFrom, pTo]
  );
  const permMin = permessoMinutes(permTarget, pFrom, pTo);

  // Where a step would land, or null when it is refused. One function behind
  // both the disabled state of the button and the step it applies, so a live
  // button always moves and a dead one always says so.
  function steppedTo(which: 'from' | 'to', dir: -1 | 1): string | null {
    const cur = which === 'from' ? pFrom : pTo;
    if (!cur) return null;
    const next = nextPermInstant(permTarget, new Date(cur).getTime(), which, dir);
    if (next === null) return null;
    // The ends may not cross, nor meet: a permesso is at least one quarter of an
    // hour, and the recap must never show a window the booking would refuse.
    const other = which === 'from' ? pTo : pFrom;
    if (other) {
      const o = new Date(other).getTime();
      if (which === 'from' ? next >= o : next <= o) return null;
    }
    return new Date(next).toISOString();
  }
  function stepPerm(which: 'from' | 'to', dir: -1 | 1) {
    const next = steppedTo(which, dir);
    // steppedTo already refuses a step whose own end is unset, and the two ends
    // are seeded and cleared together, so both are non-null whenever a step
    // lands. The guard is what says so to the type checker.
    if (!next || !pFrom || !pTo) return;
    setTuned({
      seed,
      from: which === 'from' ? next : pFrom,
      to: which === 'to' ? next : pTo,
    });
  }

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      await applyCorrection(action, correctionTarget(action, a, day), {
        note,
        pFrom,
        pTo,
        t,
      });
      setOpen(false);
      setNote('');
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
      // A retryable conflict wrote nothing and disagreed about nothing: another
      // operation simply held the employee's lock (see isRetryableConflict).
      // Leave the panel exactly as it is — the tuned window included — so the
      // "Riprova tra qualche istante" the message asks for means sending the
      // same request again. Refetching here would spend a request to learn
      // nothing, and the giornata is about to move anyway under whoever holds
      // the lock; the seed picks that up on the next load.
      if (isRetryableConflict(e)) return;
      // Everything else is the server disagreeing about the state of the day,
      // so the admin's next move must be judged against the real state rather
      // than against the window still on screen. The refetch re-seeds it: the
      // rows come back with a new proposal, the seed changes, and the tuning
      // computed against the refused state is dropped.
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-t border-neutral-100 first:border-t-0 pt-2 first:pt-0">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 shrink-0"
          checked={selected}
          onChange={onToggle}
          aria-label={t('bulk.selectRow')}
        />
        <span
          className="badge"
          style={{ background: KIND_COLOR[a.kind] + '22', color: KIND_COLOR[a.kind] }}
        >
          {t(`common:anomaly.${a.kind}`)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{a.user_display_name || a.user_email}</div>
          <div className="text-xs muted">
            {t('row.scheduleLabel')} {a.shift_template_name ?? '—'} · {t('row.expected')}{' '}
            {fmtTime(a.expected_start_at)}–{fmtTime(a.expected_end_at)} · {t('row.actual')}{' '}
            {fmtTime(a.actual_start_at)}–{fmtTime(a.actual_end_at)}
            {a.delta_minutes !== null && ` · ${t('row.deltaShort', { minutes: a.delta_minutes })}`}
            {a.break_total_min !== null && ` · ${t('row.breakShort', { minutes: a.break_total_min })}`}
          </div>
          {a.details && <div className="text-xs muted mt-0.5">{a.details}</div>}
          {a.justification_note && (
            <div
              className="text-xs mt-1 rounded-md px-2 py-1"
              style={{ background: 'var(--color-success-tint)', color: 'var(--color-success)' }}
            >
              {t('row.justified', { note: a.justification_note })}
            </div>
          )}
        </div>
        {/* Correcting an anomaly changes what the payroll will say about that
            day, so the evidence for the day has to be one click away from the
            correction itself — not on another page. */}
        <button
          className="btn btn-secondary btn-sm shrink-0"
          data-testid="anomaly-dossier"
          onClick={() => setDossier(true)}
          title={t('dossier')}
        >
          {t('dossier')}
        </button>
        <button
          className="btn btn-secondary btn-sm shrink-0"
          onClick={() => {
            // Every opening starts from the CURRENT proposal: dropping the
            // tuning is enough, since the two ends are derived from it. (A
            // reload while the panel is open is handled by the seed itself, not
            // here — that is the case this branch could never see.)
            if (!open) {
              setTuned(null);
              setErr(null);
            }
            setOpen((o) => !o);
          }}
          aria-expanded={open}
        >
          {open ? t('common:btn.close') : t('correct')}
        </button>
      </div>

      {dossier && (
        <DayDossierModal userId={a.user_id} date={a.date} onClose={() => setDossier(false)} />
      )}

      {open && (
        <div
          className="mt-2 rounded-md p-3 space-y-3"
          style={{ background: 'var(--color-surface-variant, #f5f5f4)' }}
        >
          <div>
            <label className="label">{t('action.label')}</label>
            <select
              className="input"
              value={action}
              onChange={(e) => setAction(e.target.value as CorrectionAction)}
            >
              {actions.map((act) => (
                <option key={act} value={act}>
                  {t(ACTION_LABEL_KEY[act])}
                </option>
              ))}
            </select>
          </div>

          {/* The giornata has unworked time and can take neither absence: what
              is left of it is shorter than the quarter of an hour a leave must
              be a multiple of. Both entries are missing from the list above, and
              without this the admin sees a day that offered them yesterday and
              offers nothing today. Name the leftovers and point at the orario
              they come from — a fascia ending at 13:20 leaves five minutes
              nobody can book, every single day.

              Shown on EVERY row of such a giornata, pausa and uscita fuori area
              included: they lost the same two actions, from the same cause.

              The way out is read off `actions`, never assumed. "Timbratura
              standard" is offered only where a punch is ABSENT, and a day can be
              unbookable with both punches present — a single fascia 09:00–17:40
              with tolleranza in uscita 0 is exactly that — so naming it there
              would send the admin to a menu entry that is not in the menu. */}
          {unbookable !== undefined && (
            <div className="text-xs muted" data-testid="perm-unbookable-hint">
              <Trans t={t} i18nKey="recap.noBookableWindow" components={{ strong: <strong /> }} />{' '}
              {t(
                actions.includes('standard')
                  ? 'recap.noBookableWindowFixStamps'
                  : 'recap.noBookableWindowFixNote'
              )}
              {slivers.length > 0 && (
                <>
                  {' '}
                  <Trans
                    t={t}
                    i18nKey="recap.noBookableWindowLeft"
                    values={{
                      windows: slivers.map((w) => `${fmtTime(w.from)}–${fmtTime(w.to)}`).join(' · '),
                    }}
                    components={{ strong: <strong /> }}
                  />
                </>
              )}
            </div>
          )}

          {/* "Inserisci permesso" is simply absent from the list above on a
              split day, which on its own reads as "the product won't let me".
              Say why, and where the two permessi are inserted from.
              Shown on the 'short_hours' row too: it borrows the day's window
              like a pausa row, so on a split day it has none either — and it is
              the row the admin most often opens, since its delta is the day's
              whole shortfall. The two rows the copy points at are exactly the
              ones that DO keep a window (day.split.leading/trailing). */}
          {!ownWindow && day?.split && (
            <div className="text-xs muted" data-testid="perm-split-hint">
              <Trans
                t={t}
                i18nKey="recap.permSplitDay"
                values={{
                  leading: t(`common:anomaly.${day.split.leading.kind}`),
                  trailing: t(`common:anomaly.${day.split.trailing.kind}`),
                }}
                components={{ strong: <strong /> }}
              />
            </div>
          )}

          {/* Recap of what will change */}
          {action === 'standard' && (
            <div className="text-sm">
              <div className="muted text-xs font-semibold uppercase tracking-wide mb-1">
                {t('recap.title')}
              </div>
              {toAdd.length === 0 ? (
                <div className="muted">{t('recap.noMissingStamp')}</div>
              ) : (
                <ul className="space-y-0.5">
                  {toAdd.map((ev) => (
                    <li key={ev.event_type}>
                      <Trans
                        t={t}
                        i18nKey="recap.addsEvent"
                        values={{
                          event: t(`common:stampEvent.${ev.event_type}`),
                          time: fmtTime(ev.occurred_at),
                        }}
                        components={{ strong: <strong /> }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {action === 'ferie' && (
            <div className="text-sm space-y-2">
              <div className="muted text-xs font-semibold uppercase tracking-wide">{t('recap.title')}</div>
              <div>
                <Trans
                  t={t}
                  i18nKey="recap.ferieFor"
                  values={{
                    date: fmtDate(a.date),
                    // The day's schedule, not the clicked row's: an out-of-area
                    // row carries no expected_* at all.
                    from: fmtTime((day ? day.schedule : a).expected_start_at),
                    to: fmtTime((day ? day.schedule : a).expected_end_at),
                  }}
                  components={{ strong: <strong /> }}
                />
              </div>
              {/* Opened from a row that reaches ferie only through the giornata
                  — pausa, fuori area, and 'short_hours', whose delta is a
                  shortfall and not a whole day: say that the booking covers the
                  entire working day before it is confirmed. */}
              {!ownWindow && day && (
                <div className="text-xs muted" data-testid="ferie-day-scope">
                  {t('recap.ferieDayScope')}
                </div>
              )}
              <NoteField value={note} onChange={setNote} optional />
            </div>
          )}

          {action === 'permesso' && (
            <div className="text-sm space-y-2">
              <div className="muted text-xs font-semibold uppercase tracking-wide">{t('recap.title')}</div>
              <div className="flex flex-wrap items-center gap-4">
                {/* Clamped to the fasce: a step that would land outside the
                    scheduled hours jumps the unpaid gap whole, and the outer
                    edges of the schedule disable the button rather than moving
                    the window somewhere the booking would clip back. */}
                <TimeStepper
                  testId="perm-from"
                  label={t('recap.permFrom')}
                  value={pFrom}
                  onStep={(d) => stepPerm('from', d)}
                  canStep={(d) => steppedTo('from', d) !== null}
                />
                <TimeStepper
                  testId="perm-to"
                  label={t('recap.permTo')}
                  value={pTo}
                  onStep={(d) => stepPerm('to', d)}
                  canStep={(d) => steppedTo('to', d) !== null}
                />
                <div>
                  <div className="label">{t('recap.duration')}</div>
                  <div className="font-medium" data-testid="perm-duration">
                    {permMin > 0 ? fmtMins(permMin) : '—'}
                  </div>
                </div>
              </div>
              {/* Orario spezzato: the window crosses the unpaid gap between two
                  fasce, so it is booked as one permesso per fascia and the gap
                  is charged to nobody. Without this line the duration above —
                  5h on a 12:00–18:00 window — reads as an arithmetic error.
                  Since the stepper is clamped to the fasce, Dalle and Alle are
                  the first part's start and the last part's end: the duration
                  differs from the span if and only if there is more than one
                  part, which is exactly when this line is on screen. */}
              {permParts.length > 1 && (
                <div className="text-xs muted" data-testid="perm-split-shift">
                  <Trans
                    t={t}
                    i18nKey="recap.permSplitShift"
                    values={{
                      windows: permParts
                        .map((w) => `${fmtTime(w.from)}–${fmtTime(w.to)}`)
                        .join(' · '),
                    }}
                    components={{ strong: <strong /> }}
                  />
                </div>
              )}
              {/* Without this line "dalle 14:45 alle 17:00" on a 'pausa pranzo
                  troppo breve' row reads as the length of the lunch break — and
                  on an 'ore giornaliere insufficienti' row, as the shortfall.
                  Suppressed when the giornata read its window off THIS very row
                  (a day whose only gap row is 'short_hours'): naming the row
                  back to itself explains nothing. */}
              {!ownWindow && day?.gapSource && keyOf(day.gapSource) !== keyOf(a) && (
                <div className="text-xs muted" data-testid="perm-day-scope">
                  <Trans
                    t={t}
                    i18nKey="recap.permDayScope"
                    values={{
                      date: fmtDate(a.date),
                      kind: t(`common:anomaly.${day.gapSource.kind}`),
                    }}
                    components={{ strong: <strong /> }}
                  />
                </div>
              )}
              <NoteField value={note} onChange={setNote} optional />
            </div>
          )}

          {action === 'note' && (
            <div className="text-sm space-y-1">
              <div className="muted text-xs font-semibold uppercase tracking-wide">
                {t('noteSection.title')}
              </div>
              <NoteField value={note} onChange={setNote} />
              <div className="text-xs muted">
                {t('noteSection.hint')}
              </div>
            </div>
          )}

          {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" onClick={confirm} disabled={busy}>
              {busy ? t('common:state.saving') : t('common:btn.confirm')}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              {t('common:btn.cancel')}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/* ------------------------- Bulk correction bar ------------------------- */

function BulkCorrectBar({
  items,
  days,
  unbookable,
  onDone,
  onClear,
}: {
  items: Anomaly[];
  days: Map<string, DayCorrection>;
  // Giornate that describe unworked time and can take no absence at all, the
  // same map the per-row panels read (buildUnbookableDays). The bar used to
  // re-derive this per ROW and reached a different answer on the days whose
  // rows are not day-level kinds.
  unbookable: Map<string, TimeWindow[]>;
  onDone: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation(['anomalies', 'common']);
  // One row per giornata: what a day-level action is applied to, and what the
  // offered actions have to be valid for.
  const collapsed = useMemo(() => collapseByDay(items), [items]);
  const actions = useMemo(() => bulkActions(collapsed, days), [collapsed, days]);
  const [action, setAction] = useState<CorrectionAction>(() =>
    bulkDefaultAction(collapsed, actions)
  );
  const [note, setNote] = useState('');
  // Bulk 'ferie' is the one action here that spends something irreversible —
  // whole days off the residuo, one notification per employee — and it is also
  // the one the dropdown can preselect. It gets an explicit acknowledgement of
  // how many days that is.
  const [ferieAck, setFerieAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: number;
    failed: { name: string; date: string; reason: string }[];
    // Snapshotted at apply time: on success the selection is cleared, so the
    // recap can no longer be recomputed from `items`.
    selected: number;
    days: number;
  } | null>(null);

  const targets = useMemo(() => bulkTargets(action, items, days), [action, items, days]);
  // Giornate in the selection that are un-worked at both ends with worked hours
  // in between, and therefore cannot take a single day-level permesso. Shown
  // while 'permesso' is chosen: they are the giornate the bar will skip.
  const splitDays = useMemo(() => {
    const k = new Set<string>();
    for (const a of items) if (days.get(dayKeyOf(a))?.split) k.add(dayKeyOf(a));
    return k.size;
  }, [items, days]);
  // Distinct giornate in the selection. The two counts below both hang off it
  // and mean different things, which is why targets.length can no longer stand
  // in for either: rows MERGE into a giornata, and giornate are SKIPPED.
  const selectedDays = useMemo(() => new Set(items.map(dayKeyOf)).size, [items]);
  // Giornate that describe unworked time and can still take no absence at all,
  // because what is left of them holds no bookable quarter. Counted straight
  // off the map the per-row panels read, so the bar and the panel agree on
  // which days those are whatever kind of row the admin happened to tick.
  // They are already inside skippedDays — or, when they are the whole selection,
  // they are why ferie/permesso are missing from the dropdown entirely. Either
  // way the count alone does not say WHY, and this is the same explanation the
  // per-row panel gives.
  const unbookableDays = useMemo(() => {
    const k = new Set<string>();
    for (const a of items) if (unbookable.has(dayKeyOf(a))) k.add(dayKeyOf(a));
    return k.size;
  }, [items, unbookable]);
  // Giornate the bar will book as SEVERAL permessi — one per fascia — because
  // their window crosses the unpaid gap of an orario spezzato. Counted from the
  // same targets the bar will POST, so the number cannot drift from what
  // applyCorrection does with them.
  const splitShiftDays = useMemo(
    () =>
      action === 'permesso'
        ? targets.filter((x) => x.gap && permessoParts(x.a, x.gap.from, x.gap.to).length > 1).length
        : 0,
    [action, targets]
  );
  const perDay = action !== 'note';
  // >0 only when several anomalies of the same giornata were selected and the
  // action is day-level. The admin has to see it BEFORE confirming: they
  // selected N rows and only M corrections will be sent.
  const mergedCount = perDay ? items.length - selectedDays : 0;
  // Giornate the chosen action cannot be applied to (no unworked time at all,
  // or — for 'permesso' — un-worked at both ends). Reported, not silently
  // dropped, and never a reason to withhold the action from the other days.
  const skippedDays = perDay ? selectedDays - targets.length : 0;

  // Keep the chosen action valid as the selection (and what it offers) changes.
  useEffect(() => {
    if (!actions.includes(action)) setAction(bulkDefaultAction(collapsed, actions));
  }, [collapsed, actions, action]);

  // Re-arm the confirmation whenever what it confirms changes: another action,
  // another selection, or a refetch that moved the giornate under it.
  useEffect(() => {
    setFerieAck(false);
  }, [action, items]);

  const needsNote = action === 'note';
  const noteEmpty = note.trim().length === 0;
  const needsFerieAck = action === 'ferie' && !ferieAck;

  async function apply() {
    setBusy(true);
    setResult(null);
    const rows = targets;
    // Per-giornata window, never a shared one, and computed by bulkTargets
    // from the day's whole anomaly set — not re-derived here from whichever row
    // ended up representing the day. That re-derivation is what booked
    // 16:30–18:00 on a day whose hole was 09:00–10:30.
    //
    // One applyCorrection call per giornata, and applyCorrection is one request
    // per giornata: a split-shift day either gets both its fasce or neither, and
    // a failure here can no longer leave a day half-booked in the middle of a
    // month-long selection. The bar and the per-row panel share that guarantee
    // because they share this function — an invariant, not a coincidence.
    const res = await mapLimit(rows, 4, (x) =>
      applyCorrection(action, x.a, {
        note,
        pFrom: x.gap?.from ?? null,
        pTo: x.gap?.to ?? null,
        t,
      })
    );
    const ok = res.filter((r) => r.status === 'fulfilled').length;
    const failed = res
      .map((r, i) => ({ r, a: rows[i]!.a }))
      .filter((x) => x.r.status === 'rejected')
      .map((x) => {
        const reason = (x.r as PromiseRejectedResult).reason;
        return {
          name: x.a.user_display_name || x.a.user_email,
          date: x.a.date,
          reason: reason instanceof Error ? reason.message : String(reason),
        };
      });
    setBusy(false);
    setResult({ ok, failed, selected: items.length, days: rows.length });
    setNote('');
    onDone();
    if (failed.length === 0) onClear();
  }

  return (
    <div
      className="sticky bottom-0 z-10 card shadow-lg space-y-3"
      style={{ borderColor: 'var(--color-primary)' }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="font-medium">{t('bulk.selected', { n: items.length })}</div>
        <div>
          <label className="label">{t('action.label')}</label>
          <select
            className="input"
            value={action}
            onChange={(e) => setAction(e.target.value as CorrectionAction)}
          >
            {actions.map((act) => (
              <option key={act} value={act}>
                {t(ACTION_LABEL_KEY[act])}
              </option>
            ))}
          </select>
        </div>
        {(action === 'ferie' || action === 'permesso' || action === 'note') && (
          <div className="flex-1 min-w-[12rem]">
            <label className="label">{t('noteSection.title')}</label>
            <input
              className="input"
              maxLength={1000}
              placeholder={
                needsNote ? t('noteField.placeholder') : t('noteField.optionalPlaceholder')
              }
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}
        <button
          className="btn btn-primary"
          onClick={() => {
            apply().catch(() => {});
          }}
          disabled={
            busy ||
            actions.length === 0 ||
            targets.length === 0 ||
            (needsNote && noteEmpty) ||
            needsFerieAck
          }
        >
          {busy
            ? t('common:state.saving')
            : perDay && targets.length !== items.length
              ? t('bulk.applyDays', { n: items.length, days: targets.length })
              : t('bulk.apply', { n: items.length })}
        </button>
        <button className="btn btn-secondary" onClick={onClear} disabled={busy}>
          {t('bulk.clear')}
        </button>
      </div>

      {/* Full-day ferie is the one bulk action that spends a quota and notifies
          the employee, and the only one the dropdown may open on. Name the
          number of whole days before the click can send them. */}
      {action === 'ferie' && (
        <label
          className="text-xs flex items-start gap-2 cursor-pointer"
          data-testid="bulk-ferie-ack"
          style={{ color: 'var(--color-primary)' }}
        >
          <input
            type="checkbox"
            className="mt-0.5 shrink-0"
            checked={ferieAck}
            onChange={(e) => setFerieAck(e.target.checked)}
          />
          <span>{t('bulk.ferieConfirm', { count: targets.length })}</span>
        </label>
      )}

      {/* Say it before the click, not only in the recap: the admin selected N
          rows and is about to send M corrections. */}
      {mergedCount > 0 && (
        <div className="text-xs" data-testid="bulk-merged-notice" style={{ color: 'var(--color-primary)' }}>
          {t('bulk.mergedNotice', { n: items.length, days: selectedDays })}
        </div>
      )}

      {/* The other half of "apply where the day supports it": the giornate this
          action will pass over, counted before the click instead of the action
          quietly vanishing from the dropdown. */}
      {skippedDays > 0 && (
        <div className="text-xs" data-testid="bulk-skipped-notice" style={{ color: 'var(--color-primary)' }}>
          {t('bulk.skippedNotice', {
            count: skippedDays,
            total: selectedDays,
            applied: targets.length,
          })}
        </div>
      )}

      {/* Giornate whose unworked time no absence can cover. Shown whatever the
          chosen action, because it is also the reason ferie and permesso may be
          missing from the dropdown above — the one case where the skip counter
          cannot appear at all. */}
      {unbookableDays > 0 && (
        <div className="text-xs" data-testid="bulk-unbookable" style={{ color: 'var(--color-primary)' }}>
          {t('bulk.unbookableDays', { count: unbookableDays })}
        </div>
      )}

      {/* No shared time-window editor here on purpose: the window is derived
          per giornata. Fine-tuning stays in the single-row Correggi panel. */}
      {action === 'permesso' && (
        <div className="text-xs muted" data-testid="bulk-permesso-hint">
          {t('bulk.permessoPerDay')}
        </div>
      )}

      {/* Orario spezzato: those giornate are corrected, not skipped, but they
          take more than one permesso each — say so before the click, since the
          result recap counts giornate and the employee's Richieste will show
          two rows for one day. */}
      {action === 'permesso' && splitShiftDays > 0 && (
        <div className="text-xs muted" data-testid="bulk-permesso-split-shift">
          {t('bulk.permessoSplitShift', { count: splitShiftDays })}
        </div>
      )}

      {/* WHICH giornate the skip notice above is counting, when 'permesso' is
          the action: the ones un-worked at both ends. Without it the admin sees
          a skip count and has no way to find the two rows that can take it. */}
      {action === 'permesso' && splitDays > 0 && (
        <div className="text-xs" data-testid="bulk-permesso-split" style={{ color: 'var(--color-primary)' }}>
          {t('bulk.permessoSplitDays', { count: splitDays })}
        </div>
      )}

      <div className="text-xs muted">{t('bulk.hint')}</div>

      {result && (
        <div className="text-sm space-y-1">
          <div
            style={{
              color: result.failed.length === 0 ? 'var(--color-success)' : 'inherit',
            }}
          >
            {result.selected > result.days
              ? t('bulk.resultDays', {
                  ok: result.ok,
                  fail: result.failed.length,
                  n: result.selected,
                })
              : t('bulk.result', { ok: result.ok, fail: result.failed.length })}
          </div>
          {result.failed.length > 0 && (
            <ul className="space-y-0.5" style={{ color: 'var(--color-error)' }}>
              {result.failed.map((f, i) => (
                <li key={i}>
                  {f.name} · {fmtDate(f.date)} — {f.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TimeStepper({
  label,
  value,
  onStep,
  canStep,
  testId,
}: {
  label: string;
  value: string | null;
  onStep: (dir: -1 | 1) => void;
  testId: string;
  // Which directions still have somewhere to go. The permesso stepper is
  // clamped to the day's fasce, so it runs out of moves at the edges of the
  // schedule — and a button that looks live but does nothing reads as a bug.
  canStep?: (dir: -1 | 1) => boolean;
}) {
  return (
    <div data-testid={testId}>
      <div className="label">{label}</div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onStep(-1)}
          disabled={canStep ? !canStep(-1) : false}
        >
          −
        </button>
        <span className="font-medium min-w-[3.5rem] text-center">{fmtTime(value)}</span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onStep(1)}
          disabled={canStep ? !canStep(1) : false}
        >
          +
        </button>
      </div>
    </div>
  );
}

function NoteField({
  value,
  onChange,
  optional,
}: {
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}) {
  const { t } = useTranslation(['anomalies', 'common']);
  return (
    <textarea
      className="input"
      rows={2}
      maxLength={1000}
      placeholder={optional ? t('noteField.optionalPlaceholder') : t('noteField.placeholder')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
