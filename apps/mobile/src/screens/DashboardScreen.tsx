import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { color, space } from '@sonoqui/shared';
import { api } from '../lib/api';
import { AppHeader } from '../components/AppHeader';
import { EmptyState } from '../components/EmptyState';
import { fmtDate } from '../i18n/format';
import type { TFunction } from 'i18next';

type LeaveType = 'ferie' | 'permessi' | 'malattia' | 'assenza';
type WorkState = 'nothing' | 'clocked_in' | 'on_break' | 'on_lunch';
type GroupMode = 'list' | 'by_branch';
type AbsHorizon = 'today' | 'd7' | 'd14';

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

export function DashboardScreen() {
  const { t } = useTranslation(['dashboard', 'common']);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cards, setCards] = useState<UserCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [groupMode, setGroupMode] = useState<GroupMode>('list');
  const [absHorizon, setAbsHorizon] = useState<AbsHorizon>('today');

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

  const onBreakTotal = summary
    ? Number(summary.presence.on_break) + Number(summary.presence.on_lunch)
    : 0;

  // Working first, then everyone else — the "who is working" answer up top.
  const sortedCards = useMemo(() => {
    const rank = (s: WorkState) => (s === 'nothing' ? 1 : 0);
    return [...cards].sort((a, b) => rank(a.state) - rank(b.state));
  }, [cards]);

  // Absences within the selected horizon. absent_now (active) + upcoming both
  // guarantee to_ts > now, so overlap with [now, horizon] ⟺ from_ts <= horizon.
  const absences = useMemo(() => {
    if (!summary) return [] as AbsentLeave[];
    const now = Date.now();
    const horizon =
      absHorizon === 'today'
        ? endOfTodayMs()
        : now + (absHorizon === 'd7' ? 7 : 14) * 86_400_000;
    return [...summary.absent_now, ...summary.upcoming_leaves]
      .filter((a) => new Date(a.from_ts).getTime() <= horizon)
      .sort((a, b) => new Date(a.from_ts).getTime() - new Date(b.from_ts).getTime());
  }, [summary, absHorizon]);

  // Present staff grouped by sede; off-duty collected into one trailing group.
  const branchGroups = useMemo(() => {
    const map = new Map<string, UserCard[]>();
    for (const c of cards) {
      if (c.state === 'nothing') continue;
      const key = c.branch_name ?? '__none__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === '__none__') return 1;
      if (b === '__none__') return -1;
      return a.localeCompare(b, 'it');
    });
    const off = cards.filter((c) => c.state === 'nothing');
    return { keys, map, off };
  }, [cards]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader />

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
                label={t('kpi.presentNow')}
                value={String(summary?.presence.clocked_in ?? '–')}
                suffix={`/ ${summary?.usage.active_users ?? '–'}`}
                icon="people-outline"
              />
              <StatCard
                label={t('kpi.onBreak')}
                value={String(onBreakTotal)}
                icon="cafe-outline"
              />
              <StatCard
                label={t('kpi.absentToday')}
                value={String(summary?.absent_now.length ?? '–')}
                icon="calendar-outline"
                warn={!!summary && summary.absent_now.length > 0}
              />
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitleInline}>{t('absences.title')}</Text>
              <Segmented
                value={absHorizon}
                onChange={setAbsHorizon}
                options={[
                  { id: 'today', label: t('absences.horizon.today') },
                  { id: 'd7', label: t('absences.horizon.d7') },
                  { id: 'd14', label: t('absences.horizon.d14') },
                ]}
              />
            </View>
            {absences.length > 0 ? (
              <View style={styles.card}>
                {absences.map((a, i) => (
                  <View
                    key={a.id}
                    style={[styles.absRow, i > 0 && styles.rowDivider]}>
                    <View
                      style={[
                        styles.typeChip,
                        { backgroundColor: typeBg(a.type) },
                      ]}>
                      <Text style={[styles.typeChipText, { color: typeFg(a.type) }]}>
                        {t(`common:leaveType.${a.type}`)}
                      </Text>
                    </View>
                    <Text style={styles.absName} numberOfLines={1}>
                      {a.user_display_name || a.user_email}
                    </Text>
                    <Text style={styles.absMeta}>{fmtAbsenceWhen(a, t)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyCard
                icon="calendar-outline"
                text={
                  absHorizon === 'today'
                    ? t('absences.emptyToday')
                    : t('absences.emptyUpcoming')
                }
              />
            )}

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitleInline}>{t('currentState.title')}</Text>
              <Segmented
                value={groupMode}
                onChange={setGroupMode}
                options={[
                  { id: 'list', label: t('currentState.list') },
                  { id: 'by_branch', label: t('currentState.byBranch') },
                ]}
              />
            </View>
            {sortedCards.length === 0 ? (
              <EmptyCard icon="people-outline" text={t('currentState.noEmployees')} />
            ) : groupMode === 'list' ? (
              <View style={styles.card}>
                {sortedCards.map((c, i) => (
                  <UserRow key={c.user_id} card={c} divider={i > 0} showBranch />
                ))}
              </View>
            ) : (
              <BranchGroups groups={branchGroups} />
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
  const { t } = useTranslation('common');
  const meta = stateBadge(state);
  return (
    <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
      <Text style={[styles.statusPillText, { color: meta.fg }]}>{t(meta.labelKey)}</Text>
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
  return <EmptyState icon={icon} title={text} />;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.seg}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segBtn, active && styles.segBtnActive]}>
            <Text style={[styles.segText, active && styles.segTextActive]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function UserRow({
  card,
  divider,
  showBranch,
}: {
  card: UserCard;
  divider: boolean;
  showBranch: boolean;
}) {
  return (
    <View style={[styles.userRow, divider && styles.rowDivider]}>
      <View style={styles.userIdentity}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initialsFor(card.email)}</Text>
        </View>
        <View style={styles.userTextWrap}>
          <Text style={styles.userName} numberOfLines={1}>
            {card.email}
          </Text>
          {showBranch && card.branch_name ? (
            <Text style={styles.userBranch} numberOfLines={1}>
              {card.branch_name}
            </Text>
          ) : null}
        </View>
      </View>
      <StateBadge state={card.state} />
    </View>
  );
}

function BranchGroups({
  groups,
}: {
  groups: { keys: string[]; map: Map<string, UserCard[]>; off: UserCard[] };
}) {
  const { t } = useTranslation(['dashboard', 'common']);
  const { keys, map, off } = groups;
  return (
    <View style={styles.groupStack}>
      {keys.length === 0 ? (
        <EmptyCard icon="business-outline" text={t('currentState.nobodyPresent')} />
      ) : (
        keys.map((key) => {
          const group = map.get(key)!;
          return (
            <View key={key}>
              <View style={styles.groupHeader}>
                <Ionicons name="business-outline" size={14} color={color.onSurfaceVariant} />
                <Text style={styles.groupLabel} numberOfLines={1}>
                  {key === '__none__' ? t('currentState.noBranch') : key}
                </Text>
                <Text style={styles.groupCount}>{group.length}</Text>
              </View>
              <View style={styles.card}>
                {group.map((c, i) => (
                  <UserRow key={c.user_id} card={c} divider={i > 0} showBranch={false} />
                ))}
              </View>
            </View>
          );
        })
      )}
      {off.length > 0 ? (
        <View>
          <View style={styles.groupHeader}>
            <Ionicons name="moon-outline" size={14} color={color.onSurfaceVariant} />
            <Text style={styles.groupLabel}>{t('common:workState.off')}</Text>
            <Text style={styles.groupCount}>{off.length}</Text>
          </View>
          <View style={styles.card}>
            {off.map((c, i) => (
              <UserRow key={c.user_id} card={c} divider={i > 0} showBranch={false} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function stateBadge(s: WorkState): { labelKey: string; bg: string; fg: string } {
  if (s === 'clocked_in') return { labelKey: 'workState.working', bg: '#e8f3ec', fg: color.success };
  if (s === 'on_break') return { labelKey: 'workState.on_break', bg: '#fff3d1', fg: color.warning };
  if (s === 'on_lunch') return { labelKey: 'workState.on_lunch', bg: '#fff3d1', fg: color.warning };
  return { labelKey: 'workState.off', bg: color.surfaceVariant, fg: color.onSurfaceVariant };
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
  return fmtDate(iso, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function endOfTodayMs(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

// "until X" while ongoing; start date (or range) once it's a future leave.
function fmtAbsenceWhen(a: AbsentLeave, t: TFunction): string {
  const from = new Date(a.from_ts);
  if (from.getTime() <= Date.now())
    return t('absences.until', { date: fmtDateShort(a.to_ts) });
  const to = new Date(a.to_ts);
  if (from.toDateString() === to.toDateString())
    return t('absences.on', { date: fmtDateShort(a.from_ts) });
  return t('absences.range', { from: fmtDateShort(a.from_ts), to: fmtDateShort(a.to_ts) });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },

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

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: space.s4,
    marginBottom: space.s2,
    paddingHorizontal: 4,
  },
  sectionTitleInline: {
    fontSize: 13,
    fontWeight: '700',
    color: color.onSurfaceVariant,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  seg: {
    flexDirection: 'row',
    backgroundColor: color.surfaceVariant,
    borderRadius: 10,
    padding: 2,
    gap: 2,
  },
  segBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  segBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: 'rgba(0,0,0,0.06)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
    elevation: 1,
  },
  segText: { fontSize: 12, fontWeight: '600', color: color.onSurfaceVariant },
  segTextActive: { color: color.onSurface },

  groupStack: { gap: space.s3 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  groupLabel: { flex: 1, fontSize: 12, fontWeight: '700', color: color.onSurface },
  groupCount: {
    fontSize: 11,
    fontWeight: '700',
    color: color.onSurfaceVariant,
    backgroundColor: color.surfaceVariant,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
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
});
