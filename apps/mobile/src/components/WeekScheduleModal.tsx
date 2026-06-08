import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { color, space } from '@sonoqui/shared';
import { formatDuration } from '@sonoqui/shared';
import { localeTag } from '../i18n/format';
import type { ActiveAssignment } from '@sonoqui/shared';

interface Props {
  visible: boolean;
  onClose: () => void;
  assignment: ActiveAssignment;
  /** ISO weekday of "today" (1 = Mon … 7 = Sun), highlighted in the list. */
  todayDow: number;
}

const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7];

// Locale-derived full weekday name for an ISO weekday (1=Mon..7=Sun). Jan 1
// 2024 is a Monday, so day-of-month `iso` lands on the matching weekday.
// Mirrors apps/web/src/pages/Shifts.tsx dayLabel so labels stay in sync.
function dayLabel(iso: number): string {
  const s = new Date(Date.UTC(2024, 0, iso)).toLocaleDateString(localeTag(), { weekday: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Minutes between two "HH:MM" slot bounds (same day, end ≥ start).
function slotMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number) as [number, number];
  const [eh, em] = end.split(':').map(Number) as [number, number];
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

export function WeekScheduleModal({ visible, onClose, assignment, todayDow }: Props) {
  const { t } = useTranslation(['timbrature', 'common']);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('schedule.weekTitle')}</Text>
          <Pressable style={styles.iconBtn} onPress={onClose} accessibilityLabel={t('common:btn.close')}>
            <Ionicons name="close" size={22} color={color.onSurface} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.listContent}>
          {ISO_DAYS.map((iso) => {
            const slots = assignment.slots
              .filter((s) => s.day_of_week === iso)
              .sort((a, b) => a.start_time.localeCompare(b.start_time));
            const totalMin = slots.reduce((acc, s) => acc + slotMinutes(s.start_time, s.end_time), 0);
            const isToday = iso === todayDow;
            return (
              <View key={iso} style={[styles.dayRow, isToday && styles.dayRowToday]}>
                <Text style={[styles.dayName, isToday && styles.dayNameToday]} numberOfLines={1}>
                  {dayLabel(iso)}
                </Text>
                <View style={styles.daySlots}>
                  {slots.length > 0 ? (
                    slots.map((s, i) => (
                      <View key={i} style={styles.slotPill}>
                        <Ionicons name="time-outline" size={13} color={color.primary} />
                        <Text style={styles.slotPillText}>
                          {s.start_time}–{s.end_time}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.restText}>{t('schedule.rest')}</Text>
                  )}
                </View>
                <Text style={[styles.dayTotal, slots.length === 0 && styles.dayTotalMuted]}>
                  {slots.length > 0 ? formatDuration(totalMin * 60_000) : '—'}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.s4,
    paddingTop: space.s2,
    paddingBottom: space.s2,
  },
  title: { fontSize: 22, fontWeight: '700', color: color.onSurface, letterSpacing: -0.4 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  listContent: { paddingHorizontal: 6, paddingBottom: 32, gap: 8 },

  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: space.s4,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dayRowToday: { borderColor: color.primary, backgroundColor: color.primaryContainer },
  dayName: { width: 88, fontSize: 14, fontWeight: '600', color: color.onSurface },
  dayNameToday: { color: color.primary, fontWeight: '700' },

  daySlots: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  slotPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: color.surfaceVariant,
  },
  slotPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primary,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.3,
  },
  restText: { fontSize: 13, fontWeight: '600', color: color.onSurfaceVariant },

  dayTotal: {
    width: 56,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '700',
    color: color.primary,
    fontVariant: ['tabular-nums'],
  },
  dayTotalMuted: { color: color.onSurfaceVariant, fontWeight: '600' },
});
