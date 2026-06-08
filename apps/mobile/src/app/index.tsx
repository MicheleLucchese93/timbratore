import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSession } from '../store/session';
import { LoginScreen } from '../screens/LoginScreen';

// Mirrors Documents/Penno/apps/mobile/src/App.tsx safety net: if `refresh`
// never settles (network stall, SecureStore wedge), don't trap the user
// on a spinner forever — surface login after 1500 ms so they can act.
const REFRESH_SAFETY_MS = 1500;

export default function Index() {
  const { me, loading, tenants, activeTenantId, refresh } = useSession();
  const [bootDone, setBootDone] = useState(false);
  const cancelledRef = useRef(false);

  // Cold-start bootstrap.
  useEffect(() => {
    cancelledRef.current = false;
    const timer = setTimeout(() => {
      if (!cancelledRef.current) setBootDone(true);
    }, REFRESH_SAFETY_MS);
    void refresh().finally(() => {
      if (!cancelledRef.current) {
        clearTimeout(timer);
        setBootDone(true);
      }
    });
    return () => {
      cancelledRef.current = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  // Foreground refresh: GoTrue access tokens expire in 1h. The proactive
  // timer in lib/api.ts rotates before exp while the app is running, but
  // an app backgrounded past the timer needs a re-check on resume.
  // Mirrors Penno's AppState handling.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  if (!bootDone && loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (me) return <Redirect href={me.user.role === 'admin' ? '/dashboard' : '/timbrature'} />;
  // Authenticated but a member of several companies with none chosen yet.
  if (tenants.length > 1 && !activeTenantId) return <Redirect href="/choose-tenant" />;
  return <LoginScreen />;
}
