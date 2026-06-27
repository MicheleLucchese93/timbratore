import { adminPool } from '../../lib/admin-db.js';
import { createLogger } from '../../lib/logger.js';
import { notifyStampReminder, type StampReminderKind } from '../../lib/notifications.js';
import { zonedWallClockToUtcMs, startOfZonedDayUtcMs, nextIsoDate } from '../../lib/tz.js';
import {
  stateFromLastEvent,
  italianHolidays,
  type StampEventType,
  type StampState,
} from '@sonoqui/shared';

const logger = createLogger('stamp_reminder');

// A reminder fires only within this window after its (slot time + tolerance).
// Past it we assume the moment has gone (or the cron was down for a while) and
// stay silent rather than push a stale "you forgot at 08:30" at noon.
const MAX_LATE_MS = 120 * 60_000;

export interface SlotTime {
  /** Wall-clock 'HH:MM' in the tenant timezone. */
  start: string;
  end: string;
}
export interface DayStamp {
  event_type: StampEventType;
  /** Epoch ms (true UTC instant) of the stamp. */
  occurredMs: number;
}
export interface DayLeave {
  fromMs: number;
  toMs: number;
}
export interface DueReminder {
  /** Dedupe key, unique per day; embeds the time so split shifts don't collide. */
  boundary: string;
  kind: StampReminderKind;
  /** Wall-clock 'HH:MM' for the message. */
  time: string;
}

export interface ReminderInput {
  slots: SlotTime[];
  /** This user's stamps for the local day, ascending by occurredMs. */
  stamps: DayStamp[];
  /** Approved leaves overlapping the day (any window). */
  leaves: DayLeave[];
  tolInMin: number;
  tolOutMin: number;
  /** 'YYYY-MM-DD' in the tenant timezone. */
  localDate: string;
  timeZone: string;
  /** localDate is an Italian national public holiday → no reminders. */
  isHoliday: boolean;
  nowMs: number;
}

/**
 * Pure: given a user's schedule slots and stamps for one local day, return the
 * shift-boundary reminders that are due RIGHT NOW. "Per-fascia entry/exit" model
 * (see plan): clock-in expected at every fascia start, clock-out at every fascia
 * end. Split-shift midday gaps therefore yield a leave-for-lunch + return pair.
 * Pauses (break_*) are never reminded. Exported for unit testing.
 */
export function computeDueReminders(input: ReminderInput): DueReminder[] {
  const { slots, stamps, leaves, tolInMin, tolOutMin, localDate, timeZone, isHoliday, nowMs } =
    input;
  if (isHoliday || slots.length === 0) return [];

  const sorted = [...slots].sort((a, b) => a.start.localeCompare(b.start));

  const instantOf = (hhmm: string): number => zonedWallClockToUtcMs(localDate, hhmm, timeZone);

  // State implied by the last stamp at or before `ms`.
  const stateAt = (ms: number): StampState => {
    let last: StampEventType | null = null;
    for (const s of stamps) {
      if (s.occurredMs <= ms) last = s.event_type;
      else break;
    }
    return stateFromLastEvent(last);
  };

  const coveredByLeave = (ms: number): boolean =>
    leaves.some((l) => l.fromMs <= ms && ms <= l.toMs);

  // Fires only while now ∈ [slot + grace, slot + grace + MAX_LATE_MS].
  const isDue = (schedInstant: number, graceMin: number): boolean => {
    const dueAt = schedInstant + graceMin * 60_000;
    return nowMs >= dueAt && nowMs <= dueAt + MAX_LATE_MS;
  };

  const hasClockIn = stamps.some((s) => s.event_type === 'clock_in');
  const out: DueReminder[] = [];

  // ENTRY — first fascia start; expected a clock_in by start + tolerance.
  {
    const time = sorted[0]!.start;
    const at = instantOf(time);
    if (isDue(at, tolInMin) && !coveredByLeave(at) && !hasClockIn) {
      out.push({ boundary: `entry@${time}`, kind: 'entry', time });
    }
  }

  // MIDDAY GAPS (split shift) — the lunch break: leaving (end of fascia i) and
  // returning (start of fascia i+1).
  for (let i = 0; i < sorted.length - 1; i++) {
    const outTime = sorted[i]!.end;
    const outAt = instantOf(outTime);
    if (isDue(outAt, tolOutMin) && !coveredByLeave(outAt) && stateAt(nowMs) === 'clocked_in') {
      // Still working when they should be on the midday break.
      out.push({ boundary: `lunch_out@${outTime}`, kind: 'lunch_out', time: outTime });
    }
    const inTime = sorted[i + 1]!.start;
    const inAt = instantOf(inTime);
    if (isDue(inAt, tolInMin) && !coveredByLeave(inAt)) {
      const st = stateAt(nowMs);
      // On the break and not back, OR clocked out for the split and not returned
      // (a later fascia lies ahead, so 'nothing' after a clock_in = forgot rientro).
      if (st === 'on_lunch' || st === 'on_break' || (st === 'nothing' && hasClockIn)) {
        out.push({ boundary: `lunch_in@${inTime}`, kind: 'lunch_in', time: inTime });
      }
    }
  }

  // EXIT — last fascia end; fires only if still clocked in past end + tolerance.
  {
    const time = sorted[sorted.length - 1]!.end;
    const at = instantOf(time);
    if (isDue(at, tolOutMin) && !coveredByLeave(at)) {
      const st = stateAt(nowMs);
      if (st === 'clocked_in' || st === 'on_break' || st === 'on_lunch') {
        out.push({ boundary: `exit@${time}`, kind: 'exit', time });
      }
    }
  }

  return out;
}

