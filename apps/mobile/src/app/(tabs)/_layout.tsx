import { Tabs } from 'expo-router/js-tabs';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '../../store/session';
import { CustomTabBar } from '../../components/CustomTabBar';

export default function TabsLayout() {
  const { me, loading } = useSession();
  if (loading && !me) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!me) return <Redirect href="/" />;
  return (
    <Tabs
      initialRouteName="timbrature"
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="timbrature" options={{ title: 'Timbrature' }} />
      <Tabs.Screen name="storico" options={{ title: 'Storico' }} />
      <Tabs.Screen name="correzioni" options={{ title: 'Correzioni' }} />
      <Tabs.Screen name="profilo" options={{ title: 'Profilo' }} />
    </Tabs>
  );
}
