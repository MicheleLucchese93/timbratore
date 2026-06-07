import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { color, space, type as ty } from '@sonoqui/shared';
import { useSession } from '../store/session';

const LOGO = require('../../assets/images/icon.png');

// Shown after login when the account belongs to more than one company, and
// reused as the "Cambia azienda" switcher from Profilo. Picking a company
// stores the choice, reloads the session for it (role/branches/tabs follow),
// and lands on that company's home. Single-company users never see this.
export default function ChooseTenantScreen() {
  const { t } = useTranslation(['chooseTenant', 'common']);
  const tenants = useSession((s) => s.tenants);
  const activeTenantId = useSession((s) => s.activeTenantId);
  const chooseTenant = useSession((s) => s.chooseTenant);
  const logout = useSession((s) => s.logout);
  const [busy, setBusy] = useState<string | null>(null);

  async function pick(id: string) {
    if (busy) return;
    if (id === activeTenantId) {
      if (router.canGoBack()) router.back();
      return;
    }
    setBusy(id);
    try {
      await chooseTenant(id);
      const me = useSession.getState().me;
      router.replace(me?.user.role === 'admin' ? '/dashboard' : '/timbrature');
    } catch {
      setBusy(null);
    }
  }

  async function onLogout() {
    await logout();
    router.replace('/');
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" accessible={false} />
          <Text style={styles.title}>{t('title')}</Text>
          <Text style={styles.subtitle}>{t('subtitle')}</Text>
        </View>

        <View style={styles.card}>
          {tenants.map((item, i) => {
            const isActive = item.tenant_id === activeTenantId;
            return (
              <View key={item.tenant_id}>
                <TouchableOpacity
                  style={styles.row}
                  activeOpacity={0.6}
                  disabled={!!busy}
                  onPress={() => pick(item.tenant_id)}
                  accessibilityRole="button"
                  accessibilityLabel={item.ragione_sociale}>
                  <View style={styles.rowIcon}>
                    <Ionicons name="business-outline" size={18} color={color.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{item.ragione_sociale}</Text>
                    <Text style={styles.role}>
                      {item.role === 'admin' ? t('common:role.admin') : t('common:role.user')}
                    </Text>
                  </View>
                  {busy === item.tenant_id ? (
                    <ActivityIndicator />
                  ) : isActive ? (
                    <Ionicons name="checkmark-circle" size={20} color={color.primary} />
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={color.onSurfaceVariant} />
                  )}
                </TouchableOpacity>
                {i < tenants.length - 1 && <View style={styles.divider} />}
              </View>
            );
          })}
        </View>

        <TouchableOpacity onPress={onLogout} style={styles.logout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>{t('common:btn.logout')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  scroll: { flexGrow: 1, paddingHorizontal: space.s5, paddingBottom: space.s8, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: space.s6 },
  logo: { width: 72, height: 72, marginBottom: space.s3, backgroundColor: color.surface },
  title: {
    fontSize: ty.h1.size,
    lineHeight: ty.h1.line,
    fontWeight: '800',
    color: color.onSurface,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: color.onSurfaceVariant,
    marginTop: space.s2,
    textAlign: 'center',
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
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 16, fontWeight: '700', color: color.onSurface },
  role: { fontSize: 12, color: color.onSurfaceVariant, fontWeight: '600', marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.surfaceVariant, marginLeft: 48 },
  logout: { marginTop: space.s6, paddingVertical: 16, alignItems: 'center' },
  logoutText: { fontSize: 15, fontWeight: '700', color: color.onSurfaceVariant },
});
