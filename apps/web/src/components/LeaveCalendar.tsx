import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type CalView,
  monthGrid,
  monthsOfYear,
  weekDays,
  toISODate,
  addDays,
  addMonths,
  sameDay,
  isWeekend,
  leaveCoversDay,
  leaveDaySlice,
  leaveTypeColor,
  HOLIDAY_COLOR,
  holidayMapForRange,
  holidayName,
} from '@sonoqui/shared';
import { localeTag } from '../i18n/format.ts';
import type { TFunction } from 'i18next';

// Monday-first short weekday names, locale-derived. 2024-01-01 is a Monday.
function weekdayLabelsShort(): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(localeTag(), { weekday: 'short' })
  );
}

// Long month names, locale-derived (January … December).
function monthLabels(): string[] {
  return Array.from({ length: 12 }, (_, m) =>
    new Date(2024, m, 1).toLocaleDateString(localeTag(), { month: 'long' })
  );
}

function viewTitleLocal(view: CalView, anchor: Date): string {
  const months = monthLabels();
  if (view === 'year') return String(anchor.getFullYear());
  if (view === 'month') return `${months[anchor.getMonth()]} ${anchor.getFullYear()}`;
  if (view === 'week') {
    const days = weekDays(anchor);
    const a = days[0]!;
    const b = days[6]!;
    return `${a.getDate()} ${months[a.getMonth()]} – ${b.getDate()} ${months[b.getMonth()]} ${b.getFullYear()}`;
  }
  return `${anchor.getDate()} ${months[anchor.getMonth()]} ${anchor.getFullYear()}`;
}

function eventLabel(e: CalendarEvent, t: TFunction): string {
  return e.title || e.user_label || t(`common:leaveType.${e.type}`);
}

// Time window of a partial-day ("a ore") ferie/permesso on `iso`, e.g.
// "09:00–11:00". Null for full-day leaves (malattia / assenza / full ferie).
function eventTimeLabel(e: CalendarEvent, iso: string, t: TFunction): string | null {
  const s = leaveDaySlice(e.from_ts, e.to_ts, iso);
  if (s.allDay) return null;
  if (s.startsBefore && !s.endsAfter) return t('time.until', { time: s.end });
  if (s.endsAfter && !s.startsBefore) return t('time.from', { time: s.start });
  return `${s.start}–${s.end}`;
}

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
  const { t } = useTranslation(['leaveCalendar', 'common']);
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
          <button type="button" className="btn btn-ghost px-2 py-1" onClick={() => step(-1)} aria-label={t('nav.prev')}>‹</button>
          <button type="button" className="btn btn-ghost px-2 py-1" onClick={() => setAnchor(todayLocal())}>{t('nav.today')}</button>
          <button type="button" className="btn btn-ghost px-2 py-1" onClick={() => step(1)} aria-label={t('nav.next')}>›</button>
          <span className="ml-2 text-sm font-semibold capitalize">{viewTitleLocal(view, anchor)}</span>
        </div>
        <div className="cal-seg" role="group">
          {(['day', 'week', 'month', 'year'] as CalView[]).map((v) => (
            <button
              key={v}
              type="button"
              className="cal-seg-btn"
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {t(`view.${v}`)}
            </button>
          ))}
        </div>
      </div>

      {view === 'month' && <MonthView anchor={anchor} events={shown} t={t} onPickDay={(d) => { setAnchor(d); setView('day'); }} />}
      {view === 'week' && <WeekView anchor={anchor} events={shown} t={t} onPickDay={(d) => { setAnchor(d); setView('day'); }} />}
      {view === 'day' && <DayView anchor={anchor} events={shown} t={t} />}
      {view === 'year' && <YearView anchor={anchor} events={shown} onPickMonth={(d) => { setAnchor(d); setView('month'); }} />}

      <Legend t={t} />
    </div>
  );
}

