import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient, QueryResult } from 'pg';
import type { StampEventType } from '@sonoqui/shared';
import { isRedundantFixEvent, lockFixAnomalyUser } from '../routes/admin-stamps.js';
import type { DayPunch } from '../routes/admin-stamps.js';

// Which punches "Timbratura standard" (POST /admin/stamps/fix-anomaly) may add
// to a day, and which it must leave alone.
//
// Two rules have already been wrong here, in opposite directions:
//
//  - "skip any event whose type already exists that calendar day" reads a lunch
//    punched as clock_out/clock_in as an exit, so on the Bruno Borroni day
//    (prod, 2026-07-29: in 09:00, out 12:30, in 14:00, no closing punch) the
//    correction skipped the only punch it was asked for and
//    `missing_clock_out` survived the fix — silently, since the web ignores the
//    per-event status it gets back.
//  - "the day's LAST punch decides" then duplicated the exit on a day reopened
//    after the real one (in 09:00, out 17:00, in 21:00): its last punch is an
//    entry, so a second clock_out went in at 17:00 next to the real one.
//
// The sequences below therefore carry TIMES, not just types: the earlier
// version of this file asserted on bare type lists, and ['clock_in',
// 'clock_out', 'clock_in'] describes both days above at once — its "not
// redundant" expectation was right for Borroni and wrong for the reopened day,
// which is precisely the case that duplicates a punch into the payroll export.
//
// The decision is a pure function of the day's stored punches, so everything
// below runs with no database. What needs a live DB — that the day is re-read
// between inserts, and that the advisory lock really serializes two
// corrections — belongs with the DB-backed suites.

// Europe/Rome wall-clock, the way an admin reads the giornata.
function at(hhmm: string): string {
  return `2026-08-20T${hhmm}:00.000+02:00`;
}
function punch(type: StampEventType, hhmm: string): DayPunch {
  return { event_type: type, occurred_at: at(hhmm) };
}

// in 09:00 → out 12:30 (lunch) → in 14:00, exit never punched.
const BORRONI: DayPunch[] = [
  punch('clock_in', '09:00'),
  punch('clock_out', '12:30'),
  punch('clock_in', '14:00'),
];

// in 09:00 → out 17:00 (the real exit) → in 21:00 (called back in, or a night
// shift whose closing punch lands in tomorrow's bucket).
const REOPENED: DayPunch[] = [
  punch('clock_in', '09:00'),
  punch('clock_out', '17:00'),
  punch('clock_in', '21:00'),
];

test('a lunch punched as clock_out does not close the day', () => {
  // Borroni: the day holds a clock_out at 12:30, but the session is open again
  // after the 14:00 re-entry, so the 19:30 exit must be inserted.
  assert.equal(isRedundantFixEvent(BORRONI, punch('clock_out', '19:30')), false);
});

test('a day reopened after the real exit does not take a second one', () => {
  // Same three types as Borroni, different clock: at 17:00 the session opened at
  // 09:00 is already closed, so the exit the anomaly proposes is a duplicate —
  // and the admin can re-raise it every time missing_clock_out reappears.
  assert.equal(isRedundantFixEvent(REOPENED, punch('clock_out', '17:00')), true);
  // The exit does not have to fall exactly on the scheduled end to count: a real
  // exit at 17:05 against a schedule ending 17:00 is the same duplicate.
  const late: DayPunch[] = [
    punch('clock_in', '09:00'),
    punch('clock_out', '17:05'),
    punch('clock_in', '21:00'),
  ];
  assert.equal(isRedundantFixEvent(late, punch('clock_out', '17:00')), true);
  // The evening session, though, is genuinely open: an exit for IT goes in.
  assert.equal(isRedundantFixEvent(REOPENED, punch('clock_out', '23:30')), false);
});

test('a day that already ends closed is left alone', () => {
  const closed: DayPunch[] = [punch('clock_in', '09:00'), punch('clock_out', '17:00')];
  assert.equal(isRedundantFixEvent(closed, punch('clock_out', '17:00')), true);
  const closedWithLunch: DayPunch[] = [
    punch('clock_in', '09:00'),
    punch('clock_out', '12:30'),
    punch('clock_in', '14:00'),
    punch('clock_out', '18:00'),
  ];
  assert.equal(isRedundantFixEvent(closedWithLunch, punch('clock_out', '17:00')), true);
  // And its entry is not duplicated either.
  assert.equal(isRedundantFixEvent(closed, punch('clock_in', '09:00')), true);
});

