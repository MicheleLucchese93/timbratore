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
import { WorkStateChip } from '../components/WorkStateChip';
import { DateField } from '../components/DateField';
import { SwipeableTabs } from '../components/SwipeableTabs';

interface Approver {
  user_id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'user' | null;
}

type LeaveType = 'ferie' | 'permessi' | 'malattia' | 'assenza';
type AssenzaSubtype =
  | 'lutto'
  | 'donazione_sangue'
  | 'permesso_studio'
  | 'permesso_elettorale'
  | 'matrimonio'
  | 'allattamento'
  | 'congedo_parentale'
  | 'legge_104'
  | 'assemblea_sindacale'
  | 'visita_medica'
  | 'motivi_personali';
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
  assenza_subtype: AssenzaSubtype | null;
  is_paid: boolean | null;
  created_at: string;
}

interface QuotaSummary {
  type: 'ferie' | 'permessi';
  assignment_id: string | null;
  template_id: string | null;
  template_name: string | null;
  initial_balance: number;
  accrued_total: number;
  used_approved: number;
  used_pending: number;
  residual_strict: number;
  residual_with_pending: number;
  last_accrual_on: string | null;
  accrual_amount: number;
  accrual_frequency: 'monthly' | 'yearly';
  accrual_day_of_month: number;
  accrual_month: number | null;
}

const TYPE_LABEL: Record<LeaveType, string> = {
  ferie: 'Ferie',
  permessi: 'Permesso',
  malattia: 'Malattia',
  assenza: 'Assenza',
};

const ASSENZA_SUBTYPE_LABEL: Record<AssenzaSubtype, string> = {
  lutto: 'Lutto',
  donazione_sangue: 'Donazione sangue',
  permesso_studio: 'Permesso studio (diritto allo studio)',
  permesso_elettorale: 'Permesso elettorale',
  matrimonio: 'Matrimonio',
  allattamento: 'Allattamento',
  congedo_parentale: 'Congedo parentale',
  legge_104: 'Legge 104 (assistenza disabili)',
  assemblea_sindacale: 'Assemblea sindacale',
  visita_medica: 'Visita medica',
  motivi_personali: 'Motivi personali',
};

const ASSENZA_SUBTYPES_ORDER: AssenzaSubtype[] = [
  'lutto',
  'donazione_sangue',
  'visita_medica',
  'permesso_studio',
  'matrimonio',
  'allattamento',
  'congedo_parentale',
  'legge_104',
  'assemblea_sindacale',
  'permesso_elettorale',
  'motivi_personali',
];

const STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'In attesa',
  approved: 'Approvata',
  rejected: 'Rifiutata',
  cancelled: 'Annullata',
  cancellation_pending: 'Annullamento richiesto',
  cancelled_post_approval: 'Annullata',
  superseded_by_malattia: 'Sostituita da malattia',
};

type RichiesteTab = 'mine' | 'inbox';

