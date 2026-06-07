import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Opt-in flag for the biometric app-lock. We store it in SecureStore (same
// place as the auth tokens) rather than a plain pref so a rooted/jailbroken
// inspection can't trivially flip the lock off. The *session* itself
// (access/refresh tokens) already persists across restarts in lib/api.ts —
// this flag only governs whether that restored session is gated behind a
// Face ID / Touch ID / fingerprint prompt before the UI is shown.
const ENABLED_KEY = 'sonoqui.biometric_enabled';

export interface BiometricCapability {
  /** Hardware present AND at least one biometric enrolled — the only state
   *  in which authentication can actually succeed. */
  available: boolean;
  hasHardware: boolean;
  enrolled: boolean;
  /** Human label for the UI: "Face ID", "Touch ID", "impronta digitale",
   *  "riconoscimento facciale", or the generic "biometria". */
  label: string;
}

function labelFor(types: LocalAuthentication.AuthenticationType[]): string {
  const hasFace = types.includes(
    LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION
  );
  const hasFinger = types.includes(
    LocalAuthentication.AuthenticationType.FINGERPRINT
  );
  if (Platform.OS === 'ios') {
    if (hasFace) return 'Face ID';
    if (hasFinger) return 'Touch ID';
    return 'biometria';
  }
  // Android (and anything else): describe the modality generically in IT.
  if (hasFace) return 'riconoscimento facciale';
  if (hasFinger) return 'impronta digitale';
  return 'biometria';
}

export async function getBiometricCapability(): Promise<BiometricCapability> {
  // The mobile app's web build (Expo web) is the Playwright e2e harness and
  // has no biometric hardware — report unavailable so the toggle renders
  // disabled instead of throwing on the missing native module.
  if (Platform.OS === 'web') {
    return { available: false, hasHardware: false, enrolled: false, label: 'biometria' };
  }
  try {
    const [hasHardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    return {
      available: hasHardware && enrolled,
      hasHardware,
      enrolled,
      label: labelFor(types),
    };
  } catch {
    return { available: false, hasHardware: false, enrolled: false, label: 'biometria' };
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await SecureStore.getItemAsync(ENABLED_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  if (Platform.OS === 'web') return;
  if (enabled) {
    // AFTER_FIRST_UNLOCK mirrors the token storage in lib/api.ts so a
    // background read right after a device unlock doesn't throw.
    await SecureStore.setItemAsync(ENABLED_KEY, 'true', {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  } else {
    await SecureStore.deleteItemAsync(ENABLED_KEY);
  }
}

/** Run the OS biometric sheet. Returns true only on a confirmed success.
 *  Device-passcode fallback stays enabled so a user whose face/finger fails
 *  repeatedly is never trapped out of their own session. */
export async function authenticate(promptMessage: string): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Annulla',
      fallbackLabel: 'Usa codice',
    });
    return res.success === true;
  } catch {
    return false;
  }
}
