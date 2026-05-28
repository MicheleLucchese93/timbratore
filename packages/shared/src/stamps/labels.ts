import type { StampEventType } from '../types/index.js';

export const stampEventLabel: Record<StampEventType, string> = {
  clock_in: 'Entrata',
  clock_out: 'Uscita',
  break_start: 'Inizio pausa',
  break_end: 'Fine pausa',
  lunch_start: 'Inizio pausa pranzo',
  lunch_end: 'Fine pausa pranzo',
};

export function isBreakEvent(t: StampEventType): boolean {
  return t === 'break_start' || t === 'break_end';
}

export function isLunchEvent(t: StampEventType): boolean {
  return t === 'lunch_start' || t === 'lunch_end';
}

export const ALL_STAMP_EVENT_TYPES: readonly StampEventType[] = [
  'clock_in',
  'clock_out',
  'break_start',
  'break_end',
  'lunch_start',
  'lunch_end',
] as const;
