import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useLock } from '../store/lock';
import { useSession } from '../store/session';
import { LockScreen } from '../screens/LockScreen';
import { setupBadgeSync } from '../lib/badgeSync';
import { i18nReady, applyServerLanguage } from '../i18n';
import { useUpdateGate } from '../hooks/useUpdateGate';
import { UpdateGateScreen } from '../components/UpdateGateScreen';

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

/**
 * Mirrors the in-app notification unread count to the OS app-icon badge for
 * the whole authenticated session. Lives at the root layout (like LockGate)
 * because app/index.tsx unmounts on the post-login redirect — keeping the
 * badge sync there froze the icon badge after boot (mark-all-read updated the
 * in-app bell but never the OS badge). Re-runs on account / tenant switch so
 * the initial reconcile re-pulls notifications for the active tenant.
 */
function BadgeSyncGate() {
  const userId = useSession((s) => s.me?.user.id);
  const activeTenantId = useSession((s) => s.activeTenantId);
  useEffect(() => {
    if (!userId) return;
    return setupBadgeSync();
  }, [userId, activeTenantId]);
  return null;
}

export default function RootLayout() {
  // Gate first paint until the persisted language has been applied, so the UI
  // never flashes Italian before switching to the user's English preference.
  const [i18nDone, setI18nDone] = useState(false);
  const me = useSession((s) => s.me);

  // Cold-start / warm-foreground OTA check+apply lifecycle. No-ops in dev and
  // when updates are disabled; only flips shouldBlockUI once a new bundle has
  // actually been fetched and a reload is imminent.
  const { shouldBlockUI } = useUpdateGate();

  useEffect(() => {
    void i18nReady.then(() => setI18nDone(true));
  }, []);

  // Server is source of truth for the per-user language once /me resolves.
  useEffect(() => {
    applyServerLanguage(me?.preferences?.language);
  }, [me?.preferences?.language]);

  // Applying an OTA update: show the gate above everything, even before i18n
  // hydration finishes (UpdateGateScreen carries an Italian fallback string).
  if (shouldBlockUI) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <UpdateGateScreen />
      </SafeAreaProvider>
    );
  }

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
      <BadgeSyncGate />
      <LockGate />
    </SafeAreaProvider>
  );
}
