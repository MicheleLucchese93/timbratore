import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { StampEventType } from '@sonoqui/shared';
import { color, space, type as t } from '@sonoqui/shared';
import { api } from '../lib/api';
import { useSession } from '../store/session';
import { useNotifications, type CorrectionRow } from '../lib/notifications';
import { AppHeader } from '../components/AppHeader';

const STATUS_FILTERS = [
  { id: 'pending', label: 'In attesa' },
  { id: 'all', label: 'Tutte' },
] as const;

const EVENT_OPTIONS: Array<{ value: StampEventType; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { value: 'clock_in', label: 'Ingresso', icon: 'log-in-outline' },
  { value: 'clock_out', label: 'Uscita', icon: 'log-out-outline' },
  { value: 'break_start', label: 'Inizio pausa', icon: 'pause-outline' },
  { value: 'break_end', label: 'Fine pausa', icon: 'play-outline' },
];

export function CorrezioniScreen() {
  const { me } = useSession();
  const isAdmin = me?.user.role === 'admin';

  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [rows, setRows] = useState<CorrectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const refreshNotif = useNotifications((s) => s.refresh);

  const load = useCallback(async () => {
    try {
      const q = filter === 'pending' ? '?status=pending' : '';
      const list = await api<CorrectionRow[]>(`/api/v1/correction-requests${q}`);
      setRows(list);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function approve(cr: CorrectionRow) {
    confirmAction('Approvare?', 'La timbratura verrà creata o aggiornata.', async () => {
      try {
        await api(`/api/v1/correction-requests/${cr.id}/approve`, { method: 'POST', json: {} });
        await load();
        await refreshNotif(me?.user.role ?? 'user');
      } catch (e) {
        showError(e);
      }
    });
  }

  async function reject(cr: CorrectionRow) {
    promptNote('Motivo del rifiuto', async (note) => {
      try {
        await api(`/api/v1/correction-requests/${cr.id}/reject`, {
          method: 'POST',
          json: { resolution_note: note ?? '' },
        });
        await load();
        await refreshNotif(me?.user.role ?? 'user');
      } catch (e) {
        showError(e);
      }
    });
  }

  const pendingCount = useMemo(() => rows.filter((r) => r.status === 'pending').length, [rows]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader />
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Correzioni</Text>
        <Text style={styles.subtle}>
          {isAdmin ? 'Approva o rifiuta le richieste dei dipendenti' : 'Richiedi una rettifica delle tue timbrature'}
        </Text>
      </View>

      <View style={styles.filterRow}>
        {STATUS_FILTERS.map((f) => {
          const sel = f.id === filter;
          return (
            <TouchableOpacity
              key={f.id}
              onPress={() => setFilter(f.id)}
              activeOpacity={0.7}
              style={[styles.tabPill, sel && styles.tabPillActive]}>
              <Text style={[styles.tabPillText, sel && styles.tabPillTextActive]}>
                {f.label}
                {f.id === 'pending' && pendingCount > 0 ? ` · ${pendingCount}` : ''}
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
              load();
            }}
          />
        }>
        {loading && (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        )}
        {!loading && rows.length === 0 && (
          <View style={styles.emptyCard}>
            <Ionicons name="document-text-outline" size={32} color={color.onSurfaceVariant} />
            <Text style={styles.empty}>
              {isAdmin ? 'Nessuna richiesta da gestire.' : 'Non hai richieste.'}
            </Text>
          </View>
        )}
        {rows.map((r) => (
          <CorrectionCard key={r.id} row={r} isAdmin={isAdmin} onApprove={() => approve(r)} onReject={() => reject(r)} />
        ))}
      </ScrollView>

      {!isAdmin && (
        <TouchableOpacity
          onPress={() => setFormOpen(true)}
          activeOpacity={0.8}
          style={styles.fab}
          accessibilityLabel="Nuova richiesta">
          <Ionicons name="add" size={28} color={color.onPrimary} />
        </TouchableOpacity>
      )}

      {!isAdmin && (
        <NewRequestModal
          visible={formOpen}
          onClose={() => setFormOpen(false)}
          onCreated={async () => {
            setFormOpen(false);
            await load();
          }}
          branches={me?.branches ?? []}
        />
      )}
    </SafeAreaView>
  );
}

function CorrectionCard({
  row,
  isAdmin,
  onApprove,
  onReject,
}: {
  row: CorrectionRow;
  isAdmin: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const statusMeta = statusBadge(row.status);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.eventChip, { backgroundColor: eventBg(row.claimed_event_type) }]}>
          <Ionicons name={eventIcon(row.claimed_event_type)} size={14} color={eventFg(row.claimed_event_type)} />
          <Text style={[styles.eventChipText, { color: eventFg(row.claimed_event_type) }]}>
            {humanEvent(row.claimed_event_type)}
          </Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusMeta.bg }]}>
          <Text style={[styles.statusPillText, { color: statusMeta.fg }]}>{statusMeta.label}</Text>
        </View>
      </View>

      {isAdmin && row.user_email && (
        <View style={styles.userRow}>
          <Ionicons name="person-outline" size={14} color={color.onSurfaceVariant} />
          <Text style={styles.userText}>{row.user_email}</Text>
        </View>
      )}

      <View style={styles.metaRow}>
        <Ionicons name="time-outline" size={14} color={color.onSurfaceVariant} />
        <Text style={styles.metaText}>{formatFull(row.claimed_occurred_at)}</Text>
      </View>

      <Text style={styles.justification}>{row.justification}</Text>

      {row.resolution_note?.trim() ? (
        <View style={[styles.noteBox, { backgroundColor: row.status === 'rejected' ? '#fde4e4' : '#e8f3ec' }]}>
          <Text style={styles.noteLabel}>Risposta admin</Text>
          <Text style={styles.noteText}>{row.resolution_note}</Text>
        </View>
      ) : null}

      <Text style={styles.created}>Inviata {formatFull(row.created_at)}</Text>

      {isAdmin && row.status === 'pending' && (
        <View style={styles.actions}>
          <TouchableOpacity onPress={onReject} activeOpacity={0.8} style={[styles.actionBtn, styles.actionReject]}>
            <Ionicons name="close-outline" size={18} color={color.error} />
            <Text style={[styles.actionText, { color: color.error }]}>Rifiuta</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onApprove} activeOpacity={0.8} style={[styles.actionBtn, styles.actionApprove]}>
            <Ionicons name="checkmark-outline" size={18} color={color.onPrimary} />
            <Text style={[styles.actionText, { color: color.onPrimary }]}>Approva</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function NewRequestModal({
  visible,
  onClose,
  onCreated,
  branches,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  branches: Array<{ id: string; name: string }>;
}) {
  const [eventType, setEventType] = useState<StampEventType>('clock_in');
  const [date, setDate] = useState(() => isoLocal(new Date()));
  const [time, setTime] = useState(() => isoTime(new Date()));
  const [branchId, setBranchId] = useState<string | null>(branches[0]?.id ?? null);
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setEventType('clock_in');
      const now = new Date();
      setDate(isoLocal(now));
      setTime(isoTime(now));
      setBranchId(branches[0]?.id ?? null);
      setJustification('');
    }
  }, [visible, branches]);

  async function submit() {
    if (justification.trim().length < 5) {
      Alert.alert('Motivazione', 'Spiega in almeno 5 caratteri.');
      return;
    }
    setSubmitting(true);
    try {
      const occurredAt = combineLocalDateTime(date, time);
      await api('/api/v1/correction-requests', {
        method: 'POST',
        json: {
          claimed_event_type: eventType,
          claimed_occurred_at: occurredAt,
          claimed_branch_id: branchId,
          justification: justification.trim(),
        },
      });
      onCreated();
    } catch (e) {
      showError(e);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Nuova correzione</Text>
            <Pressable onPress={onClose} style={styles.iconBtn}>
              <Ionicons name="close" size={22} color={color.onSurface} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Tipo evento</Text>
            <View style={styles.eventGrid}>
              {EVENT_OPTIONS.map((e) => {
                const sel = e.value === eventType;
                return (
                  <Pressable
                    key={e.value}
                    onPress={() => setEventType(e.value)}
                    style={[styles.eventOpt, sel && styles.eventOptSel]}>
                    <Ionicons name={e.icon} size={18} color={sel ? color.onPrimary : color.primary} />
                    <Text style={[styles.eventOptText, sel && styles.eventOptTextSel]}>{e.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.dateRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Data</Text>
                <TextInput
                  value={date}
                  onChangeText={setDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={color.onSurfaceVariant}
                  style={styles.input}
                  autoCapitalize="none"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Ora</Text>
                <TextInput
                  value={time}
                  onChangeText={setTime}
                  placeholder="HH:MM"
                  placeholderTextColor={color.onSurfaceVariant}
                  style={styles.input}
                  autoCapitalize="none"
                />
              </View>
            </View>

            {branches.length > 1 && (
              <>
                <Text style={styles.fieldLabel}>Sede</Text>
                <View style={styles.branchRow}>
                  {branches.map((b) => {
                    const sel = b.id === branchId;
                    return (
                      <Pressable
                        key={b.id}
                        onPress={() => setBranchId(b.id)}
                        style={[styles.branchChip, sel && styles.branchChipSel]}>
                        <Text style={[styles.branchChipText, sel && styles.branchChipTextSel]}>{b.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            <Text style={styles.fieldLabel}>Motivazione</Text>
            <TextInput
              value={justification}
              onChangeText={setJustification}
              placeholder="Es. avevo dimenticato di timbrare l'uscita"
              placeholderTextColor={color.onSurfaceVariant}
              multiline
              numberOfLines={4}
              style={[styles.input, styles.textarea]}
            />

            <TouchableOpacity
              onPress={submit}
              disabled={submitting}
              activeOpacity={0.85}
              style={[styles.submitBtn, submitting && { opacity: 0.6 }]}>
              {submitting ? (
                <ActivityIndicator color={color.onPrimary} />
              ) : (
                <>
                  <Ionicons name="send-outline" size={18} color={color.onPrimary} />
                  <Text style={styles.submitText}>Invia richiesta</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function confirmAction(title: string, msg: string, fn: () => void): void {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (window.confirm(`${title}\n\n${msg}`)) fn();
    return;
  }
  Alert.alert(title, msg, [
    { text: 'Annulla', style: 'cancel' },
    { text: 'Conferma', onPress: fn },
  ]);
}

function promptNote(title: string, fn: (note: string | null) => void): void {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    const v = window.prompt(title);
    fn(v);
    return;
  }
  if (Platform.OS === 'ios') {
    Alert.prompt(
      title,
      undefined,
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Conferma', onPress: (note?: string) => fn(note ?? '') },
      ],
      'plain-text'
    );
    return;
  }
  // Android: no Alert.prompt — accept rejection with empty note
  Alert.alert(title, 'Procedere senza nota?', [
    { text: 'Annulla', style: 'cancel' },
    { text: 'Rifiuta', onPress: () => fn('') },
  ]);
}

function showError(err: unknown): void {
  const e = err as { message?: string };
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(e.message ?? 'Errore');
    return;
  }
  Alert.alert('Errore', e.message ?? 'Operazione non riuscita.');
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

function eventBg(e: StampEventType): string {
  switch (e) {
    case 'clock_in': return '#e8f3ec';
    case 'clock_out': return '#fde4e4';
    case 'break_start':
    case 'break_end':
      return '#fff3d1';
  }
}

function eventFg(e: StampEventType): string {
  switch (e) {
    case 'clock_in': return color.success;
    case 'clock_out': return color.error;
    case 'break_start':
    case 'break_end':
      return color.warning;
  }
}

function statusBadge(s: CorrectionRow['status']): { label: string; bg: string; fg: string } {
  switch (s) {
    case 'pending': return { label: 'In attesa', bg: '#fff3d1', fg: color.warning };
    case 'approved': return { label: 'Approvata', bg: '#e8f3ec', fg: color.success };
    case 'rejected': return { label: 'Rifiutata', bg: '#fde4e4', fg: color.error };
    case 'superseded': return { label: 'Superata', bg: color.surfaceVariant, fg: color.onSurfaceVariant };
  }
}

function formatFull(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function combineLocalDateTime(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map((s) => parseInt(s, 10));
  const [h, mi] = time.split(':').map((s) => parseInt(s, 10));
  const dt = new Date(y, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, 0, 0);
  return dt.toISOString();
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  headerBlock: { paddingHorizontal: 6, paddingTop: space.s2, paddingBottom: space.s3 },
  title: { fontSize: 28, fontWeight: '700', color: color.onSurface, letterSpacing: -0.5 },
  subtle: { color: color.onSurfaceVariant, marginTop: 2, fontSize: t.body.size },

  filterRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 6, paddingBottom: space.s3 },
  tabPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: color.surfaceVariant,
    alignItems: 'center',
  },
  tabPillActive: { backgroundColor: color.primary },
  tabPillText: { fontSize: 13, fontWeight: '600', color: color.onSurfaceVariant },
  tabPillTextActive: { color: color.onPrimary },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 6, paddingBottom: 96 },

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
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  eventChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  eventChipText: { fontSize: 12, fontWeight: '700' },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusPillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },

  userRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  userText: { fontSize: 13, fontWeight: '600', color: color.onSurface },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  metaText: { fontSize: 13, color: color.onSurfaceVariant, fontVariant: ['tabular-nums'] },

  justification: { marginTop: 10, fontSize: 14, color: color.onSurface, lineHeight: 20 },

  noteBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: 12,
  },
  noteLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: color.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  noteText: { fontSize: 13, color: color.onSurface, marginTop: 2 },

  created: { marginTop: 10, fontSize: 11, color: color.onSurfaceVariant },

  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 20,
  },
  actionReject: { backgroundColor: '#fde4e4' },
  actionApprove: { backgroundColor: color.primary },
  actionText: { fontSize: 14, fontWeight: '700' },

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

  // Form modal
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.s4,
    paddingTop: space.s2,
    paddingBottom: space.s3,
  },
  modalTitle: { fontSize: 22, fontWeight: '700', color: color.onSurface, letterSpacing: -0.4 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formContent: { padding: 6, paddingBottom: 48, gap: 14 },

  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: color.onSurfaceVariant,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
  },
  eventGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  eventOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.surfaceVariant,
  },
  eventOptSel: { backgroundColor: color.primary, borderColor: color.primary },
  eventOptText: { fontSize: 13, fontWeight: '600', color: color.primary },
  eventOptTextSel: { color: color.onPrimary },

  dateRow: { flexDirection: 'row', gap: 8 },
  input: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: color.onSurface,
    borderWidth: 1,
    borderColor: color.surfaceVariant,
  },
  textarea: { minHeight: 96, textAlignVertical: 'top' },

  branchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  branchChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.surfaceVariant,
  },
  branchChipSel: { backgroundColor: color.primary, borderColor: color.primary },
  branchChipText: { fontSize: 13, fontWeight: '600', color: color.onSurfaceVariant },
  branchChipTextSel: { color: color.onPrimary },

  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: color.primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 24,
    marginTop: 8,
    shadowColor: 'rgba(0,0,0,0.12)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 4,
  },
  submitText: { fontSize: 16, fontWeight: '700', color: color.onPrimary },
});