function EventChip({ e, faded, iso, t }: { e: CalendarEvent; faded?: boolean; iso?: string; t: TFunction }) {
  const pending = e.status === 'pending';
  const time = iso ? eventTimeLabel(e, iso, t) : null;
  return (
    <div
      title={`${time ? `${time} — ` : ''}${eventLabel(e, t)} — ${t(`common:leaveType.${e.type}`)}${pending ? t('pending') : ''}`}
      style={{ ['--cal-chip-color' as string]: leaveTypeColor(e.type), opacity: faded ? 0.5 : 1 }}
      className={`cal-chip truncate ${pending ? 'cal-chip--pending' : 'cal-chip--solid'}`}
    >
      {time ? `${time} · ${eventLabel(e, t)}` : eventLabel(e, t)}
    </div>
  );
}

function eventsForDay(events: CalendarEvent[], iso: string): CalendarEvent[] {
  return events.filter((e) => leaveCoversDay(e.from_ts, e.to_ts, iso));
}

function MonthView({
  anchor,
  events,
  t,
  onPickDay,
}: {
  anchor: Date;
  events: CalendarEvent[];
  t: TFunction;
  onPickDay: (d: Date) => void;
}) {
  const weeks = monthGrid(anchor.getFullYear(), anchor.getMonth());
  const holidays = holidayMapForRange(toISODate(weeks[0]![0]!), toISODate(weeks[5]![6]!));
  const today = toISODate(todayLocal());
  const weekdays = weekdayLabelsShort();
  return (
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-surface-variant)' }}>
      <div className="grid grid-cols-7 text-center text-xs font-semibold" style={{ background: 'var(--color-surface-variant)' }}>
        {weekdays.map((w, i) => (
          <div key={w} className="py-2 capitalize" style={{ color: i >= 5 ? HOLIDAY_COLOR : 'var(--color-on-surface-variant)' }}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 cal-grid">
        {weeks.flat().map((d) => {
          const iso = toISODate(d);
          const inMonth = d.getMonth() === anchor.getMonth();
          const dayEvents = eventsForDay(events, iso);
          const hol = holidays.get(iso);
          const isToday = iso === today;
          const cls = ['cal-day', 'min-h-[96px]', 'p-1.5', 'text-left', 'align-top'];
          if (!inMonth) cls.push('cal-day--out');
          else if (isWeekend(d)) cls.push('cal-day--weekend');
          return (
            <button key={iso} type="button" onClick={() => onPickDay(d)} className={cls.join(' ')}>
              <div className="flex items-center justify-between" style={{ opacity: inMonth ? 1 : 0.5 }}>
                <span
                  className={`text-xs ${isToday ? 'cal-today' : ''}`}
                  style={isToday ? undefined : { color: hol || isWeekend(d) ? HOLIDAY_COLOR : 'inherit' }}
                >
                  {d.getDate()}
                </span>
              </div>
              {hol && <div className="truncate text-[10px]" style={{ color: HOLIDAY_COLOR }} title={hol}>{hol}</div>}
              <div className="mt-1 space-y-0.5" style={{ opacity: inMonth ? 1 : 0.6 }}>
                {dayEvents.slice(0, 3).map((e) => (
                  <EventChip key={e.id} e={e} t={t} />
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
  t,
  onPickDay,
}: {
  anchor: Date;
  events: CalendarEvent[];
  t: TFunction;
  onPickDay: (d: Date) => void;
}) {
  const days = weekDays(anchor);
  const today = toISODate(todayLocal());
  const weekdays = weekdayLabelsShort();
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d) => {
        const iso = toISODate(d);
        const dayEvents = eventsForDay(events, iso);
        const hol = holidayName(iso);
        const isToday = iso === today;
        return (
          <div
            key={iso}
            className="rounded-lg border p-2"
            style={{
              borderColor: isToday ? 'var(--color-primary)' : 'var(--color-surface-variant)',
              background: isWeekend(d) ? 'color-mix(in oklab, var(--color-surface-variant) 30%, var(--color-surface))' : 'var(--color-surface)',
              minHeight: 140,
            }}
          >
            <button type="button" onClick={() => onPickDay(d)} className="mb-1 w-full text-left">
              <div className="text-xs font-medium capitalize" style={{ color: 'var(--color-on-surface-variant)' }}>{weekdays[(d.getDay() + 6) % 7]}</div>
              <div className="mt-0.5">
                <span className={`text-sm ${isToday ? 'cal-today' : ''}`} style={isToday ? undefined : { color: hol || isWeekend(d) ? HOLIDAY_COLOR : 'inherit', fontWeight: 600 }}>
                  {d.getDate()}
                </span>
              </div>
            </button>
            {hol && <div className="mb-1 truncate text-[10px]" style={{ color: HOLIDAY_COLOR }} title={hol}>{hol}</div>}
            <div className="space-y-1">
              {dayEvents.map((e) => <EventChip key={e.id} e={e} iso={iso} t={t} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayView({ anchor, events, t }: { anchor: Date; events: CalendarEvent[]; t: TFunction }) {
  const iso = toISODate(anchor);
  const dayEvents = eventsForDay(events, iso);
  const hol = holidayName(iso);
  return (
    <div className="rounded border p-4" style={{ borderColor: 'var(--color-border)' }}>
      {hol && <div className="mb-2 text-sm font-medium" style={{ color: HOLIDAY_COLOR }}>🎉 {hol}</div>}
      {dayEvents.length === 0 ? (
        <div className="text-sm opacity-60">{t('noEvents')}</div>
      ) : (
        <div className="space-y-2">
          {dayEvents.map((e) => {
            const time = eventTimeLabel(e, iso, t);
            return (
              <div key={e.id} className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ background: leaveTypeColor(e.type) }} />
                <span className="text-sm">{eventLabel(e, t)}</span>
                {time && <span className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>{time}</span>}
                <span className="text-xs opacity-60">· {t(`common:leaveType.${e.type}`)}{e.status === 'pending' ? t('pending') : ''}</span>
              </div>
            );
          })}
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
  const months = monthLabels();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {monthsOfYear(year).map((m) => (
        <MiniMonth key={m.getMonth()} month={m} events={events} label={months[m.getMonth()]!} onClick={() => onPickMonth(m)} />
      ))}
    </div>
  );
}

function MiniMonth({ month, events, label, onClick }: { month: Date; events: CalendarEvent[]; label: string; onClick: () => void }) {
  const weeks = monthGrid(month.getFullYear(), month.getMonth());
  const holidays = holidayMapForRange(toISODate(weeks[0]![0]!), toISODate(weeks[5]![6]!));
  const today = toISODate(todayLocal());
  return (
    <button type="button" onClick={onClick} className="rounded border p-2 text-left hover:shadow-sm" style={{ borderColor: 'var(--color-border)' }}>
      <div className="mb-1 text-xs font-semibold">{label}</div>
      <div className="grid grid-cols-7 gap-px">
        {weeks.flat().map((d) => {
          const iso = toISODate(d);
          const inMonth = d.getMonth() === month.getMonth();
          const dayEvents = eventsForDay(events, iso);
          const hol = holidays.get(iso);
          const dot = dayEvents[0];
          return (
            <div key={iso} className="relative flex h-5 items-center justify-center text-[9px]" style={{ opacity: inMonth ? 1 : 0.3 }}>
              <span style={{ color: hol ? HOLIDAY_COLOR : iso === today ? 'var(--color-primary)' : 'inherit', fontWeight: iso === today ? 700 : 400 }}>
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

function Legend({ t }: { t: TFunction }) {
  const types = ['ferie', 'permessi', 'malattia', 'assenza', 'chiusura'];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs opacity-80">
      {types.map((type) => (
        <span key={type} className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: leaveTypeColor(type) }} />
          {t(`common:leaveType.${type}`)}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: HOLIDAY_COLOR }} />
        {t('legend.holiday')}
      </span>
    </div>
  );
}
