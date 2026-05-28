import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTransition, stateFromLastEvent } from '../stamps/state-machine.ts';

const now = new Date('2026-05-24T12:00:00Z');
const longAgo = new Date('2026-05-24T11:50:00Z');

test('nothing → clock_in OK', () => {
  const r = validateTransition({
    currentState: 'nothing',
    lastEvent: null,
    lastEventAt: null,
    requestedEvent: 'clock_in',
    now,
  });
  assert.deepEqual(r, { ok: true, nextState: 'clocked_in' });
});

test('nothing → break_start NOT OK', () => {
  const r = validateTransition({
    currentState: 'nothing',
    lastEvent: null,
    lastEventAt: null,
    requestedEvent: 'break_start',
    now,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'INVALID_TRANSITION');
});

test('clock_in → clock_in within 60s = DUPLICATE_TOO_FAST', () => {
  const r = validateTransition({
    currentState: 'clocked_in',
    lastEvent: 'clock_in',
    lastEventAt: new Date(now.getTime() - 30_000),
    requestedEvent: 'clock_in',
    now,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'DUPLICATE_TOO_FAST');
});

test('break_start → clock_out NOT OK (must end break first)', () => {
  const r = validateTransition({
    currentState: 'on_break',
    lastEvent: 'break_start',
    lastEventAt: longAgo,
    requestedEvent: 'clock_out',
    now,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'INVALID_TRANSITION');
});

test('break_end → clock_out OK', () => {
  const r = validateTransition({
    currentState: 'clocked_in',
    lastEvent: 'break_end',
    lastEventAt: longAgo,
    requestedEvent: 'clock_out',
    now,
  });
  assert.deepEqual(r, { ok: true, nextState: 'nothing' });
});

test('break_end → break_start OK (second break)', () => {
  const r = validateTransition({
    currentState: 'clocked_in',
    lastEvent: 'break_end',
    lastEventAt: longAgo,
    requestedEvent: 'break_start',
    now,
  });
  assert.deepEqual(r, { ok: true, nextState: 'on_break' });
});

test('stateFromLastEvent reflects matrix', () => {
  assert.equal(stateFromLastEvent(null), 'nothing');
  assert.equal(stateFromLastEvent('clock_in'), 'clocked_in');
  assert.equal(stateFromLastEvent('break_start'), 'on_break');
  assert.equal(stateFromLastEvent('break_end'), 'clocked_in');
  assert.equal(stateFromLastEvent('lunch_start'), 'on_lunch');
  assert.equal(stateFromLastEvent('lunch_end'), 'clocked_in');
  assert.equal(stateFromLastEvent('clock_out'), 'nothing');
});

test('clocked_in → lunch_start OK', () => {
  const r = validateTransition({
    currentState: 'clocked_in',
    lastEvent: 'clock_in',
    lastEventAt: longAgo,
    requestedEvent: 'lunch_start',
    now,
  });
  assert.deepEqual(r, { ok: true, nextState: 'on_lunch' });
});

test('on_lunch → lunch_end OK', () => {
  const r = validateTransition({
    currentState: 'on_lunch',
    lastEvent: 'lunch_start',
    lastEventAt: longAgo,
    requestedEvent: 'lunch_end',
    now,
  });
  assert.deepEqual(r, { ok: true, nextState: 'clocked_in' });
});

test('on_lunch → break_end NOT OK (wrong end type)', () => {
  const r = validateTransition({
    currentState: 'on_lunch',
    lastEvent: 'lunch_start',
    lastEventAt: longAgo,
    requestedEvent: 'break_end',
    now,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'INVALID_TRANSITION');
});

test('on_break → lunch_start NOT OK (no concurrent breaks)', () => {
  const r = validateTransition({
    currentState: 'on_break',
    lastEvent: 'break_start',
    lastEventAt: longAgo,
    requestedEvent: 'lunch_start',
    now,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'INVALID_TRANSITION');
});
