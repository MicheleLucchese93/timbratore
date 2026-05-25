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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import type { StampEventType } from '@sonoqui/shared';
import { color, space, type as t } from '@sonoqui/shared';
import { computeDayTotals, formatDuration, isoDay, type DayStamp } from '../lib/day-totals';
import { AppHeader } from '../components/AppHeader';

const RANGES = [
  { id: 7, label: '7 giorni' },
  { id: 30, label: '30 giorni' },
  { id: 90, label: '90 giorni' },
] as const;

export function StoricoScreen() {
  const [days, setDays] = useState(30);
  const [stamps, setStamps] = useState<DayStamp[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStamps = useCallback(async (n: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - n);
    try {
      const list = await api<DayStamp[]>(`/api/v1/stamps/me?from=${isoDay(from)}&to=${isoDay(to)}`);
      setStamps(list);
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

  const byDay = useMemo(() => groupByDay(stamps), [stamps]);
  const totalWorkedMs = useMemo(
    () => byDay.reduce((acc, d) => acc + computeDayTotals(d.stamps).workedMs, 0),
    [byDay]
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader />
      <View style={styles.filterRow}>
        {RANGES.map((r) => {
          const sel = r.id === days;
          return (
            <TouchableOpacity
              key={r.id}
              onPress={() => setDays(r.id)}
              activeOpacity={0.7}
              style={[styles.tabPill, sel && styles.tabPillActive]}>
              <Text style={[styles.tabPillText, sel && styles.tabPillTextActive]}>{r.label}</Text>
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
            <View>
              <Text style={styles.summaryLabel}>Totale lavorato</Text>
              <Text style={styles.summaryValue}>{formatDuration(totalWorkedMs)}</Text>
            </View>
            <View style={styles.summaryRight}>
              <Text style={styles.summaryDays}>{byDay.length}</Text>
              <Text style={styles.summaryDaysLabel}>giorni</Text>
            </View>
          </View>
        )}

        {loading && (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        )}
        {!loading && byDay.length === 0 && (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={32} color={color.onSurfaceVariant} />
            <Text style={styles.empty}>Nessuna timbratura nel periodo.</Text>
          </View>
        )}
        {byDay.map((d) => (
          <DayCard key={d.day} day={d.day} stamps={d.stamps} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function DayCard({ day, stamps }: { day: string; stamps: DayStamp[] }) {
  const [expanded, setExpanded] = useState(false);
  const totals = computeDayTotals(stamps);
  const sorted = [...stamps].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );
  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? 'Comprimi giorno' : 'Espandi giorno'}
        style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.dayLabel}>{formatDay(day)}</Text>
          {totals.breakMs > 0 && (
            <Text style={styles.breakLine}>Pause {formatDuration(totals.breakMs)}</Text>
          )}
        </View>
        <View style={styles.dayTotalBadge}>
          <Text style={styles.dayTotal}>{formatDuration(totals.workedMs)}</Text>
        </View>
        <View style={styles.chevron}>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={color.onSurfaceVariant}
          />
        </View>
      </Pressable>
      {expanded && (
        <View style={styles.eventList}>
          {sorted.map((s) => (
            <View key={s.id} style={styles.eventRow}>
              <View style={[styles.eventIcon, { backgroundColor: dotBg(s.event_type) }]}>
                <Ionicons name={eventIcon(s.event_type)} size={14} color={dotFg(s.event_type)} />
              </View>
              <Text style={styles.eventLabel}>{humanEvent(s.event_type)}</Text>
              <Text style={styles.eventTime}>{formatTime(s.occurred_at)}</Text>
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

function formatDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const today = isoDay(new Date());
  const yesterday = isoDay(new Date(Date.now() - 86400_000));
  if (iso === today) return 'Oggi';
  if (iso === yesterday) return 'Ieri';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function humanEvent(e: StampEventType): string {
  switch (e) {
    case 'clock_in': return 'Ingresso';
    case 'clock_out': return 'Uscita';
    case 'break_start': return 'Inizio pausa';
    case 'break_end': return 'Fine pausa';
  }
}

function eventIcon(e: StampEventType): keyof typeof Ionicons.glyphMap {
  switch (e) {
    case 'clock_in': return 'log-in-outline';
    case 'clock_out': return 'log-out-outline';
    case 'break_start': return 'pause-outline';
    case 'break_end': return 'play-outline';
  }
}

function dotBg(e: StampEventType): string {
  switch (e) {
    case 'clock_in': return '#e8f3ec';
    case 'clock_out': return '#fde4e4';
    case 'break_start':
    case 'break_end':
      return '#fff3d1';
  }
}

function dotFg(e: StampEventType): string {
  switch (e) {
    case 'clock_in': return color.success;
    case 'clock_out': return color.error;
    case 'break_start':
    case 'break_end':
      return color.warning;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
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
  scrollContent: { paddingHorizontal: 6, paddingBottom: 44 },

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
  summaryRight: { alignItems: 'flex-end' },
  summaryDays: { fontSize: 24, fontWeight: '700', color: color.onSurface, fontVariant: ['tabular-nums'] },
  summaryDaysLabel: { fontSize: 11, fontWeight: '600', color: color.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.5 },

  centered: { paddingVertical: 48, alignItems: 'center' },
  emptyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    gap: 8,
  },
  empty: { color: color.onSurfaceVariant, textAlign: 'center' },

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
  dayTotalBadge: {
    backgroundColor: '#ffe0c8',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  dayTotal: { fontSize: 14, fontWeight: '700', color: color.primary, fontVariant: ['tabular-nums'] },
  breakLine: {
    fontSize: 12,
    color: color.onSurfaceVariant,
    marginTop: 2,
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