/**
 * Cron (every 5 min, Europe/Rome). Cross-tenant via adminPool (same shape as
 * leave-reminder.ts): find users on a shift today who passed an expected stamp
 * boundary without stamping, and push a reminder. Deduped per (user, day,
 * boundary) by stamp_reminder_log so a given boundary pushes at most once.
 */
export async function stampReminder(): Promise<void> {
  const nowMs = Date.now();

  // Keep the dedupe ledger bounded.
  await adminPool.query(`DELETE FROM stamp_reminder_log WHERE local_date < (CURRENT_DATE - 7)`);

  const cand = await adminPool.query(
    `WITH cand AS (
       SELECT m.tenant_id, m.user_id, t.timezone, up.language,
              st.tolerance_in_min, st.tolerance_out_min,
              to_char((now() AT TIME ZONE t.timezone)::date, 'YYYY-MM-DD') AS local_date,
              sl.start_time, sl.end_time
         FROM memberships m
         JOIN tenants t ON t.id = m.tenant_id
          AND t.deleted_at IS NULL AND t.suspended_at IS NULL
         JOIN user_preferences up ON up.user_id = m.user_id
         JOIN user_shift_assignments a ON a.tenant_id = m.tenant_id AND a.user_id = m.user_id
          AND a.valid_from <= (now() AT TIME ZONE t.timezone)::date
          AND (a.valid_to IS NULL OR a.valid_to >= (now() AT TIME ZONE t.timezone)::date)
         JOIN shift_templates st ON st.id = a.shift_template_id
          AND st.active = TRUE AND st.deleted_at IS NULL
         JOIN shift_template_slots sl ON sl.shift_template_id = st.id
          AND sl.day_of_week = EXTRACT(isodow FROM (now() AT TIME ZONE t.timezone)::date)
        WHERE m.active = TRUE AND m.deleted_at IS NULL
          AND cardinality(m.stamp_modes) > 0
          AND up.push_token IS NOT NULL
          AND COALESCE((up.notification_preferences->>'push_stamp_reminders')::boolean, TRUE)
     )
     SELECT tenant_id, user_id, timezone, language, tolerance_in_min, tolerance_out_min, local_date,
            jsonb_agg(jsonb_build_object(
              'start', to_char(start_time, 'HH24:MI'),
              'end',   to_char(end_time,   'HH24:MI')
            ) ORDER BY start_time) AS slots
       FROM cand
      GROUP BY tenant_id, user_id, timezone, language, tolerance_in_min, tolerance_out_min, local_date`
  );

  if ((cand.rowCount ?? 0) === 0) {
    logger.info('no stamp-reminder candidates');
    return;
  }

  const userIds = [...new Set(cand.rows.map((r) => r.user_id as string))];

  const [stampRes, leaveRes] = await Promise.all([
    adminPool.query(
      `SELECT tenant_id, user_id, event_type, occurred_at
         FROM stamps
        WHERE deleted_at IS NULL
          AND user_id = ANY($1::uuid[])
          AND occurred_at >= now() - INTERVAL '30 hours'
          AND occurred_at <= now()
        ORDER BY user_id, occurred_at ASC`,
      [userIds]
    ),
    adminPool.query(
      `SELECT tenant_id, user_id, from_ts, to_ts
         FROM leave_requests
        WHERE status = 'approved'
          AND user_id = ANY($1::uuid[])
          AND to_ts   >= now() - INTERVAL '1 day'
          AND from_ts <= now() + INTERVAL '1 day'`,
      [userIds]
    ),
  ]);

  const stampsByKey = new Map<string, DayStamp[]>();
  for (const s of stampRes.rows) {
    const key = `${s.tenant_id}:${s.user_id}`;
    const arr = stampsByKey.get(key) ?? [];
    arr.push({
      event_type: s.event_type as StampEventType,
      occurredMs: new Date(s.occurred_at).getTime(),
    });
    stampsByKey.set(key, arr);
  }
  const leavesByKey = new Map<string, DayLeave[]>();
  for (const l of leaveRes.rows) {
    const key = `${l.tenant_id}:${l.user_id}`;
    const arr = leavesByKey.get(key) ?? [];
    arr.push({ fromMs: new Date(l.from_ts).getTime(), toMs: new Date(l.to_ts).getTime() });
    leavesByKey.set(key, arr);
  }

  const holidayCache = new Map<string, Set<string>>();
  const isHolidayDate = (localDate: string): boolean => {
    const year = localDate.slice(0, 4);
    let set = holidayCache.get(year);
    if (!set) {
      set = new Set(italianHolidays(Number(year)).map((h) => h.date));
      holidayCache.set(year, set);
    }
    return set.has(localDate);
  };

  let due = 0;
  let sent = 0;
  for (const c of cand.rows) {
    const key = `${c.tenant_id}:${c.user_id}`;
    const tz = (c.timezone as string) || 'Europe/Rome';
    const localDate = c.local_date as string;
    const dayStart = startOfZonedDayUtcMs(localDate, tz);
    const dayEnd = startOfZonedDayUtcMs(nextIsoDate(localDate), tz);
    const stamps = (stampsByKey.get(key) ?? []).filter(
      (s) => s.occurredMs >= dayStart && s.occurredMs < dayEnd
    );
    const reminders = computeDueReminders({
      slots: c.slots as SlotTime[],
      stamps,
      leaves: leavesByKey.get(key) ?? [],
      tolInMin: c.tolerance_in_min ?? 10,
      tolOutMin: c.tolerance_out_min ?? 10,
      localDate,
      timeZone: tz,
      isHoliday: isHolidayDate(localDate),
      nowMs,
    });
    for (const r of reminders) {
      due++;
      try {
        const ins = await adminPool.query(
          `INSERT INTO stamp_reminder_log(tenant_id, user_id, local_date, boundary)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING
           RETURNING boundary`,
          [c.tenant_id, c.user_id, localDate, r.boundary]
        );
        if (ins.rowCount === 1) {
          await notifyStampReminder(c.tenant_id, c.user_id, { kind: r.kind, time: r.time });
          sent++;
        }
      } catch (err) {
        logger.error({ err, userId: c.user_id, boundary: r.boundary }, 'stamp reminder send failed');
      }
    }
  }

  logger.info({ candidates: cand.rowCount, due, sent }, 'stamp reminders processed');
}
