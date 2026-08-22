import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contractedDaysUntil,
  contractsDay,
  configForDay,
  type ShiftAssignment,
  type ShiftConfig,
} from '../services/export-service.js';

/* How far into an export period a person may still be charged contracted hours.
 *
 * The scheduled-day seeding walks the whole period and asks configForDay()
 * whether a shift is in force. That is not enough on its own, twice over:
 *
 *  1. NOTHING in the product ever closes a shift assignment when an employee
 *     leaves. POST /users/:id/deactivate sets memberships.active = FALSE,
 *     DELETE /users/:id sets deleted_at + active = FALSE, and routes/shifts.ts
 *     only closes valid_to when a NEW assignment is created — so the leaver's
 *     assignment stays open (valid_to IS NULL) and resolves for every day of
 *     the month, including the ones after they were gone.
 *  2. Days that have not happened yet are not contracted hours anybody owes.
 *
 * contractedDaysUntil() is the single ceiling both writers apply, so the xlsx
 * and the Centro Paghe file cover the same dates for the same person.
 *
 * The departure ceiling only fires on evidence that belongs to the PERIOD, and
 * the block below pins why: memberships.active carries no date, so reading it
 * against a month that has already closed made the same export change answer on
 * the day HR happened to click "disattiva". Everything a re-export of an elapsed
 * period can still legitimately move on is a real edit to that period's data.
 */

const SEPTEMBER_FROM = '2026-09-01';
const SEPTEMBER_TO = '2026-09-30';
/** A closed month, exported in October the way payroll actually runs it. */
const AFTER_THE_MONTH = '2026-10-05';

/* ───────────────── the leaver ───────────────── */

test('a full month is contracted for an active employee once the month is closed', () => {
  // The ordinary case, and the one that must not move: an active employee gets
  // every day of the period and both ceilings are inert.
  assert.equal(
    contractedDaysUntil(SEPTEMBER_TO, AFTER_THE_MONTH, {
      active: true,
      deletedDay: null,
      lastActivityDay: '2026-09-29',
    }),
    SEPTEMBER_TO
  );
});

test('a deactivated employee stops at their last day of presence while the month runs', () => {
  // The defect: a full-timer deactivated on 15 September, stamps 1–15. Their
  // assignment is still open, so the seeding walked 16–30 and gave eleven
  // weekdays 480 contracted minutes each — Riepilogo printed 176,00 "Ore
  // ordinarie" against ~88,00 worked, and Dettaglio giornaliero grew eleven
  // rows dated after the person's last day.
  //
  // Exported ON 20 September, i.e. while the period is still open: `active` is
  // undated but "gone by today" does put the departure inside this window, so
  // the last day of presence is a bound the data supports.
  assert.equal(
    contractedDaysUntil(SEPTEMBER_TO, '2026-09-20', {
      active: false,
      deletedDay: null,
      lastActivityDay: '2026-09-15',
    }),
    '2026-09-15'
  );
});

test('a deactivation with no date does not shorten a month that has already closed', () => {
  // Same person, same September, exported in October: `active = FALSE` now means
  // only "gone at some point before today", and today is past the period. The
  // schema has no termination date to tell a departure on the 15th from one on
  // 3 October, so the period keeps its contracted days.
  //
  // This is the reproducibility rule, not a nicety. Employee M, last punch
  // Friday 25 September, 28–30 September an unpaid absence settled off-system:
  // exported on 1 October with M still active the file carried all 22 weekdays,
  // and once HR deactivated M on 5 October the identical export used to drop the
  // last three days. A payroll file re-issued for a closed month must match the
  // copy already filed.
  const runWhileActive = contractedDaysUntil(SEPTEMBER_TO, '2026-10-01', {
    active: true,
    deletedDay: null,
    lastActivityDay: '2026-09-25',
  });
  const runAfterDeactivation = contractedDaysUntil(SEPTEMBER_TO, AFTER_THE_MONTH, {
    active: false,
    deletedDay: null,
    lastActivityDay: '2026-09-25',
  });
  assert.equal(runWhileActive, SEPTEMBER_TO);
  assert.equal(runAfterDeactivation, SEPTEMBER_TO);
  assert.equal(runAfterDeactivation, runWhileActive);
});