test('an entry missing before a lunch punched as clock_out still goes in', () => {
  // The mirror image of the Borroni day: the morning entry was forgotten, lunch
  // was punched as exit+entry. The day HOLDS a clock_in (14:00), so the old
  // "already present today" rule skipped the 09:00 entry the admin asked for.
  const missingMorningIn: DayPunch[] = [
    punch('clock_out', '12:30'),
    punch('clock_in', '14:00'),
    punch('clock_out', '18:00'),
  ];
  assert.equal(isRedundantFixEvent(missingMorningIn, punch('clock_in', '09:00')), false);
  // But an entry inside an open session adds nothing.
  assert.equal(isRedundantFixEvent(missingMorningIn, punch('clock_in', '15:00')), true);
});

test('an empty day is not a closed day', () => {
  // stateFromLastEvent(null) is 'nothing' too, which is why the emptiness has
  // to be checked separately: a caller that sends only the exit would otherwise
  // get an empty 200 back and no punch at all.
  assert.equal(isRedundantFixEvent([], punch('clock_out', '17:00')), false);
  assert.equal(isRedundantFixEvent([], punch('clock_in', '09:00')), false);
});

test('an open break or lunch still lets the closing punch through', () => {
  // The employee forgot both lunch_end and the exit. The session is still open
  // at 17:00 — a break is not an exit — so the clock_out must be inserted:
  // refusing would leave the admin's correction with nothing to show.
  const openLunch: DayPunch[] = [punch('clock_in', '09:00'), punch('lunch_start', '13:00')];
  const openBreak: DayPunch[] = [punch('clock_in', '09:00'), punch('break_start', '10:30')];
  const lunchTaken: DayPunch[] = [
    punch('clock_in', '09:00'),
    punch('lunch_start', '13:00'),
    punch('lunch_end', '14:00'),
  ];
  assert.equal(isRedundantFixEvent(openLunch, punch('clock_out', '17:00')), false);
  assert.equal(isRedundantFixEvent(openBreak, punch('clock_out', '17:00')), false);
  assert.equal(isRedundantFixEvent(lunchTaken, punch('clock_out', '17:00')), false);
});

test('a punch the day already holds at that instant is never duplicated', () => {
  // Re-running the same correction proposes each punch at exactly the
  // occurred_at the first run inserted, so the comparison has to include it.
  for (const type of ['clock_in', 'break_start', 'break_end', 'lunch_start', 'lunch_end'] as const) {
    assert.equal(
      isRedundantFixEvent([punch(type, '10:00')], punch(type, '10:00')),
      true,
      `${type} must not be duplicated`
    );
  }
  assert.equal(
    isRedundantFixEvent([punch('clock_in', '09:00'), punch('clock_out', '17:00')], punch('clock_out', '17:00')),
    true
  );
});

test('break and lunch punches are judged on the same session state', () => {
  const onBreak: DayPunch[] = [punch('clock_in', '09:00'), punch('break_start', '10:30')];
  // A second break_start inside the open one adds nothing; a break_end closes it.
  assert.equal(isRedundantFixEvent(onBreak, punch('break_start', '10:45')), true);
  assert.equal(isRedundantFixEvent(onBreak, punch('break_end', '10:45')), false);
  // With the break already closed, a second break is legitimate — the old rule
  // ("break_start exists today") refused it — while a second break_end is not.
  const breakTaken: DayPunch[] = [...onBreak, punch('break_end', '10:45')];
  assert.equal(isRedundantFixEvent(breakTaken, punch('break_start', '15:00')), false);
  assert.equal(isRedundantFixEvent(breakTaken, punch('break_end', '15:00')), true);
  // Same for lunch, and the two never close each other.
  const onLunch: DayPunch[] = [punch('clock_in', '09:00'), punch('lunch_start', '13:00')];
  assert.equal(isRedundantFixEvent(onLunch, punch('lunch_end', '14:00')), false);
  assert.equal(isRedundantFixEvent(onLunch, punch('break_end', '14:00')), true);
});

test('a day missing both ends gets both punches, applied chronologically', () => {
  // Mirrors the handler loop with the per-event re-read replaced by the list
  // built so far: the request arrives out of order (exit first), is sorted, and
  // each decision sees the punches that precede it. Without the sort the
  // clock_out would be judged against an empty day and skipped.
  const requested: DayPunch[] = [punch('clock_out', '17:00'), punch('clock_in', '09:00')];
  const sorted = [...requested].sort(
    (x, y) => new Date(x.occurred_at).getTime() - new Date(y.occurred_at).getTime()
  );

  const day: DayPunch[] = [];
  const statuses: string[] = [];
  for (const ev of sorted) {
    if (isRedundantFixEvent(day, ev)) {
      statuses.push('skipped');
      continue;
    }
    day.push(ev);
    statuses.push('created');
  }

  assert.deepEqual(statuses, ['created', 'created']);
  assert.deepEqual(
    day.map((p) => p.event_type),
    ['clock_in', 'clock_out']
  );

  // Re-running the same correction on the now-closed day changes nothing —
  // what a double-click, or a re-selected row, actually does.
  const again = sorted.map((ev) => (isRedundantFixEvent(day, ev) ? 'skipped' : 'created'));
  assert.deepEqual(again, ['skipped', 'skipped']);
});

