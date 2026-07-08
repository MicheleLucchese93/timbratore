import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import type { StampEventType } from '@sonoqui/shared';
import { color, space, type as t } from '@sonoqui/shared';
import { fmtDate, fmtTime } from '../i18n/format';
import { EmptyState } from '../components/EmptyState';
import { formatDuration, isoDay, type DayStamp } from '@sonoqui/shared';
import {
  computeCountedDayClosed,
  isScheduledWorkday,
  type ActiveAssignment,
  type LeaveInterval,
} from '@sonoqui/shared';

const RANGES = [
  { id: 7, labelKey: 'range.7' },
  { id: 30, labelKey: 'range.30' },
  { id: 90, labelKey: 'range.90' },
] as const;

// History body, rendered as the "Storico" sub-tab inside Timbrature (which
// already provides the SafeAreaView + AppHeader chrome).
export function StoricoContent() {
  const { t: tr } = useTranslation(['storico', 'common']);
  const [days, setDays] = useState(30);
  const [stamps, setStamps] = useState<DayStamp[]>([]);
  const [assignment, setAssignment] = useState<ActiveAssignment | null>(null);
  const [leaves, setLeaves] = useState<LeaveInterval[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStamps = useCallback(async (n: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - n);
    try {
      const [list, a, lv] = await Promise.all([
        api<DayStamp[]>(`/api/v1/stamps/me?from=${isoDay(from)}&to=${isoDay(to)}`),
        api<ActiveAssignment | null>('/api/v1/shifts/assignments/me').catch(() => null),
        api<LeaveInterval[]>(
          `/api/v1/leaves?scope=mine&status=approved&from=${isoDay(from)}&to=${isoDay(to)}`
        ).catch(() => []),
      ]);
      setStamps(list);
      setAssignment(a);
      setLeaves(lv);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchStamps(days);
  }, [fetchStamps, days]);

  // Hide rest days (no shift slot for that weekday) unless work was actually
  // logged on them; scheduled work days always show. Without an assignment the
  // schedule is unknown, so every stamped day is kept.
  const byDay = useMemo(() => {
    const grouped = groupByDay(stamps);
    if (!assignment) return grouped;
    return grouped.filter((d) => {
      if (isScheduledWorkday(assignment, d.day)) return true;
      return computeCountedDayClosed(d.stamps, assignment, d.day, leaves).workedMs > 0;
    });
  }, [stamps, assignment, leaves]);
  const totals = useMemo(() => {
    let worked = 0;
    let counted = 0;
    for (const d of byDay) {
      const c = computeCountedDayClosed(d.stamps, assignment, d.day, leaves);
      worked += c.workedMs;
      counted += c.countedTotalMs;
    }
    return { worked, counted };
  }, [byDay, assignment, leaves]);

  return (
    <View style={styles.content}>
      <View style={styles.filterRow}>
        {RANGES.map((r) => {
          const sel = r.id === days;
          return (
            <TouchableOpacity
              key={r.id}
              onPress={() => setDays(r.id)}
              activeOpacity={0.7}
              style={[styles.tabPill, sel && styles.tabPillActive]}>
              <Text style={[styles.tabPillText, sel && styles.tabPillTextActive]}>
                {tr(r.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchStamps(days);
            }}
          />
        }>
        {!loading && byDay.length > 0 && (
          <View style={styles.summaryCard}>
            <View style={styles.summaryLeft}>
              <Text style={styles.summaryLabel}>{tr('summary.countedTotal')}</Text>
              <Text style={styles.summaryValue}>{formatDuration(totals.counted)}</Text>
              <Text style={styles.summarySub}>
                {tr('summary.worked', { value: formatDuration(totals.worked) })}
              </Text>
            </View>
            <View style={styles.summaryRight}>
              <Text style={styles.summaryDays}>{byDay.length}</Text>
              <Text style={styles.summaryDaysLabel}>{tr('common:unit.days')}</Text>
            </View>
          </View>
        )}

        {loading && (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        )}
        {!loading && byDay.length === 0 && (
          <EmptyState icon="calendar-outline" title={tr('empty')} subtitle={tr('emptySub')} fill bare />
        )}
        {byDay.map((d) => (
          <DayCard key={d.day} day={d.day} stamps={d.stamps} assignment={assignment} leaves={leaves} />
        ))}
      </ScrollView>
    </View>
  );
}

function DayCard({
  day,
  stamps,
  assignment,
  leaves,
}: {
  day: string;
  stamps: DayStamp[];
  assignment: ActiveAssignment | null;
  leaves: LeaveInterval[];
}) {
  const { t: tr } = useTranslation(['storico', 'common']);
  const [expanded, setExpanded] = useState(false);
  const totals = computeCountedDayClosed(stamps, assignment, day, leaves);
  const sorted = [...stamps].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );
  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? tr('a11y.collapseDay') : tr('a11y.expandDay')}
        style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.dayLabel}>{formatDay(day, tr)}</Text>
          {(totals.breakMs > 0 || totals.lunchMs > 0) && (
            <Text style={styles.breakLine}>
              {tr('breaks', { value: formatDuration(totals.breakMs + totals.lunchMs) })}
            </Text>
          )}
        </View>
        <View style={styles.chevron}>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={color.onSurfaceVariant}
          />
        </View>
      </Pressable>

      <View style={styles.metricStrip}>
        <View style={styles.metricCol}>
          <Text style={styles.metricCaption}>{tr('metric.worked')}</Text>
          <Text style={styles.metricWorked}>{formatDuration(totals.workedMs)}</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metricCol}>
          <Text style={styles.metricCaption}>{tr('metric.counted')}</Text>
          <Text style={styles.metricCounted}>{formatDuration(totals.countedTotalMs)}</Text>
          {totals.overtimeMs > 0 && (
            <Text style={styles.metricExtra}>
              {tr('metric.overtime', { value: formatDuration(totals.overtimeMs) })}
            </Text>
          )}
        </View>
      </View>
      {expanded && (
        <View style={styles.eventList}>
          {sorted.map((s) => (
            <View key={s.id} style={styles.eventRow}>
              <View style={[styles.eventIcon, { backgroundColor: dotBg(s.event_type) }]}>
                <Ionicons name={eventIcon(s.event_type)} size={14} color={dotFg(s.event_type)} />
              </View>
              <Text style={styles.eventLabel}>{tr(`common:stampEvent.${s.event_type}`)}</Text>
              <Text style={styles.eventTime}>
                {fmtTime(s.occurred_at, { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function groupByDay(stamps: DayStamp[]): Array<{ day: string; stamps: DayStamp[] }> {
  const map = new Map<string, DayStamp[]>();
  for (const s of stamps) {
    const d = isoDay(s.occurred_at);
    const arr = map.get(d) ?? [];
    arr.push(s);
    map.set(d, arr);
  }
  return Array.from(map.entries())
    .map(([day, stamps]) => ({ day, stamps }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
}

function formatDay(iso: string, tr: (key: string) => string): string {
  const d = new Date(`${iso}T12:00:00`);
  const today = isoDay(new Date());
  const yesterday = isoDay(new Date(Date.now() - 86400_000));
  if (iso === today) return tr('today');
  if (iso === yesterday) return tr('yesterday');
  return fmtDate(d, { weekday: 'long', day: '2-digit', month: 'long' });
}

function eventIcon(e: StampEventType): keyof typeof Ionicons.glyphMap {
  switch (e) {
    case 'clock_in': return 'log-in-outline';
    case 'clock_out': return 'log-out-outline';
    case 'break_start': return 'pause-outline';
    case 'break_end': return 'play-outline';
    case 'lunch_start': return 'restaurant-outline';
    case 'lunch_end': return 'play-outline';
  }
}

function dotBg(e: StampEventType): string {
  switch (e) {
    case 'clock_in': return '#e8f3ec';
    case 'clock_out': return '#fde4e4';
    case 'break_start':
    case 'break_end':
    case 'lunch_start':
    case 'lunch_end':
      return '#fff3d1';
  }
}

function dotFg(e: StampEventType): string {
  switch (e) {
    case 'clock_in': return color.success;
    case 'clock_out': return color.error;
    case 'break_start':
    case 'break_end':
    case 'lunch_start':
    case 'lunch_end':
      return color.warning;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  content: { flex: 1 },
  headerBlock: { paddingHorizontal: 6, paddingTop: space.s2, paddingBottom: space.s3 },
  title: { fontSize: 28, fontWeight: '700', color: color.onSurface, letterSpacing: -0.5 },
  subtle: { color: color.onSurfaceVariant, marginTop: 2, fontSize: t.body.size },

  filterRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 6,
    paddingTop: space.s3,
    paddingBottom: space.s3,
  },
  tabPill: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: color.surfaceVariant,
    alignItems: 'center',
  },
  tabPillActive: { backgroundColor: color.primary },
  tabPillText: { fontSize: 13, fontWeight: '600', color: color.onSurfaceVariant },
  tabPillTextActive: { color: color.onPrimary },

  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 6, paddingBottom: 44 },

  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 18,
    marginBottom: space.s4,
    shadowColor: 'rgba(0,0,0,0.06)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 2,
  },
  summaryLeft: { flex: 1 },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: color.onSurfaceVariant,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: '700',
    color: color.primary,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  summarySub: {
    fontSize: 13,
    fontWeight: '600',
    color: color.onSurfaceVariant,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  summaryRight: { alignItems: 'flex-end', paddingLeft: space.s3 },
  summaryDays: { fontSize: 24, fontWeight: '700', color: color.onSurface, fontVariant: ['tabular-nums'] },
  summaryDaysLabel: { fontSize: 11, fontWeight: '600', color: color.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.5 },

  centered: { paddingVertical: 48, alignItems: 'center' },

  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    marginBottom: space.s3,
    shadowColor: 'rgba(0,0,0,0.04)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 1,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chevron: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceVariant,
  },
  dayLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: color.onSurface,
    textTransform: 'capitalize',
  },
  breakLine: {
    fontSize: 12,
    color: color.onSurfaceVariant,
    marginTop: 2,
  },

  metricStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.surfaceVariant,
  },
  metricCol: { flex: 1, gap: 3 },
  metricDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: color.surfaceVariant,
    marginHorizontal: space.s3,
  },
  metricCaption: {
    fontSize: 11,
    fontWeight: '600',
    color: color.onSurfaceVariant,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  metricWorked: {
    fontSize: 20,
    fontWeight: '700',
    color: color.onSurface,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  metricCounted: {
    fontSize: 20,
    fontWeight: '700',
    color: color.primary,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  metricExtra: {
    fontSize: 11,
    fontWeight: '600',
    color: color.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },

  eventList: { marginTop: 14, gap: 10 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  eventIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventLabel: { flex: 1, fontSize: 14, color: color.onSurface, fontWeight: '500' },
  eventTime: {
    fontSize: 14,
    color: color.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
});