test('a removal dated inside the period still shortens it, whenever it is re-run', () => {
  // The residual limitation above has an escape hatch, and it is the one the
  // comment sends admins to: DELETE /users/:id writes deleted_at, which is a
  // real date. It bounds the period from every later run identically — the
  // export date moves, the answer does not.
  for (const runOn of ['2026-10-01', '2026-11-30', '2027-04-17']) {
    assert.equal(
      contractedDaysUntil(SEPTEMBER_TO, runOn, {
        active: false,
        deletedDay: '2026-09-15',
        lastActivityDay: '2026-09-15',
      }),
      '2026-09-15'
    );
  }
});

test('a deactivated employee is contracted the whole elapsed period, last punch or not', () => {
  // The direction of the residual limitation, stated so it cannot be softened by
  // accident: the days after the last punch are NOT dropped, they are printed
  // with 0,00 ore lavorate against their contracted hours. Visible and
  // questionable beats silent and missing from a file already delivered.
  assert.equal(
    contractedDaysUntil(SEPTEMBER_TO, AFTER_THE_MONTH, {
      active: false,
      deletedDay: null,
      lastActivityDay: '2026-09-02',
    }),
    SEPTEMBER_TO
  );
});

test('a deactivated employee with no presence at all is contracted nothing', () => {
  // They only reach the export through exportsEmployee() if they had activity,
  // so this is the belt: no signal, no invented days.
  assert.equal(
    contractedDaysUntil(SEPTEMBER_TO, AFTER_THE_MONTH, {
      active: false,
      deletedDay: null,
      lastActivityDay: null,
    }),
    null
  );
});

test('a user with no membership row is treated as departed, not as open-ended', () => {
  // A stamp whose user has no membership in this tenant. Defaulting to "still
  // employed" would be the one assumption that invents hours.
  assert.equal(contractedDaysUntil(SEPTEMBER_TO, AFTER_THE_MONTH, undefined), null);
});

test('a removed employee is cut at the removal date when that precedes the last stamp', () => {
  // deleted_at is the only timestamped departure the schema has. It can only
  // tighten the bound — an approved leave running past the removal must not
  // extend the contract.
  assert.equal(
    contractedDaysUntil(SEPTEMBER_TO, AFTER_THE_MONTH, {
      active: false,
      deletedDay: '2026-09-10',
      lastActivityDay: '2026-09-20',
    }),
    '2026-09-10'
  );
});

test('a removal recorded after the period does not shorten a month fully worked', () => {
  // Deleted in December, September re-exported afterwards: they were employed
  // for the whole period, so the removal date must not bite. The last day of
  // presence must not bite either — deliberately given as the 18th here, well
  // short of the month's end, because that is exactly the shape the old rule got
  // wrong: it read a December departure as authority to erase the last twelve
  // days of a September that had been worked and paid.
  assert.equal(
    contractedDaysUntil(SEPTEMBER_TO, AFTER_THE_MONTH, {
      active: false,
      deletedDay: '2026-12-02',
      lastActivityDay: '2026-09-18',
    }),
    SEPTEMBER_TO
  );
});

test('a dated removal is authoritative — the last punch does not tighten it further', () => {
  // Removed on the 25th, last badged on the 10th (signed off, garden leave, a
  // fortnight of approved absence recorded elsewhere — the app cannot tell). The
  // termination date is the real fact and the contract runs to it; the silence
  // before it is not evidence of anything. Understating a contract that a
  // recorded date pins down would be inventing a second, worse guess.
  assert.equal(
    contractedDaysUntil(SEPTEMBER_TO, AFTER_THE_MONTH, {
      active: false,
      deletedDay: '2026-09-25',
      lastActivityDay: '2026-09-10',
    }),
    '2026-09-25'
  );
});

