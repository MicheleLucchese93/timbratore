import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  isWeekend,
  viewTitle,
  leaveCoversDay,
  leaveTypeColor,
  leaveTypeLabel,
  HOLIDAY_COLOR,
  holidayMapForRange,
  holidayName,
  color,
  space,
} from '@sonoqui/shared';

export interface MobileCalEvent {
  id: string;
  type: string;
  status: string;
  from_ts: string;
  to_ts: string;
  user_label?: string | null;
  title?: string | null;
}

const HIDDEN_STATUS = new Set([
  'rejected',
  'cancelled',
  'cancelled_post_approval',
  'superseded_by_malattia',
]);

function todayLocal(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function eventsForDay(events: MobileCalEvent[], iso: string): MobileCalEvent[] {
  return events.filter((e) => leaveCoversDay(e.from_ts, e.to_ts, iso));
}

function eventLabel(e: MobileCalEvent): string {
  return e.title || e.user_label || leaveTypeLabel(e.type);
}

export function LeaveCalendarMobile({
  events,
  onRangeChange,
}: {
  events: MobileCalEvent[];
  onRangeChange?: (fromISO: string, toISO: string) => void;
}) {
  const [view, setView] = useState<CalView>('month');
  const [anchor, setAnchor] = useState<Date>(todayLocal);

  const shown = useMemo(() => events.filter((e) => !HIDDEN_STATUS.has(e.status)), [events]);

  const year = anchor.getFullYear();
  useEffect(() => {
    onRangeChange?.(`${year}-01-01`, `${year}-12-31`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  function step(dir: -1 | 1) {
    if (view === 'day') setAnchor((a) => addDays(a, dir));
    else if (view === 'week') setAnchor((a) => addDays(a, 7 * dir));
    else if (view === 'month') setAnchor((a) => addMonths(a, dir));
    else setAnchor((a) => new Date(a.getFullYear() + dir, a.getMonth(), 1));
  }

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <View style={styles.navRow}>
          <Pressable onPress={() => step(-1)} hitSlop={8} style={styles.navBtn}>
            <Ionicons name="chevron-back" size={20} color={color.onSurface} />
          </Pressable>
          <Pressable onPress={() => setAnchor(todayLocal())} style={styles.todayBtn}>
            <Text style={styles.todayText}>Oggi</Text>
          </Pressable>
          <Pressable onPress={() => step(1)} hitSlop={8} style={styles.navBtn}>
            <Ionicons name="chevron-forward" size={20} color={color.onSurface} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{viewTitle(view, anchor)}</Text>
        </View>
      </View>

      <View style={styles.viewSwitch}>
        {(['day', 'week', 'month', 'year'] as CalView[]).map((v) => (
          <Pressable
            key={v}
            onPress={() => setView(v)}
            style={[styles.viewBtn, view === v && styles.viewBtnActive]}>
            <Text style={[styles.viewBtnText, view === v && styles.viewBtnTextActive]}>
              {v === 'day' ? 'Giorno' : v === 'week' ? 'Sett.' : v === 'month' ? 'Mese' : 'Anno'}
            </Text>
          </Pressable>
        ))}
      </View>

      {view === 'month' && (
        <MonthGrid anchor={anchor} events={shown} onPickDay={(d) => { setAnchor(d); setView('day'); }} />
      )}
      {view === 'week' && <WeekList anchor={anchor} events={shown} />}
      {view === 'day' && <DayList anchor={anchor} events={shown} />}
      {view === 'year' && (
        <YearGrid anchor={anchor} events={shown} onPickMonth={(d) => { setAnchor(d); setView('month'); }} />
      )}

      <Legend />
    </View>
  );
}

function MonthGrid({
  anchor,
  events,
  onPickDay,
}: {
  anchor: Date;
  events: MobileCalEvent[];
  onPickDay: (d: Date) => void;
}) {
  const weeks = monthGrid(anchor.getFullYear(), anchor.getMonth());
  const holidays = holidayMapForRange(toISODate(weeks[0]![0]!), toISODate(weeks[5]![6]!));
  const today = toISODate(todayLocal());
  return (
    <View>
      <View style={styles.weekHeader}>
        {WEEKDAY_LABELS_SHORT.map((w) => (
          <Text key={w} style={styles.weekHeaderText}>{w}</Text>
        ))}
      </View>
      <View style={styles.grid}>
        {weeks.flat().map((d) => {
          const iso = toISODate(d);
          const inMonth = d.getMonth() === anchor.getMonth();
          const dayEvents = eventsForDay(events, iso);
          const hol = holidays.get(iso);
          return (
            <Pressable key={iso} onPress={() => onPickDay(d)} style={styles.cell}>
              <View
                style={[
                  styles.cellNum,
                  iso === today && styles.cellToday,
                ]}>
                <Text
                  style={[
                    styles.cellNumText,
                    !inMonth && styles.cellOut,
                    (hol || isWeekend(d)) && { color: HOLIDAY_COLOR },
                    iso === today && styles.cellTodayText,
                  ]}>
                  {d.getDate()}
                </Text>
              </View>
              <View style={styles.dots}>
                {dayEvents.slice(0, 3).map((e) => (
                  <View key={e.id} style={[styles.dot, { backgroundColor: leaveTypeColor(e.type) }]} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function DayList({ anchor, events }: { anchor: Date; events: MobileCalEvent[] }) {
  const iso = toISODate(anchor);
  const dayEvents = eventsForDay(events, iso);
  const hol = holidayName(iso);
  return (
    <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: space.s4 }}>
      {hol && <Text style={styles.holidayBanner}>🎉 {hol}</Text>}
      {dayEvents.length === 0 ? (
        <Text style={styles.empty}>Nessun evento.</Text>
      ) : (
        dayEvents.map((e) => <EventRow key={e.id} e={e} />)
      )}
    </ScrollView>
  );
}

function WeekList({ anchor, events }: { anchor: Date; events: MobileCalEvent[] }) {
  const days = weekDays(anchor);
  const today = toISODate(todayLocal());
  return (
    <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: space.s4 }}>
      {days.map((d) => {
        const iso = toISODate(d);
        const dayEvents = eventsForDay(events, iso);
        const hol = holidayName(iso);
        return (
          <View key={iso} style={styles.weekDayBlock}>
            <Text style={[styles.weekDayTitle, iso === today && { color: color.primary }]}>
              {WEEKDAY_LABELS_SHORT[(d.getDay() + 6) % 7]} {d.getDate()}
              {hol ? `  · ${hol}` : ''}
            </Text>
            {dayEvents.length === 0 ? (
              <Text style={styles.weekEmpty}>—</Text>
            ) : (
              dayEvents.map((e) => <EventRow key={e.id} e={e} />)
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function YearGrid({
  anchor,
  events,
  onPickMonth,
}: {
  anchor: Date;
  events: MobileCalEvent[];
  onPickMonth: (d: Date) => void;
}) {
  const year = anchor.getFullYear();
  return (
    <View style={styles.yearGrid}>
      {monthsOfYear(year).map((m) => {
        const count = events.filter((e) => {
          const f = new Date(e.from_ts);
          return f.getFullYear() === year && f.getMonth() === m.getMonth();
        }).length;
        return (
          <Pressable key={m.getMonth()} onPress={() => onPickMonth(m)} style={styles.yearCell}>
            <Text style={styles.yearMonth}>{MONTH_LABELS[m.getMonth()]}</Text>
            {count > 0 && (
              <View style={styles.yearBadge}>
                <Text style={styles.yearBadgeText}>{count}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function EventRow({ e }: { e: MobileCalEvent }) {
  return (
    <View style={styles.eventRow}>
      <View style={[styles.eventBar, { backgroundColor: leaveTypeColor(e.type) }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.eventLabel}>{eventLabel(e)}</Text>
        <Text style={styles.eventMeta}>
          {leaveTypeLabel(e.type)}{e.status === 'pending' ? ' · in attesa' : ''}
        </Text>
      </View>
    </View>
  );
}

function Legend() {
  const types = ['ferie', 'permessi', 'malattia', 'assenza', 'chiusura'];
  return (
    <View style={styles.legend}>
      {types.map((tp) => (
        <View key={tp} style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: leaveTypeColor(tp) }]} />
          <Text style={styles.legendText}>{leaveTypeLabel(tp)}</Text>
        </View>
      ))}
      <View style={styles.legendItem}>
        <View style={[styles.dot, { backgroundColor: HOLIDAY_COLOR }]} />
        <Text style={styles.legendText}>Festività</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: space.s3 },
  toolbar: { paddingVertical: space.s2 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  navBtn: { padding: 4 },
  todayBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: color.surfaceVariant,
  },
  todayText: { fontSize: 13, fontWeight: '600', color: color.onSurface },
  title: { flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '700', color: color.onSurface, textTransform: 'capitalize' },

  viewSwitch: { flexDirection: 'row', gap: 6, marginBottom: space.s2 },
  viewBtn: { flex: 1, paddingVertical: 6, borderRadius: 8, alignItems: 'center', backgroundColor: color.surfaceVariant },
  viewBtnActive: { backgroundColor: color.primaryContainer },
  viewBtnText: { fontSize: 12, fontWeight: '600', color: color.onSurfaceVariant },
  viewBtnTextActive: { color: color.primary },

  weekHeader: { flexDirection: 'row' },
  weekHeaderText: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 11, fontWeight: '600', color: color.onSurfaceVariant, paddingVertical: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', paddingTop: 4 },
  cellNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  cellToday: { backgroundColor: color.primary },
  cellNumText: { fontSize: 13, color: color.onSurface },
  cellTodayText: { color: color.onPrimary, fontWeight: '700' },
  cellOut: { opacity: 0.35 },
  dots: { flexDirection: 'row', gap: 2, marginTop: 2, height: 6 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },

  list: { maxHeight: 420 },
  empty: { color: color.onSurfaceVariant, paddingVertical: space.s4, textAlign: 'center' },
  holidayBanner: { color: HOLIDAY_COLOR, fontWeight: '700', paddingVertical: space.s2 },
  weekDayBlock: { paddingVertical: space.s2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.surfaceVariant },
  weekDayTitle: { fontSize: 13, fontWeight: '700', color: color.onSurface, marginBottom: 4 },
  weekEmpty: { color: color.onSurfaceVariant, fontSize: 12 },

  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  eventBar: { width: 4, height: 28, borderRadius: 2 },
  eventLabel: { fontSize: 14, fontWeight: '600', color: color.onSurface },
  eventMeta: { fontSize: 12, color: color.onSurfaceVariant, marginTop: 1 },

  yearGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  yearCell: {
    width: `${100 / 3}%`,
    paddingVertical: space.s4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yearMonth: { fontSize: 13, fontWeight: '600', color: color.onSurface },
  yearBadge: { marginTop: 4, minWidth: 18, paddingHorizontal: 5, height: 18, borderRadius: 9, backgroundColor: color.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  yearBadgeText: { fontSize: 11, fontWeight: '700', color: color.primary },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s3, paddingVertical: space.s3 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendText: { fontSize: 11, color: color.onSurfaceVariant },
});
