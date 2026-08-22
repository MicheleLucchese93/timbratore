import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportsEmployee } from '../services/export-service.js';

/* Who lands in a period's export.
 *
 * The xlsx aggregate used to pick its people implicitly — whoever had a stamp
 * or an approved leave in the period — while the Centro Paghe writer picked
 * them explicitly from the membership list. An employee with a shift assignment
 * but neither a punch nor a leave therefore got NO row in the xlsx (0,00 "Ore
 * ordinarie") while the payroll file for the same month wrote a full month of
 * theoretical hours against them: 176:00 on one side, nothing on the other.
 *
 * Both selections now run through exportsEmployee(), so the pair below pins the
 * property that matters — same month, same employees — without a database.
 *
 * memberships.deleted_at is deliberately NOT part of either selection: the two
 * writers used to disagree about a removed member, and the hours somebody
 * actually worked in a period that has already been paid have to reach the
 * payroll file. See the removal tests at the bottom. */

interface Member {
  userId: string;
  /** memberships.active */
  active: boolean;
  /** memberships.deleted_at set — DELETE /users/:id, which also clears active. */
  removed: boolean;
  hasStamps: boolean;
  hasLeave: boolean;
}

/** Mirrors aggregateForExport(): byUser is seeded from the stamp query, gains
 *  the leave-only users, then is completed from loadAnagrafica().
 *
 *  `orphanLeaveUserIds` are users the leave map surfaces who have NO membership
 *  row at all — the one path that reaches this file without going through the
 *  anagrafica, so it needs its own argument to be modelled honestly. */
function aggregateSelection(members: Member[], orphanLeaveUserIds: string[] = []): string[] {
  const byUser = new Set(members.filter((m) => m.hasStamps).map((m) => m.userId));
  const extra = new Set([
    ...members.filter((m) => m.hasLeave && !byUser.has(m.userId)).map((m) => m.userId),
    ...orphanLeaveUserIds,
  ]);
  for (const m of members) {
    const hadActivity = byUser.has(m.userId) || extra.has(m.userId);
    if (hadActivity) continue;
    if (!exportsEmployee(m.active, hadActivity)) continue;
    extra.add(m.userId);
  }
  return [...byUser, ...extra].sort();
}

/** Mirrors writeCentroPaghe(): loadAnagrafica() filtered by the same predicate.
 *  `agg` is left out of hadActivity on purpose — a UserAgg row exists exactly
 *  for the users aggregateSelection() returns, so counting it would be circular. */
function centroPagheSelection(members: Member[]): string[] {
  return members
    .filter((m) => exportsEmployee(m.active, m.hasStamps || m.hasLeave))
    .map((m) => m.userId)
    .sort();
}

/** Every combination of the flags, as members m0..m11. `removed` implies
 *  `active === false`: DELETE /users/:id writes both in one UPDATE, so a removed
 *  member that is still active does not exist and is not worth pinning. */
function everyCombination(): Member[] {
  const out: Member[] = [];
  let i = 0;
  for (const [active, removed] of [
    [true, false],
    [false, false],
    [false, true],
  ] as const) {
    for (const hasStamps of [true, false]) {
      for (const hasLeave of [true, false]) {
        out.push({ userId: `m${i++}`, active, removed, hasStamps, hasLeave });
      }
    }
  }
  return out;
}

test('the xlsx and the Centro Paghe file select the same employees', () => {
  const members = everyCombination();
  assert.deepEqual(aggregateSelection(members), centroPagheSelection(members));
});

test('an active employee with neither a punch nor a leave is still exported', () => {
  // The regression itself: a full-timer who forgot to badge all month. Both
  // files must carry them, so "Ore ordinarie" can print the contracted 176:00
  // instead of nothing at all.
  const idle: Member[] = [
    { userId: 'forgot-to-badge', active: true, removed: false, hasStamps: false, hasLeave: false },
  ];
  assert.deepEqual(aggregateSelection(idle), ['forgot-to-badge']);
  assert.deepEqual(centroPagheSelection(idle), ['forgot-to-badge']);
});

test('a deactivated employee with no activity is exported by neither', () => {
  // Long gone: seeding them would resurrect a full month of contracted hours
  // for somebody who has not worked here in a year.
  const gone: Member[] = [
    { userId: 'left-last-year', active: false, removed: false, hasStamps: false, hasLeave: false },
  ];
  assert.deepEqual(aggregateSelection(gone), []);
  assert.deepEqual(centroPagheSelection(gone), []);
});

test('a deactivated employee who worked part of the period is exported by both', () => {
  // Left mid-month: the days they actually worked have to be paid. Which DAYS
  // they get is decided later, per date, by the shift assignment window.
  const leaver: Member[] = [
    { userId: 'left-mid-month', active: false, removed: false, hasStamps: true, hasLeave: false },
  ];
  assert.deepEqual(aggregateSelection(leaver), ['left-mid-month']);
  assert.deepEqual(centroPagheSelection(leaver), ['left-mid-month']);
});

test('a member removed after working the period is exported by both', () => {
  // The divergence this pins. The xlsx kept a removed member — their own stamps
  // carry them in, and the anagrafica guard only ever blocked ADDING one — while
  // the Centro Paghe writer skipped them outright, so the hours somebody had
  // actually worked reached the xlsx and never reached the payroll bureau. An
  // admin clicking "Elimina" in the first week of the month was enough to lose a
  // colleague's wages for the month before.
  //
  // Removal is a membership action (a soft delete: stamps, leave and anagrafica
  // all stay), not an erasure request, and it decides only how far the CONTRACT
  // runs — contractedDaysUntil() reads deleted_at as the dated departure. Who
  // gets reported is exportsEmployee(), on both sides, with no exception.
  const removed: Member[] = [
    { userId: 'removed-in-october', active: false, removed: true, hasStamps: true, hasLeave: false },
  ];
  assert.deepEqual(aggregateSelection(removed), ['removed-in-october']);
  assert.deepEqual(centroPagheSelection(removed), ['removed-in-october']);
});

test('a removed member with nothing in the period is exported by neither', () => {
  // Removal is not a reason to resurrect somebody either: DELETE clears active
  // too, so the ordinary long-gone rule applies unchanged.
  const removed: Member[] = [
    { userId: 'removed-last-year', active: false, removed: true, hasStamps: false, hasLeave: false },
  ];
  assert.deepEqual(aggregateSelection(removed), []);
  assert.deepEqual(centroPagheSelection(removed), []);
});

test('the leave-only path does not depend on the membership list', () => {
  // The residual asymmetry, and it is structural rather than a policy choice:
  // approved leave is read straight from leave_requests, so a user with leave
  // but NO membership row at all still gets an xlsx line, while the Centro Paghe
  // file cannot emit a record for somebody who has neither matricola nor codice
  // fiscale. A REMOVED member is no longer part of this — loadAnagrafica returns
  // their row, so both writers see them.
  assert.deepEqual(aggregateSelection([], ['no-membership-row']), ['no-membership-row']);
  assert.deepEqual(centroPagheSelection([]), []);
});
