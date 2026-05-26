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
import { color, space } from '@sonoqui/shared';
import { api } from '../lib/api';
import { useSession } from '../store/session';
import { AppHeader } from '../components/AppHeader';

type LeaveType = 'ferie' | 'permessi' | 'malattia';
type LeaveStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'cancellation_pending'
  | 'cancelled_post_approval'
  | 'superseded_by_malattia';

interface LeaveRequest {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  type: LeaveType;
  status: LeaveStatus;
  from_ts: string;
  to_ts: string;
  duration_hours: number;
  inps_protocol: string | null;
  user_note: string | null;
  rejection_reason: string | null;
  cancellation_reason: string | null;
  created_at: string;
}

interface QuotaSummary {
  type: 'ferie' | 'permessi';
  year: number;
  total: number;
  carry_in: number;
  used_approved: number;
  used_pending: number;
  residual_strict: number;
  residual_with_pending: number;
}

const TYPE_LABEL: Record<LeaveType, string> = {
  ferie: 'Ferie',
  permessi: 'Permesso',
  malattia: 'Malattia',
};

const STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'In attesa',
  approved: 'Approvata',
  rejected: 'Rifiutata',
  cancelled: 'Annullata',
  cancellation_pending: 'Annullamento richiesto',
  cancelled_post_approval: 'Annullata',
  superseded_by_malattia: 'Sostituita da malattia',
};

const TABS = [
  { id: 'mine', label: 'Le mie' },
  { id: 'inbox', label: 'Da approvare' },
] as const;

