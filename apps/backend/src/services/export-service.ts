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
}

interface UserAgg {
  user_id: string;
  email: string;
  days: DayAgg[];
  worked_minutes_total: number;
  paid_break_minutes_total: number;
  unpaid_break_minutes_total: number;
  worked_days: number;
}

export async function generateExportFile(job: ExportJobRow): Promise<ExportResult> {
  const data = await aggregateForExport(job);
  if (job.format === 'json') {
    return await writeJson(job, data);
  }
  return await writeXlsx(job, data);
}

async function aggregateForExport(job: ExportJobRow): Promise<UserAgg[]> {
  // Per-stamp paid-break threshold resolves through the user's active shift_template
  // assignment at that date; falls back to 30 min when no shift is assigned.
  const rows = await pool.query(
    `SELECT s.user_id, s.event_type, s.occurred_at, s.deleted_at,
            COALESCE(au.email, s.user_id::text) AS email,
            COALESCE(
              (SELECT st.paid_break_threshold_min
                 FROM user_shift_assignments a
                 JOIN shift_templates st ON st.id = a.shift_template_id
                WHERE a.user_id = s.user_id
                  AND a.valid_from <= s.occurred_at::date
                  AND (a.valid_to IS NULL OR a.valid_to >= s.occurred_at::date)
                ORDER BY a.valid_from DESC
                LIMIT 1),
              30
            ) AS paid_break_threshold_min
     FROM stamps s
     LEFT JOIN auth_users au ON au.id = s.user_id
     WHERE s.tenant_id = $1
       AND s.occurred_at >= $2::date
       AND s.occurred_at < ($3::date + INTERVAL '1 day')
       AND s.deleted_at IS NULL
     ORDER BY s.user_id, s.occurred_at`,
    [job.tenant_id, job.period_from, job.period_to]
  );
  type UserBucket = { email: string; stamps: Array<{ event: string; at: Date; threshold: number }> };
  const byUser = new Map<string, UserBucket>();
  for (const r of rows.rows) {
    const u: UserBucket = byUser.get(r.user_id) ?? { email: r.email, stamps: [] };
    u.stamps.push({
      event: r.event_type,
      at: new Date(r.occurred_at),
      threshold: r.paid_break_threshold_min,
    });
    byUser.set(r.user_id, u);
  }
  const out: UserAgg[] = [];
  for (const [userId, u] of byUser) {
    const days = new Map<string, DayAgg>();
    let openClockIn: Date | null = null;
    let openBreak: Date | null = null;
    for (const s of u.stamps) {
      const dayKey = s.at.toISOString().slice(0, 10);
      const day = days.get(dayKey) ?? {
        day: dayKey,
        worked_minutes: 0,
        paid_break_minutes: 0,
        unpaid_break_minutes: 0,
      };
      if (s.event === 'clock_in') openClockIn = s.at;
      else if (s.event === 'break_start' && openClockIn) {
        day.worked_minutes += Math.max(0, Math.round((s.at.getTime() - openClockIn.getTime()) / 60000));
        openBreak = s.at;
      } else if (s.event === 'break_end' && openBreak) {
        const minutes = Math.max(0, Math.round((s.at.getTime() - openBreak.getTime()) / 60000));
        if (minutes <= s.threshold) day.paid_break_minutes += minutes;
        else day.unpaid_break_minutes += minutes;
        openClockIn = s.at;
        openBreak = null;
      } else if (s.event === 'clock_out' && openClockIn) {
        day.worked_minutes += Math.max(0, Math.round((s.at.getTime() - openClockIn.getTime()) / 60000));
        openClockIn = null;
      }
      days.set(dayKey, day);
    }
    const dayList = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
    out.push({
      user_id: userId,
      email: u.email,
      days: dayList,
      worked_minutes_total: sum(dayList.map((d) => d.worked_minutes)),
      paid_break_minutes_total: sum(dayList.map((d) => d.paid_break_minutes)),
      unpaid_break_minutes_total: sum(dayList.map((d) => d.unpaid_break_minutes)),
      worked_days: dayList.filter((d) => d.worked_minutes > 0).length,
    });
  }
  return out;
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
    { header: 'Pausa retribuita', key: 'paid', width: 18 },
    { header: 'Pausa non retribuita', key: 'unpaid', width: 22 },
    { header: 'Giorni lavorati', key: 'days', width: 18 },
  ];
  for (const u of data) {
    riep.addRow({
      email: u.email,
      worked: u.worked_minutes_total / 60,
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
      { header: 'Pausa retribuita (min)', key: 'paid', width: 22 },
      { header: 'Pausa non retribuita (min)', key: 'unpaid', width: 26 },
    ];
    for (const d of u.days) {
      ws.addRow({ day: d.day, worked: d.worked_minutes / 60, paid: d.paid_break_minutes, unpaid: d.unpaid_break_minutes });
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
