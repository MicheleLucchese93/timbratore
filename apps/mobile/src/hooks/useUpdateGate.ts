/**
 * useUpdateGate
 *
 * Drives the cold-start and warm-foreground OTA check/fetch/apply lifecycle
 * so users don't need to kill+relaunch twice to pick up a JS-only update
 * published to the OTA server (expo-open-ota at ota.sonoqui.pro).
 *
 * Behaviour:
 *   - Cold start:    silently run checkForUpdateAsync under a 5 s hard
 *                    timeout. Phase stays `'idle'` (no UI) during the
 *                    check so the app renders normally. If no update
 *                    is available, fall through — user never sees
 *                    anything.
 *                    If an update IS available, flip to `'applying'`
 *                    BEFORE fetchUpdateAsync so the gate stays visible
 *                    continuously through fetch → reload.
 *   - Warm foreground (AppState background → active, Δt > 10s): identical
 *                    behaviour to cold start. Quick context switches
 *                    (<10 s) are skipped entirely.
 *
 *   - **Abort-on-timeout**: if check+fetch doesn't finish within the
 *                    cold-start or foreground timeout, we ABANDON the
 *                    apply. The downloaded bundle (if any) is cached on
 *                    disk, and the native side picks it up on the next
 *                    cold launch — no mid-use reload that would throw away
 *                    the user's in-progress timbratura / form state.
 *
 * Design notes:
 *   - Built on expo-updates 56's imperative API. We don't use
 *     `Updates.useUpdates()` because we need strict ordering
 *     (check-then-fetch-then-reload with a shared mutex and a timeout
 *     that covers the combined check+fetch, not each call separately).
 *   - `__DEV__` and `!Updates.isEnabled` short-circuit the whole thing
 *     in the `useState` initializer, so dev builds and emergency
 *     launches never hit the network.
 *   - A single `inFlightRef` serialises the cold-start and foreground
 *     entry points — they can't overlap.
 *   - `reloadAsync` tears down the JS runtime, so anything after it may
 *     or may not execute.
 */

import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';

// Minimal dev-gated logger. expo-updates work is silent in production builds;
// in dev (where the gate short-circuits anyway) these help when manually
// testing against a real OTA server from a release build.
const logger = {
  info: (msg: string, meta?: unknown) =>
    __DEV__ && console.log(`[UpdateGate] ${msg}`, meta ?? ''),
  warn: (msg: string, meta?: unknown) =>
    __DEV__ && console.warn(`[UpdateGate] ${msg}`, meta ?? ''),
  error: (msg: string, err?: unknown) =>
    console.error(`[UpdateGate] ${msg}`, err ?? ''),
};

export type UpdateGatePhase =
  | 'idle' // not checking OR checking silently — no UI shown
  | 'applying' // downloaded, reloadAsync in flight — show gate
  | 'skipped'; // dev / disabled — short-circuited on mount

export interface UpdateGateState {
  phase: UpdateGatePhase;
  /**
   * True only when we've actually downloaded a new bundle and are about
   * to reload. The initial check (both cold-start and warm-foreground)
   * runs silently; users never see the gate for "no update available".
   */
  shouldBlockUI: boolean;
}

export interface UseUpdateGateOptions {
  /** Total ceiling on cold-start check+fetch. Default 5000 ms. */
  coldStartTimeoutMs?: number;
  /**
   * Minimum time in background to trigger a warm-foreground re-check.
   * Quick context switches below this don't run the check. Default 10000 ms.
   */
  foregroundThresholdMs?: number;
  /**
   * Total ceiling on a foreground-triggered check+fetch. If check+fetch
   * takes longer than this from when the foreground listener fires, we
   * abandon the attempt rather than reloading mid-use. Default 5000 ms.
   */
  foregroundTimeoutMs?: number;
}

const DEFAULT_COLD_TIMEOUT_MS = 5000;
const DEFAULT_FOREGROUND_THRESHOLD_MS = 10000;
const DEFAULT_FOREGROUND_TIMEOUT_MS = 5000;

