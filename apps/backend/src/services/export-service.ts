import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { env } from '../env.js';

export interface ExportJobRow {
  id: string;
  tenant_id: string;
  format: 'xlsx' | 'json';
  period_from: string;
  period_to: string;
  filters: Record<string, unknown>;
  requested_by: string;
}

export interface ExportResult {
  storageKey: string;
  signedUrlExpiresAt: Date;
}

import { pool } from '../lib/db.js';

interface DayAgg {
  day: string;
  worked_minutes: number;
  paid_break_minutes: number;
  unpaid_break_minutes: number;
  overtime_minutes: number;
}

interface UserAgg {
  user_id: string;
  email: string;
  days: DayAgg[];
  worked_minutes_total: number;
  paid_break_minutes_total: number;
  unpaid_break_minutes_total: number;
  overtime_minutes_total: number;
  worked_days: number;
}

interface ShiftConfig {
  tolerance_in_min: number;
  tolerance_out_min: number;
  expected_break_max_min: number;
  extraordinary_threshold_min: number;
  count_extraordinary: boolean;
  tolerance_in_breach_deduct_min: number;
  tolerance_out_breach_deduct_min: number;
  tolerance_break_breach_deduct_min: number;
  /** day_of_week (1=Mon..7=Sun) → [{ start_time, end_time }] sorted ascending */
  slotsByDow: Map<number, Array<{ start: string; end: string }>>;
}

export async function generateExportFile(job: ExportJobRow): Promise<ExportResult> {
  const data = await aggregateForExport(job);
  if (job.format === 'json') {
    return await writeJson(job, data);
  }
  return await writeXlsx(job, data);
}

// Paid-break cutoff: breaks at/under this duration count as paid, above as unpaid.
const PAID_BREAK_THRESHOLD_MIN = 30;

async function aggregateForExport(job: ExportJobRow): Promise<UserAgg[]> {
  const rows = await pool.query(
    `SELECT s.user_id, s.event_type, s.occurred_at, s.deleted_at,
            COALESCE(au.email, s.user_id::text) AS email
     FROM stamps s
     LEFT JOIN auth_users au ON au.id = s.user_id
     WHERE s.tenant_id = $1
       AND s.occurred_at >= $2::date
       AND s.occurred_at < ($3::date + INTERVAL '1 day')
       AND s.deleted_at IS NULL
     ORDER BY s.user_id, s.occurred_at`,
    [job.tenant_id, job.period_from, job.period_to]
  );

  const shiftByUser = await loadShiftConfigs(job);

  type UserBucket = { email: string; stamps: Array<{ event: string; at: Date }> };
  const byUser = new Map<string, UserBucket>();
  for (const r of rows.rows) {
    const u: UserBucket = byUser.get(r.user_id) ?? { email: r.email, stamps: [] };
    u.stamps.push({ event: r.event_type, at: new Date(r.occurred_at) });
    byUser.set(r.user_id, u);
  }

  const out: UserAgg[] = [];
  for (const [userId, u] of byUser) {
    const cfg = shiftByUser.get(userId);
    const days = new Map<string, DayAgg & { firstIn: Date | null; lastOut: Date | null }>();
    let openClockIn: Date | null = null;
    let openBreak: Date | null = null;

    for (const s of u.stamps) {
      const dayKey = s.at.toISOString().slice(0, 10);
      const day =
        days.get(dayKey) ?? {
          day: dayKey,
          worked_minutes: 0,
          paid_break_minutes: 0,
          unpaid_break_minutes: 0,
          overtime_minutes: 0,
          firstIn: null,
          lastOut: null,
        };

      if (s.event === 'clock_in') {
        openClockIn = s.at;
        if (!day.firstIn) day.firstIn = s.at;
      } else if (s.event === 'break_start' && openClockIn) {
        day.worked_minutes += diffMin(openClockIn, s.at);
        openBreak = s.at;
      } else if (s.event === 'break_end' && openBreak) {
        const minutes = diffMin(openBreak, s.at);
        if (minutes <= PAID_BREAK_THRESHOLD_MIN) day.paid_break_minutes += minutes;
        else day.unpaid_break_minutes += minutes;
        openClockIn = s.at;
        openBreak = null;
      } else if (s.event === 'clock_out' && openClockIn) {
        day.worked_minutes += diffMin(openClockIn, s.at);
        day.lastOut = s.at;
        openClockIn = null;
      }
      days.set(dayKey, day);
    }

    // Apply shift-driven breach deductions + overtime calc per day.
    for (const day of days.values()) {
      if (!cfg) continue;
      const dowSlots = cfg.slotsByDow.get(isoDowUtc(day.day));
      if (!dowSlots || dowSlots.length === 0) continue;
      const expectedStart = combineDateTime(day.day, dowSlots[0]!.start);
      const expectedEnd = combineDateTime(day.day, dowSlots[dowSlots.length - 1]!.end);

      // late clock-in beyond tolerance → deduct
      if (day.firstIn) {
        const lateMin = diffMin(expectedStart, day.firstIn);
        if (lateMin > cfg.tolerance_in_min) {
          day.worked_minutes = Math.max(0, day.worked_minutes - cfg.tolerance_in_breach_deduct_min);
        }
      }
      // early clock-out beyond tolerance → deduct
      if (day.lastOut) {
        const earlyMin = diffMin(day.lastOut, expectedEnd);
        if (earlyMin > cfg.tolerance_out_min) {
          day.worked_minutes = Math.max(0, day.worked_minutes - cfg.tolerance_out_breach_deduct_min);
        }
      }
      // break duration over expected max → deduct
      const breakTotal = day.paid_break_minutes + day.unpaid_break_minutes;
      if (breakTotal > cfg.expected_break_max_min) {
        day.worked_minutes = Math.max(0, day.worked_minutes - cfg.tolerance_break_breach_deduct_min);
      }
      // overtime: surplus past expected_end + threshold, only if flag on
      if (cfg.count_extraordinary && day.lastOut) {
        const cutoff = new Date(expectedEnd.getTime() + cfg.extraordinary_threshold_min * 60_000);
        if (day.lastOut.getTime() > cutoff.getTime()) {
          day.overtime_minutes = diffMin(cutoff, day.lastOut);
        }
      }
    }

    const dayList = [...days.values()]
      .map((d) => ({
        day: d.day,
        worked_minutes: d.worked_minutes,
        paid_break_minutes: d.paid_break_minutes,
        unpaid_break_minutes: d.unpaid_break_minutes,
        overtime_minutes: d.overtime_minutes,
      }))
      .sort((a, b) => a.day.localeCompare(b.day));

    out.push({
      user_id: userId,
      email: u.email,
      days: dayList,
      worked_minutes_total: sum(dayList.map((d) => d.worked_minutes)),
      paid_break_minutes_total: sum(dayList.map((d) => d.paid_break_minutes)),
      unpaid_break_minutes_total: sum(dayList.map((d) => d.unpaid_break_minutes)),
      overtime_minutes_total: sum(dayList.map((d) => d.overtime_minutes)),
      worked_days: dayList.filter((d) => d.worked_minutes > 0).length,
    });
  }
  return out;
}

