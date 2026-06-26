import { useEffect, useRef } from 'react';
import { api } from '../lib/api.ts';

// DEV-STUB: polls /api/v1/realtime/since every 3s.
// Production swaps this for a Centrifuge websocket client.
export function useRealtimePolling(onEvent: (payload: unknown) => void): void {
  const lastIdRef = useRef<number>(0);
  // Keep the latest callback in a ref so callers can pass an inline arrow
  // (new identity each render) without tearing down and re-arming the 3s
  // interval on every render. The effect runs once on mount.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await api<{ events: Array<{ id: number; payload: unknown }>; last_id: number }>(
          `/api/v1/realtime/since?since=${lastIdRef.current}`
        );
        if (r.last_id > lastIdRef.current) {
          lastIdRef.current = r.last_id;
          for (const ev of r.events) onEventRef.current(ev.payload);
        }
      } catch {
        // ignore transient errors
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
}
