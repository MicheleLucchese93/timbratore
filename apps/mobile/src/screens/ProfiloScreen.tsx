import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../store/session';
import { color, space, type as t } from '@sonoqui/shared';
import { userDisplayName } from '../lib/user-display';

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

export function ProfiloScreen() {
  const { me, logout } = useSession();
  const router = useRouter();

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
      if (window.confirm('Vuoi uscire?')) doLogout();
      return;
    }
    Alert.alert('Esci', 'Vuoi uscire?', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Esci', style: 'destructive', onPress: () => { doLogout(); } },
    ]);
  }

  if (!me) return null;

  const displayName = userDisplayName(me.user);
  const initials = getInitials(displayName);
  const avatarColor = getAvatarColor(displayName);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          style={styles.backButton}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Indietro">
          <Ionicons name="arrow-back" size={24} color={color.onSurface} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profilo</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>Profilo</Text>
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
                  {me.user.role === 'admin' ? 'Amministratore' : 'Dipendente'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Azienda</Text>
        <View style={styles.card}>
          <Row icon="business-outline" label="Ragione sociale" value={me.tenant.ragione_sociale} />
        </View>

        <Text style={styles.sectionLabel}>
          {me.branches.length > 1 ? 'Sedi' : 'Sede'}
        </Text>
        <View style={styles.card}>
          {me.branches.length === 0 && (
            <Text style={styles.empty}>Nessuna sede assegnata.</Text>
          )}
          {me.branches.map((b, i) => (
            <View key={b.id}>
              <Row
                icon={b.smart_working ? 'laptop-outline' : 'business-outline'}
                label={b.name}
                value={b.smart_working ? 'Smart working' : 'In sede'}
              />
              {i < me.branches.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        <TouchableOpacity
          onPress={confirmLogout}
          style={styles.logoutButton}
          activeOpacity={0.8}>
          <Text style={styles.logoutText}>Esci</Text>
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
