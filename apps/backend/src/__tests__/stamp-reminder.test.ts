import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDueReminders,
  type DayStamp,
  type DueReminder,
  type ReminderInput,
} from '../services/jobs/stamp-reminder.js';
import type { StampEventType } from '@sonoqui/shared';
import { zonedWallClock } from '../lib/tz.js';

// Pure unit tests for computeDueReminders (no DB). Slot times AND stamps are
// Europe/Rome wall-clock; stamps are built as the matching Rome-local instant
// via zonedWallClock so they line up with the slot conversion regardless of DST.
// 2025-06-09 is a Monday and NOT a national holiday.
const MON = '2025-06-09';

function ms(hhmm: string, date = MON): number {
  return zonedWallClock(date, hhmm).getTime();
}
function st(event_type: StampEventType, hhmm: string): DayStamp {
  return { event_type, occurredMs: ms(hhmm) };
}
function run(over: Partial<ReminderInput> = {}): DueReminder[] {
  return computeDueReminders({
    slots: [{ start: '09:00', end: '18:00' }],
    stamps: [],
    leaves: [],
    tolInMin: 10,
    tolOutMin: 10,
    localDate: MON,
    timeZone: 'Europe/Rome',
    isHoliday: false,
    nowMs: ms('09:11'),
    ...over,
  });
}
const kinds = (r: DueReminder[]) => r.map((x) => x.kind).sort();
const boundaries = (r: DueReminder[]) => r.map((x) => x.boundary).sort();

test('entry fires when no clock_in past start + tolerance', () => {
  const r = run({ nowMs: ms('09:11') });
  assert.deepEqual(boundaries(r), ['entry@09:00']);
  assert.equal(r[0]!.kind, 'entry');
});

test('entry does not fire once clocked in', () => {
  const r = run({ stamps: [st('clock_in', '09:00')], nowMs: ms('09:11') });
  assert.deepEqual(r, []);
});

test('entry does not fire before start + tolerance', () => {
  // 09:05 < 09:00 + 10min grace.
  assert.deepEqual(run({ nowMs: ms('09:05') }), []);
});

test('entry suppressed past the 120-min lateness cap', () => {
  // due at 09:10, cap 11:10; 12:00 is past it.
  assert.deepEqual(run({ nowMs: ms('12:00') }), []);
});

test('exit fires when still clocked in past end + tolerance', () => {
  const r = run({ stamps: [st('clock_in', '09:00')], nowMs: ms('18:11') });
  assert.deepEqual(boundaries(r), ['exit@18:00']);
  assert.equal(r[0]!.kind, 'exit');
});

test('exit does not fire once clocked out', () => {
  const r = run({
    stamps: [st('clock_in', '09:00'), st('clock_out', '18:00')],
    nowMs: ms('18:11'),
  });
  assert.deepEqual(r, []);
});

test('split shift: lunch_out fires when still working at midday gap', () => {
  const r = run({
    slots: [
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '18:00' },
    ],
    stamps: [st('clock_in', '09:00')],
    nowMs: ms('13:11'),
  });
  assert.deepEqual(boundaries(r), ['lunch_out@13:00']);
  assert.equal(r[0]!.kind, 'lunch_out');
});

test('split shift: lunch_in fires when on lunch and not back', () => {
  const r = run({
    slots: [
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '18:00' },
    ],
    stamps: [st('clock_in', '09:00'), st('lunch_start', '13:00')],
    nowMs: ms('14:11'),
  });
  assert.deepEqual(boundaries(r), ['lunch_in@14:00']);
  assert.equal(r[0]!.kind, 'lunch_in');
});

test('split shift: lunch_in fires when clocked out for the split and not returned', () => {
  const r = run({
    slots: [
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '18:00' },
    ],
    stamps: [st('clock_in', '09:00'), st('clock_out', '13:00')],
    nowMs: ms('14:11'),
  });
  assert.deepEqual(boundaries(r), ['lunch_in@14:00']);
});

test('a short break (pausa) never triggers a reminder', () => {
  // Single continuous fascia, on a break at exit time -> exit still fires (still
  // clocked in), but no break_* boundary is ever emitted.
  const r = run({
    slots: [{ start: '09:00', end: '18:00' }],
    stamps: [st('clock_in', '09:00'), st('break_start', '15:00')],
    nowMs: ms('18:11'),
  });
  assert.deepEqual(kinds(r), ['exit']);
});

test('approved leave covering the boundary suppresses the reminder', () => {
  const r = run({
    nowMs: ms('09:11'),
    leaves: [{ fromMs: ms('00:00'), toMs: ms('23:59') }],
  });
  assert.deepEqual(r, []);
});

test('national holiday suppresses all reminders', () => {
  assert.deepEqual(run({ isHoliday: true, nowMs: ms('09:11') }), []);
});

test('no assigned slots -> no reminders', () => {
  assert.deepEqual(run({ slots: [], nowMs: ms('09:11') }), []);
});
