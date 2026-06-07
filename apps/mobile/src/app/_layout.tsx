import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useLock } from '../store/lock';
import { useSession } from '../store/session';
import { LockScreen } from '../screens/LockScreen';
import { i18nReady, applyServerLanguage } from '../i18n';

/**
 * Biometric app-lock gate. Lives at the root layout so it stays mounted
 * across every navigation (the per-route AppState listener in app/index.tsx
 * unmounts once we redirect into the tabs). It:
 *   - loads the lock state once on mount (init),
 *   - re-locks on foreground if the app sat in the background past the grace
 *     period (noteBackground / noteForeground),
 *   - renders the LockScreen as an absolute-fill overlay above the active
 *     route whenever a logged-in session is currently locked.
 */
function LockGate() {
  const me = useSession((s) => s.me);
  const ready = useLock((s) => s.ready);
  const enabled = useLock((s) => s.enabled);
  const unlocked = useLock((s) => s.unlocked);
  const init = useLock((s) => s.init);
  const noteBackground = useLock((s) => s.noteBackground);
  const noteForeground = useLock((s) => s.noteForeground);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    // Use 'background' (not 'inactive') so iOS app-switcher peeks and the
    // notification-centre pull-down don't trip the grace timer.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') noteForeground();
      else if (s === 'background') noteBackground();
    });
    return () => sub.remove();
  }, [noteBackground, noteForeground]);

  if (!me || !ready || !enabled || unlocked) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="auto">
      <LockScreen />
    </View>
  );
}

export default function RootLayout() {
  // Gate first paint until the persisted language has been applied, so the UI
  // never flashes Italian before switching to the user's English preference.
  const [i18nDone, setI18nDone] = useState(false);
  const me = useSession((s) => s.me);

  useEffect(() => {
    void i18nReady.then(() => setI18nDone(true));
  }, []);

  // Server is source of truth for the per-user language once /me resolves.
  useEffect(() => {
    applyServerLanguage(me?.preferences?.language);
  }, [me?.preferences?.language]);

  if (!i18nDone) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#fffbf8' }]} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fffbf8' } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="choose-tenant" options={{ animation: 'fade' }} />
        <Stack.Screen name="profilo" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="forgot-password" options={{ animation: 'slide_from_right' }} />
      </Stack>
      <LockGate />
    </SafeAreaProvider>
  );
}