export function RichiesteScreen() {
  const { me } = useSession();
  const [tab, setTab] = useState<'mine' | 'inbox'>('mine');
  const [rows, setRows] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [quotas, setQuotas] = useState<QuotaSummary[]>([]);

  const load = useCallback(async () => {
    try {
      const list = await api<LeaveRequest[]>(`/api/v1/leaves?scope=${tab}`);
      setRows(list);
      if (tab === 'mine') {
        try {
          const q = await api<QuotaSummary[]>('/api/v1/leave-quotas/me/summary');
          setQuotas(q);
        } catch {
          setQuotas([]);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function cancel(r: LeaveRequest) {
    confirmAction('Annullare richiesta?', 'Verrà annullata definitivamente.', async () => {
      try {
        await api(`/api/v1/leaves/${r.id}/cancel`, { method: 'POST', json: {} });
        await load();
      } catch (e) {
        showError(e);
      }
    });
  }

  async function requestCancellation(r: LeaveRequest) {
    promptText('Motivo dell\'annullamento', async (reason) => {
      if (!reason || reason.trim().length < 1) return;
      try {
        await api(`/api/v1/leaves/${r.id}/request-cancellation`, {
          method: 'POST',
          json: { cancellation_reason: reason.trim() },
        });
        await load();
      } catch (e) {
        showError(e);
      }
    });
  }

  async function approve(r: LeaveRequest) {
    confirmAction('Approvare?', `${TYPE_LABEL[r.type]} • ${r.duration_hours}h`, async () => {
      try {
        await api(`/api/v1/leaves/${r.id}/approve`, { method: 'POST', json: {} });
        await load();
      } catch (e) {
        showError(e);
      }
    });
  }

  async function reject(r: LeaveRequest) {
    promptText('Motivo del rifiuto', async (reason) => {
      if (!reason || reason.trim().length < 1) {
        Alert.alert('Motivo obbligatorio', 'Inserisci un motivo per il rifiuto.');
        return;
      }
      try {
        await api(`/api/v1/leaves/${r.id}/reject`, {
          method: 'POST',
          json: { rejection_reason: reason.trim() },
        });
        await load();
      } catch (e) {
        showError(e);
      }
    });
  }

  async function decideCancel(r: LeaveRequest, approveCancel: boolean) {
    confirmAction(
      approveCancel ? 'Accettare annullamento?' : 'Rifiutare annullamento?',
      `${TYPE_LABEL[r.type]} • ${r.duration_hours}h`,
      async () => {
        try {
          await api(`/api/v1/leaves/${r.id}/decide-cancellation`, {
            method: 'POST',
            json: { approve: approveCancel },
          });
          await load();
        } catch (e) {
          showError(e);
        }
      }
    );
  }

  const pendingCount = useMemo(
    () => rows.filter((r) => r.status === 'pending').length,
    [rows]
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader />

      <View style={styles.filterRow}>
        {TABS.map((t) => {
          const sel = t.id === tab;
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => setTab(t.id)}
              activeOpacity={0.7}
              style={[styles.tabPill, sel && styles.tabPillActive]}>
              <Text style={[styles.tabPillText, sel && styles.tabPillTextActive]}>
                {t.label}
                {t.id === 'inbox' && pendingCount > 0 ? ` · ${pendingCount}` : ''}
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
        {tab === 'mine' && quotas.length > 0 && (
          <View style={styles.quotaCard}>
            {quotas.map((q) => (
              <View key={q.type} style={styles.quotaRow}>
                <Text style={styles.quotaLabel}>
                  {q.type === 'ferie' ? 'Ferie' : 'Permessi'} {q.year}
                </Text>
                <Text style={styles.quotaValue}>
                  {q.residual_strict.toFixed(2)}h
                </Text>
                <Text style={styles.quotaHint}>
                  ({q.residual_with_pending.toFixed(2)}h dopo richieste in attesa)
                </Text>
              </View>
            ))}
          </View>
        )}

        {loading && (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        )}
        {!loading && rows.length === 0 && (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={32} color={color.onSurfaceVariant} />
            <Text style={styles.empty}>
              {tab === 'inbox'
                ? 'Nessuna richiesta da approvare.'
                : 'Non hai richieste.'}
            </Text>
          </View>
        )}
        {rows.map((r) => (
          <LeaveCard
            key={r.id}
            row={r}
            tab={tab}
            myUserId={me?.user.id ?? ''}
            onApprove={() => approve(r)}
            onReject={() => reject(r)}
            onCancel={() => cancel(r)}
            onRequestCancellation={() => requestCancellation(r)}
            onDecideCancellation={(ok) => decideCancel(r, ok)}
          />
        ))}
      </ScrollView>

      {tab === 'mine' && (
        <TouchableOpacity
          onPress={() => setFormOpen(true)}
          activeOpacity={0.8}
          style={styles.fab}
          accessibilityLabel="Nuova richiesta">
          <Ionicons name="add" size={28} color={color.onPrimary} />
        </TouchableOpacity>
      )}

      <NewLeaveModal
        visible={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={async () => {
          setFormOpen(false);
          await load();
        }}
        quotas={quotas}
      />
    </SafeAreaView>
  );
}

function LeaveCard({
  row,
  tab,
  myUserId,
  onApprove,
  onReject,
  onCancel,
  onRequestCancellation,
  onDecideCancellation,
}: {
  row: LeaveRequest;
  tab: 'mine' | 'inbox';
  myUserId: string;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
  onRequestCancellation: () => void;
  onDecideCancellation: (approveCancel: boolean) => void;
}) {
  const isMine = row.user_id === myUserId;
  const status = statusBadge(row.status);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.typeChip,
            { backgroundColor: typeBg(row.type) },
          ]}>
          <Ionicons
            name={typeIcon(row.type)}
            size={14}
            color={typeFg(row.type)}
          />
          <Text style={[styles.typeChipText, { color: typeFg(row.type) }]}>
            {TYPE_LABEL[row.type]}
          </Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
          <Text style={[styles.statusPillText, { color: status.fg }]}>
            {status.label}
          </Text>
        </View>
      </View>

      {tab === 'inbox' && (
        <View style={styles.userRow}>
          <Ionicons name="person-outline" size={14} color={color.onSurfaceVariant} />
          <Text style={styles.userText}>
            {row.user_display_name || row.user_email}
          </Text>
        </View>
      )}

      <View style={styles.metaRow}>
        <Ionicons name="time-outline" size={14} color={color.onSurfaceVariant} />
        <Text style={styles.metaText}>{fmtRange(row.from_ts, row.to_ts, row.type)}</Text>
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="hourglass-outline" size={14} color={color.onSurfaceVariant} />
        <Text style={styles.metaText}>{row.duration_hours}h</Text>
      </View>

      {row.type === 'malattia' && row.inps_protocol ? (
        <View style={styles.metaRow}>
          <Ionicons name="medkit-outline" size={14} color={color.onSurfaceVariant} />
          <Text style={styles.metaText}>INPS: {row.inps_protocol}</Text>
        </View>
      ) : null}

      {row.user_note ? <Text style={styles.note}>{row.user_note}</Text> : null}

      {row.rejection_reason ? (
        <View style={[styles.noteBox, { backgroundColor: '#fde4e4' }]}>
          <Text style={styles.noteLabel}>Motivo rifiuto</Text>
          <Text style={styles.noteText}>{row.rejection_reason}</Text>
        </View>
      ) : null}
      {row.cancellation_reason ? (
        <View style={[styles.noteBox, { backgroundColor: '#fff3d1' }]}>
          <Text style={styles.noteLabel}>Annullamento</Text>
          <Text style={styles.noteText}>{row.cancellation_reason}</Text>
        </View>
      ) : null}

      {tab === 'mine' && isMine && row.status === 'pending' && (
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={onCancel}
            activeOpacity={0.8}
            style={[styles.actionBtn, styles.actionReject]}>
            <Ionicons name="close-outline" size={18} color={color.error} />
            <Text style={[styles.actionText, { color: color.error }]}>Annulla</Text>
          </TouchableOpacity>
        </View>
      )}

      {tab === 'mine' &&
        isMine &&
        row.status === 'approved' &&
        row.type !== 'malattia' && (
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={onRequestCancellation}
              activeOpacity={0.8}
              style={[styles.actionBtn, styles.actionReject]}>
              <Ionicons name="close-outline" size={18} color={color.error} />
              <Text style={[styles.actionText, { color: color.error }]}>
                Richiedi annullamento
              </Text>
            </TouchableOpacity>
          </View>
        )}

      {tab === 'inbox' && row.status === 'pending' && (
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={onReject}
            activeOpacity={0.8}
            style={[styles.actionBtn, styles.actionReject]}>
            <Ionicons name="close-outline" size={18} color={color.error} />
            <Text style={[styles.actionText, { color: color.error }]}>Rifiuta</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onApprove}
            activeOpacity={0.8}
            style={[styles.actionBtn, styles.actionApprove]}>
            <Ionicons name="checkmark-outline" size={18} color={color.onPrimary} />
            <Text style={[styles.actionText, { color: color.onPrimary }]}>
              Approva
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {tab === 'inbox' && row.status === 'cancellation_pending' && (
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={() => onDecideCancellation(false)}
            activeOpacity={0.8}
            style={[styles.actionBtn, styles.actionReject]}>
            <Text style={[styles.actionText, { color: color.error }]}>Rifiuta</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onDecideCancellation(true)}
            activeOpacity={0.8}
            style={[styles.actionBtn, styles.actionApprove]}>
            <Text style={[styles.actionText, { color: color.onPrimary }]}>
              Accetta annullamento
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.created}>Inviata {fmtFull(row.created_at)}</Text>
    </View>
  );
}

function NewLeaveModal({
  visible,
  onClose,
  onCreated,
  quotas,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  quotas: QuotaSummary[];
}) {
  const [type, setType] = useState<LeaveType>('ferie');
  const [fromDate, setFromDate] = useState(() => isoLocal(new Date()));
  const [toDate, setToDate] = useState(() => isoLocal(new Date()));
  const [fromTime, setFromTime] = useState('09:00');
  const [toTime, setToTime] = useState('13:00');
  const [inpsProtocol, setInpsProtocol] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setType('ferie');
      const t = isoLocal(new Date());
      setFromDate(t);
      setToDate(t);
      setFromTime('09:00');
      setToTime('13:00');
      setInpsProtocol('');
      setNote('');
    }
  }, [visible]);

  async function submit() {
    if (type === 'malattia' && !inpsProtocol.trim()) {
      Alert.alert(
        'Protocollo INPS',
        'Inserisci il numero di protocollo INPS della malattia.'
      );
      return;
    }
    const useTime = type === 'permessi';
    const from = useTime
      ? combineLocalDateTime(fromDate, fromTime)
      : combineLocalDateTime(fromDate, '00:00');
    const to = useTime
      ? combineLocalDateTime(toDate, toTime)
      : combineLocalDateTime(toDate, '23:59');
    if (new Date(to).getTime() <= new Date(from).getTime()) {
      Alert.alert('Periodo', 'L\'orario di fine deve essere dopo l\'inizio.');
      return;
    }
    setSubmitting(true);
    try {
      await api('/api/v1/leaves', {
        method: 'POST',
        json: {
          type,
          from_ts: from,
          to_ts: to,
          inps_protocol: type === 'malattia' ? inpsProtocol.trim() : undefined,
          user_note: note.trim() || undefined,
        },
      });
      onCreated();
    } catch (e) {
      showError(e);
    } finally {
      setSubmitting(false);
    }
  }

  const residual = quotas.find(
    (q) => q.type === (type === 'malattia' ? 'ferie' : type)
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Nuova richiesta</Text>
            <Pressable onPress={onClose} style={styles.iconBtn}>
              <Ionicons name="close" size={22} color={color.onSurface} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Tipo</Text>
            <View style={styles.typeGrid}>
              {(['ferie', 'permessi', 'malattia'] as LeaveType[]).map((t) => {
                const sel = t === type;
                return (
                  <Pressable
                    key={t}
                    onPress={() => setType(t)}
                    style={[styles.typeOpt, sel && styles.typeOptSel]}>
                    <Ionicons
                      name={typeIcon(t)}
                      size={18}
                      color={sel ? color.onPrimary : color.primary}
                    />
                    <Text
                      style={[
                        styles.typeOptText,
                        sel && styles.typeOptTextSel,
                      ]}>
                      {TYPE_LABEL[t]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {type !== 'malattia' && residual && (
              <Text style={styles.quotaHintInline}>
                Disponibili: {residual.residual_strict.toFixed(2)}h ·{' '}
                <Text style={{ opacity: 0.7 }}>
                  {residual.residual_with_pending.toFixed(2)}h dopo richieste in
                  attesa
                </Text>
              </Text>
            )}

            <View style={styles.dateRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Dal</Text>
                <TextInput
                  value={fromDate}
                  onChangeText={(v) => {
                    setFromDate(v);
                    if (v > toDate) setToDate(v);
                  }}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={color.onSurfaceVariant}
                  style={styles.input}
                  autoCapitalize="none"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Al</Text>
                <TextInput
                  value={toDate}
                  onChangeText={setToDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={color.onSurfaceVariant}
                  style={styles.input}
                  autoCapitalize="none"
                />
              </View>
            </View>

            {type === 'permessi' && (
              <View style={styles.dateRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Ora inizio</Text>
                  <TextInput
                    value={fromTime}
                    onChangeText={setFromTime}
                    placeholder="HH:MM"
                    placeholderTextColor={color.onSurfaceVariant}
                    style={styles.input}
                    autoCapitalize="none"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Ora fine</Text>
                  <TextInput
                    value={toTime}
                    onChangeText={setToTime}
                    placeholder="HH:MM"
                    placeholderTextColor={color.onSurfaceVariant}
                    style={styles.input}
                    autoCapitalize="none"
                  />
                </View>
              </View>
            )}

            {type === 'malattia' && (
              <>
                <Text style={styles.fieldLabel}>Numero protocollo INPS</Text>
                <TextInput
                  value={inpsProtocol}
                  onChangeText={setInpsProtocol}
                  placeholder="es. 1234567890"
                  placeholderTextColor={color.onSurfaceVariant}
                  style={styles.input}
                  autoCapitalize="none"
                />
              </>
            )}

            <Text style={styles.fieldLabel}>Note (facoltative)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Es. matrimonio fratello"
              placeholderTextColor={color.onSurfaceVariant}
              multiline
              numberOfLines={3}
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

/* ----- helpers ----- */

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

function promptText(title: string, fn: (text: string | null) => void): void {
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
        { text: 'Conferma', onPress: (t?: string) => fn(t ?? '') },
      ],
      'plain-text'
    );
    return;
  }
  Alert.alert(title, 'Su Android conferma senza testo aggiuntivo.', [
    { text: 'Annulla', style: 'cancel' },
    { text: 'Conferma', onPress: () => fn('motivo non specificato') },
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

function typeIcon(t: LeaveType): keyof typeof Ionicons.glyphMap {
  if (t === 'ferie') return 'sunny-outline';
  if (t === 'permessi') return 'time-outline';
  return 'medkit-outline';
}

function typeBg(t: LeaveType): string {
  if (t === 'ferie') return '#e0f2fe';
  if (t === 'permessi') return '#fff3d1';
  return '#fde4e4';
}

function typeFg(t: LeaveType): string {
  if (t === 'ferie') return '#0369a1';
  if (t === 'permessi') return color.warning;
  return color.error;
}

function statusBadge(s: LeaveStatus): { label: string; bg: string; fg: string } {
  if (s === 'approved') return { label: STATUS_LABEL[s], bg: '#e8f3ec', fg: color.success };
  if (s === 'rejected' || s === 'superseded_by_malattia')
    return { label: STATUS_LABEL[s], bg: '#fde4e4', fg: color.error };
  if (s === 'pending' || s === 'cancellation_pending')
    return { label: STATUS_LABEL[s], bg: '#fff3d1', fg: color.warning };
  return { label: STATUS_LABEL[s], bg: color.surfaceVariant, fg: color.onSurfaceVariant };
}

function fmtFull(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtRange(from: string, to: string, type: LeaveType): string {
  const f = new Date(from);
  const t = new Date(to);
  const sameDay = f.toDateString() === t.toDateString();
  const d: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
  const h: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (type === 'permessi' && sameDay) {
    return `${f.toLocaleDateString('it-IT', d)} ${f.toLocaleTimeString('it-IT', h)}–${t.toLocaleTimeString('it-IT', h)}`;
  }
  if (sameDay) return f.toLocaleDateString('it-IT', d);
  return `${f.toLocaleDateString('it-IT', d)} → ${t.toLocaleDateString('it-IT', d)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function combineLocalDateTime(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map((s) => parseInt(s, 10));
  const [h, mi] = time.split(':').map((s) => parseInt(s, 10));
  const dt = new Date(y, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, 0, 0);
  return dt.toISOString();
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },

  filterRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 6,
    paddingBottom: space.s3,
  },
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

  quotaCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    marginBottom: space.s3,
    gap: 6,
  },
  quotaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  quotaLabel: { fontSize: 13, fontWeight: '600', color: color.onSurface },
  quotaValue: { fontSize: 16, fontWeight: '700', color: color.primary },
  quotaHint: { fontSize: 11, color: color.onSurfaceVariant },
  quotaHintInline: {
    fontSize: 12,
    color: color.onSurfaceVariant,
    paddingHorizontal: 4,
  },

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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  typeChipText: { fontSize: 12, fontWeight: '700' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  userText: { fontSize: 13, fontWeight: '600', color: color.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  metaText: {
    fontSize: 13,
    color: color.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  note: { marginTop: 10, fontSize: 14, color: color.onSurface, lineHeight: 20 },
  noteBox: { marginTop: 12, padding: 10, borderRadius: 12 },
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
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: color.onSurface,
    letterSpacing: -0.4,
  },
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
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeOpt: {
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
  typeOptSel: { backgroundColor: color.primary, borderColor: color.primary },
  typeOptText: { fontSize: 13, fontWeight: '600', color: color.primary },
  typeOptTextSel: { color: color.onPrimary },

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