async function loadShiftConfigs(job: ExportJobRow): Promise<Map<string, ShiftConfig>> {
  // Latest active assignment overlapping the export period — one row per user.
  const assigns = await pool.query(
    `SELECT DISTINCT ON (a.user_id)
            a.user_id, a.shift_template_id,
            st.tolerance_in_min, st.tolerance_out_min,
            st.expected_break_max_min,
            st.extraordinary_threshold_min, st.count_extraordinary,
            st.tolerance_in_breach_deduct_min, st.tolerance_out_breach_deduct_min,
            st.tolerance_break_breach_deduct_min
       FROM user_shift_assignments a
       JOIN shift_templates st ON st.id = a.shift_template_id
      WHERE a.tenant_id = $1
        AND a.valid_from <= $3::date
        AND (a.valid_to IS NULL OR a.valid_to >= $2::date)
      ORDER BY a.user_id, a.valid_from DESC`,
    [job.tenant_id, job.period_from, job.period_to]
  );
  if (assigns.rowCount === 0) return new Map();

  const tplIds = [...new Set(assigns.rows.map((r) => r.shift_template_id))];
  const slots = await pool.query(
    `SELECT shift_template_id, day_of_week,
            to_char(start_time, 'HH24:MI') AS start_time,
            to_char(end_time, 'HH24:MI') AS end_time
       FROM shift_template_slots
      WHERE shift_template_id = ANY($1::uuid[])
      ORDER BY day_of_week, start_time`,
    [tplIds]
  );

  const slotsByTpl = new Map<string, Map<number, Array<{ start: string; end: string }>>>();
  for (const r of slots.rows) {
    const byDow = slotsByTpl.get(r.shift_template_id) ?? new Map();
    const arr = byDow.get(r.day_of_week) ?? [];
    arr.push({ start: r.start_time, end: r.end_time });
    byDow.set(r.day_of_week, arr);
    slotsByTpl.set(r.shift_template_id, byDow);
  }

  const out = new Map<string, ShiftConfig>();
  for (const r of assigns.rows) {
    out.set(r.user_id, {
      tolerance_in_min: r.tolerance_in_min,
      tolerance_out_min: r.tolerance_out_min,
      expected_break_max_min: r.expected_break_max_min,
      extraordinary_threshold_min: r.extraordinary_threshold_min,
      count_extraordinary: r.count_extraordinary,
      tolerance_in_breach_deduct_min: r.tolerance_in_breach_deduct_min,
      tolerance_out_breach_deduct_min: r.tolerance_out_breach_deduct_min,
      tolerance_break_breach_deduct_min: r.tolerance_break_breach_deduct_min,
      slotsByDow: slotsByTpl.get(r.shift_template_id) ?? new Map(),
    });
  }
  return out;
}

