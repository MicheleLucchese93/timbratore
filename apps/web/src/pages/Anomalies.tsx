import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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
// shortfall, but proposeGap('short_hours') is END-anchored (ee − delta → ee).
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

// Default permesso window = the uncovered part of the scheduled day ("copri il
// gap mancante"), snapped to a 15-minute grid. Admin can fine-tune in the recap.
function proposeGap(a: Anomaly): { from: string; to: string } | null {
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
        from = ee - Math.abs(a.delta_minutes) * 60_000;
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
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
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
// Only 'ferie' is re-targeted, and only to read a schedule: the clicked row can
// be a 'clock_out_out_of_area' whose expected_* are null, which would post
// from_ts: null. Everything else stays on the clicked row — 'standard' inserts
// the punches THAT row reports absent, 'note' is stored per (user, date, kind),
// and 'permesso' carries its window in pFrom/pTo, taking only user_id from the
// row.
function correctionTarget(
  action: CorrectionAction,
  a: Anomaly,
  day: DayCorrection | undefined
): Anomaly {
  return action === 'ferie' && day ? day.schedule : a;
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
    const permMin = Math.round(
      (new Date(opts.pTo).getTime() - new Date(opts.pFrom).getTime()) / 60_000
    );
    if (permMin < 15) throw new Error(t('errors.permMinDuration'));
    await api('/api/v1/leaves/admin-create', {
      method: 'POST',
      json: {
        user_id: a.user_id,
        type: 'permessi',
        from_ts: opts.pFrom,
        to_ts: opts.pTo,
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
  selected,
  onToggle,
  onDone,
}: {
  a: Anomaly;
  // What this row's giornata can take (see buildDays); undefined when the day
  // has no unworked time to book an absence against.
  day: DayCorrection | undefined;
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
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<CorrectionAction>(defaultActionFor(a, actions));
  const [pFrom, setPFrom] = useState<string | null>(gap0?.from ?? null);
  const [pTo, setPTo] = useState<string | null>(gap0?.to ?? null);
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
  const permMin =
    pFrom && pTo
      ? Math.round((new Date(pTo).getTime() - new Date(pFrom).getTime()) / 60_000)
      : 0;

  function stepPerm(which: 'from' | 'to', dir: -1 | 1) {
    const cur = which === 'from' ? pFrom : pTo;
    if (!cur) return;
    const next = new Date(new Date(cur).getTime() + dir * QUARTER_MS).toISOString();
    if (which === 'from') setPFrom(next);
    else setPTo(next);
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
            // Re-seed from the CURRENT proposal on every opening. pFrom/pTo are
            // component state and a reload between two openings can move the
            // giornata's gap under a panel that was never opened — the stepper
            // must not show a window computed against stamps that have changed.
            if (!open) {
              setPFrom(gap0?.from ?? null);
              setPTo(gap0?.to ?? null);
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
                <TimeStepper
                  label={t('recap.permFrom')}
                  value={pFrom}
                  onStep={(d) => stepPerm('from', d)}
                />
                <TimeStepper label={t('recap.permTo')} value={pTo} onStep={(d) => stepPerm('to', d)} />
                <div>
                  <div className="label">{t('recap.duration')}</div>
                  <div className="font-medium">{permMin > 0 ? fmtMins(permMin) : '—'}</div>
                </div>
              </div>
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
  onDone,
  onClear,
}: {
  items: Anomaly[];
  days: Map<string, DayCorrection>;
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

      {/* No shared time-window editor here on purpose: the window is derived
          per giornata. Fine-tuning stays in the single-row Correggi panel. */}
      {action === 'permesso' && (
        <div className="text-xs muted" data-testid="bulk-permesso-hint">
          {t('bulk.permessoPerDay')}
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
}: {
  label: string;
  value: string | null;
  onStep: (dir: -1 | 1) => void;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex items-center gap-1">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStep(-1)}>
          −
        </button>
        <span className="font-medium min-w-[3.5rem] text-center">{fmtTime(value)}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStep(1)}>
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
