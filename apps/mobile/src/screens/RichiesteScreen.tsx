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
import { useTranslation } from 'react-i18next';
import { color, space, estimateLeaveHours, type ActiveAssignment } from '@sonoqui/shared';
import i18n from '../i18n';
import { fmtDateTime, fmtDate, fmtTime } from '../i18n/format';
import { api } from '../lib/api';
import { useNotifications } from '../lib/notifications';
import { useSession } from '../store/session';
import { AppHeader } from '../components/AppHeader';
import { WorkStateChip } from '../components/WorkStateChip';
import { DateField } from '../components/DateField';
import { SwipeableTabs } from '../components/SwipeableTabs';
import { LeaveCalendarMobile, type MobileCalEvent } from '../components/LeaveCalendarMobile';

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
  decided_by: string | null;
  decided_by_display_name: string | null;
  decided_by_email: string | null;
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

// Display labels for leave types / assenza subtypes / statuses are resolved at
// render time from the shared `common` namespace (and a few request-specific
// keys in `richieste`). See `typeLabel`, `statusBadge`.
const STATUS_KEY: Record<LeaveStatus, string> = {
  pending: 'common:status.pending',
  approved: 'common:status.approved',
  rejected: 'common:status.rejected',
  cancelled: 'common:status.cancelled',
  cancellation_pending: 'common:status.cancel_requested',
  cancelled_post_approval: 'common:status.cancelled',
  superseded_by_malattia: 'richieste:status.superseded_by_malattia',
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

function typeLabel(t: LeaveType): string {
  return i18n.t(`common:leaveType.${t}`);
}

type RichiesteTab = 'mine' | 'calendar' | 'inbox';

interface CalUser {
  user_id: string;
  email: string;
  display_name: string | null;
}

export function RichiesteScreen() {
  const { t } = useTranslation(['richieste', 'common']);
  const { me } = useSession();
  const isAdmin = me?.user.role === 'admin';
  const refreshNotif = useNotifications((s) => s.refresh);
  const [tab, setTab] = useState<RichiesteTab>('mine');
  const [mineRows, setMineRows] = useState<LeaveRequest[]>([]);
  const [inboxRows, setInboxRows] = useState<LeaveRequest[]>([]);
  const [calendarRows, setCalendarRows] = useState<LeaveRequest[]>([]);
  const [calUsers, setCalUsers] = useState<CalUser[]>([]);
  const [hiddenUsers, setHiddenUsers] = useState<Set<string>>(new Set());
  const [loadingMine, setLoadingMine] = useState(true);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [refreshingMine, setRefreshingMine] = useState(false);
  const [refreshingInbox, setRefreshingInbox] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [quotas, setQuotas] = useState<QuotaSummary[]>([]);
  const [myApprovers, setMyApprovers] = useState<Approver[]>([]);

  const loadMine = useCallback(async () => {
    try {
      const [list, q, appr] = await Promise.all([
        api<LeaveRequest[]>('/api/v1/leaves?scope=mine'),
        api<QuotaSummary[]>('/api/v1/leave-quotas/me/summary').catch(() => [] as QuotaSummary[]),
        me?.user.id
          ? api<Approver[]>(`/api/v1/users/${me.user.id}/approvers`).catch(() => [] as Approver[])
          : Promise.resolve([] as Approver[]),
      ]);
      setMineRows(list);
      setQuotas(q);
      setMyApprovers(appr);
    } catch {
      /* ignore */
    } finally {
      setLoadingMine(false);
      setRefreshingMine(false);
    }
  }, [me?.user.id]);

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

  // Calendar: admins see everyone (scope=all), users see their own (scope=mine).
  const loadCalendar = useCallback(
    async (from: string, to: string) => {
      try {
        const scope = isAdmin ? 'all' : 'mine';
        const list = await api<LeaveRequest[]>(
          `/api/v1/leaves?scope=${scope}&from=${from}&to=${to}`
        );
        setCalendarRows(list);
      } catch {
        /* ignore */
      }
    },
    [isAdmin]
  );

  const load = useCallback(async () => {
    await Promise.all([loadMine(), loadInbox()]);
  }, [loadMine, loadInbox]);

  useEffect(() => {
    loadMine();
    loadInbox();
  }, [loadMine, loadInbox]);

  // Admin-only: user roster to drive the calendar filter chips.
  useEffect(() => {
    if (!isAdmin) return;
    api<CalUser[]>('/api/v1/users')
      .then(setCalUsers)
      .catch(() => undefined);
  }, [isAdmin]);

  async function cancel(r: LeaveRequest) {
    confirmAction(t('confirm.cancelTitle'), t('confirm.cancelMessage'), async () => {
      try {
        await api(`/api/v1/leaves/${r.id}/cancel`, { method: 'POST', json: {} });
        await load();
      } catch (e) {
        showError(e);
      }
    });
  }

  async function requestCancellation(r: LeaveRequest) {
    promptText(t('prompt.cancellationReason'), async (reason) => {
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
    confirmAction(t('confirm.approveTitle'), t('confirm.summary', { type: typeLabel(r.type), hours: r.duration_hours }), async () => {
      try {
        await api(`/api/v1/leaves/${r.id}/approve`, { method: 'POST', json: {} });
        await load();
        await refreshNotif();
      } catch (e) {
        showError(e);
      }
    });
  }

  async function reject(r: LeaveRequest) {
    promptText(t('prompt.rejectionReason'), async (reason) => {
      if (!reason || reason.trim().length < 1) {
        Alert.alert(t('prompt.rejectionRequiredTitle'), t('prompt.rejectionRequiredMessage'));
        return;
      }
      try {
        await api(`/api/v1/leaves/${r.id}/reject`, {
          method: 'POST',
          json: { rejection_reason: reason.trim() },
        });
        await load();
        await refreshNotif();
      } catch (e) {
        showError(e);
      }
    });
  }

  async function decideCancel(r: LeaveRequest, approveCancel: boolean) {
    confirmAction(
      approveCancel ? t('confirm.acceptCancelTitle') : t('confirm.rejectCancelTitle'),
      t('confirm.summary', { type: typeLabel(r.type), hours: r.duration_hours }),
      async () => {
        try {
          await api(`/api/v1/leaves/${r.id}/decide-cancellation`, {
            method: 'POST',
            json: { approve: approveCancel },
          });
          await load();
          await refreshNotif();
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

  const approverNames = useMemo(
    () => myApprovers.map((a) => a.display_name || a.email).join(', '),
    [myApprovers]
  );

  // KPI sub-line: "Totale X · Usate Y", plus "· In attesa: Zh" only when the
  // quota has hours pending approval (used_pending > 0).
  const quotaSub = (q: QuotaSummary): string => {
    const base = t('kpi.total', {
      total: fmtH(q.initial_balance + q.accrued_total),
      used: fmtH(q.used_approved),
    });
    return q.used_pending > 0
      ? `${base} · ${t('kpi.pending', { pending: fmtH(q.used_pending) })}`
      : base;
  };

  const ferieQuota = quotas.find((q) => q.type === 'ferie');
  const permessiQuota = quotas.find((q) => q.type === 'permessi');

  const calendarEvents: MobileCalEvent[] = useMemo(
    () =>
      calendarRows
        .filter((r) => !hiddenUsers.has(r.user_id))
        .map((r) => ({
          id: r.id,
          type: r.type,
          status: r.status,
          from_ts: r.from_ts,
          to_ts: r.to_ts,
          user_label: isAdmin ? r.user_display_name || r.user_email : null,
          title: (r as { title?: string | null }).title ?? null,
        })),
    [calendarRows, hiddenUsers, isAdmin]
  );

  const presentUsers = useMemo(() => {
    const ids = new Set(calendarRows.map((r) => r.user_id));
    return calUsers.filter((u) => ids.has(u.user_id));
  }, [calendarRows, calUsers]);

  function toggleUser(id: string) {
    setHiddenUsers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const renderCalendarPage = (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {isAdmin && presentUsers.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingHorizontal: space.s3, paddingBottom: space.s2 }}>
          {presentUsers.map((u) => {
            const on = !hiddenUsers.has(u.user_id);
            return (
              <Pressable
                key={u.user_id}
                onPress={() => toggleUser(u.user_id)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 999,
                  backgroundColor: on ? color.primaryContainer : color.surfaceVariant,
                  opacity: on ? 1 : 0.5,
                }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: on ? color.primary : color.onSurfaceVariant }}>
                  {u.display_name || u.email}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      <LeaveCalendarMobile events={calendarEvents} onRangeChange={loadCalendar} />
    </ScrollView>
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
      <View style={styles.kpiRow}>
        <KpiTile
          label={t('kpi.ferie')}
          value={ferieQuota ? fmtH(ferieQuota.residual_strict) : '—'}
          sub={ferieQuota ? quotaSub(ferieQuota) : t('kpi.noQuota')}
          fg={typeFg('ferie')}
        />
        <KpiTile
          label={t('kpi.permessi')}
          value={permessiQuota ? fmtH(permessiQuota.residual_strict) : '—'}
          sub={permessiQuota ? quotaSub(permessiQuota) : t('kpi.noQuota')}
          fg={typeFg('permessi')}
        />
      </View>
      {loadingMine && (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      )}
      {!loadingMine && mineRows.length === 0 && (
        <View style={styles.emptyCard}>
          <Ionicons name="calendar-outline" size={32} color={color.onSurfaceVariant} />
          <Text style={styles.empty}>{t('empty.mine')}</Text>
        </View>
      )}
      {mineRows.map((r) => (
        <LeaveCard
          key={r.id}
          row={r}
          tab="mine"
          myUserId={me?.user.id ?? ''}
          approverNames={approverNames}
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
          <Text style={styles.empty}>{t('empty.inbox')}</Text>
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
          { id: 'mine', label: t('tab.mine') },
          { id: 'calendar', label: t('tab.calendar') },
          { id: 'inbox', label: t('tab.inbox'), badge: pendingInboxCount },
        ]}
        activeId={tab}
        onChange={setTab}>
        {[renderMinePage, renderCalendarPage, renderInboxPage]}
      </SwipeableTabs>

      {tab === 'mine' && (
        <TouchableOpacity
          onPress={() => setFormOpen(true)}
          activeOpacity={0.8}
          style={styles.fab}
          accessibilityLabel={t('fab')}>
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
  approverNames,
  onApprove,
  onReject,
  onCancel,
  onRequestCancellation,
  onDecideCancellation,
}: {
  row: LeaveRequest;
  tab: 'mine' | 'inbox';
  myUserId: string;
  approverNames?: string;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
  onRequestCancellation: () => void;
  onDecideCancellation: (approveCancel: boolean) => void;
}) {
  const { t } = useTranslation(['richieste', 'common']);
  const isMine = row.user_id === myUserId;
  const status = statusBadge(row.status);
  // Who approves / decided this request (own requests, non-malattia). Decided
  // requests show the decider; otherwise the configured approver(s).
  const decidedName = row.decided_by_display_name || row.decided_by_email;
  const approverLine =
    row.status === 'approved' && decidedName
      ? t('card.approvedBy', { name: decidedName })
      : row.status === 'rejected' && decidedName
        ? t('card.rejectedBy', { name: decidedName })
        : approverNames
          ? t('card.approver', { names: approverNames })
          : t('card.noApprover');
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.typeChip,
            { backgroundColor: typeBg(row.type) },
          ]}>
          <Text style={[styles.typeChipText, { color: typeFg(row.type) }]}>
            {t(`common:leaveType.${row.type}`)}
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

      {tab === 'mine' && row.type !== 'malattia' ? (
        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={14} color={color.onSurfaceVariant} />
          <Text style={styles.metaText}>{approverLine}</Text>
        </View>
      ) : null}

      {row.type === 'malattia' && row.inps_protocol ? (
        <View style={styles.metaRow}>
          <Ionicons name="medkit-outline" size={14} color={color.onSurfaceVariant} />
          <Text style={styles.metaText}>{t('card.inps', { protocol: row.inps_protocol })}</Text>
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
            {t(`common:assenzaSubtype.${row.assenza_subtype}`)} ·{' '}
            {row.is_paid ? t('card.paid') : t('card.unpaid')}
          </Text>
        </View>
      ) : null}

      {row.user_note ? <Text style={styles.note}>{row.user_note}</Text> : null}

      {row.rejection_reason ? (
        <View style={[styles.noteBox, { backgroundColor: '#fde4e4' }]}>
          <Text style={styles.noteLabel}>{t('card.rejectionReason')}</Text>
          <Text style={styles.noteText}>{row.rejection_reason}</Text>
        </View>
      ) : null}
      {row.cancellation_reason ? (
        <View style={[styles.noteBox, { backgroundColor: '#fff3d1' }]}>
          <Text style={styles.noteLabel}>{t('card.cancellation')}</Text>
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
            <Text style={[styles.actionText, { color: color.error }]}>{t('common:btn.cancel')}</Text>
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
                {t('card.requestCancellation')}
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
            <Text style={[styles.actionText, { color: color.error }]}>{t('common:btn.reject')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onApprove}
            activeOpacity={0.8}
            style={[styles.actionBtn, styles.actionApprove]}>
            <Ionicons name="checkmark-outline" size={18} color={color.onPrimary} />
            <Text style={[styles.actionText, { color: color.onPrimary }]}>
              {t('common:btn.approve')}
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
            <Text style={[styles.actionText, { color: color.error }]}>{t('common:btn.reject')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onDecideCancellation(true)}
            activeOpacity={0.8}
            style={[styles.actionBtn, styles.actionApprove]}>
            <Text style={[styles.actionText, { color: color.onPrimary }]}>
              {t('card.acceptCancellation')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.created}>{t('card.sentAt', { date: fmtFull(row.created_at) })}</Text>
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
  const { t } = useTranslation(['richieste', 'common']);
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
  const [assignment, setAssignment] = useState<ActiveAssignment | null>(null);
  const [assenzaSubtype, setAssenzaSubtype] =
    useState<AssenzaSubtype>('motivi_personali');
  const [isPaid, setIsPaid] = useState(true);
  const [subtypePickerOpen, setSubtypePickerOpen] = useState(false);

  useEffect(() => {
    if (visible) {
      setType('ferie');
      setAllDay(true);
      const today = isoLocal(new Date());
      setFromDate(today);
      setToDate(today);
      setFromTime('09:00');
      setToTime('13:00');
      setInpsProtocol('');
      setNote('');
      setAssenzaSubtype('motivi_personali');
      setIsPaid(true);
      setSubtypePickerOpen(false);
    }
  }, [visible]);

  // When the modal opens, load the approver list (shown for everything except
  // malattia) and the user's active shift assignment. The assignment drives the
  // live hours preview — see `estimatedHours` / estimateLeaveHours.
  useEffect(() => {
    if (!visible || !me?.user.id) return;
    let cancelled = false;
    (async () => {
      const [list, asg] = await Promise.all([
        api<Approver[]>(`/api/v1/users/${me.user.id}/approvers`).catch(
          () => [] as Approver[]
        ),
        api<ActiveAssignment | null>('/api/v1/shifts/assignments/me').catch(
          () => null
        ),
      ]);
      if (!cancelled) {
        setApprovers(list);
        setAssignment(asg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, me?.user.id]);

  // Hours the request will claim, mirroring the backend's duration_hours
  // (apps/backend/src/lib/leave-quota.ts). null = invalid period (submit will
  // alert); 0 = covers no working hours; >0 = the figure shown to the user.
  const estimatedHours = useMemo<number | null>(() => {
    const range = buildLeaveRange(type, allDay, fromDate, toDate, fromTime, toTime);
    if (!range) return null;
    return estimateLeaveHours(type, range.from, range.to, assignment);
  }, [type, allDay, fromDate, toDate, fromTime, toTime, assignment]);

  async function submit() {
    if (type === 'malattia' && !inpsProtocol.trim()) {
      Alert.alert(
        t('modal.inpsRequiredTitle'),
        t('modal.inpsRequiredMessage')
      );
      return;
    }
    // Derive the period the same way the live hours preview does, so the
    // submitted from/to always match the total shown to the user.
    const range = buildLeaveRange(type, allDay, fromDate, toDate, fromTime, toTime);
    if (!range) {
      Alert.alert(t('modal.periodTitle'), t('modal.periodMessage'));
      return;
    }
    const { from, to } = range;
    // Block requests that fall entirely outside the user's working schedule
    // (e.g. ferie only on a Sunday). The backend rejects these too — this is the
    // friendly client-side guard. A mixed range (Mon–Sun) is fine: only the
    // scheduled days are counted, so the total is > 0.
    if (estimatedHours === 0) {
      Alert.alert(t('modal.noWorkingHoursTitle'), t('modal.noWorkingHours'));
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
          all_day: type === 'ferie' || type === 'permessi' ? allDay : true,
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
            <Text style={styles.modalTitle}>{t('modal.title')}</Text>
            <Pressable onPress={onClose} style={styles.iconBtn}>
              <Ionicons name="close" size={22} color={color.onSurface} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>{t('modal.typeLabel')}</Text>
            <View style={styles.typeGrid}>
              {(['ferie', 'permessi', 'malattia', 'assenza'] as LeaveType[]).map(
                (lt) => {
                  const sel = lt === type;
                  return (
                    <Pressable
                      key={lt}
                      onPress={() => setType(lt)}
                      style={[styles.typeOpt, sel && styles.typeOptSel]}>
                      <Ionicons
                        name={typeIcon(lt)}
                        size={18}
                        color={sel ? color.onPrimary : color.primary}
                      />
                      <Text
                        style={[
                          styles.typeOptText,
                          sel && styles.typeOptTextSel,
                        ]}>
                        {t(`common:leaveType.${lt}`)}
                      </Text>
                    </Pressable>
                  );
                }
              )}
            </View>

            {residual && (
              <Text style={styles.quotaHintInline}>
                {t('modal.quotaHint', { strict: residual.residual_strict.toFixed(2) })}
                <Text style={{ opacity: 0.7 }}>
                  {t('modal.quotaHintPending', { pending: residual.residual_with_pending.toFixed(2) })}
                </Text>
              </Text>
            )}

            {type === 'assenza' && (
              <>
                <Text style={styles.fieldLabel}>{t('modal.assenzaTypeLabel')}</Text>
                <Pressable
                  onPress={() => setSubtypePickerOpen((v) => !v)}
                  style={styles.subtypeBtn}>
                  <Text style={styles.subtypeBtnText}>
                    {t(`common:assenzaSubtype.${assenzaSubtype}`)}
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
                            {t(`common:assenzaSubtype.${s}`)}
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

                <Text style={styles.fieldLabel}>{t('modal.compensationLabel')}</Text>
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
                      {t('modal.paid')}
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
                      {t('modal.unpaid')}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}

            <View style={styles.dateRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>{t('modal.from')}</Text>
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
                <Text style={styles.fieldLabel}>{t('modal.to')}</Text>
                <DateField mode="date" value={toDate} onChange={setToDate} />
              </View>
            </View>

            {(type === 'ferie' || type === 'permessi') && (
              <>
                <Text style={styles.fieldLabel}>{t('modal.durationLabel')}</Text>
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
                      {t('modal.allDay')}
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
                      {t('modal.specificTime')}
                    </Text>
                  </Pressable>
                </View>
                {!allDay && (
                  <View style={styles.dateRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>{t('modal.startTime')}</Text>
                      <DateField
                        mode="time"
                        value={fromTime}
                        onChange={setFromTime}
                        minuteInterval={15}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>{t('modal.endTime')}</Text>
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

            {estimatedHours !== null && estimatedHours > 0 ? (
              <View style={styles.totalBox}>
                <Ionicons name="hourglass-outline" size={16} color={color.primary} />
                <Text style={styles.totalText}>
                  {t('modal.estimatedTotal', { hours: fmtH(estimatedHours) })}
                </Text>
              </View>
            ) : estimatedHours === 0 ? (
              <Text style={styles.totalNote}>{t('modal.noWorkingHours')}</Text>
            ) : null}

            {type !== 'malattia' && (
              <View style={styles.approverBox} testID="modal-approver-box">
                <Ionicons
                  name="person-outline"
                  size={14}
                  color={color.onSurfaceVariant}
                />
                <Text style={styles.approverText}>
                  {approvers.length === 0
                    ? t('modal.noApprover')
                    : t('modal.approver', {
                        names: approvers
                          .map((a) => a.display_name || a.email)
                          .join(', '),
                      })}
                </Text>
              </View>
            )}

            {type === 'malattia' && (
              <>
                <Text style={styles.fieldLabel}>{t('modal.inpsLabel')}</Text>
                <TextInput
                  value={inpsProtocol}
                  onChangeText={setInpsProtocol}
                  placeholder={t('modal.inpsPlaceholder')}
                  placeholderTextColor={color.onSurfaceVariant}
                  style={styles.input}
                  autoCapitalize="none"
                />
              </>
            )}

            <Text style={styles.fieldLabel}>
              {type === 'assenza' ? t('modal.reasonOptional') : t('modal.notesOptional')}
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={t(`notePlaceholder.${type}`)}
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
                      ? t('modal.submitReport')
                      : t('modal.submitRequest')}
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

/* ----- helpers ----- */

function confirmAction(title: string, msg: string, fn: () => void): void {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${msg}`)) fn();
    return;
  }
  Alert.alert(title, msg, [
    { text: i18n.t('common:btn.cancel'), style: 'cancel' },
    { text: i18n.t('common:btn.confirm'), onPress: fn },
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
        { text: i18n.t('common:btn.cancel'), style: 'cancel' },
        { text: i18n.t('common:btn.confirm'), onPress: (text?: string) => fn(text ?? '') },
      ],
      'plain-text'
    );
    return;
  }
  Alert.alert(title, i18n.t('richieste:androidPromptHint'), [
    { text: i18n.t('common:btn.cancel'), style: 'cancel' },
    { text: i18n.t('common:btn.confirm'), onPress: () => fn(i18n.t('richieste:unspecifiedReason')) },
  ]);
}

function showError(err: unknown): void {
  const e = err as { message?: string };
  if (Platform.OS === 'web') {
    window.alert(e.message ?? i18n.t('richieste:error.generic'));
    return;
  }
  Alert.alert(i18n.t('common:state.error'), e.message ?? i18n.t('richieste:error.operationFailed'));
}

function KpiTile({
  label,
  value,
  sub,
  fg,
}: {
  label: string;
  value: string;
  sub?: string;
  fg: string;
}) {
  return (
    <View style={styles.kpiTile}>
      <Text style={styles.kpiLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.kpiValue, { color: fg }]}>{value}</Text>
      {sub ? (
        <Text style={styles.kpiSub} numberOfLines={3}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

// Hours, trimmed: 120 → "120h", 15.75 → "15.75h".
function fmtH(n: number): string {
  const r = Math.round(n * 100) / 100;
  return `${Number.isInteger(r) ? r : r.toFixed(2)}h`;
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
  const label = i18n.t(STATUS_KEY[s]);
  if (s === 'approved') return { label, bg: '#e8f3ec', fg: color.success };
  if (s === 'rejected' || s === 'superseded_by_malattia')
    return { label, bg: '#fde4e4', fg: color.error };
  if (s === 'pending' || s === 'cancellation_pending')
    return { label, bg: '#fff3d1', fg: color.warning };
  return { label, bg: color.surfaceVariant, fg: color.onSurfaceVariant };
}

function fmtFull(iso: string): string {
  return fmtDateTime(iso, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtRange(from: string, to: string, type: LeaveType): string {
  const f = new Date(from);
  const tDate = new Date(to);
  const sameDay = f.toDateString() === tDate.toDateString();
  const d: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
  const h: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (type === 'permessi' && sameDay) {
    return `${fmtDate(f, d)} ${fmtTime(f, h)}–${fmtTime(tDate, h)}`;
  }
  if (sameDay) return fmtDate(f, d);
  return `${fmtDate(f, d)} → ${fmtDate(tDate, d)}`;
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

// Ferie and permessi carry start/end times (15-min slots) when the user unticks
// "Tutto il giorno"; otherwise (and always for malattia / assenza) the request
// covers full day(s). Returns null when the period is empty (end ≤ start).
// Shared by submit() and the live hours preview so the two can never drift.
function buildLeaveRange(
  type: LeaveType,
  allDay: boolean,
  fromDate: string,
  toDate: string,
  fromTime: string,
  toTime: string
): { from: string; to: string } | null {
  const useTime = (type === 'ferie' || type === 'permessi') && !allDay;
  const from = useTime
    ? combineLocalDateTime(fromDate, fromTime)
    : combineLocalDateTime(fromDate, '00:00');
  const to = useTime
    ? combineLocalDateTime(toDate, toTime)
    : combineLocalDateTime(toDate, '23:59');
  if (new Date(to).getTime() <= new Date(from).getTime()) return null;
  return { from, to };
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 6, paddingBottom: 96 },

  kpiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: space.s3,
  },
  kpiTile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 10,
    gap: 2,
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: color.onSurfaceVariant,
  },
  kpiValue: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  kpiSub: { fontSize: 10, color: color.onSurfaceVariant, fontVariant: ['tabular-nums'] },

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

  totalBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: color.primaryContainer,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
  },
  totalText: { flex: 1, fontSize: 15, fontWeight: '700', color: color.primary },
  totalNote: { fontSize: 13, color: color.warning, paddingHorizontal: 4 },

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
