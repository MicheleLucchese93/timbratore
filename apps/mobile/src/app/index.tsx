import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '../store/session';
import { LoginScreen } from '../screens/LoginScreen';
import { HomeScreen } from '../screens/HomeScreen';

export default function Index() {
  const { me, loading, refresh } = useSession();
  useEffect(() => {
    refresh();
  }, [refresh]);
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return me ? <HomeScreen /> : <LoginScreen />;
}
