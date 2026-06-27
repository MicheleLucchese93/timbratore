import { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSession } from '../store/session';
import { useLock } from '../store/lock';
import { color, space, type as t } from '@sonoqui/shared';
import { userDisplayName } from '../lib/user-display';
import { api } from '../lib/api';
import { LanguageRow } from '../components/LanguageRow';

const AVATAR_PALETTE = [
  '#24389c',
  '#b7131a',
  '#004e11',
  '#6d4c9e',
  '#c4651a',
  '#0d7377',
  '#8b5e3c',
  '#5c6bc0',
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// All notification_preferences keys we toggle from this screen. Push keys are
// gated on push being enabled; email keys are not. `email_documents` is an
// email *opt-out* (defaults ON), unlike the other email prefs.
type NotifPrefKey =
  | 'push_leave_decisions'
  | 'push_correction_decisions'
  | 'push_leave_submissions'
  | 'push_correction_submissions'
  | 'push_leave_reminders'
  | 'push_documents'
  | 'push_stamp_reminders'
  | 'email_documents';

const NOTIF_PREF_DEFAULTS: Record<NotifPrefKey, boolean> = {
  push_leave_decisions: true,
  push_correction_decisions: true,
  push_leave_submissions: true,
  push_correction_submissions: true,
  push_leave_reminders: true,
  push_documents: true,
  push_stamp_reminders: true,
  email_documents: true,
};

export function ProfiloScreen() {
  const { t: tr } = useTranslation(['profilo', 'common']);
  const { me, logout, refresh } = useSession();
  const tenants = useSession((s) => s.tenants);
  const router = useRouter();

  const lockReady = useLock((s) => s.ready);
  const lockEnabled = useLock((s) => s.enabled);
  const lockCapability = useLock((s) => s.capability);
  const enableLock = useLock((s) => s.enable);
  const disableLock = useLock((s) => s.disable);
  const [bioBusy, setBioBusy] = useState(false);

  async function toggleBiometric(next: boolean) {
    if (bioBusy) return;
    setBioBusy(true);
    try {
      if (next) {
        const res = await enableLock();
        if (!res.ok && res.error) {
          if (Platform.OS === 'web') window.alert(res.error);
          else Alert.alert(tr('security.bioTitleDefault'), res.error);
        }
      } else {
        await disableLock();
      }
    } finally {
      setBioBusy(false);
    }
  }

  const initialPushPrefs = {
    ...NOTIF_PREF_DEFAULTS,
    ...(me?.preferences?.notification_preferences ?? {}),
  };
  const [pushPrefs, setPushPrefs] =
    useState<Record<NotifPrefKey, boolean>>(initialPushPrefs);
  const [savingPushKey, setSavingPushKey] = useState<NotifPrefKey | null>(null);

  useEffect(() => {
    setPushPrefs({
      ...NOTIF_PREF_DEFAULTS,
      ...(me?.preferences?.notification_preferences ?? {}),
    });
  }, [me?.preferences?.notification_preferences]);

  async function togglePushPref(key: NotifPrefKey, next: boolean) {
    const prev = pushPrefs[key];
    setPushPrefs((p) => ({ ...p, [key]: next }));
    setSavingPushKey(key);
    try {
      await api('/api/v1/me', {
        method: 'PATCH',
        json: { notification_preferences: { [key]: next } },
      });
      await refresh();
    } catch (e) {
      setPushPrefs((p) => ({ ...p, [key]: prev }));
      const msg = e instanceof Error ? e.message : tr('saveError');
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert(tr('common:state.error'), msg);
    } finally {
      setSavingPushKey(null);
    }
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/timbrature');
  }

  function confirmLogout() {
    const doLogout = async () => {
      await logout();
      router.replace('/');
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (window.confirm(tr('logoutConfirm'))) doLogout();
      return;
    }
    Alert.alert(tr('common:btn.logout'), tr('logoutConfirm'), [
      { text: tr('common:btn.cancel'), style: 'cancel' },
      { text: tr('common:btn.logout'), style: 'destructive', onPress: () => { doLogout(); } },
    ]);
  }

  if (!me) return null;

  const displayName = userDisplayName(me.user);
  const initials = getInitials(displayName);
  const avatarColor = getAvatarColor(displayName);
  const isAdmin = me.user.role === 'admin';
  const pushEnabled = !!me.preferences?.push_token_registered;

  const bioLabel = lockCapability?.label ?? 'biometria';
  const bioAvailable = !!lockCapability?.available;
  const bioTitle =
    bioLabel === 'biometria' ? tr('security.bioTitleDefault') : tr('security.bioTitleWith', { label: bioLabel });
  const bioIcon =
    bioLabel === 'Face ID' || bioLabel === 'riconoscimento facciale'
      ? 'scan-outline'
      : 'finger-print-outline';
  const bioHint = !lockReady
    ? tr('security.bioChecking')
    : bioAvailable
      ? tr('security.bioHintAvailable', { label: bioLabel })
      : lockCapability?.hasHardware
        ? tr('security.bioHintNotConfigured')
        : tr('security.bioHintNoHardware');
  const bioDisabled = bioBusy || !lockReady || !bioAvailable;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          style={styles.backButton}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={tr('common:btn.back')}>
          <Ionicons name="arrow-back" size={24} color={color.onSurface} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{tr('title')}</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>{tr('section.profile')}</Text>
        <View style={styles.card}>
          <View style={styles.profileRow}>
            <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.displayName} numberOfLines={1}>{displayName}</Text>
              <Text style={styles.email} numberOfLines={1}>{me.user.email}</Text>
              <View style={styles.rolePill}>
                <Ionicons
                  name={me.user.role === 'admin' ? 'shield-checkmark-outline' : 'person-outline'}
                  size={12}
                  color={color.primary}
                />
                <Text style={styles.rolePillText}>
                  {me.user.role === 'admin' ? tr('common:role.admin') : tr('common:role.user')}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={styles.sectionLabel}>{tr('section.company')}</Text>
        <View style={styles.card}>
          <Row icon="business-outline" label={tr('company.legalName')} value={me.tenant.ragione_sociale} />
          {tenants.length > 1 && (
            <>
              <View style={styles.divider} />
              <LinkRow
                icon="swap-horizontal-outline"
                label={tr('company.switch')}
                value={tr('company.switchHint')}
                onPress={() => router.push('/choose-tenant')}
              />
            </>
          )}
        </View>

        <Text style={styles.sectionLabel}>
          {me.branches.length > 1 ? tr('section.branches') : tr('section.branch')}
        </Text>
        <View style={styles.card}>
          {me.branches.length === 0 && (
            <Text style={styles.empty}>{tr('branches.empty')}</Text>
          )}
          {me.branches.map((b, i) => (
            <View key={b.id}>
              <Row
                icon={b.smart_working ? 'laptop-outline' : 'business-outline'}
                label={b.name}
                value={b.smart_working ? tr('branches.offSite') : tr('branches.onSite')}
              />
              {i < me.branches.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>{tr('section.language')}</Text>
        <View style={styles.card}>
          <LanguageRow />
        </View>

        <Text style={styles.sectionLabel}>{tr('section.security')}</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name={bioIcon} size={18} color={color.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowValue}>{bioTitle}</Text>
              <Text style={[styles.rowLabel, bioDisabled && styles.subRowDisabled]}>
                {bioHint}
              </Text>
            </View>
            <Switch
              value={lockEnabled && bioAvailable}
              onValueChange={toggleBiometric}
              disabled={bioDisabled}
            />
          </View>
        </View>

        <Text style={styles.sectionLabel}>{tr('section.notifications')}</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="notifications-outline" size={18} color={color.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{tr('notifications.push')}</Text>
              <Text style={styles.rowValue}>
                {pushEnabled ? tr('notifications.pushOn') : tr('notifications.pushOff')}
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          <PushToggleRow
            label={tr('notifications.stampReminders')}
            hint={tr('notifications.stampRemindersHint')}
            value={pushPrefs.push_stamp_reminders}
            disabled={!pushEnabled || savingPushKey === 'push_stamp_reminders'}
            onChange={(v) => togglePushPref('push_stamp_reminders', v)}
          />
          <View style={styles.divider} />
          <PushToggleRow
            label={tr('notifications.leaveDecisions')}
            hint={tr('notifications.leaveDecisionsHint')}
            value={pushPrefs.push_leave_decisions}
            disabled={!pushEnabled || savingPushKey === 'push_leave_decisions'}
            onChange={(v) => togglePushPref('push_leave_decisions', v)}
          />
          <View style={styles.divider} />
          <PushToggleRow
            label={tr('notifications.correctionDecisions')}
            hint={tr('notifications.correctionDecisionsHint')}
            value={pushPrefs.push_correction_decisions}
            disabled={!pushEnabled || savingPushKey === 'push_correction_decisions'}
            onChange={(v) => togglePushPref('push_correction_decisions', v)}
          />
          <View style={styles.divider} />
          <PushToggleRow
            label={tr('notifications.leaveReminders')}
            hint={tr('notifications.leaveRemindersHint')}
            value={pushPrefs.push_leave_reminders}
            disabled={!pushEnabled || savingPushKey === 'push_leave_reminders'}
            onChange={(v) => togglePushPref('push_leave_reminders', v)}
          />
          <View style={styles.divider} />
          <PushToggleRow
            label={tr('notifications.documentsPush')}
            hint={tr('notifications.documentsPushHint')}
            value={pushPrefs.push_documents}
            disabled={!pushEnabled || savingPushKey === 'push_documents'}
            onChange={(v) => togglePushPref('push_documents', v)}
          />
          <View style={styles.divider} />
          {/* Email toggle is independent of push permission. */}
          <PushToggleRow
            label={tr('notifications.documentsEmail')}
            hint={tr('notifications.documentsEmailHint')}
            value={pushPrefs.email_documents}
            disabled={savingPushKey === 'email_documents'}
            onChange={(v) => togglePushPref('email_documents', v)}
          />
          {isAdmin && (
            <>
              <View style={styles.divider} />
              <PushToggleRow
                label={tr('notifications.leaveSubmissions')}
                hint={tr('notifications.leaveSubmissionsHint')}
                value={pushPrefs.push_leave_submissions}
                disabled={!pushEnabled || savingPushKey === 'push_leave_submissions'}
                onChange={(v) => togglePushPref('push_leave_submissions', v)}
              />
              <View style={styles.divider} />
              <PushToggleRow
                label={tr('notifications.correctionSubmissions')}
                hint={tr('notifications.correctionSubmissionsHint')}
                value={pushPrefs.push_correction_submissions}
                disabled={!pushEnabled || savingPushKey === 'push_correction_submissions'}
                onChange={(v) => togglePushPref('push_correction_submissions', v)}
              />
            </>
          )}
        </View>

        <TouchableOpacity
          onPress={confirmLogout}
          style={styles.logoutButton}
          activeOpacity={0.8}>
          <Text style={styles.logoutText}>{tr('common:btn.logout')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={18} color={color.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </View>
  );
}

function LinkRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="link"
      accessibilityLabel={label}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={18} color={color.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowValue}>{label}</Text>
        {value ? <Text style={styles.rowLabel}>{value}</Text> : null}
      </View>
      <Ionicons name="open-outline" size={18} color={color.onSurfaceVariant} />
    </TouchableOpacity>
  );
}

function PushToggleRow({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.subRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.subRowLabel, disabled && styles.subRowDisabled]}>{label}</Text>
        <Text style={[styles.subRowHint, disabled && styles.subRowDisabled]}>{hint}</Text>
      </View>
      <Switch value={value && !disabled} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.s2,
    paddingVertical: space.s3,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: t.h2.size,
    lineHeight: t.h2.line,
    fontWeight: '600',
    color: color.onSurface,
  },

  scrollContent: {
    paddingHorizontal: space.s2,
    paddingBottom: space.s8,
  },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: color.onSurfaceVariant,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: space.s5,
    marginBottom: space.s2,
    paddingHorizontal: space.s2,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingHorizontal: space.s4,
    paddingVertical: space.s1,
    shadowColor: 'rgba(0,0,0,0.04)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 1,
  },

  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.s4,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  profileInfo: { flex: 1, marginLeft: space.s4 },
  displayName: {
    fontSize: 18,
    fontWeight: '700',
    color: color.onSurface,
  },
  email: {
    fontSize: 13,
    color: color.onSurfaceVariant,
    marginTop: 2,
  },
  rolePill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: color.primaryContainer,
    marginTop: 6,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: color.primary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    fontSize: 12,
    color: color.onSurfaceVariant,
    fontWeight: '600',
  },
  rowValue: {
    fontSize: 15,
    color: color.onSurface,
    fontWeight: '600',
    marginTop: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.surfaceVariant,
    marginLeft: 48,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 48,
    gap: 12,
  },
  subRowLabel: {
    fontSize: 14,
    color: color.onSurface,
    fontWeight: '500',
  },
  subRowHint: {
    fontSize: 12,
    color: color.onSurfaceVariant,
    marginTop: 2,
  },
  subRowDisabled: {
    opacity: 0.5,
  },
  empty: { color: color.onSurfaceVariant, paddingVertical: 14 },

  logoutButton: {
    marginTop: space.s6,
    backgroundColor: '#fde4e4',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '700',
    color: color.error,
  },
});
