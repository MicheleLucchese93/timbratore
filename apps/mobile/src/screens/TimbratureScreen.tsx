import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Platform,
  ScrollView,
  Pressable,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useSession } from '../store/session';
import { api } from '../lib/api';
import { acquireLocation } from '../lib/acquire-location';
import { enqueueStamp, drainQueue } from '../lib/offline-queue';
import { stateFromLastEvent } from '@sonoqui/shared';
import type { StampEventType } from '@sonoqui/shared';
import { color, space, type as t } from '@sonoqui/shared';
import { formatDuration, isoDay, type DayStamp } from '@sonoqui/shared';
import {
  computeCountedDay,
  type ActiveAssignment,
  type LeaveInterval,
} from '@sonoqui/shared';
import { AppHeader } from '../components/AppHeader';
import { WorkStateChip } from '../components/WorkStateChip';
import { WeekScheduleModal } from '../components/WeekScheduleModal';
import { SwipeableTabs } from '../components/SwipeableTabs';
import {
  useCorrections,
  CorrectionsListPage,
  NewCorrectionModal,
} from '../components/CorrectionsTab';
import { StoricoContent } from './StoricoScreen';
import { fmtTime } from '../i18n/format';

// "Timbra" is the stamping page; "correct" hosts the merged corrections list
// (formerly the standalone Correzioni tab), pending requests on top; "storico"
// is the personal stamp history (also reachable as its own tab for non-stampers).
type TimbraTab = 'timbra' | 'correct' | 'storico';

