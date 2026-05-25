import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../store/session';
import { color, space, type as t } from '@sonoqui/shared';
import { userDisplayName } from '../lib/user-display';

export function ProfiloScreen() {
  const { me, logout } = useSession();
  const router = useRouter();

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
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroBlock}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.heroInfo}>
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

        <Section title="Azienda">
          <Row icon="business-outline" label="Ragione sociale" value={me.tenant.ragione_sociale} />
        </Section>

        <Section title={me.branches.length > 1 ? 'Sedi' : 'Sede'}>
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
              {i < me.branches.length - 1 && <Divider />}
            </View>
          ))}
        </Section>

        <TouchableOpacity onPress={confirmLogout} activeOpacity={0.7} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={20} color={color.error} />
          <Text style={styles.logoutText}>Esci</Text>
        </TouchableOpacity>

        <Text style={styles.version}>sonoQui · v0.1.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
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

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  scroll: { paddingHorizontal: 6, paddingTop: space.s4, paddingBottom: 44 },

  heroBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: space.s4,
    paddingHorizontal: space.s2,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(0,0,0,0.12)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 4,
  },
  avatarText: { color: color.onPrimary, fontSize: 26, fontWeight: '700' },
  heroInfo: { flex: 1, alignItems: 'flex-start' },
  displayName: {
    fontSize: 20,
    fontWeight: '700',
    color: color.onSurface,
  },
  email: { fontSize: 13, color: color.onSurfaceVariant, marginTop: 2 },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#ffe0c8',
    marginTop: 6,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: color.primary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  section: { marginTop: space.s5 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: color.onSurfaceVariant,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: space.s2,
    paddingHorizontal: space.s2,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    paddingVertical: 4,
    shadowColor: 'rgba(0,0,0,0.04)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffe0c8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { fontSize: 12, color: color.onSurfaceVariant, fontWeight: '600' },
  rowValue: { fontSize: 15, color: color.onSurface, fontWeight: '600', marginTop: 1 },
  divider: { height: 1, backgroundColor: color.surfaceVariant, marginLeft: 64 },
  empty: { color: color.onSurfaceVariant, padding: 16 },

  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 24,
    backgroundColor: '#fde4e4',
    marginTop: space.s5,
  },
  logoutText: { fontSize: 16, fontWeight: '700', color: color.error },

  version: {
    marginTop: 32,
    textAlign: 'center',
    color: color.onSurfaceVariant,
    fontSize: 12,
  },
});
