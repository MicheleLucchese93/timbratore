import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { color, space } from '@sonoqui/shared';
import { api } from '../lib/api';
import { AppHeader } from '../components/AppHeader';

type LeaveType = 'ferie' | 'permessi' | 'malattia' | 'assenza';
type WorkState = 'nothing' | 'clocked_in' | 'on_break' | 'on_lunch';

interface AbsentLeave {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  type: LeaveType;
  from_ts: string;
  to_ts: string;
  duration_hours: number;
}

interface Summary {
  usage: {
    active_users: string | number;
    active_admins: string | number;
    max_users: number;
    max_admins: number;
    branches_count: string | number;
  };
  presence: {
    clocked_in: string | number;
    on_break: string | number;
    on_lunch: string | number;
    off: string | number;
  };
  pending: {
    corrections: string | number;
    leaves: string | number;
    leave_cancellations: string | number;
  };
  absent_now: AbsentLeave[];
  upcoming_leaves: AbsentLeave[];
  anomalies_7d: { total: number };
}

interface UserCard {
  user_id: string;
  email: string;
  role: 'admin' | 'user';
  state: WorkState;
  last_event: string | null;
  last_event_at: string | null;
  branch_name: string | null;
}

const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  ferie: 'Ferie',
  permessi: 'Permesso',
  malattia: 'Malattia',
  assenza: 'Assenza',
};