export function RichiesteScreen() {
  const { me } = useSession();
  const [tab, setTab] = useState<RichiesteTab>('mine');
  const [mineRows, setMineRows] = useState<LeaveRequest[]>([]);
  const [inboxRows, setInboxRows] = useState<LeaveRequest[]>([]);
  const [loadingMine, setLoadingMine] = useState(true);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [refreshingMine, setRefreshingMine] = useState(false);
  const [refreshingInbox, setRefreshingInbox] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [quotas, setQuotas] = useState<QuotaSummary[]>([]);

  const loadMine = useCallback(async () => {
    try {
      const [list, q] = await Promise.all([
        api<LeaveRequest[]>('/api/v1/leaves?scope=mine'),
        api<QuotaSummary[]>('/api/v1/leave-quotas/me/summary').catch(() => [] as QuotaSummary[]),
      ]);
      setMineRows(list);
      setQuotas(q);
    } catch {
      /* ignore */
    } finally {
      setLoadingMine(false);
      setRefreshingMine(false);
    }
  }, []);

  const loadInbox = useCallback(async () => {
    try {
      const list = await api<LeaveRequest[]>('/api/v1/leaves?scope=inbox');
      setInboxRows(list);
    } catch {
      /* ignore */
    } finally {
      setLoadingInbox(false);
      setRefreshingInbox(false);
    }
  }, []);

  const load = useCallback(async () => {
    await Promise.all([loadMine(), loadInbox()]);
  }, [loadMine, loadInbox]);

  useEffect(() => {
    loadMine();
    loadInbox();
  }, [loadMine, loadInbox]);

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

  const pendingInboxCount = useMemo(
    () => inboxRows.filter((r) => r.status === 'pending').length,
    [inboxRows]
  );

  const renderMinePage = (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshingMine}
          onRefresh={() => {
            setRefreshingMine(true);
            loadMine();
          }}
        />
      }>
      {quotas.length > 0 && (
        <View style={styles.quotaCard}>
          <Text style={styles.quotaCardTitle}>Disponibilità</Text>
          {quotas.map((q) => (
            <View key={q.type} style={styles.quotaItem}>
              <View style={styles.quotaItemHeader}>
                <View style={styles.quotaItemTitleRow}>
                  <Ionicons
                    name={typeIcon(q.type)}
                    size={16}
                    color={typeFg(q.type)}
                  />
                  <Text style={styles.quotaItemTitle}>
                    {q.type === 'ferie' ? 'Ferie' : 'Permessi'}
                  </Text>
                </View>
                <Text style={[styles.quotaItemResidual, { color: typeFg(q.type) }]}>
                  {q.residual_strict.toFixed(2)}h
                </Text>
              </View>
              <View style={styles.quotaBreakdownRow}>
                <QuotaStat label="Iniziale" value={q.initial_balance} />
                <QuotaStat label="Maturate" value={q.accrued_total} />
                <QuotaStat label="Usate" value={q.used_approved} />
                {q.used_pending > 0 && (
                  <QuotaStat label="In attesa" value={q.used_pending} />
                )}
              </View>
              {q.used_pending > 0 && (
                <Text style={styles.quotaPendingHint}>
                  Residuo dopo richieste in attesa: {q.residual_with_pending.toFixed(2)}h
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
      {loadingMine && (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      )}
      {!loadingMine && mineRows.length === 0 && (
        <View style={styles.emptyCard}>
          <Ionicons name="calendar-outline" size={32} color={color.onSurfaceVariant} />
          <Text style={styles.empty}>Non hai richieste.</Text>
        </View>
      )}
      {mineRows.map((r) => (
        <LeaveCard
          key={r.id}
          row={r}
          tab="mine"
          myUserId={me?.user.id ?? ''}
          onApprove={() => approve(r)}
          onReject={() => reject(r)}
          onCancel={() => cancel(r)}
          onRequestCancellation={() => requestCancellation(r)}
          onDecideCancellation={(ok) => decideCancel(r, ok)}
        />
      ))}
    </ScrollView>
  );

  const renderInboxPage = (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshingInbox}
          onRefresh={() => {
            setRefreshingInbox(true);
            loadInbox();
          }}
        />
      }>
      {loadingInbox && (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      )}
      {!loadingInbox && inboxRows.length === 0 && (
        <View style={styles.emptyCard}>
          <Ionicons name="calendar-outline" size={32} color={color.onSurfaceVariant} />
          <Text style={styles.empty}>Nessuna richiesta da approvare.</Text>
        </View>
      )}
      {inboxRows.map((r) => (
        <LeaveCard
          key={r.id}
          row={r}
          tab="inbox"
          myUserId={me?.user.id ?? ''}
          onApprove={() => approve(r)}
          onReject={() => reject(r)}
          onCancel={() => cancel(r)}
          onRequestCancellation={() => requestCancellation(r)}
          onDecideCancellation={(ok) => decideCancel(r, ok)}
        />
      ))}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader centerSlot={<WorkStateChip />} />

      <SwipeableTabs
        tabs={[
          { id: 'mine', label: 'Le mie' },
          { id: 'inbox', label: 'Da approvare', badge: pendingInboxCount },
        ]}
        activeId={tab}
        onChange={setTab}>
        {[renderMinePage, renderInboxPage]}
      </SwipeableTabs>

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

      {row.type === 'assenza' && row.assenza_subtype ? (
        <View style={styles.metaRow}>
          <Ionicons
            name="bookmark-outline"
            size={14}
            color={color.onSurfaceVariant}
          />
          <Text style={styles.metaText}>
            {ASSENZA_SUBTYPE_LABEL[row.assenza_subtype]} ·{' '}
            {row.is_paid ? 'retribuita' : 'non retribuita'}
          </Text>
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
  const { me } = useSession();
  const [type, setType] = useState<LeaveType>('ferie');
  const [allDay, setAllDay] = useState(true);
  const [fromDate, setFromDate] = useState(() => isoLocal(new Date()));
  const [toDate, setToDate] = useState(() => isoLocal(new Date()));
  const [fromTime, setFromTime] = useState('09:00');
  const [toTime, setToTime] = useState('13:00');
  const [inpsProtocol, setInpsProtocol] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [assenzaSubtype, setAssenzaSubtype] =
    useState<AssenzaSubtype>('motivi_personali');
  const [isPaid, setIsPaid] = useState(true);
  const [subtypePickerOpen, setSubtypePickerOpen] = useState(false);

  useEffect(() => {
    if (visible) {
      setType('ferie');
      setAllDay(true);
      const t = isoLocal(new Date());
      setFromDate(t);
      setToDate(t);
      setFromTime('09:00');
      setToTime('13:00');
      setInpsProtocol('');
      setNote('');
      setAssenzaSubtype('motivi_personali');
      setIsPaid(true);
      setSubtypePickerOpen(false);
    }
  }, [visible]);

  // Load approver list once when the modal is opened. We only show it for
  // ferie/permessi (malattia is just a notification — no approval needed).
  useEffect(() => {
    if (!visible || !me?.user.id) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await api<Approver[]>(
          `/api/v1/users/${me.user.id}/approvers`
        );
        if (!cancelled) setApprovers(list);
      } catch {
        if (!cancelled) setApprovers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, me?.user.id]);

  async function submit() {
    if (type === 'malattia' && !inpsProtocol.trim()) {
      Alert.alert(
        'Protocollo INPS',
        'Inserisci il numero di protocollo INPS della malattia.'
      );
      return;
    }
    if (type === 'assenza' && note.trim().length === 0) {
      Alert.alert(
        'Motivazione',
        'Inserisci una motivazione per l\'assenza.'
      );
      return;
    }
    // Ferie and permessi carry start/end times (15-min slots) when the user
    // unticks "Tutto il giorno". Otherwise (and always for malattia /
    // assenza) the request covers the full day(s).
    const useTime = (type === 'ferie' || type === 'permessi') && !allDay;
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
          assenza_subtype: type === 'assenza' ? assenzaSubtype : undefined,
          is_paid: type === 'assenza' ? isPaid : undefined,
        },
      });
      onCreated();
    } catch (e) {
      showError(e);
    } finally {
      setSubmitting(false);
    }
  }

  const residual =
    type === 'ferie' || type === 'permessi'
      ? quotas.find((q) => q.type === type)
      : undefined;

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
              {(['ferie', 'permessi', 'malattia', 'assenza'] as LeaveType[]).map(
                (t) => {
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
                }
              )}
            </View>

            {residual && (
              <Text style={styles.quotaHintInline}>
                Disponibili: {residual.residual_strict.toFixed(2)}h ·{' '}
                <Text style={{ opacity: 0.7 }}>
                  {residual.residual_with_pending.toFixed(2)}h dopo richieste in
                  attesa
                </Text>
              </Text>
            )}

            {type === 'assenza' && (
              <>
                <Text style={styles.fieldLabel}>Tipologia di assenza</Text>
                <Pressable
                  onPress={() => setSubtypePickerOpen((v) => !v)}
                  style={styles.subtypeBtn}>
                  <Text style={styles.subtypeBtnText}>
                    {ASSENZA_SUBTYPE_LABEL[assenzaSubtype]}
                  </Text>
                  <Ionicons
                    name={subtypePickerOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={color.onSurfaceVariant}
                  />
                </Pressable>
                {subtypePickerOpen && (
                  <View style={styles.subtypeList}>
                    {ASSENZA_SUBTYPES_ORDER.map((s) => {
                      const sel = s === assenzaSubtype;
                      return (
                        <Pressable
                          key={s}
                          onPress={() => {
                            setAssenzaSubtype(s);
                            setSubtypePickerOpen(false);
                          }}
                          style={[
                            styles.subtypeRow,
                            sel && styles.subtypeRowSel,
                          ]}>
                          <Text
                            style={[
                              styles.subtypeRowText,
                              sel && styles.subtypeRowTextSel,
                            ]}>
                            {ASSENZA_SUBTYPE_LABEL[s]}
                          </Text>
                          {sel && (
                            <Ionicons
                              name="checkmark"
                              size={16}
                              color={color.primary}
                            />
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                <Text style={styles.fieldLabel}>Retribuzione</Text>
                <View style={styles.allDayRow}>
                  <Pressable
                    onPress={() => setIsPaid(true)}
                    style={[
                      styles.allDayOpt,
                      isPaid && styles.allDayOptSel,
                    ]}>
                    <Text
                      style={[
                        styles.allDayOptText,
                        isPaid && styles.allDayOptTextSel,
                      ]}>
                      Retribuita
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setIsPaid(false)}
                    style={[
                      styles.allDayOpt,
                      !isPaid && styles.allDayOptSel,
                    ]}>
                    <Text
                      style={[
                        styles.allDayOptText,
                        !isPaid && styles.allDayOptTextSel,
                      ]}>
                      Non retribuita
                    </Text>
                  </Pressable>
                </View>
              </>
            )}

            <View style={styles.dateRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Dal</Text>
                <DateField
                  mode="date"
                  value={fromDate}
                  onChange={(v) => {
                    setFromDate(v);
                    if (v > toDate) setToDate(v);
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Al</Text>
                <DateField mode="date" value={toDate} onChange={setToDate} />
              </View>
            </View>

            {(type === 'ferie' || type === 'permessi') && (
              <>
                <Text style={styles.fieldLabel}>Durata</Text>
                <View style={styles.allDayRow}>
                  <Pressable
                    onPress={() => setAllDay(true)}
                    style={[
                      styles.allDayOpt,
                      allDay && styles.allDayOptSel,
                    ]}>
                    <Text
                      style={[
                        styles.allDayOptText,
                        allDay && styles.allDayOptTextSel,
                      ]}>
                      Tutto il giorno
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setAllDay(false)}
                    style={[
                      styles.allDayOpt,
                      !allDay && styles.allDayOptSel,
                    ]}>
                    <Text
                      style={[
                        styles.allDayOptText,
                        !allDay && styles.allDayOptTextSel,
                      ]}>
                      Orario specifico
                    </Text>
                  </Pressable>
                </View>
                {!allDay && (
                  <View style={styles.dateRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Ora inizio</Text>
                      <DateField
                        mode="time"
                        value={fromTime}
                        onChange={setFromTime}
                        minuteInterval={15}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Ora fine</Text>
                      <DateField
                        mode="time"
                        value={toTime}
                        onChange={setToTime}
                        minuteInterval={15}
                      />
                    </View>
                  </View>
                )}
              </>
            )}

            {type !== 'malattia' && (
              <View style={styles.approverBox}>
                <Ionicons
                  name="person-outline"
                  size={14}
                  color={color.onSurfaceVariant}
                />
                <Text style={styles.approverText}>
                  {approvers.length === 0
                    ? 'Nessun approvatore configurato'
                    : `Approvatore: ${approvers
                        .map((a) => a.display_name || a.email)
                        .join(', ')}`}
                </Text>
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

            <Text style={styles.fieldLabel}>
              {type === 'assenza' ? 'Motivazione' : 'Note (facoltative)'}
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={notePlaceholder(type)}
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
                  <Text style={styles.submitText}>
                    {type === 'malattia'
                      ? 'Invia segnalazione'
                      : 'Invia richiesta'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function notePlaceholder(t: LeaveType): string {
  if (t === 'malattia') return 'Es. influenza';
  if (t === 'permessi') return 'Es. visita medica';
  if (t === 'assenza') return 'Es. funerale del nonno (obbligatoria)';
  return 'Es. matrimonio fratello';
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

function QuotaStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.quotaStat}>
      <Text style={styles.quotaStatLabel}>{label}</Text>
      <Text style={styles.quotaStatValue}>{value.toFixed(2)}h</Text>
    </View>
  );
}

function typeIcon(t: LeaveType): keyof typeof Ionicons.glyphMap {
  if (t === 'ferie') return 'sunny-outline';
  if (t === 'permessi') return 'time-outline';
  if (t === 'assenza') return 'ellipsis-horizontal-circle-outline';
  return 'medkit-outline';
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

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 6, paddingBottom: 96 },

  quotaCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    marginBottom: space.s3,
    gap: 12,
  },
  quotaCardTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: color.onSurfaceVariant,
  },
  quotaItem: { gap: 8 },
  quotaItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quotaItemTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quotaItemTitle: { fontSize: 14, fontWeight: '700', color: color.onSurface },
  quotaItemResidual: { fontSize: 18, fontWeight: '800' },
  quotaBreakdownRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quotaStat: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: color.surfaceVariant,
    minWidth: 70,
  },
  quotaStatLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: color.onSurfaceVariant,
  },
  quotaStatValue: {
    fontSize: 13,
    fontWeight: '700',
    color: color.onSurface,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  quotaPendingHint: { fontSize: 11, color: color.onSurfaceVariant },
  quotaHintInline: {
    fontSize: 12,
    color: color.onSurfaceVariant,
    paddingHorizontal: 4,
  },

  subtypeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: color.surfaceVariant,
    marginBottom: 4,
  },
  subtypeBtnText: { fontSize: 14, color: color.onSurface, fontWeight: '600' },
  subtypeList: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 4,
    marginBottom: 4,
  },
  subtypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  subtypeRowSel: { backgroundColor: color.surfaceVariant },
  subtypeRowText: { fontSize: 14, color: color.onSurface },
  subtypeRowTextSel: { fontWeight: '700', color: color.primary },

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

  allDayRow: { flexDirection: 'row', gap: 8 },
  allDayOpt: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.surfaceVariant,
    alignItems: 'center',
  },
  allDayOptSel: { backgroundColor: color.primary, borderColor: color.primary },
  allDayOptText: { fontSize: 13, fontWeight: '600', color: color.primary },
  allDayOptTextSel: { color: color.onPrimary },

  approverBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: color.surfaceVariant,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  approverText: {
    flex: 1,
    fontSize: 12,
    color: color.onSurfaceVariant,
  },
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
