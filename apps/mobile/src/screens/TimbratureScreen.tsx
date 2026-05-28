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
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../store/session';
import { api } from '../lib/api';
import { acquireLocation } from '../lib/acquire-location';
import { enqueueStamp, drainQueue } from '../lib/offline-queue';
import { stateFromLastEvent } from '@sonoqui/shared';
import type { StampEventType } from '@sonoqui/shared';
import { color, space, type as t } from '@sonoqui/shared';
import { formatDuration, isoDay, type DayStamp } from '../lib/day-totals';
import { computeCountedDay, type ActiveAssignment } from '../lib/counted-day';
import { AppHeader } from '../components/AppHeader';
import { WorkStateChip } from '../components/WorkStateChip';

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
  const { me } = useSession();
  const [state, setState] = useState<CurrentState | null>(null);
  const [todayStamps, setTodayStamps] = useState<DayStamp[]>([]);
  const [assignment, setAssignment] = useState<ActiveAssignment | null>(null);
  const [working, setWorking] = useState<StampEventType | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [lastSubmittedAt, setLastSubmittedAt] = useState<Date | null>(null);
  const [lastUndoId, setLastUndoId] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

  const branches = me?.branches ?? [];

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
      const [s, list, a] = await Promise.all([
        api<CurrentState>('/api/v1/stamps/me/current-state'),
        api<DayStamp[]>(`/api/v1/stamps/me?from=${today}&to=${today}`),
        api<ActiveAssignment | null>('/api/v1/shifts/assignments/me').catch(() => null),
      ]);
      setState(s);
      setTodayStamps(list);
      setAssignment(a);
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
      if (!selectedBranch.smart_working) {
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
        const created = await api<{ id: string }>('/api/v1/stamps', {
          method: 'POST',
          headers: { 'Idempotency-Key': idem },
          json: payload,
        });
        setLastSubmittedAt(occurredAt);
        setLastUndoId(created.id);
        await fetchAll();
      } catch (err) {
        const e = err as { code?: string; message?: string };
        if (!e.code || e.code === 'NETWORK' || e.message?.includes('Network')) {
          enqueueStamp(idem, payload);
          alertCross('Senza connessione', 'Timbratura accodata. Verrà inviata quando torni online.');
        } else {
          alertCross('Timbratura non riuscita', humanError(e));
        }
      }
    } catch (err) {
      alertCross('Posizione GPS', humanError(err));
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
      alertCross('Impossibile annullare', humanError(err));
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
  const lockedBranchId = branchLocked ? openShiftBranchId(todayStamps) : null;
  const totals = computeCountedDay(todayStamps, assignment, now);

  useEffect(() => {
    if (branchLocked && lockedBranchId && selectedBranchId !== lockedBranchId) {
      setSelectedBranchId(lockedBranchId);
    }
  }, [branchLocked, lockedBranchId, selectedBranchId]);
  const buttons: Array<{ event: StampEventType; label: string; icon: keyof typeof Ionicons.glyphMap; variant: 'primary' | 'secondary' }> = [];
  if (currentState === 'nothing') {
    buttons.push({ event: 'clock_in', label: 'Timbra ingresso', icon: 'log-in-outline', variant: 'primary' });
  } else if (currentState === 'clocked_in') {
    buttons.push({ event: 'clock_out', label: 'Timbra uscita', icon: 'log-out-outline', variant: 'primary' });
    buttons.push({ event: 'break_start', label: 'Inizia pausa', icon: 'pause-outline', variant: 'secondary' });
    buttons.push({ event: 'lunch_start', label: 'Inizia pausa pranzo', icon: 'restaurant-outline', variant: 'secondary' });
  } else if (currentState === 'on_break') {
    buttons.push({ event: 'break_end', label: 'Termina pausa', icon: 'play-outline', variant: 'primary' });
  } else if (currentState === 'on_lunch') {
    buttons.push({ event: 'lunch_end', label: 'Termina pausa pranzo', icon: 'play-outline', variant: 'primary' });
  }
  const undoVisible =
    lastUndoId && lastSubmittedAt && Date.now() - lastSubmittedAt.getTime() < 60_000;

  const stateMeta = stateBadge(currentState);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader centerSlot={<WorkStateChip state={currentState} />} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroTopCol}>
              <Text style={styles.heroLabel}>Ore lavorate</Text>
              <Text style={styles.heroAmount}>{formatDuration(totals.workedMs)}</Text>
            </View>
            <View style={styles.heroTopColRight}>
              <Text style={styles.heroLabel}>Ore conteggiate</Text>
              <Text style={styles.heroAmount}>
                {assignment ? formatDuration(totals.countedTotalMs) : '—'}
              </Text>
            </View>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroRow}>
            <HeroStat label="Entrata" value={totals.firstInAt ? formatTime(totals.firstInAt) : '—'} />
            <View style={styles.heroSep} />
            <HeroStat label="Pause" value={formatDuration(totals.breakMs)} />
            <View style={styles.heroSep} />
            <HeroStat
              label="Uscita"
              value={totals.lastOutAt && !totals.isOpen ? formatTime(totals.lastOutAt) : '—'}
            />
          </View>
        </View>

        {branches.length > 1 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Sede</Text>
              {branchLocked && (
                <View style={styles.lockHint}>
                  <Ionicons name="lock-closed" size={11} color={color.onSurfaceVariant} />
                  <Text style={styles.lockHintText}>Bloccata fino all'uscita</Text>
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
                <Text style={styles.branchRowTag}>Smart working</Text>
              )}
            </View>
          </View>
        )}

        <View style={styles.actions}>
          {buttons.map((b) => (
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
              <Text style={styles.undoText}>Annulla ultima timbratura</Text>
            </TouchableOpacity>
          )}
        </View>

        {state?.lastEventAt && (
          <View style={styles.lastEvent}>
            <Ionicons name="time-outline" size={14} color={color.onSurfaceVariant} />
            <Text style={styles.lastEventText}>
              Ultimo evento: {humanEvent(state.lastEvent)} alle {formatTime(state.lastEventAt)}
            </Text>
          </View>
        )}
      </ScrollView>
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

function stateBadge(s: 'nothing' | 'clocked_in' | 'on_break' | 'on_lunch'): { label: string; bg: string; fg: string } {
  if (s === 'clocked_in') return { label: 'Al lavoro', bg: '#e8f3ec', fg: color.success };
  if (s === 'on_break') return { label: 'In pausa', bg: '#fff3d1', fg: color.warning };
  if (s === 'on_lunch') return { label: 'In pausa pranzo', bg: '#fff3d1', fg: color.warning };
  return { label: 'Fuori servizio', bg: color.surfaceVariant, fg: color.onSurfaceVariant };
}

function humanEvent(e: StampEventType | null): string {
  switch (e) {
    case 'clock_in': return 'Ingresso';
    case 'clock_out': return 'Uscita';
    case 'break_start': return 'Inizio pausa';
    case 'break_end': return 'Fine pausa';
    case 'lunch_start': return 'Inizio pausa pranzo';
    case 'lunch_end': return 'Fine pausa pranzo';
    default: return '–';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function humanError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  switch (e.code) {
    case 'OUT_OF_GEOFENCE': return 'Sei fuori dall\'area consentita.';
    case 'INVALID_TRANSITION': return 'Operazione non valida per lo stato attuale.';
    case 'DUPLICATE_TOO_FAST': return 'Hai già timbrato pochi secondi fa.';
    case 'GPS_ACCURACY_TOO_LOW': return 'Il segnale GPS è troppo debole.';
    case 'GPS_REQUIRED': return 'Serve il GPS per timbrare.';
    case 'MOCK_LOCATION_BLOCKED': return 'Posizione finta non consentita.';
    case 'LOCATION_PERMISSION_DENIED': return 'Permesso posizione negato. Vai alle Impostazioni.';
    case 'ACQUISITION_TIMEOUT': return 'GPS non disponibile. Spostati all\'aperto e riprova.';
    case 'WEB_CLOCK_IN_DISABLED': return 'Timbratura da web non consentita per questo utente.';
    default: return e.message ?? 'Errore sconosciuto.';
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 44 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },

  statePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statePillDot: { width: 6, height: 6, borderRadius: 3 },
  statePillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },

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
});
