import { useEffect, useMemo, useState } from 'react';
import {
  type CalView,
  MONTH_LABELS,
  WEEKDAY_LABELS_SHORT,
  monthGrid,
  monthsOfYear,
  weekDays,
  toISODate,
  addDays,
  addMonths,
  sameDay,
  isWeekend,
  viewTitle,
  leaveCoversDay,
  leaveTypeColor,
  leaveTypeLabel,
  HOLIDAY_COLOR,
  holidayMapForRange,
  holidayName,
} from '@sonoqui/shared';

export interface CalendarEvent {
  id: string;
  type: string; // ferie | permessi | malattia | assenza | chiusura
  status: string;
  from_ts: string;
  to_ts: string;
  user_label?: string | null;
  title?: string | null;
}

// Terminal/negative states never shown on the calendar.
const HIDDEN_STATUS = new Set([
  'rejected',
  'cancelled',
  'cancelled_post_approval',
  'superseded_by_malattia',
]);

function visibleEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter((e) => !HIDDEN_STATUS.has(e.status));
}

function eventLabel(e: CalendarEvent): string {
  return e.title || e.user_label || leaveTypeLabel(e.type);
}

function todayLocal(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function LeaveCalendar({
  events,
  initialView = 'month',
  onRangeChange,
}: {
  events: CalendarEvent[];
  initialView?: CalView;
  /** Fired with the inclusive ISO range the user is looking at, so the parent can fetch. */
  onRangeChange?: (fromISO: string, toISO: string) => void;
}) {
  const [view, setView] = useState<CalView>(initialView);
  const [anchor, setAnchor] = useState<Date>(todayLocal);

  const shown = useMemo(() => visibleEvents(events), [events]);

  // Notify parent of the visible range (year granularity keeps fetches cheap).
  const yearKey = anchor.getFullYear();
  useEffect(() => {
    if (onRangeChange) onRangeChange(`${yearKey}-01-01`, `${yearKey}-12-31`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearKey]);

  function step(dir: -1 | 1) {
    if (view === 'day') setAnchor((a) => addDays(a, dir));
    else if (view === 'week') setAnchor((a) => addDays(a, 7 * dir));
    else if (view === 'month') setAnchor((a) => addMonths(a, dir));
    else setAnchor((a) => new Date(a.getFullYear() + dir, a.getMonth(), 1));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-ghost px-2 py-1" onClick={() => step(-1)} aria-label="Precedente">‹</button>
          <button type="button" className="btn btn-ghost px-2 py-1" onClick={() => setAnchor(todayLocal())}>Oggi</button>
          <button type="button" className="btn btn-ghost px-2 py-1" onClick={() => step(1)} aria-label="Successivo">›</button>
          <span className="ml-2 text-sm font-semibold capitalize">{viewTitle(view, anchor)}</span>
        </div>
        <div className="flex items-center gap-1">
          {(['day', 'week', 'month', 'year'] as CalView[]).map((v) => (
            <button
              key={v}
              type="button"
              className={`px-3 py-1 text-sm rounded border ${view === v ? 'font-semibold' : 'opacity-70'}`}
              style={{ borderColor: view === v ? 'var(--color-primary, #2563eb)' : 'var(--color-border, #e5e7eb)' }}
              onClick={() => setView(v)}
            >
              {v === 'day' ? 'Giorno' : v === 'week' ? 'Settimana' : v === 'month' ? 'Mese' : 'Anno'}
            </button>
          ))}
        </div>
      </div>

      {view === 'month' && <MonthView anchor={anchor} events={shown} onPickDay={(d) => { setAnchor(d); setView('day'); }} />}
      {view === 'week' && <WeekView anchor={anchor} events={shown} onPickDay={(d) => { setAnchor(d); setView('day'); }} />}
      {view === 'day' && <DayView anchor={anchor} events={shown} />}
      {view === 'year' && <YearView anchor={anchor} events={shown} onPickMonth={(d) => { setAnchor(d); setView('month'); }} />}

      <Legend />
    </div>
  );
}

function EventChip({ e, faded }: { e: CalendarEvent; faded?: boolean }) {
  const color = leaveTypeColor(e.type);
  const pending = e.status === 'pending';
  return (
    <div
      title={`${eventLabel(e)} — ${leaveTypeLabel(e.type)}`}
      style={{
        background: pending ? 'transparent' : `${color}22`,
        borderLeft: `3px solid ${color}`,
        color: 'var(--color-on-surface, #111827)',
        opacity: faded ? 0.5 : 1,
        borderStyle: pending ? 'dashed' : 'solid',
        borderWidth: pending ? 1 : 0,
        borderLeftWidth: 3,
        borderLeftStyle: 'solid',
      }}
      className="truncate rounded px-1.5 py-0.5 text-[11px] leading-tight"
    >
      {eventLabel(e)}
    </div>
  );
}

function eventsForDay(events: CalendarEvent[], iso: string): CalendarEvent[] {
  return events.filter((e) => leaveCoversDay(e.from_ts, e.to_ts, iso));
}

function MonthView({
  anchor,
  events,
  onPickDay,
}: {
  anchor: Date;
  events: CalendarEvent[];
  onPickDay: (d: Date) => void;
}) {
  const weeks = monthGrid(anchor.getFullYear(), anchor.getMonth());
  const holidays = holidayMapForRange(toISODate(weeks[0]![0]!), toISODate(weeks[5]![6]!));
  const today = toISODate(todayLocal());
  return (
    <div className="overflow-hidden rounded border" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
      <div className="grid grid-cols-7 text-center text-xs font-medium" style={{ background: 'var(--color-surface-variant, #f3f4f6)' }}>
        {WEEKDAY_LABELS_SHORT.map((w) => (
          <div key={w} className="py-1.5">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((d) => {
          const iso = toISODate(d);
          const inMonth = d.getMonth() === anchor.getMonth();
          const dayEvents = eventsForDay(events, iso);
          const hol = holidays.get(iso);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onPickDay(d)}
              className="min-h-[88px] border-t border-l p-1 text-left align-top"
              style={{
                borderColor: 'var(--color-border, #e5e7eb)',
                background: inMonth ? 'var(--color-surface, #fff)' : 'var(--color-surface-variant, #fafafa)',
                opacity: inMonth ? 1 : 0.55,
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-xs"
                  style={{
                    fontWeight: iso === today ? 700 : 400,
                    color: hol || isWeekend(d) ? HOLIDAY_COLOR : 'inherit',
                  }}
                >
                  {d.getDate()}
                </span>
                {iso === today && <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-primary, #2563eb)' }} />}
              </div>
              {hol && <div className="truncate text-[10px]" style={{ color: HOLIDAY_COLOR }}>{hol}</div>}
              <div className="mt-0.5 space-y-0.5">
                {dayEvents.slice(0, 3).map((e) => (
                  <EventChip key={e.id} e={e} />
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-[10px] opacity-70">+{dayEvents.length - 3}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  anchor,
  events,
  onPickDay,
}: {
  anchor: Date;
  events: CalendarEvent[];
  onPickDay: (d: Date) => void;
}) {
  const days = weekDays(anchor);
  const today = toISODate(todayLocal());
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d) => {
        const iso = toISODate(d);
        const dayEvents = eventsForDay(events, iso);
        const hol = holidayName(iso);
        return (
          <div key={iso} className="rounded border p-2" style={{ borderColor: 'var(--color-border, #e5e7eb)', minHeight: 140 }}>
            <button type="button" onClick={() => onPickDay(d)} className="mb-1 w-full text-left">
              <div className="text-xs font-medium">{WEEKDAY_LABELS_SHORT[(d.getDay() + 6) % 7]}</div>
              <div className="text-sm" style={{ fontWeight: iso === today ? 700 : 400, color: hol || isWeekend(d) ? HOLIDAY_COLOR : 'inherit' }}>
                {d.getDate()}
              </div>
            </button>
            {hol && <div className="mb-1 truncate text-[10px]" style={{ color: HOLIDAY_COLOR }}>{hol}</div>}
            <div className="space-y-1">
              {dayEvents.map((e) => <EventChip key={e.id} e={e} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayView({ anchor, events }: { anchor: Date; events: CalendarEvent[] }) {
  const iso = toISODate(anchor);
  const dayEvents = eventsForDay(events, iso);
  const hol = holidayName(iso);
  return (
    <div className="rounded border p-4" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
      {hol && <div className="mb-2 text-sm font-medium" style={{ color: HOLIDAY_COLOR }}>🎉 {hol}</div>}
      {dayEvents.length === 0 ? (
        <div className="text-sm opacity-60">Nessun evento.</div>
      ) : (
        <div className="space-y-2">
          {dayEvents.map((e) => (
            <div key={e.id} className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm" style={{ background: leaveTypeColor(e.type) }} />
              <span className="text-sm">{eventLabel(e)}</span>
              <span className="text-xs opacity-60">· {leaveTypeLabel(e.type)}{e.status === 'pending' ? ' (in attesa)' : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function YearView({
  anchor,
  events,
  onPickMonth,
}: {
  anchor: Date;
  events: CalendarEvent[];
  onPickMonth: (d: Date) => void;
}) {
  const year = anchor.getFullYear();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {monthsOfYear(year).map((m) => (
        <MiniMonth key={m.getMonth()} month={m} events={events} onClick={() => onPickMonth(m)} />
      ))}
    </div>
  );
}

function MiniMonth({ month, events, onClick }: { month: Date; events: CalendarEvent[]; onClick: () => void }) {
  const weeks = monthGrid(month.getFullYear(), month.getMonth());
  const holidays = holidayMapForRange(toISODate(weeks[0]![0]!), toISODate(weeks[5]![6]!));
  const today = toISODate(todayLocal());
  return (
    <button type="button" onClick={onClick} className="rounded border p-2 text-left hover:shadow-sm" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
      <div className="mb-1 text-xs font-semibold">{MONTH_LABELS[month.getMonth()]}</div>
      <div className="grid grid-cols-7 gap-px">
        {weeks.flat().map((d) => {
          const iso = toISODate(d);
          const inMonth = d.getMonth() === month.getMonth();
          const dayEvents = eventsForDay(events, iso);
          const hol = holidays.get(iso);
          const dot = dayEvents[0];
          return (
            <div key={iso} className="relative flex h-5 items-center justify-center text-[9px]" style={{ opacity: inMonth ? 1 : 0.3 }}>
              <span style={{ color: hol ? HOLIDAY_COLOR : iso === today ? 'var(--color-primary,#2563eb)' : 'inherit', fontWeight: iso === today ? 700 : 400 }}>
                {d.getDate()}
              </span>
              {dot && (
                <span
                  className="absolute bottom-0 h-1 w-1 rounded-full"
                  style={{ background: leaveTypeColor(dot.type) }}
                />
              )}
            </div>
          );
        })}
      </div>
    </button>
  );
}

function Legend() {
  const types = ['ferie', 'permessi', 'malattia', 'assenza', 'chiusura'];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs opacity-80">
      {types.map((t) => (
        <span key={t} className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: leaveTypeColor(t) }} />
          {leaveTypeLabel(t)}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: HOLIDAY_COLOR }} />
        Festività
      </span>
    </div>
  );
}
