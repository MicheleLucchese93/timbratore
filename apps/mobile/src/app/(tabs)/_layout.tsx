import { useEffect } from 'react';
import { Tabs } from 'expo-router/js-tabs';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../store/session';
import { useBacheca } from '../../store/bacheca';
import { useRichieste } from '../../store/richieste';
import { CustomTabBar } from '../../components/CustomTabBar';

export default function TabsLayout() {
  const { t } = useTranslation('components');
  const { me, loading } = useSession();
  const refreshBacheca = useBacheca((s) => s.refresh);
  const refreshRichieste = useRichieste((s) => s.refresh);

  // Seed the Bacheca unread and Richieste "da approvare" badges once a session
  // is present, so the counts show even before the member opens the tabs.
  useEffect(() => {
    if (me) {
      void refreshBacheca();
      void refreshRichieste();
    }
  }, [me, refreshBacheca, refreshRichieste]);
  if (loading && !me) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!me) return <Redirect href="/" />;
  const isAdmin = me.user.role === 'admin';
  const canStamp = (me.user.stamp_modes ?? []).length > 0;
  // Cantieri needs the tenant flag AND a module role (admin or user) — same
  // predicate as the CustomTabBar route filter; keep the two in sync.
  const hasCantieri = me.tenant.cantieri_enabled === true && me.user.cantieri_role != null;
  // Admins open on the Dashboard recap; everyone else on their stamp screen
  // (or Richieste when no stamp method is enabled — those users have no
  // Timbrature tab, and Storico lives inside it).
  const initialRouteName = isAdmin ? 'dashboard' : canStamp ? 'timbrature' : 'richieste';
  return (
    <Tabs
      initialRouteName={initialRouteName}
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="dashboard" options={{ title: t('tab.dashboard') }} />
      <Tabs.Screen name="bacheca" options={{ title: t('tab.bacheca') }} />
      <Tabs.Screen name="timbrature" options={{ title: t('tab.timbrature') }} />
      <Tabs.Screen name="richieste" options={{ title: t('tab.richieste') }} />
      {hasCantieri && <Tabs.Screen name="cantieri" options={{ title: t('tab.cantieri') }} />}
      <Tabs.Screen name="documenti" options={{ title: t('tab.documenti') }} />
    </Tabs>
  );
}
