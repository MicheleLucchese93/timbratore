import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useLock } from '../store/lock';
import { useSession } from '../store/session';
import { color, space } from '@sonoqui/shared';

const LOGO = require('../../assets/images/icon.png');

/**
 * Full-screen biometric lock. Rendered as an overlay by LockGate (in
 * app/_layout.tsx) on top of whatever route is mounted, so it covers the app
 * regardless of where the user was when the grace period expired. The OS
 * prompt fires once automatically on mount; the button re-triggers it, and
 * "Esci" drops back to the password login.
 */
export function LockScreen() {
  const { t } = useTranslation(['lock', 'common']);
  const unlock = useLock((s) => s.unlock);
  const capability = useLock((s) => s.capability);
  const logout = useSession((s) => s.logout);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const triedRef = useRef(false);

  const label = capability?.label ?? t('biometricFallback');
  const iconName =
    label === 'Face ID' || label === 'riconoscimento facciale'
      ? 'scan-outline'
      : 'finger-print-outline';

  const attempt = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    const ok = await unlock();
    setBusy(false);
    if (!ok) setFailed(true);
  }, [unlock]);

  // Auto-prompt once so the OS sheet appears the instant the lock shows.
  useEffect(() => {
    if (triedRef.current) return;
    triedRef.current = true;
    void attempt();
  }, [attempt]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <Image source={LOGO} style={styles.logo} resizeMode="contain" accessible={false} />
        <Text style={styles.brand}>
          sono<Text style={styles.brandAccent}>Qui</Text>
        </Text>
        <Text style={styles.subtitle}>{t('subtitle')}</Text>

        <Pressable
          onPress={busy ? undefined : attempt}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('unlockWith', { label })}
          style={({ pressed }) => [
            styles.cta,
            pressed && styles.ctaPressed,
            busy && styles.ctaBusy,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={color.onPrimary} />
          ) : (
            <View style={styles.ctaInner}>
              <Ionicons name={iconName} size={20} color={color.onPrimary} />
              <Text style={styles.ctaText}>{t('unlockWith', { label })}</Text>
            </View>
          )}
        </Pressable>

        {failed ? (
          <Text style={styles.failed}>{t('failed')}</Text>
        ) : null}

        <Pressable
          onPress={() => {
            void logout();
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('exit')}
          style={({ pressed }) => [styles.exit, pressed && styles.exitPressed]}
        >
          <Text style={styles.exitText}>{t('exit')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.s5,
  },
  logo: {
    width: 84,
    height: 84,
    marginBottom: space.s3,
    backgroundColor: color.surface,
  },
  brand: {
    fontSize: 48,
    lineHeight: 56,
    fontWeight: '800',
    color: color.primary,
    letterSpacing: -1,
    textAlign: 'center',
  },
  brandAccent: { color: color.onPrimaryContainer },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: color.onSurfaceVariant,
    marginTop: space.s2,
    marginBottom: space.s8,
    textAlign: 'center',
  },
  cta: {
    backgroundColor: color.primary,
    paddingVertical: 16,
    paddingHorizontal: space.s6,
    borderRadius: 24,
    minHeight: 52,
    minWidth: 240,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(31,27,22,0.25)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 4,
  },
  ctaInner: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  ctaPressed: { opacity: 0.85 },
  ctaBusy: { opacity: 0.6 },
  ctaText: { fontSize: 16, fontWeight: '600', color: color.onPrimary },
  failed: {
    marginTop: space.s4,
    fontSize: 14,
    color: color.error,
    textAlign: 'center',
  },
  exit: { marginTop: space.s6, paddingVertical: space.s2 },
  exitPressed: { opacity: 0.6 },
  exitText: { fontSize: 15, fontWeight: '600', color: color.primary },
});
