import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSession } from '../store/session';
import { LoginScreen } from '../screens/LoginScreen';

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
  if (me) return <Redirect href="/timbrature" />;
  return <LoginScreen />;
}
