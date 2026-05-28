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
import { color, space } from '@sonoqui/shared';
import { api } from '../lib/api';
import { useSession } from '../store/session';
import { useNotifications, type CorrectionRow } from '../lib/notifications';
import { AppHeader } from '../components/AppHeader';
import { WorkStateChip } from '../components/WorkStateChip';
import { DateField } from '../components/DateField';

const STATUS_FILTERS = [
  { id: 'pending', label: 'In attesa' },
  { id: 'all', label: 'Tutte' },
] as const;

const EVENT_OPTIONS: Array<{ value: StampEventType; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { value: 'clock_in', label: 'Ingresso', icon: 'log-in-outline' },
  { value: 'clock_out', label: 'Uscita', icon: 'log-out-outline' },
  { value: 'break_start', label: 'Inizio pausa', icon: 'pause-outline' },
  { value: 'break_end', label: 'Fine pausa', icon: 'play-outline' },
  { value: 'lunch_start', label: 'Inizio pausa pranzo', icon: 'restaurant-outline' },
  { value: 'lunch_end', label: 'Fine pausa pranzo', icon: 'play-outline' },
];

interface DayStamp {
  id: string;
  event_type: StampEventType;
  occurred_at: string;
  branch_id: string | null;
}

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
      <AppHeader centerSlot={<WorkStateChip />} />

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
          <CorrectionCard
            key={r.id}
            row={r}
            canDecide={isAdmin}
            onApprove={() => approve(r)}
            onReject={() => reject(r)}
          />
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
  canDecide,
  onApprove,
  onReject,
}: {
  row: CorrectionRow;
  canDecide: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const statusMeta = statusBadge(row.status);
  const isEdit = row.original_stamp_id != null && row.original_occurred_at != null;
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

      {canDecide && row.user_email && (
        <View style={styles.userRow}>
          <Ionicons name="person-outline" size={14} color={color.onSurfaceVariant} />
          <Text style={styles.userText}>{row.user_display_name || row.user_email}</Text>
        </View>
      )}

      {isEdit ? (
        <View style={styles.diffRow}>
          <View style={[styles.diffBox, styles.diffOld]}>
            <Text style={styles.diffLabel}>Attuale</Text>
            <DiffField label="Evento" value={humanEvent(row.original_event_type as StampEventType)} />
            <DiffField
              label="Quando"
              value={formatFull(row.original_occurred_at as string)}
            />
            <DiffField label="Sede" value={row.original_branch_name ?? '—'} />
          </View>
          <View style={[styles.diffBox, styles.diffNew]}>
            <Text style={styles.diffLabel}>Richiesto</Text>
            <DiffField
              label="Evento"
              value={humanEvent(row.claimed_event_type)}
              changed={row.claimed_event_type !== row.original_event_type}
            />
            <DiffField
              label="Quando"
              value={formatFull(row.claimed_occurred_at)}
              changed={
                row.original_occurred_at == null ||
                new Date(row.claimed_occurred_at).getTime() !==
                  new Date(row.original_occurred_at).getTime()
              }
            />
            <DiffField
              label="Sede"
              value={row.claimed_branch_name ?? '—'}
              changed={row.claimed_branch_id !== row.original_branch_id}
            />
          </View>
        </View>
      ) : (
        <View style={[styles.diffBox, styles.diffMissing, { marginTop: 10 }]}>
          <Text style={styles.diffLabel}>Timbratura mancante da aggiungere</Text>
          <DiffField label="Evento" value={humanEvent(row.claimed_event_type)} />
          <DiffField label="Quando" value={formatFull(row.claimed_occurred_at)} />
          <DiffField label="Sede" value={row.claimed_branch_name ?? '—'} />
        </View>
      )}

      <View style={styles.justificationBlock}>
        <Text style={styles.diffLabel}>Motivazione</Text>
        <Text style={styles.justification}>{row.justification}</Text>
      </View>

      {row.resolution_note?.trim() ? (
        <View style={[styles.noteBox, { backgroundColor: row.status === 'rejected' ? '#fde4e4' : '#e8f3ec' }]}>
          <Text style={styles.noteLabel}>Risposta approvatore</Text>
          <Text style={styles.noteText}>{row.resolution_note}</Text>
        </View>
      ) : null}

      <Text style={styles.created}>Inviata {formatFull(row.created_at)}</Text>

      {canDecide && row.status === 'pending' && (
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

function DiffField({ label, value, changed }: { label: string; value: string; changed?: boolean }) {
  return (
    <View style={styles.diffFieldRow}>
      <Text style={styles.diffFieldLabel}>{label}</Text>
      <Text style={[styles.diffFieldValue, changed && styles.diffFieldChanged]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

type ModalStep = 'date' | 'pickStamp' | 'edit';

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
  const [step, setStep] = useState<ModalStep>('date');
  const [targetDate, setTargetDate] = useState(() => isoLocal(new Date()));
  const [dayStamps, setDayStamps] = useState<DayStamp[] | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);

  const [originalStampId, setOriginalStampId] = useState<string | null>(null);
  const [eventType, setEventType] = useState<StampEventType>('clock_in');
  const [time, setTime] = useState(() => isoTime(new Date()));
  const [branchId, setBranchId] = useState<string | null>(branches[0]?.id ?? null);
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setStep('date');
      setTargetDate(isoLocal(new Date()));
      setDayStamps(null);
      setOriginalStampId(null);
      setEventType('clock_in');
      setTime(isoTime(new Date()));
      setBranchId(branches[0]?.id ?? null);
      setJustification('');
    }
  }, [visible, branches]);

  async function goToPickStamp() {
    setLoadingDay(true);
    try {
      const rows = await api<DayStamp[]>(
        `/api/v1/stamps/me?from=${targetDate}&to=${targetDate}`
      );
      // Backend returns DESC by occurred_at — flip to chronological for the picker.
      rows.sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : 1));
      setDayStamps(rows);
      setStep('pickStamp');
    } catch (e) {
      showError(e);
    } finally {
      setLoadingDay(false);
    }
  }

  function chooseExisting(s: DayStamp) {
    setOriginalStampId(s.id);
    setEventType(s.event_type);
    const d = new Date(s.occurred_at);
    setTime(isoTime(d));
    setBranchId(s.branch_id ?? branches[0]?.id ?? null);
    setStep('edit');
  }

  function chooseMissing() {
    setOriginalStampId(null);
    setEventType('clock_in');
    setTime(isoTime(new Date()));
    setBranchId(branches[0]?.id ?? null);
    setStep('edit');
  }

  async function submit() {
    if (justification.trim().length < 5) {
      Alert.alert('Motivazione', 'Spiega in almeno 5 caratteri.');
      return;
    }
    setSubmitting(true);
    try {
      const occurredAt = combineLocalDateTime(targetDate, time);
      await api('/api/v1/correction-requests', {
        method: 'POST',
        json: {
          original_stamp_id: originalStampId,
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

  function back() {
    if (step === 'edit') setStep('pickStamp');
    else if (step === 'pickStamp') setStep('date');
    else onClose();
  }

  const headerTitle =
    step === 'date'
      ? 'Quale giorno?'
      : step === 'pickStamp'
      ? formatDateLong(targetDate)
      : originalStampId
      ? 'Modifica timbratura'
      : 'Nuova timbratura';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}>
          <View style={styles.modalHeader}>
            <Pressable onPress={back} style={styles.iconBtn} accessibilityLabel="Indietro">
              <Ionicons
                name={step === 'date' ? 'close' : 'chevron-back'}
                size={22}
                color={color.onSurface}
              />
            </Pressable>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {headerTitle}
            </Text>
            <View style={styles.iconBtn} />
          </View>

          {step === 'date' && (
            <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.helperText}>
                Scegli la data per cui vuoi richiedere una correzione. Caricheremo le tue
                timbrature di quel giorno e potrai modificarle o aggiungerne una mancante.
              </Text>
              <Text style={styles.fieldLabel}>Data</Text>
              <DateField mode="date" value={targetDate} onChange={setTargetDate} maximumDate={new Date()} />
              <TouchableOpacity
                onPress={goToPickStamp}
                disabled={loadingDay}
                activeOpacity={0.85}
                style={[styles.submitBtn, loadingDay && { opacity: 0.6 }]}>
                {loadingDay ? (
                  <ActivityIndicator color={color.onPrimary} />
                ) : (
                  <>
                    <Ionicons name="arrow-forward-outline" size={18} color={color.onPrimary} />
                    <Text style={styles.submitText}>Continua</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          )}

          {step === 'pickStamp' && (
            <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.helperText}>
                Tocca una timbratura per correggerla, oppure segnala una timbratura mancante.
              </Text>

              {dayStamps && dayStamps.length === 0 && (
                <View style={styles.emptyCard}>
                  <Ionicons name="document-text-outline" size={28} color={color.onSurfaceVariant} />
                  <Text style={styles.empty}>Nessuna timbratura in questa data.</Text>
                </View>
              )}

              {dayStamps?.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  activeOpacity={0.75}
                  onPress={() => chooseExisting(s)}
                  style={styles.stampRow}>
                  <View style={[styles.eventChip, { backgroundColor: eventBg(s.event_type) }]}>
                    <Ionicons name={eventIcon(s.event_type)} size={14} color={eventFg(s.event_type)} />
                    <Text style={[styles.eventChipText, { color: eventFg(s.event_type) }]}>
                      {humanEvent(s.event_type)}
                    </Text>
                  </View>
                  <Text style={styles.stampTime}>
                    {new Date(s.occurred_at).toLocaleTimeString('it-IT', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={color.onSurfaceVariant} />
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                onPress={chooseMissing}
                activeOpacity={0.85}
                style={[styles.stampRow, styles.missingRow]}>
                <Ionicons name="add-circle-outline" size={20} color={color.primary} />
                <Text style={[styles.stampTime, { color: color.primary }]}>
                  Aggiungi una timbratura mancante
                </Text>
                <Ionicons name="chevron-forward" size={18} color={color.primary} />
              </TouchableOpacity>
            </ScrollView>
          )}

          {step === 'edit' && (
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
                  <View style={styles.fieldStatic}>
                    <Text style={styles.fieldStaticText}>{formatDateLong(targetDate)}</Text>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Ora</Text>
                  <DateField mode="time" value={time} onChange={setTime} minuteInterval={5} />
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
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function confirmAction(title: string, msg: string, fn: () => void): void {
  if (Platform.OS === 'web') {
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
  Alert.alert(title, 'Procedere senza nota?', [
    { text: 'Annulla', style: 'cancel' },
    { text: 'Rifiuta', onPress: () => fn('') },
  ]);
}

function showError(err: unknown): void {
  const e = err as { message?: string };
  if (Platform.OS === 'web') {
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
    case 'lunch_start': return 'Inizio pausa pranzo';
    case 'lunch_end': return 'Fine pausa pranzo';
  }
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

function eventBg(e: StampEventType): string {
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

function eventFg(e: StampEventType): string {
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

function formatDateLong(date: string): string {
  const [y, mo, d] = date.split('-').map((s) => parseInt(s, 10));
  return new Date(y, (mo ?? 1) - 1, d ?? 1).toLocaleDateString('it-IT', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
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

  diffRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  diffBox: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    gap: 4,
  },
  diffOld: { backgroundColor: '#fde4e4' },
  diffNew: { backgroundColor: '#e8f3ec' },
  diffMissing: { backgroundColor: color.surfaceVariant },
  diffLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: color.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  diffFieldRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  diffFieldLabel: { fontSize: 11, color: color.onSurfaceVariant, minWidth: 56 },
  diffFieldValue: { flex: 1, fontSize: 12, color: color.onSurface, fontVariant: ['tabular-nums'] },
  diffFieldChanged: { fontWeight: '700' },

  justificationBlock: { marginTop: 12 },
  justification: { marginTop: 2, fontSize: 14, color: color.onSurface, lineHeight: 20 },

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

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.s4,
    paddingTop: space.s2,
    paddingBottom: space.s3,
    gap: 8,
  },
  modalTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: color.onSurface,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formContent: { padding: 6, paddingBottom: 48, gap: 14 },
  helperText: { fontSize: 13, color: color.onSurfaceVariant, paddingHorizontal: 4, lineHeight: 18 },

  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: color.onSurfaceVariant,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
  },
  fieldStatic: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: color.surfaceVariant,
    minHeight: 48,
    justifyContent: 'center',
  },
  fieldStaticText: { fontSize: 14, color: color.onSurface },

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

  stampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.surfaceVariant,
  },
  missingRow: { borderStyle: 'dashed', borderColor: color.primary },
  stampTime: { flex: 1, fontSize: 14, fontWeight: '600', color: color.onSurface, fontVariant: ['tabular-nums'] },

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
