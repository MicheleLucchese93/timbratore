// Day-level "Ore lavorate" segment arithmetic, shared by mobile + web.
// Mirrors the backend export-service segment arithmetic
// (apps/backend/src/services/export-service.ts) — keep the two in sync.
import type { StampEventType } from '../types/index.js';

export interface DayStamp {
  id: string;
  event_type: StampEventType;
  occurred_at: string;
  branch_id: string | null;
}

export interface DayTotals {
  workedMs: number;
  breakMs: number;
  lunchMs: number;
  firstInAt: string | null;
  lastOutAt: string | null;
  isOpen: boolean;
}

// `tickOpen` extends any still-open segment to `now` (live "today" behaviour).
// Pass false for closed historical days so a dangling clock_in (missing
// clock_out) contributes 0 instead of ticking for days — mirrors the backend
// export, which only counts completed segments.
export function computeDayTotals(
  stamps: DayStamp[],
  now: Date = new Date(),
  tickOpen = true
): DayTotals {
  const sorted = [...stamps].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );
  let workedMs = 0;
  let breakMs = 0;
  let lunchMs = 0;
  let inAt: Date | null = null;
  let breakAt: Date | null = null;
  let lunchAt: Date | null = null;
  let firstInAt: string | null = null;
  let lastOutAt: string | null = null;
  for (const s of sorted) {
    const t = new Date(s.occurred_at);
    switch (s.event_type) {
      case 'clock_in':
        if (!firstInAt) firstInAt = s.occurred_at;
        inAt = t;
        break;
      case 'break_start':
        if (inAt) {
          workedMs += t.getTime() - inAt.getTime();
          inAt = null;
        }
        breakAt = t;
        break;
      case 'break_end':
        if (breakAt) {
          breakMs += t.getTime() - breakAt.getTime();
          breakAt = null;
        }
        inAt = t;
        break;
      case 'lunch_start':
        if (inAt) {
          workedMs += t.getTime() - inAt.getTime();
          inAt = null;
        }
        lunchAt = t;
        break;
      case 'lunch_end':
        if (lunchAt) {
          lunchMs += t.getTime() - lunchAt.getTime();
          lunchAt = null;
        }
        inAt = t;
        break;
      case 'clock_out':
        if (inAt) {
          workedMs += t.getTime() - inAt.getTime();
          inAt = null;
        }
        lastOutAt = s.occurred_at;
        break;
    }
  }
  const isOpen = inAt !== null || breakAt !== null || lunchAt !== null;
  if (tickOpen) {
    if (inAt) workedMs += now.getTime() - inAt.getTime();
    if (breakAt) breakMs += now.getTime() - breakAt.getTime();
    if (lunchAt) lunchMs += now.getTime() - lunchAt.getTime();
  }
  return { workedMs, breakMs, lunchMs, firstInAt, lastOutAt, isOpen };
}

export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

export function isoDay(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const y = dt.getFullYear();
  const m = (dt.getMonth() + 1).toString().padStart(2, '0');
  const day = dt.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}
