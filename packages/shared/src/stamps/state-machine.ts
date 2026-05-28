import type { StampEventType } from '../types/index.js';

export type StampState =
  | 'nothing'
  | 'clocked_in'
  | 'on_break'
  | 'on_lunch';

export function stateAfter(currentState: StampState, event: StampEventType): StampState | null {
  switch (currentState) {
    case 'nothing':
      return event === 'clock_in' ? 'clocked_in' : null;
    case 'clocked_in':
      if (event === 'clock_out') return 'nothing';
      if (event === 'break_start') return 'on_break';
      if (event === 'lunch_start') return 'on_lunch';
      return null;
    case 'on_break':
      if (event === 'break_end') return 'clocked_in';
      return null;
    case 'on_lunch':
      if (event === 'lunch_end') return 'clocked_in';
      return null;
  }
}

export interface ValidateInput {
  currentState: StampState;
  lastEvent: StampEventType | null;
  lastEventAt: Date | null;
  requestedEvent: StampEventType;
  now: Date;
}

export type ValidateResult =
  | { ok: true; nextState: StampState }
  | { ok: false; code: 'INVALID_TRANSITION' | 'DUPLICATE_TOO_FAST' };

export function validateTransition(input: ValidateInput): ValidateResult {
  const { currentState, lastEvent, lastEventAt, requestedEvent, now } = input;
  if (
    lastEvent === requestedEvent &&
    lastEventAt &&
    now.getTime() - lastEventAt.getTime() < 60_000
  ) {
    return { ok: false, code: 'DUPLICATE_TOO_FAST' };
  }
  const next = stateAfter(currentState, requestedEvent);
  if (!next) return { ok: false, code: 'INVALID_TRANSITION' };
  return { ok: true, nextState: next };
}

export function stateFromLastEvent(lastEvent: StampEventType | null): StampState {
  switch (lastEvent) {
    case 'clock_in':
    case 'break_end':
    case 'lunch_end':
      return 'clocked_in';
    case 'break_start':
      return 'on_break';
    case 'lunch_start':
      return 'on_lunch';
    case 'clock_out':
    case null:
      return 'nothing';
  }
}
