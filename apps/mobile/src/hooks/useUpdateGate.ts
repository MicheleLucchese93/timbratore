/**
 * useUpdateGate (warm-foreground only)
 *
 * Cold-launch OTA apply is handled NATIVELY by expo-updates: with
 * `EXUpdatesLaunchWaitMs` (= app.json `updates.fallbackToCacheTimeout`) set to
 * 10000, the native runtime waits up to 10 s on the splash, downloads any
 * pending update, and launches directly into it — a single cold launch, no JS
 * gate, no race. A hand-rolled cold-start JS gate is deliberately NOT used here:
 * it races the native background download and tends to apply "next launch only"
 * (the lesson baked into Argo's self-hosted-OTA guide §3/§4).
 *
 * This hook covers ONLY the case the native side can't: a WARM foreground —
 * the app resumes after being backgrounded a while. expo-updates has no
 * built-in foreground check, so we run the documented AppState pattern:
 * https://docs.expo.dev/eas-update/download-updates/
 *
 * Behaviour on resume (AppState background → active, Δt ≥ threshold):
 *   - silently checkForUpdateAsync under a hard timeout; phase stays 'idle'
 *     (no UI) during the check;
 *   - if an update is available, flip to 'applying' (show the gate) BEFORE
 *     fetchUpdateAsync so the gate stays visible continuously through reload;
 *   - **abort-on-timeout**: if check+fetch doesn't finish in time, abandon the
 *     apply. The downloaded bundle is cached on disk and the native side picks
 *     it up on the next cold launch — never a reload mid-timbratura.
 *
 * Guards (per the guide):
 *   - threshold ≥ 5 min in background before a re-check, so a quick glance away
 *     never yanks the user back to a reloaded app;
 *   - reloadAsync is called AFTER the async fetch, never synchronously inside
 *     the AppState listener (avoids expo/expo#16264);
 *   - `__DEV__` / `!Updates.isEnabled` short-circuit the whole thing.
 */

import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';

const logger = {
  info: (msg: string, meta?: unknown) =>
    __DEV__ && console.log(`[UpdateGate] ${msg}`, meta ?? ''),
  warn: (msg: string, meta?: unknown) =>
    __DEV__ && console.warn(`[UpdateGate] ${msg}`, meta ?? ''),
};

export type UpdateGatePhase =
  | 'idle' // not checking OR checking silently — no UI shown
  | 'applying' // downloaded, reloadAsync in flight — show gate
  | 'skipped'; // dev / disabled — short-circuited on mount

export interface UpdateGateState {
  phase: UpdateGatePhase;
  /**
   * True only when a new bundle has been fetched and a reload is imminent. The
   * silent check never shows the gate.
   */
  shouldBlockUI: boolean;
}

export interface UseUpdateGateOptions {
  /**
   * Minimum time in background to trigger a warm-foreground re-check. Quick
   * context switches below this don't run the check. Default 5 min — only
   * re-check once the user is unlikely to expect their exact session restored.
   */
  foregroundThresholdMs?: number;
  /**
   * Total ceiling on a foreground-triggered check+fetch. If it runs longer, we
   * abandon rather than reloading mid-use. Default 5000 ms.
   */
  foregroundTimeoutMs?: number;
}

const DEFAULT_FOREGROUND_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_FOREGROUND_TIMEOUT_MS = 5000;

export function useUpdateGate(
  options: UseUpdateGateOptions = {}
): UpdateGateState {
  const foregroundThresholdMs =
    options.foregroundThresholdMs ?? DEFAULT_FOREGROUND_THRESHOLD_MS;
  const foregroundTimeoutMs =
    options.foregroundTimeoutMs ?? DEFAULT_FOREGROUND_TIMEOUT_MS;

  const [phase, setPhase] = useState<UpdateGatePhase>(() =>
    __DEV__ || !Updates.isEnabled ? 'skipped' : 'idle'
  );

  // Timestamp when AppState last left 'active'. Nulled on return to 'active' so
  // the first-activation-after-mount doesn't falsely qualify.
  const backgroundedAtRef = useRef<number | null>(null);
  // Serialises overlapping foreground checks.
  const inFlightRef = useRef(false);
  // Set immediately before reloadAsync so a concurrent timeout doesn't dismiss
  // the gate out from under the reload.
  const reloadInFlightRef = useRef(false);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    const handleAppStateChange = (next: AppStateStatus) => {
      if (next === 'background') {
        // Record only on a real background transition; ignore the 'inactive'
        // iOS emits for control-centre swipes etc.
        if (backgroundedAtRef.current == null) {
          backgroundedAtRef.current = Date.now();
        }
        return;
      }
      if (next !== 'active') return;

      const since = backgroundedAtRef.current;
      backgroundedAtRef.current = null;
      if (since == null) return; // first activation after mount
      const elapsed = Date.now() - since;
      if (elapsed < foregroundThresholdMs) {
        logger.info('Foreground check skipped (below threshold)', {
          elapsedMs: elapsed,
          thresholdMs: foregroundThresholdMs,
        });
        return;
      }
      if (inFlightRef.current) return;

      let timedOut = false;
      let timerId: ReturnType<typeof setTimeout> | null = null;

      void (async () => {
        inFlightRef.current = true;
        try {
          timerId = setTimeout(() => {
            timedOut = true;
            if (!reloadInFlightRef.current) {
              setPhase((prev) => (prev === 'applying' ? 'skipped' : prev));
            }
            logger.warn('Foreground check/fetch timed out; abandoning apply', {
              timeoutMs: foregroundTimeoutMs,
            });
          }, foregroundTimeoutMs);

          const check = await Updates.checkForUpdateAsync();
          if (!check.isAvailable || timedOut) return;

          // Show the gate from "update available" through reload.
          setPhase('applying');
          const fetched = await Updates.fetchUpdateAsync();
          if (!fetched.isNew || timedOut) {
            // Not new, or window elapsed — the bundle (if any) is cached for the
            // next cold launch. Unblock.
            setPhase('skipped');
            return;
          }

          // Commit to the reload AFTER the fetch (never sync in the listener).
          reloadInFlightRef.current = true;
          await Updates.reloadAsync();
        } catch (err) {
          logger.warn('Foreground update check failed; continuing', {
            message: err instanceof Error ? err.message : String(err),
          });
        } finally {
          inFlightRef.current = false;
          if (timerId !== null) clearTimeout(timerId);
          if (!reloadInFlightRef.current) {
            setPhase((prev) => (prev === 'applying' ? 'skipped' : prev));
          }
        }
      })();
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [foregroundThresholdMs, foregroundTimeoutMs]);

  return { phase, shouldBlockUI: phase === 'applying' };
}