test('the same punch twice in one request is inserted once', () => {
  // The schema accepts up to 6 events and nothing dedupes them client-side.
  const day: DayPunch[] = [punch('clock_in', '09:00')];
  const statuses: string[] = [];
  for (const ev of [punch('clock_out', '17:00'), punch('clock_out', '17:00')]) {
    if (isRedundantFixEvent(day, ev)) {
      statuses.push('skipped');
      continue;
    }
    day.push(ev);
    statuses.push('created');
  }
  assert.deepEqual(statuses, ['created', 'skipped']);
});

/* ── the lock that makes the decision above safe under concurrency ───────── */

interface Recorded {
  sql: string;
  params: unknown[];
}

function lockStub(): { client: PoolClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const query = async (sql: string, params: unknown[] = []): Promise<QueryResult> => {
    calls.push({ sql, params });
    return { rows: [], rowCount: 0, command: '', oid: 0, fields: [] } as QueryResult;
  };
  return { client: { query } as unknown as PoolClient, calls };
}

const USER_LOWER = 'aaaaaaaa-bbbb-4bbb-8bbb-cccccccccccc';

test('the fix-anomaly lock key normalises the uuid, so letter case cannot fork it', async () => {
  // hashtextextended hashes BYTES, so the raw '$1::text' key made
  // 'AAAAAAAA-…' and 'aaaaaaaa-…' two different advisory locks — while the
  // membership check and the day query compare `user_id = $1` against a uuid
  // COLUMN, where Postgres parses the parameter and matches both spellings as
  // the same person. FixAnomaly validates with zod's .uuid(), whose regex is
  // case-insensitive and which normalises nothing, so an upper-cased id is a
  // body the API accepts. Two concurrent corrections of that employee took two
  // different locks, neither waited, both read the day before either INSERT
  // landed, both passed isRedundantFixEvent — and two clock_out rows landed at
  // the same instant, straight into the payroll export.
  const lower = lockStub();
  const upper = lockStub();
  await lockFixAnomalyUser(lower.client, USER_LOWER);
  await lockFixAnomalyUser(upper.client, USER_LOWER.toUpperCase());

  const lockOf = (calls: Recorded[]): Recorded =>
    calls.find((c) => c.sql.includes('pg_advisory_xact_lock'))!;
  const a = lockOf(lower.calls);
  const b = lockOf(upper.calls);

  // The parameter stays the caller's spelling on purpose — normalising in JS
  // would only move the problem to the next caller that forgets. The SQL is
  // what has to be case-blind, and it is the same SQL either way.
  assert.equal(a.params[0], USER_LOWER);
  assert.equal(b.params[0], USER_LOWER.toUpperCase());
  assert.equal(a.sql, b.sql);
  assert.match(a.sql, /\$1::uuid::text/, 'the user id must be parsed as a uuid before hashing');
  assert.ok(!a.sql.includes('$1::text'), 'a bare ::text hashes the client spelling byte-for-byte');
});

test('the tenant half of the fix-anomaly key is normalised the same way', async () => {
  // Same reasoning as lib/leave-quota.ts: req.user.tenantId comes back out of a
  // uuid column today, but a key whose case-blindness depends on what some
  // other file happens to do is only half a guarantee. NULLIF covers the empty
  // string a placeholder GUC is left with after a rolled-back SET LOCAL, which
  // ''::uuid would turn into a 22P02 instead of the '-' fallback.
  const { client, calls } = lockStub();
  await lockFixAnomalyUser(client, USER_LOWER);
  const lock = calls.find((c) => c.sql.includes('pg_advisory_xact_lock'))!;

  assert.match(lock.sql, /NULLIF\(current_setting\('app\.current_tenant_id', true\), ''\)::uuid::text/);
  // A distinct prefix from the leave lock: advisory lock ids are one
  // database-wide space, and a stamp correction must not queue behind a leave
  // write for the same employee.
  assert.match(lock.sql, /'stamp:fix-anomaly:'/);
});