export function useUpdateGate(
  options: UseUpdateGateOptions = {}
): UpdateGateState {
  const coldTimeoutMs = options.coldStartTimeoutMs ?? DEFAULT_COLD_TIMEOUT_MS;
  const foregroundThresholdMs =
    options.foregroundThresholdMs ?? DEFAULT_FOREGROUND_THRESHOLD_MS;
  const foregroundTimeoutMs =
    options.foregroundTimeoutMs ?? DEFAULT_FOREGROUND_TIMEOUT_MS;

  const [phase, setPhase] = useState<UpdateGatePhase>(() => {
    // Dev and emergency-launch paths never hit the network.
    if (__DEV__ || !Updates.isEnabled) {
      return 'skipped';
    }
    return 'idle';
  });

  // Serialises cold-start and foreground entry points; both paths share
  // the same check/fetch/reload verb sequence and must not overlap.
  const inFlightRef = useRef(false);
  // Timestamp when AppState last left 'active'. Nulled on return to
  // 'active' so the first-activation-after-mount doesn't falsely qualify.
  const backgroundedAtRef = useRef<number | null>(null);
  // Guards React 18 StrictMode dev double-effect firing.
  const coldStartedRef = useRef(false);
  // Set to true immediately before `Updates.reloadAsync()` is called.
  // Used by timeout handlers to know "don't dismiss the gate, the reload
  // is already in flight and will tear down the runtime momentarily."
  const reloadInFlightRef = useRef(false);

  /**
   * Run check → (gate) → fetch → reload with cooperative aborts.
   *
   * `shouldAbort()` is checked AFTER every network call; if it returns
   * true, we abandon the run without calling `setPhase('applying')` (if
   * we haven't already) and without calling `reloadAsync`. Returns:
   *   - 'applied'  if reloadAsync was invoked.
   *   - 'none'     if no update was available or the fetched update was
   *                not new.
   *   - 'aborted'  if `shouldAbort()` returned true at any checkpoint.
   * Throws on network/signature/disk errors — the caller swallows.
   */
  const runCheckFetchReload = async (
    source: 'cold' | 'foreground',
    shouldAbort: () => boolean
  ): Promise<'applied' | 'none' | 'aborted'> => {
    const check = await Updates.checkForUpdateAsync();
    logger.info(`${source} check complete`, {
      isAvailable: check.isAvailable,
      currentUpdateId: Updates.updateId,
    });
    if (!check.isAvailable) {
      return 'none';
    }
    if (shouldAbort()) {
      logger.info(
        `${source} aborted after check (window elapsed); will retry next launch`
      );
      return 'aborted';
    }

    // Flip UI to 'applying' BEFORE fetchUpdateAsync so the gate stays
    // visible continuously from "update available" through reload.
    setPhase('applying');

    const fetched = await Updates.fetchUpdateAsync();
    logger.info(`${source} fetch complete`, { isNew: fetched.isNew });
    if (!fetched.isNew) {
      // Rare: server had a new manifest but the bundle matched ours.
      // Unblock UI — nothing to apply.
      setPhase('skipped');
      return 'none';
    }
    if (shouldAbort()) {
      // Bundle is cached on disk by expo-updates; next cold launch (or
      // next quiet foreground) will pick it up without re-downloading.
      logger.info(
        `${source} aborted after fetch (window elapsed); bundle cached for next launch`
      );
      setPhase('skipped');
      return 'aborted';
    }

    // Committing to the reload — mark the ref so any concurrent timeout
    // doesn't dismiss the gate out from under reloadAsync.
    reloadInFlightRef.current = true;

    // reloadAsync resolves just before the actual reload. Nothing after
    // this reliably executes.
    await Updates.reloadAsync();
    return 'applied';
  };

  // Cold-start effect: runs once on mount when updates are enabled.
  // Skips entirely when phase is 'skipped' (dev / disabled).
  useEffect(() => {
    if (phase === 'skipped') return;
    if (coldStartedRef.current) return;
    coldStartedRef.current = true;

    let cancelled = false;
    let timedOut = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const shouldAbort = () => cancelled || timedOut;

    const run = async () => {
      if (inFlightRef.current) {
        // Shouldn't happen on cold start, but defence in depth.
        logger.info('Cold-start check skipped; already in flight');
        if (!cancelled) setPhase('skipped');
        return;
      }
      inFlightRef.current = true;

      try {
        timerId = setTimeout(() => {
          timedOut = true;
          // If the gate was shown (check already found an update and we
          // flipped to 'applying'), dismiss it so the user can use the
          // app. The download continues in the background; any bundle
          // that lands after this point is cached, not auto-applied.
          if (!cancelled && !reloadInFlightRef.current) {
            setPhase('skipped');
          }
          logger.warn('Cold-start check/fetch timed out; abandoning apply', {
            timeoutMs: coldTimeoutMs,
          });
        }, coldTimeoutMs);

        await runCheckFetchReload('cold', shouldAbort);
      } catch (err) {
        logger.error('Cold-start check failed; falling through', err);
      } finally {
        inFlightRef.current = false;
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        // If reload is not in flight and we're still mounted, make sure
        // the phase isn't stuck on 'applying'.
        if (!cancelled && !reloadInFlightRef.current) {
          setPhase((prev) => (prev === 'applying' ? 'skipped' : prev));
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [phase, coldTimeoutMs]);

  // Foreground listener: runs silently when the app returns after being
  // backgrounded > foregroundThresholdMs. Only flips shouldBlockUI when
  // a new update actually downloads AND the foreground timeout hasn't
  // elapsed yet — otherwise we abandon so the user isn't reloaded
  // mid-use after coming back to the app.
  useEffect(() => {
    // Skip entirely in dev / when updates disabled — matches the
    // cold-start short-circuit.
    if (__DEV__ || !Updates.isEnabled) return;

    const handleAppStateChange = (next: AppStateStatus) => {
      if (next === 'background') {
        // Only record on a real background transition; ignore 'inactive'
        // which iOS spuriously emits for control-centre swipes etc.
        if (backgroundedAtRef.current == null) {
          backgroundedAtRef.current = Date.now();
        }
        return;
      }
      if (next !== 'active') return;

      const since = backgroundedAtRef.current;
      backgroundedAtRef.current = null;
      if (since == null) {
        // First activation after mount — not a real foreground return.
        return;
      }
      const elapsed = Date.now() - since;
      if (elapsed < foregroundThresholdMs) {
        logger.info('Foreground check skipped (below threshold)', {
          elapsedMs: elapsed,
          thresholdMs: foregroundThresholdMs,
        });
        return;
      }
      if (inFlightRef.current) {
        logger.info('Foreground check skipped; already in flight');
        return;
      }

      let timedOut = false;
      let timerId: ReturnType<typeof setTimeout> | null = null;
      const shouldAbort = () => timedOut;

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

          await runCheckFetchReload('foreground', shouldAbort);
        } catch (err) {
          logger.warn('Foreground check failed; continuing', {
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

  // Only block when we're actually applying an update. The pre-check
  // (cold or foreground) runs invisibly in the background.
  const shouldBlockUI = phase === 'applying';
  return { phase, shouldBlockUI };
}
