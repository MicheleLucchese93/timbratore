import { create } from 'zustand';
import {
  authenticate,
  getBiometricCapability,
  isBiometricEnabled,
  setBiometricEnabled,
  type BiometricCapability,
} from '../lib/biometric';

// Grace period: when the biometric lock is on, returning to the foreground
// only re-prompts if the app sat in the background longer than this. Quick
// app-switches (opening the camera, tapping a push, glancing at a map) don't
// force a re-scan — the right balance for an attendance app where clock-ins
// must stay fast. A cold start always locks (the store resets with the JS VM).
const RELOCK_AFTER_MS = 5 * 60 * 1000;

interface LockState {
  /** Capability + persisted flag have been loaded at least once. */
  ready: boolean;
  /** Biometric login is on AND the device can actually satisfy it. */
  enabled: boolean;
  /** Passed biometric this session, or no lock is required. When `enabled`
   *  is true and this is false, the UI must show the LockScreen. */
  unlocked: boolean;
  capability: BiometricCapability | null;
  /** Epoch ms the app was last backgrounded, for the grace-period check. */
  backgroundedAt: number | null;
  init: () => Promise<void>;
  unlock: () => Promise<boolean>;
  enable: () => Promise<{ ok: boolean; error?: string }>;
  disable: () => Promise<void>;
  /** Called after a fresh password login — the user just proved identity,
   *  so don't immediately gate them behind biometrics. */
  markUnlocked: () => void;
  noteBackground: () => void;
  noteForeground: () => void;
}

export const useLock = create<LockState>((set, get) => ({
  ready: false,
  enabled: false,
  // Default unlocked so non-biometric users are never gated, even for the
  // frame before init() resolves. init() flips this to false when a lock is
  // required (which lands before `me` does, since it's local I/O vs the
  // network /me call — so the LockScreen appears in the same render as `me`,
  // never a flash of the app behind it).
  unlocked: true,
  capability: null,
  backgroundedAt: null,

  async init() {
    try {
      const [capability, enabledFlag] = await Promise.all([
        getBiometricCapability(),
        isBiometricEnabled(),
      ]);
      // Fail open: if the user turned biometrics on but later removed every
      // enrolled face/finger from the device, the lock can never be
      // satisfied — treat it as off so they aren't bricked out of a valid
      // session. The Sicurezza toggle still reads `enabledFlag` so they can
      // see it's "on" and re-confirm once biometrics are re-enrolled.
      const effective = enabledFlag && capability.available;
      set({
        ready: true,
        capability,
        enabled: effective,
        unlocked: !effective,
        backgroundedAt: null,
      });
    } catch {
      set({ ready: true, enabled: false, unlocked: true });
    }
  },

  async unlock() {
    const label = get().capability?.label ?? 'biometria';
    const ok = await authenticate(`Sblocca sonoQui con ${label}`);
    if (ok) set({ unlocked: true, backgroundedAt: null });
    return ok;
  },

  async enable() {
    const capability = await getBiometricCapability();
    if (!capability.available) {
      return {
        ok: false,
        error: capability.hasHardware
          ? 'Nessuna biometria configurata su questo dispositivo. Aggiungi un volto o un’impronta nelle impostazioni del telefono.'
          : 'Questo dispositivo non supporta la biometria.',
      };
    }
    // Confirm the user can actually pass the check before persisting the
    // flag — avoids enabling a lock they then can't open.
    const ok = await authenticate(
      `Conferma con ${capability.label} per attivare l’accesso biometrico`
    );
    if (!ok) return { ok: false };
    await setBiometricEnabled(true);
    set({ enabled: true, unlocked: true, capability, backgroundedAt: null });
    return { ok: true };
  },

  async disable() {
    await setBiometricEnabled(false);
    set({ enabled: false, unlocked: true, backgroundedAt: null });
  },

  markUnlocked() {
    set({ unlocked: true, backgroundedAt: null });
  },

  noteBackground() {
    if (!get().enabled) return;
    set({ backgroundedAt: Date.now() });
  },

  noteForeground() {
    const { enabled, backgroundedAt } = get();
    if (!enabled || backgroundedAt == null) return;
    if (Date.now() - backgroundedAt > RELOCK_AFTER_MS) {
      set({ unlocked: false });
    }
    set({ backgroundedAt: null });
  },
}));
