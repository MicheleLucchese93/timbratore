import { Tabs } from 'expo-router/js-tabs';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../store/session';
import { CustomTabBar } from '../../components/CustomTabBar';

export default function TabsLayout() {
  const { t } = useTranslation('components');
  const { me, loading } = useSession();
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
  // Admins open on the Dashboard recap; everyone else on their stamp screen
  // (or Storico when no stamp method is enabled).
  const initialRouteName = isAdmin ? 'dashboard' : canStamp ? 'timbrature' : 'storico';
  return (
    <Tabs
      initialRouteName={initialRouteName}
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="dashboard" options={{ title: t('tab.dashboard') }} />
      <Tabs.Screen name="timbrature" options={{ title: t('tab.timbrature') }} />
      <Tabs.Screen name="storico" options={{ title: t('tab.storico') }} />
      <Tabs.Screen name="correzioni" options={{ title: t('tab.correzioni') }} />
      <Tabs.Screen name="richieste" options={{ title: t('tab.richieste') }} />
    </Tabs>
  );
}
