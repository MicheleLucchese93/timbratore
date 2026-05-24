import { useEffect, useRef } from 'react';
import { api } from '../lib/api.ts';

// DEV-STUB: polls /api/v1/realtime/since every 3s.
// Production swaps this for a Centrifuge websocket client.
export function useRealtimePolling(onEvent: (payload: unknown) => void): void {
  const lastIdRef = useRef<number>(0);
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
          for (const ev of r.events) onEvent(ev.payload);
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
  }, [onEvent]);
}