/* ───────────────── the period still running ───────────────── */

test('exporting the month in progress stops at today', () => {
  // On 5 August a full-timer read 176,00 "Ore ordinarie" against ~24,00 worked,
  // with ~17 dates that had not happened yet listed as untimbrated days.
  assert.equal(
    contractedDaysUntil('2026-08-31', '2026-08-05', {
      active: true,
      deletedDay: null,
      lastActivityDay: '2026-08-05',
    }),
    '2026-08-05'
  );
});

test('today itself is contracted — the clamp is inclusive', () => {
  // Today is a working day that has begun; dropping it would understate the
  // month by one day for every employee, every day.
  const bound = contractedDaysUntil('2026-08-31', '2026-08-05', {
    active: true,
    deletedDay: null,
    lastActivityDay: null,
  });
  assert.equal(bound, '2026-08-05');
});

test('a period entirely in the future is contracted nothing', () => {
  // The bound lands before period_from, so the seeding walk ends on its first
  // step instead of fabricating a whole planned month.
  const bound = contractedDaysUntil('2026-12-31', '2026-08-05', {
    active: true,
    deletedDay: null,
    lastActivityDay: null,
  });
  assert.ok(bound !== null && bound < '2026-12-01');
});

test('the departure ceiling wins over the today ceiling and vice versa', () => {
  // Both apply at once for someone deactivated during the month in progress.
  assert.equal(
    contractedDaysUntil('2026-08-31', '2026-08-20', {
      active: false,
      deletedDay: null,
      lastActivityDay: '2026-08-07',
    }),
    '2026-08-07'
  );
  assert.equal(
    contractedDaysUntil('2026-08-31', '2026-08-10', {
      active: false,
      deletedDay: null,
      lastActivityDay: '2026-08-28',
    }),
    '2026-08-10'
  );
});

/* ───────────────── the seeding walk, end to end ───────────────── */

function fullTime(): ShiftConfig {
  return {
    tolerance_in_min: 5,
    tolerance_out_min: 5,
    expected_break_max_min: 30,
    extraordinary_threshold_min: 30,
    count_extraordinary: true,
    tolerance_in_breach_deduct_min: 0,
    tolerance_out_breach_deduct_min: 0,
    tolerance_break_breach_deduct_min: 0,
    flexible_enabled: false,
    flex_in_after_min: 0,
    flex_out_before_min: 0,
    // Mon–Fri 09:00–18:00, one hour of it deducted as lunch → 480 ordinary min.
    slotsByDow: new Map([1, 2, 3, 4, 5].map((d) => [d, [{ start: '09:00', end: '18:00' }]])),
    lunchByDow: new Map([1, 2, 3, 4, 5].map((d) => [d, 60])),
  };
}

/** The employee never had a NEW assignment created, so valid_to is still open —
 *  which is the whole reason the assignment window cannot bound the seeding. */
const NEVER_CLOSED: ShiftAssignment[] = [
  { validFrom: '2026-01-01', validTo: null, cfg: fullTime() },
];