function diffMin(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

function combineDateTime(dateStr: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const [y, mo, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, h, m, 0));
}

function isoDowUtc(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay();
  return dow === 0 ? 7 : dow;
}

function sum(a: number[]): number {
  return a.reduce((acc, v) => acc + v, 0);
}

async function writeJson(job: ExportJobRow, data: UserAgg[]): Promise<ExportResult> {
  const body = {
    schema_version: 'v1',
    tenant_id: job.tenant_id,
    period: { from: job.period_from, to: job.period_to },
    generated_at: new Date().toISOString(),
    users: data,
  };
  const key = `tenants/${job.tenant_id}/exports/${job.id}.json`;
  await persist(key, Buffer.from(JSON.stringify(body, null, 2), 'utf8'));
  return { storageKey: key, signedUrlExpiresAt: new Date(Date.now() + 15 * 60_000) };
}

async function writeXlsx(job: ExportJobRow, data: UserAgg[]): Promise<ExportResult> {
  const wb = new ExcelJS.Workbook();
  const riep = wb.addWorksheet('Riepilogo');
  riep.columns = [
    { header: 'Utente', key: 'email', width: 30 },
    { header: 'Ore lavorate', key: 'worked', width: 14 },
    { header: 'Ore straordinarie', key: 'overtime', width: 18 },
    { header: 'Pausa retribuita', key: 'paid', width: 18 },
    { header: 'Pausa non retribuita', key: 'unpaid', width: 22 },
    { header: 'Giorni lavorati', key: 'days', width: 18 },
  ];
  for (const u of data) {
    riep.addRow({
      email: u.email,
      worked: u.worked_minutes_total / 60,
      overtime: u.overtime_minutes_total / 60,
      paid: u.paid_break_minutes_total / 60,
      unpaid: u.unpaid_break_minutes_total / 60,
      days: u.worked_days,
    });
  }

  const usedNames = new Set<string>();
  for (const u of data) {
    let name = u.email.replace(/[\\/?*\[\]:]/g, '_').slice(0, 28);
    let candidate = name;
    let i = 2;
    while (usedNames.has(candidate)) {
      candidate = `${name}_${i++}`.slice(0, 31);
    }
    usedNames.add(candidate);
    const ws = wb.addWorksheet(candidate);
    ws.columns = [
      { header: 'Giorno', key: 'day', width: 14 },
      { header: 'Ore lavorate', key: 'worked', width: 14 },
      { header: 'Ore straordinarie', key: 'overtime', width: 18 },
      { header: 'Pausa retribuita (min)', key: 'paid', width: 22 },
      { header: 'Pausa non retribuita (min)', key: 'unpaid', width: 26 },
    ];
    for (const d of u.days) {
      ws.addRow({
        day: d.day,
        worked: d.worked_minutes / 60,
        overtime: d.overtime_minutes / 60,
        paid: d.paid_break_minutes,
        unpaid: d.unpaid_break_minutes,
      });
    }
  }

  const meta = wb.addWorksheet('Metadati');
  meta.addRow(['tenant_id', job.tenant_id]);
  meta.addRow(['period_from', job.period_from]);
  meta.addRow(['period_to', job.period_to]);
  meta.addRow(['generated_at', new Date().toISOString()]);
  meta.addRow(['schema_version', 'v1']);

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const key = `tenants/${job.tenant_id}/exports/${job.id}.xlsx`;
  await persist(key, Buffer.from(buf));
  return { storageKey: key, signedUrlExpiresAt: new Date(Date.now() + 15 * 60_000) };
}

async function persist(key: string, body: Buffer): Promise<void> {
  if (env.STORAGE_DRIVER === 'disk') {
    const full = join(env.STORAGE_DISK_PATH, key);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, body);
    return;
  }
  // r2 driver wired in TASK-EXP-02 production path
  throw new Error('R2 driver not implemented in this scaffold');
}

export async function readExportFile(storageKey: string): Promise<Buffer> {
  if (env.STORAGE_DRIVER === 'disk') {
    const fs = await import('node:fs/promises');
    return await fs.readFile(join(env.STORAGE_DISK_PATH, storageKey));
  }
  throw new Error('R2 driver not implemented in this scaffold');
}