export function DashboardScreen() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cards, setCards] = useState<UserCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        api<Summary>('/api/v1/dashboard/summary'),
        api<UserCard[]>('/api/v1/dashboard/cards'),
      ]);
      setSummary(s);
      setCards(c);
    } catch {
      /* ignore — keep stale data on transient failures */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refetch each time the tab regains focus so the recap stays current
  // without a polling timer (mirrors WorkStateChip's focus pattern).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        if (cancelled) return;
        await load();
      })();
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  const pendingTotal = useMemo(() => {
    if (!summary) return 0;
    return (
      Number(summary.pending.corrections) +
      Number(summary.pending.leaves) +
      Number(summary.pending.leave_cancellations)
    );
  }, [summary]);

  const onBreakTotal = summary
    ? Number(summary.presence.on_break) + Number(summary.presence.on_lunch)
    : 0;

  // Working first, then everyone else — the "who is working" answer up top.
  const sortedCards = useMemo(() => {
    const rank = (s: WorkState) => (s === 'nothing' ? 1 : 0);
    return [...cards].sort((a, b) => rank(a.state) - rank(b.state));
  }, [cards]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader centerSlot={<Text style={styles.headerTitle}>Dashboard</Text>} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }>
        {loading && !summary ? (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        ) : (
          <>
            <View style={styles.statGrid}>
              <StatCard
                label="Presenti ora"
                value={String(summary?.presence.clocked_in ?? '–')}
                suffix={`/ ${summary?.usage.active_users ?? '–'}`}
                icon="people-outline"
              />
              <StatCard
                label="In pausa"
                value={String(onBreakTotal)}
                icon="cafe-outline"
              />
              <StatCard
                label="Assenti oggi"
                value={String(summary?.absent_now.length ?? '–')}
                icon="calendar-outline"
                warn={!!summary && summary.absent_now.length > 0}
              />
              <StatCard
                label="Da approvare"
                value={String(pendingTotal)}
                icon="file-tray-full-outline"
                warn={pendingTotal > 0}
              />
              <StatCard
                label="Anomalie 7 gg"
                value={String(summary?.anomalies_7d.total ?? '–')}
                icon="warning-outline"
                warn={!!summary && summary.anomalies_7d.total > 0}
              />
              <StatCard
                label="Sedi"
                value={String(summary?.usage.branches_count ?? '–')}
                icon="business-outline"
              />
            </View>

            <Text style={styles.sectionTitle}>Assenti ora</Text>
            {summary && summary.absent_now.length > 0 ? (
              <View style={styles.card}>
                {summary.absent_now.map((a, i) => (
                  <View
                    key={a.id}
                    style={[styles.absRow, i > 0 && styles.rowDivider]}>
                    <View
                      style={[
                        styles.typeChip,
                        { backgroundColor: typeBg(a.type) },
                      ]}>
                      <Text style={[styles.typeChipText, { color: typeFg(a.type) }]}>
                        {LEAVE_TYPE_LABEL[a.type]}
                      </Text>
                    </View>
                    <Text style={styles.absName} numberOfLines={1}>
                      {a.user_display_name || a.user_email}
                    </Text>
                    <Text style={styles.absMeta}>fino al {fmtDateShort(a.to_ts)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyCard icon="calendar-outline" text="Nessuna assenza in corso" />
            )}

            <Text style={styles.sectionTitle}>Stato attuale</Text>
            {sortedCards.length > 0 ? (
              <View style={styles.card}>
                {sortedCards.map((c, i) => (
                  <View
                    key={c.user_id}
                    style={[styles.userRow, i > 0 && styles.rowDivider]}>
                    <View style={styles.userIdentity}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{initialsFor(c.email)}</Text>
                      </View>
                      <View style={styles.userTextWrap}>
                        <Text style={styles.userName} numberOfLines={1}>
                          {c.email}
                        </Text>
                        {c.branch_name ? (
                          <Text style={styles.userBranch} numberOfLines={1}>
                            {c.branch_name}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <StateBadge state={c.state} />
                  </View>
                ))}
              </View>
            ) : (
              <EmptyCard icon="people-outline" text="Nessun dipendente ancora" />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({
  label,
  value,
  suffix,
  icon,
  warn,
}: {
  label: string;
  value: string;
  suffix?: string;
  icon: keyof typeof Ionicons.glyphMap;
  warn?: boolean;
}) {
  return (
    <View style={[styles.statCard, warn && styles.statCardWarn]}>
      <View style={[styles.statIcon, warn && styles.statIconWarn]}>
        <Ionicons
          name={icon}
          size={18}
          color={warn ? color.warning : color.primary}
        />
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>
        {value}
        {suffix ? <Text style={styles.statSuffix}> {suffix}</Text> : null}
      </Text>
    </View>
  );
}

function StateBadge({ state }: { state: WorkState }) {
  const meta = stateBadge(state);
  return (
    <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
      <Text style={[styles.statusPillText, { color: meta.fg }]}>{meta.label}</Text>
    </View>
  );
}

function EmptyCard({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.emptyCard}>
      <Ionicons name={icon} size={28} color={color.onSurfaceVariant} />
      <Text style={styles.empty}>{text}</Text>
    </View>
  );
}

function stateBadge(s: WorkState): { label: string; bg: string; fg: string } {
  if (s === 'clocked_in') return { label: 'Al lavoro', bg: '#e8f3ec', fg: color.success };
  if (s === 'on_break') return { label: 'In pausa', bg: '#fff3d1', fg: color.warning };
  if (s === 'on_lunch') return { label: 'In pausa pranzo', bg: '#fff3d1', fg: color.warning };
  return { label: 'Fuori servizio', bg: color.surfaceVariant, fg: color.onSurfaceVariant };
}

function typeBg(t: LeaveType): string {
  if (t === 'ferie') return '#e0f2fe';
  if (t === 'permessi') return '#fff3d1';
  if (t === 'assenza') return '#ede9fe';
  return '#fde4e4';
}

function typeFg(t: LeaveType): string {
  if (t === 'ferie') return '#0369a1';
  if (t === 'permessi') return color.warning;
  if (t === 'assenza') return '#6d28d9';
  return color.error;
}

function initialsFor(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
  return letters || local.slice(0, 2).toUpperCase() || '?';
}

function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  headerTitle: { fontSize: 18, fontWeight: '700', color: color.onSurface },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 6, paddingBottom: 44 },

  centered: { paddingVertical: 64, alignItems: 'center' },

  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: space.s2,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 100,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 12,
    gap: 6,
    shadowColor: 'rgba(0,0,0,0.04)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 1,
  },
  statCardWarn: { backgroundColor: '#fff8ec' },
  statIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.primaryContainer,
  },
  statIconWarn: { backgroundColor: '#ffe9c7' },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: color.onSurfaceVariant,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: color.onSurface,
    fontVariant: ['tabular-nums'],
  },
  statSuffix: { fontSize: 13, fontWeight: '600', color: color.onSurfaceVariant },

  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: color.onSurfaceVariant,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: space.s4,
    marginBottom: space.s2,
    paddingHorizontal: 4,
  },

  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 4,
    shadowColor: 'rgba(0,0,0,0.04)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 1,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.surfaceVariant },

  absRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  typeChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  typeChipText: { fontSize: 11, fontWeight: '700' },
  absName: { flex: 1, fontSize: 14, fontWeight: '600', color: color.onSurface },
  absMeta: { fontSize: 12, color: color.onSurfaceVariant, fontVariant: ['tabular-nums'] },

  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 12,
  },
  userIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 13, fontWeight: '700', color: color.primary },
  userTextWrap: { flex: 1, minWidth: 0 },
  userName: { fontSize: 14, fontWeight: '600', color: color.onSurface },
  userBranch: { fontSize: 12, color: color.onSurfaceVariant, marginTop: 1 },

  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  statusPillText: { fontSize: 11, fontWeight: '700' },

  emptyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    gap: 8,
  },
  empty: { color: color.onSurfaceVariant, textAlign: 'center' },
});