function isoDow(dateStr: string): number {
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return dow === 0 ? 7 : dow;
}

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (cur.getTime() <= end.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Mirrors the seeding loop in aggregateForExport(): walk the period, stop at
 *  the bound, skip days that already exist, seed the scheduled ones. */
function seededDays(
  periodFrom: string,
  periodTo: string,
  today: string,
  employment: Parameters<typeof contractedDaysUntil>[2],
  existing: string[]
): string[] {
  const have = new Set(existing);
  const until = contractedDaysUntil(periodTo, today, employment);
  const seeded: string[] = [];
  for (const day of eachDate(periodFrom, periodTo)) {
    if (!contractsDay(until, day)) break;
    if (have.has(day)) continue;
    const cfg = configForDay(NEVER_CLOSED, day);
    if (!cfg) continue;
    const slots = cfg.slotsByDow.get(isoDow(day));
    if (!slots || slots.length === 0) continue;
    seeded.push(day);
  }
  return seeded;
}

test('the leaver gains no contracted day after the day they left', () => {
  // 1–15 September stamped, gone on the 15th. September 2026 starts on a
  // Tuesday, so 16–30 holds eleven weekdays: those eleven × 480 min are the
  // 88,00 phantom hours the Riepilogo used to add on top of the hours worked.
  const stamped = eachDate('2026-09-01', '2026-09-15').filter((d) => isoDow(d) <= 5);

  // Removed (deleted_at dated 15 September): the ceiling bites from any run.
  const removed = seededDays(
    SEPTEMBER_FROM,
    SEPTEMBER_TO,
    AFTER_THE_MONTH,
    { active: false, deletedDay: '2026-09-15', lastActivityDay: '2026-09-15' },
    stamped
  );
  assert.deepEqual(removed, []);

  // Merely deactivated, and the month exported while it was still running: the
  // undated flag is usable here because the departure has to be inside the
  // window. 16–18 September are the weekdays elapsed by the 18th.
  const midMonth = seededDays(
    SEPTEMBER_FROM,
    SEPTEMBER_TO,
    '2026-09-18',
    { active: false, deletedDay: null, lastActivityDay: '2026-09-15' },
    stamped
  );
  assert.deepEqual(midMonth, []);

  // Same person left active by mistake: the eleven weekdays come back, which is
  // exactly the count the defect report measured.
  const stillActive = seededDays(
    SEPTEMBER_FROM,
    SEPTEMBER_TO,
    AFTER_THE_MONTH,
    { active: true, deletedDay: null, lastActivityDay: '2026-09-15' },
    stamped
  );
  assert.equal(stillActive.length, 11);
  assert.equal(stillActive[0], '2026-09-16');
  assert.equal(stillActive.at(-1), '2026-09-30');
});

test('a closed month seeds the same days however long after it is exported', () => {
  // Employee M: last punch Friday 25 September, 28–30 September an unpaid
  // absence settled off-system, so nothing in the data marks them. The export
  // must land on the same 22 weekdays on 1 October (M active) and after HR
  // deactivates M on 5 October — the deactivation is a fact about October.
  const stamped = eachDate('2026-09-01', '2026-09-25').filter((d) => isoDow(d) <= 5);
  const runs = [
    seededDays(
      SEPTEMBER_FROM,
      SEPTEMBER_TO,
      '2026-10-01',
      { active: true, deletedDay: null, lastActivityDay: '2026-09-25' },
      stamped
    ),
    seededDays(
      SEPTEMBER_FROM,
      SEPTEMBER_TO,
      AFTER_THE_MONTH,
      { active: false, deletedDay: null, lastActivityDay: '2026-09-25' },
      stamped
    ),
  ];
  assert.deepEqual(runs[0], runs[1]);
  // 28, 29 and 30 September: the three days that used to vanish on the re-run.
  assert.deepEqual(runs[1], ['2026-09-28', '2026-09-29', '2026-09-30']);
  assert.equal(stamped.length + runs[1]!.length, 22);
});

/* ── the ceiling on the OTHER loop: ordinary_minutes ─────────────────────── */

/** Mon–Fri 09:00–18:00 less the 60' auto-lunch, the figure fullTime() encodes. */
const ORDINARY_MIN_PER_DAY = 480;

/** Mirrors BOTH loops of aggregateForExport() that owe the ceiling an answer:
 *  the seeding walk, and the per-day loop that assigns ordinary_minutes.
 *
 *  `preexisting` are the days a punch or an approved leave has already put into
 *  `days` before any seeding happens. They never pass through the walk — which
 *  is precisely how the ceiling came to gate one loop and not the other. */
function ordinaryMinutesByDay(
  periodFrom: string,
  periodTo: string,
  today: string,
  employment: Parameters<typeof contractedDaysUntil>[2],
  preexisting: string[]
): Map<string, number> {
  const until = contractedDaysUntil(periodTo, today, employment);

  const days = new Set(preexisting);
  for (const day of eachDate(periodFrom, periodTo)) {
    if (!contractsDay(until, day)) break;
    if (days.has(day)) continue;
    const cfg = configForDay(NEVER_CLOSED, day);
    if (!cfg) continue;
    const slots = cfg.slotsByDow.get(isoDow(day));
    if (!slots || slots.length === 0) continue;
    days.add(day);
  }

  const ordinary = new Map<string, number>();
  for (const day of [...days].sort()) {
    const cfg = configForDay(NEVER_CLOSED, day);
    if (!cfg) continue;
    const slots = cfg.slotsByDow.get(isoDow(day));
    if (!slots || slots.length === 0) continue;
    ordinary.set(day, contractsDay(until, day) ? ORDINARY_MIN_PER_DAY : 0);
  }
  return ordinary;
}

test('an approved leave past the ceiling keeps its day but earns no contracted hours', () => {
  // The defect the seeding ceiling did not cover. Leaves are merged into `days`
  // BEFORE the seeding walk runs, so gating the walk alone gates nothing for
  // them: an employee with approved ferie 24–28 August, exported on the 21st,
  // still had the per-day loop stamp 480 ordinary minutes on all five. Riepilogo
  // printed 160,00 "Ore ordinarie" while writeCentroPaghe gated the very same
  // dates to 00000 theoretical — one month, two files, 40 hours apart.
  const ferie = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'];
  const ordinary = ordinaryMinutesByDay(
    '2026-08-01',
    '2026-08-31',
    '2026-08-21',
    { active: true, deletedDay: null, lastActivityDay: '2026-08-21' },
    ferie
  );

  // The days stay in the file — the ferie hours have to print somewhere, and the
  // LUL keeps their giustificativi too. Only the contract is gated.
  for (const day of ferie) {
    assert.equal(ordinary.has(day), true, `${day} must still be reported`);
    assert.equal(ordinary.get(day), 0, `${day} must contract nothing`);
  }

  // 15 weekdays elapsed by the 21st × 8h = 120,00, which is what the Riepilogo
  // and the Centro Paghe file now agree on. The old number was 160,00.
  const totalHours = [...ordinary.values()].reduce((a, b) => a + b, 0) / 60;
  assert.equal(totalHours, 120);
});

test('the same ceiling gates a removed employee on both loops at once', () => {
  // Removed on 15 September with an approved leave running to the 22nd: the
  // leave days are past the ceiling, so they report their absence and no
  // contract, exactly as the seeding refuses to add 16–30.
  const leaveDays = ['2026-09-21', '2026-09-22'];
  const ordinary = ordinaryMinutesByDay(
    SEPTEMBER_FROM,
    SEPTEMBER_TO,
    AFTER_THE_MONTH,
    { active: false, deletedDay: '2026-09-15', lastActivityDay: '2026-09-22' },
    leaveDays
  );
  for (const day of leaveDays) assert.equal(ordinary.get(day), 0);
  assert.equal([...ordinary.keys()].filter((d) => d > '2026-09-15' && ordinary.get(d)! > 0).length, 0);
});

test('an active employee who never badged still gets the whole closed month', () => {
  // The regression the seeding was added for: forgetting to badge must not cost
  // contracted hours. 2026-09 has 22 weekdays.
  const seeded = seededDays(
    SEPTEMBER_FROM,
    SEPTEMBER_TO,
    AFTER_THE_MONTH,
    { active: true, deletedDay: null, lastActivityDay: null },
    []
  );
  assert.equal(seeded.length, 22);
});

test('the month in progress seeds only the days that have happened', () => {
  // 5 August 2026 is a Wednesday; 3, 4 and 5 August are the elapsed weekdays.
  const seeded = seededDays(
    '2026-08-01',
    '2026-08-31',
    '2026-08-05',
    { active: true, deletedDay: null, lastActivityDay: '2026-08-05' },
    []
  );
  assert.deepEqual(seeded, ['2026-08-03', '2026-08-04', '2026-08-05']);
});