interface CurrentState {
  state: 'nothing' | 'clocked_in' | 'on_break' | 'on_lunch';
  lastEvent: StampEventType | null;
  lastEventAt: string | null;
}

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function alertCross(title: string, msg: string): void {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${msg}`);
  } else {
    Alert.alert(title, msg);
  }
}

export function TimbratureScreen() {
  const { t } = useTranslation(['timbrature', 'correzioni', 'common']);
  const { me } = useSession();
  const corr = useCorrections();
  const [tab, setTab] = useState<TimbraTab>('timbra');
  // A correction notification deep-links to /timbrature?corr=1 — land on the
  // Correggi tab in that case.
  const params = useLocalSearchParams<{ corr?: string }>();
  useEffect(() => {
    if (params.corr) setTab('correct');
  }, [params.corr]);
  const [state, setState] = useState<CurrentState | null>(null);
  const [todayStamps, setTodayStamps] = useState<DayStamp[]>([]);
  const [assignment, setAssignment] = useState<ActiveAssignment | null>(null);
  const [leaves, setLeaves] = useState<LeaveInterval[]>([]);
  const [working, setWorking] = useState<StampEventType | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [lastSubmittedAt, setLastSubmittedAt] = useState<Date | null>(null);
  const [lastUndoId, setLastUndoId] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [weekScheduleOpen, setWeekScheduleOpen] = useState(false);

  const branches = me?.branches ?? [];
  const stampModes = me?.user.stamp_modes ?? [];
  const canStamp = stampModes.length > 0;
  const needsGps = stampModes.includes('gps');

  useEffect(() => {
    if (!selectedBranchId && branches.length > 0) {
      setSelectedBranchId(branches[0].id);
    }
  }, [branches, selectedBranchId]);

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === selectedBranchId) ?? branches[0] ?? null,
    [branches, selectedBranchId]
  );

  const fetchAll = useCallback(async () => {
    const today = isoDay(new Date());
    try {
      const [s, list, a, lv] = await Promise.all([
        api<CurrentState>('/api/v1/stamps/me/current-state'),
        api<DayStamp[]>(`/api/v1/stamps/me?from=${today}&to=${today}`),
        api<ActiveAssignment | null>('/api/v1/shifts/assignments/me').catch(() => null),
        api<LeaveInterval[]>(
          `/api/v1/leaves?scope=mine&status=approved&from=${today}&to=${today}`
        ).catch(() => []),
      ]);
      setState(s);
      setTodayStamps(list);
      setAssignment(a);
      setLeaves(lv);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchAll();
    drainQueue().catch(() => {});
  }, [fetchAll]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // When a shift is open the branch is locked to the one clocked into — keep the
  // selection pinned to it. Declared here (not after the `!me` early return) so
  // the hook order stays stable; derives lock state from state/todayStamps.
  useEffect(() => {
    const cs = state?.state ?? stateFromLastEvent(null);
    const lockedId = cs !== 'nothing' ? openShiftBranchId(todayStamps) : null;
    if (lockedId && selectedBranchId !== lockedId) {
      setSelectedBranchId(lockedId);
    }
  }, [state, todayStamps, selectedBranchId]);

  async function onRefresh() {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }

  async function stamp(event: StampEventType) {
    if (working || !selectedBranch) return;
    setWorking(event);
    const idem = uuidv4();
    const occurredAt = new Date();
    let payload: Record<string, unknown> = {
      event_type: event,
      occurred_at: occurredAt.toISOString(),
      device_platform: Platform.OS,
      device_app_version: '0.1.0',
      branch_id: selectedBranch.id,
    };
    try {
      if (needsGps && !selectedBranch.smart_working) {
        const loc = await acquireLocation();
        payload = {
          ...payload,
          latitude: loc.latitude,
          longitude: loc.longitude,
          gps_accuracy_m: loc.accuracyM,
          is_mock_location: loc.isMockLocation,
        };
      }
      try {
        const created = await api<{ id: string; out_of_geofence?: boolean }>('/api/v1/stamps', {
          method: 'POST',
          headers: { 'Idempotency-Key': idem },
          json: payload,
        });
        setLastSubmittedAt(occurredAt);
        setLastUndoId(created.id);
        await fetchAll();
        // clock_out is allowed even outside the geofence (e.g. closing a shift
        // from home), but the server flags it — tell the user it was recorded
        // as an anomaly rather than silently succeeding.
        if (event === 'clock_out' && created.out_of_geofence) {
          alertCross(
            t('alert.outOfAreaTitle'),
            t('alert.outOfAreaMessage')
          );
        }
      } catch (err) {
        const e = err as { code?: string; message?: string };
        if (!e.code || e.code === 'NETWORK' || e.message?.includes('Network')) {
          enqueueStamp(idem, payload);
          alertCross(t('alert.offlineTitle'), t('alert.offlineMessage'));
        } else {
          alertCross(t('alert.stampFailedTitle'), humanError(e, t));
        }
      }
    } catch (err) {
      alertCross(t('alert.gpsTitle'), humanError(err, t));
    } finally {
      setWorking(null);
    }
  }

  async function undo() {
    if (!lastUndoId) return;
    try {
      await api(`/api/v1/stamps/${lastUndoId}`, { method: 'DELETE' });
      setLastUndoId(null);
      setLastSubmittedAt(null);
      await fetchAll();
    } catch (err) {
      alertCross(t('alert.undoFailedTitle'), humanError(err, t));
    }
  }

  if (!me) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  const currentState = state?.state ?? stateFromLastEvent(null);
  const branchLocked = currentState !== 'nothing';
  const totals = computeCountedDay(todayStamps, assignment, now, leaves);

  // Today's assigned shift: the slots scheduled for this weekday + their total,
  // so the worker sees the hours expected of them today.
  const todayDow = now.getDay() === 0 ? 7 : now.getDay();
  const todaySlots = (assignment?.slots ?? [])
    .filter((s) => s.day_of_week === todayDow)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const expectedMin = todaySlots.reduce((acc, s) => acc + slotMinutes(s.start_time, s.end_time), 0);
  // Feature B auto-lunch: the lunch is auto-deducted, never stamped — so hide
  // the "Inizio pranzo" button on those days.
  const autoLunchToday = (assignment?.day_lunch ?? []).some(
    (d) => d.day_of_week === todayDow && d.lunch_min > 0
  );

  const buttons: Array<{ event: StampEventType; label: string; icon: keyof typeof Ionicons.glyphMap; variant: 'primary' | 'secondary' }> = [];
  if (currentState === 'nothing') {
    buttons.push({ event: 'clock_in', label: t('action.clockIn'), icon: 'log-in-outline', variant: 'primary' });
  } else if (currentState === 'clocked_in') {
    buttons.push({ event: 'clock_out', label: t('action.clockOut'), icon: 'log-out-outline', variant: 'primary' });
    buttons.push({ event: 'break_start', label: t('action.breakStart'), icon: 'pause-outline', variant: 'secondary' });
    if (!autoLunchToday) {
      buttons.push({ event: 'lunch_start', label: t('action.lunchStart'), icon: 'restaurant-outline', variant: 'secondary' });
    }
  } else if (currentState === 'on_break') {
    buttons.push({ event: 'break_end', label: t('action.breakEnd'), icon: 'play-outline', variant: 'primary' });
  } else if (currentState === 'on_lunch') {
    buttons.push({ event: 'lunch_end', label: t('action.lunchEnd'), icon: 'play-outline', variant: 'primary' });
  }
  const undoVisible =
    lastUndoId && lastSubmittedAt && Date.now() - lastSubmittedAt.getTime() < 60_000;

  const stampPage = (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroTopCol}>
              <Text style={styles.heroLabel}>{t('hero.workedHours')}</Text>
              <Text style={styles.heroAmount}>{formatDuration(totals.workedMs)}</Text>
            </View>
            <View style={styles.heroTopColRight}>
              <Text style={styles.heroLabel}>{t('hero.countedHours')}</Text>
              <Text style={styles.heroAmount}>
                {assignment ? formatDuration(totals.countedTotalMs) : '—'}
              </Text>
            </View>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroRow}>
            <HeroStat label={t('common:stampEvent.clock_in')} value={totals.firstInAt ? fmtTime(totals.firstInAt, { hour: '2-digit', minute: '2-digit' }) : '—'} />
            <View style={styles.heroSep} />
            <HeroStat label={t('hero.breaks')} value={formatDuration(totals.breakMs)} />
            <View style={styles.heroSep} />
            <HeroStat
              label={t('common:stampEvent.clock_out')}
              value={totals.lastOutAt && !totals.isOpen ? fmtTime(totals.lastOutAt, { hour: '2-digit', minute: '2-digit' }) : '—'}
            />
          </View>
        </View>

        {assignment && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>{t('schedule.title')}</Text>
              <View style={styles.scheduleHeaderRight}>
                {todaySlots.length > 0 && (
                  <Text style={styles.scheduleTotal}>
                    {t('schedule.total', { duration: formatDuration(expectedMin * 60_000) })}
                  </Text>
                )}
                <Pressable
                  onPress={() => setWeekScheduleOpen(true)}
                  hitSlop={8}
                  accessibilityLabel={t('schedule.viewWeekA11y')}
                  style={styles.weekBtn}>
                  <Ionicons name="calendar-outline" size={18} color={color.primary} />
                </Pressable>
              </View>
            </View>
            {todaySlots.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pillRow}>
                {todaySlots.map((s, i) => (
                  <View key={i} style={styles.slotPill}>
                    <Ionicons name="time-outline" size={14} color={color.primary} />
                    <Text style={styles.slotPillText}>
                      {s.start_time}–{s.end_time}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.restRow}>
                <Ionicons name="bed-outline" size={16} color={color.onSurfaceVariant} />
                <Text style={styles.restText}>{t('schedule.restDay')}</Text>
              </View>
            )}
          </View>
        )}

        {branches.length > 1 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>{t('branch.title')}</Text>
              {branchLocked && (
                <View style={styles.lockHint}>
                  <Ionicons name="lock-closed" size={11} color={color.onSurfaceVariant} />
                  <Text style={styles.lockHintText}>{t('branch.lockedUntilExit')}</Text>
                </View>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
              {branches.map((b) => {
                const sel = b.id === selectedBranch?.id;
                const disabled = branchLocked && !sel;
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => !branchLocked && setSelectedBranchId(b.id)}
                    disabled={branchLocked}
                    style={[
                      styles.pill,
                      sel && styles.pillActive,
                      disabled && styles.pillDisabled,
                    ]}>
                    <Ionicons
                      name={
                        sel && branchLocked
                          ? 'lock-closed'
                          : b.smart_working
                          ? 'laptop-outline'
                          : 'business-outline'
                      }
                      size={14}
                      color={sel ? color.onPrimary : color.onSurfaceVariant}
                    />
                    <Text style={[styles.pillText, sel && styles.pillTextActive]}>{b.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
        {branches.length === 1 && selectedBranch && (
          <View style={styles.section}>
            <View style={styles.branchRow}>
              <Ionicons
                name={selectedBranch.smart_working ? 'laptop-outline' : 'business-outline'}
                size={16}
                color={color.onSurfaceVariant}
              />
              <Text style={styles.branchRowText}>{selectedBranch.name}</Text>
              {selectedBranch.smart_working && (
                <Text style={styles.branchRowTag}>{t('branch.offSite')}</Text>
              )}
            </View>
          </View>
        )}

        <View style={styles.actions}>
          {!canStamp && (
            <View style={styles.disabledNotice}>
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={color.onSurfaceVariant}
              />
              <Text style={styles.disabledNoticeText}>
                {t('disabledNotice')}
              </Text>
            </View>
          )}
          {canStamp &&
            buttons.map((b) => (
              <ActionButton
                key={b.event}
                label={b.label}
                icon={b.icon}
                variant={b.variant}
                loading={working === b.event}
                onPress={() => stamp(b.event)}
              />
            ))}
          {undoVisible && (
            <TouchableOpacity onPress={undo} activeOpacity={0.7} style={styles.undoBtn}>
              <Ionicons name="arrow-undo-outline" size={16} color={color.error} />
              <Text style={styles.undoText}>{t('undoLast')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {state?.lastEventAt && (
          <View style={styles.lastEvent}>
            <Ionicons name="time-outline" size={14} color={color.onSurfaceVariant} />
            <Text style={styles.lastEventText}>
              {t('lastEvent', {
                event: humanEvent(state.lastEvent, t),
                time: fmtTime(state.lastEventAt, { hour: '2-digit', minute: '2-digit' }),
              })}
            </Text>
          </View>
        )}
    </ScrollView>
  );

  const correctPage = (
    <CorrectionsListPage
      data={corr.rows}
      isLoading={corr.loading}
      isRefreshing={corr.refreshing}
      onRefresh={() => {
        corr.setRefreshing(true);
        corr.load();
      }}
      isAdmin={corr.isAdmin}
      onApprove={corr.approve}
      onReject={corr.reject}
    />
  );

  const storicoPage = <StoricoContent />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader centerSlot={<WorkStateChip state={currentState} />} />
      <SwipeableTabs
        tabs={[
          { id: 'timbra', label: t('tabs.stamp') },
          { id: 'correct', label: t('tabs.correct'), badge: corr.pendingCount },
          { id: 'storico', label: t('tabs.storico') },
        ]}
        activeId={tab}
        onChange={setTab}>
        {[stampPage, correctPage, storicoPage]}
      </SwipeableTabs>

      {/* Anyone can file a correction for their own stamps — admins too, so
          they get a request→approve audit trail. FAB only on the Correggi
          tab, not on the stamp page. */}
      {tab === 'correct' && (
        <TouchableOpacity
          onPress={() => corr.setFormOpen(true)}
          activeOpacity={0.8}
          style={styles.fab}
          accessibilityLabel={t('correzioni:newRequest')}>
          <Ionicons name="add" size={28} color={color.onPrimary} />
        </TouchableOpacity>
      )}

      <NewCorrectionModal
        visible={corr.formOpen}
        onClose={() => corr.setFormOpen(false)}
        onCreated={async () => {
          corr.setFormOpen(false);
          await corr.load();
        }}
        branches={corr.branches}
      />

      {assignment && (
        <WeekScheduleModal
          visible={weekScheduleOpen}
          onClose={() => setWeekScheduleOpen(false)}
          assignment={assignment}
          todayDow={todayDow}
        />
      )}
    </SafeAreaView>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatLabel}>{label}</Text>
      <Text style={styles.heroStatValue}>{value}</Text>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  variant,
  loading,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  variant: 'primary' | 'secondary';
  loading: boolean;
  onPress: () => void;
}) {
  const isPrimary = variant === 'primary';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.8}
      style={[styles.actionBtn, isPrimary ? styles.actionPrimary : styles.actionSecondary, loading && { opacity: 0.6 }]}>
      {loading ? (
        <ActivityIndicator color={isPrimary ? color.onPrimary : color.primary} />
      ) : (
        <>
          <Ionicons name={icon} size={20} color={isPrimary ? color.onPrimary : color.primary} />
          <Text style={[styles.actionText, isPrimary ? styles.actionTextPrimary : styles.actionTextSecondary]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

function openShiftBranchId(stamps: DayStamp[]): string | null {
  const sorted = [...stamps].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );
  let openBranch: string | null = null;
  for (const s of sorted) {
    if (s.event_type === 'clock_in') openBranch = s.branch_id;
    else if (s.event_type === 'clock_out') openBranch = null;
  }
  return openBranch;
}

function humanEvent(e: StampEventType | null, t: TFunction): string {
  if (!e) return '–';
  return t(`common:stampEvent.${e}`);
}

// Minutes between two "HH:MM" slot bounds (same day, end ≥ start).
function slotMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number) as [number, number];
  const [eh, em] = end.split(':').map(Number) as [number, number];
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

function humanError(err: unknown, t: TFunction): string {
  const e = err as { code?: string; message?: string };
  switch (e.code) {
    case 'OUT_OF_GEOFENCE': return t('common:errors.OUT_OF_GEOFENCE');
    case 'INVALID_TRANSITION': return t('common:errors.INVALID_TRANSITION');
    case 'DUPLICATE_TOO_FAST': return t('common:errors.DUPLICATE_TOO_FAST');
    case 'GPS_REQUIRED': return t('common:errors.GPS_REQUIRED');
    case 'MOCK_LOCATION_BLOCKED': return t('common:errors.MOCK_LOCATION_BLOCKED');
    case 'STAMPING_DISABLED': return t('common:errors.STAMPING_DISABLED');
    case 'LOCATION_PERMISSION_DENIED': return t('error.LOCATION_PERMISSION_DENIED');
    case 'ACQUISITION_TIMEOUT': return t('error.ACQUISITION_TIMEOUT');
    case 'WEB_CLOCK_IN_DISABLED': return t('error.WEB_CLOCK_IN_DISABLED');
    default: return e.message ?? t('error.unknown');
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 44 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },

  heroCard: {
    marginHorizontal: 6,
    marginTop: space.s3,
    backgroundColor: color.primary,
    borderRadius: 24,
    paddingVertical: 24,
    paddingHorizontal: 20,
    shadowColor: 'rgba(0,0,0,0.12)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 4,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'flex-start' },
  heroTopCol: { flex: 1, alignItems: 'center' },
  heroTopColRight: { flex: 1, alignItems: 'center' },
  heroLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.75)',
  },
  heroAmount: {
    fontSize: 32,
    fontWeight: '700',
    color: color.onPrimary,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginVertical: 16 },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  heroStatValue: {
    fontSize: 16,
    fontWeight: '600',
    color: color.onPrimary,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  heroSep: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.15)' },

  section: { paddingHorizontal: 6, marginTop: space.s5 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: color.onSurfaceVariant,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  pillRow: { gap: space.s2, paddingHorizontal: space.s2, paddingVertical: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.surfaceVariant,
  },
  pillActive: { backgroundColor: color.primary, borderColor: color.primary },
  pillDisabled: { opacity: 0.4 },
  pillText: { fontSize: 14, fontWeight: '600', color: color.onSurfaceVariant },
  pillTextActive: { color: color.onPrimary },

  scheduleHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  weekBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.primaryContainer,
  },
  scheduleTotal: {
    fontSize: 12,
    fontWeight: '700',
    color: color.primary,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.3,
  },
  slotPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: color.primaryContainer,
  },
  slotPillText: {
    fontSize: 14,
    fontWeight: '700',
    color: color.primary,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.3,
  },
  restRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: space.s2,
    paddingHorizontal: space.s4,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderRadius: 14,
  },
  restText: { fontSize: 14, fontWeight: '600', color: color.onSurfaceVariant },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.s2,
    marginBottom: space.s2,
  },
  lockHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lockHintText: {
    fontSize: 11,
    fontWeight: '600',
    color: color.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  branchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: space.s4,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderRadius: 14,
  },
  branchRowText: { flex: 1, fontSize: 14, fontWeight: '600', color: color.onSurface },
  branchRowTag: {
    fontSize: 11,
    fontWeight: '700',
    color: color.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  actions: { paddingHorizontal: 6, marginTop: space.s5, gap: space.s3 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 24,
    minHeight: 52,
  },
  actionPrimary: {
    backgroundColor: color.primary,
    shadowColor: 'rgba(0,0,0,0.12)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 4,
  },
  actionSecondary: {
    backgroundColor: color.surfaceVariant,
  },
  actionText: { fontSize: 16, fontWeight: '600' },
  actionTextPrimary: { color: color.onPrimary },
  actionTextSecondary: { color: color.primary },

  undoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  undoText: { color: color.error, fontSize: 14, fontWeight: '600' },

  lastEvent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: space.s5,
    paddingHorizontal: 6,
  },
  lastEventText: { fontSize: 12, color: color.onSurfaceVariant },

  disabledNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    backgroundColor: color.surfaceVariant,
    borderRadius: 14,
  },
  disabledNoticeText: { flex: 1, fontSize: 13, color: color.onSurfaceVariant },

  fab: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(0,0,0,0.2)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 6,
  },
});
