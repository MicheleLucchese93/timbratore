// Centro Paghe "ORARIO" tracciato (TRORAPRO) builder — pure, no DB.
//
// Produces the fixed-width text body for the LIBRO UNICO presence import:
//   - record type 1: one per employee-day (punches + worked + giustificativi)
//   - record type 2: monthly totals per giustificativo (incl. OL worked total
//                    and OT theoretical total)
//   - record type 3: INPS events (malattia/maternità/infortunio certificates)
//
// Each record is exactly 200 bytes + CRLF (0D0A). Numeric fields are zero-padded
// (non-significant zeros), alfanumeric fields are left-aligned + space-padded.
// Hour fields are 5 chars HHMMM-style "3 interi + 2 decimali" where the 2
// decimals are MINUTES: 8h30m → "00830" (NOT decimal 8.50).
//
// The output is encoded latin1 (ISO-8859-1) — a superset-compatible subset of
// Windows-1252 for the Italian accented characters that appear in descriptions.

import { resolveInpCode, CENTRO_PAGHE_WORKED_INP } from '@sonoqui/shared';

export interface CentroPaghePunch {
  /** "HH:MM" Rome local, or null for an absent punch. */
  in: string | null;
  out: string | null;
}

export interface CentroPagheGiustificativo {
  /** 2-char INP code (mapping value); resolved to the export form here. */
  inp: string;
  minutes: number;
}

export interface CentroPagheDay {
  /** YYYY-MM-DD */
  date: string;
  punches: CentroPaghePunch[];
  /** ORE LAVORATE (ordinary, straordinario excluded). */
  workedMin: number;
  /** ORE TEORICHE — null when no shift is assigned (field left zero). */
  theoreticalMin: number | null;
  /** ORE-CONTRATTO — null leaves the field zero. */
  contractMin: number | null;
  tipoGiorno: 'GL' | 'SA' | 'DO' | '';
  giustificativi: CentroPagheGiustificativo[];
}

export interface CentroPagheInpsEvent {
  /** "CM" PUC | "PR" protocollo | "DT" data inizio evento. */
  tipo: 'CM' | 'PR' | 'DT';
  /** PUC / protocollo / date string per tipo (max 20). */
  code: string;
  /** YYYY-MM-DD */
  start: string;
  end: string;
}

export interface CentroPagheEmployee {
  inail: string | null;
  qualifica: string | null;
  qualifica2: string | null;
  matricola: string | null;
  codiceFiscale: string | null;
  days: CentroPagheDay[];
  inpsEvents: CentroPagheInpsEvent[];
}

export interface CentroPagheInput {
  /** 7-char company code (CODICE DITTA), must match the payroll anagrafica. */
  codiceDitta: string;
  /** AAAAMM period the data refers to. */
  periodoAAAAMM: string;
  codeLen: 2 | 4;
  /** 11-char CF/P.IVA of the blood-collection centre (donazione sangue rows). */
  donazioneCf: string;
  employees: CentroPagheEmployee[];
}

const REC_LEN = 200;
const EOL = '\r\n';

/* ── field helpers ─────────────────────────────────────────────────────── */

/** Alfanumeric: left-aligned, space-padded, right-truncated. */
function a(value: string | null | undefined, width: number): string {
  const s = (value ?? '').replace(/[\r\n]/g, ' ');
  return s.length >= width ? s.slice(0, width) : s.padEnd(width, ' ');
}

/** Numeric: zero-padded, right-aligned. Negatives/NaN → zeros. */
function n(value: number | string | null | undefined, width: number): string {
  if (value === null || value === undefined || value === '') return '0'.repeat(width);
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) return '0'.repeat(width);
  const s = String(Math.floor(num));
  return s.length >= width ? s.slice(-width) : s.padStart(width, '0');
}

/** Hour field (5): minutes → HHMMM where the last 2 digits are minutes. */
function hours5(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.min(999, Math.floor(m / 60));
  const mm = m % 60;
  return String(h * 100 + mm).padStart(5, '0');
}

/** Punch field (4): "HH:MM" → HHMM; null/empty → 0000. */
function hhmm4(time: string | null | undefined): string {
  if (!time) return '0000';
  const [h, mi] = time.split(':');
  const hh = Number(h);
  const mm = Number(mi);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return '0000';
  return String(hh * 100 + mm).padStart(4, '0');
}

/** Date field (8): YYYY-MM-DD → YYYYMMDD; empty → 8 zeros. */
function date8(iso: string | null | undefined): string {
  if (!iso) return '0'.repeat(8);
  return iso.replace(/-/g, '').slice(0, 8).padStart(8, '0');
}

function record(parts: string[]): string {
  const s = parts.join('');
  if (s.length !== REC_LEN) {
    throw new Error(`Centro Paghe record length ${s.length} != ${REC_LEN}: "${s}"`);
  }
  return s;
}

/* ── record builders ──────────────────────────────────────────────────── */

/** Common header (31 chars): DITTA INAIL QUAL QUAL2 MATR CF TIPO. */
function header(input: CentroPagheInput, emp: CentroPagheEmployee, tipo: '1' | '2' | '3'): string {
  return (
    a(input.codiceDitta, 7) +
    a(emp.inail, 1) +
    a(emp.qualifica, 1) +
    a(emp.qualifica2, 1) +
    n(emp.matricola, 4) +
    a(emp.codiceFiscale, 16) +
    a(tipo, 1)
  );
}

function type1(input: CentroPagheInput, emp: CentroPagheEmployee, day: CentroPagheDay): string {
  const punches: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const p = day.punches[i];
    punches.push(hhmm4(p?.in), hhmm4(p?.out));
  }
  const giu: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const g = day.giustificativi[i];
    if (g) {
      const resolved = resolveInpCode(g.inp, input.codeLen);
      giu.push(a(resolved?.code ?? '', 4), hours5(g.minutes));
    } else {
      giu.push(a('', 4), hours5(0));
    }
  }
  return record([
    header(input, emp, '1'),
    n(input.periodoAAAAMM, 6),
    date8(day.date),
    ...punches,
    day.theoreticalMin == null ? n(0, 5) : hours5(day.theoreticalMin),
    hours5(day.workedMin),
    ...giu,
    a('', 6), // CARICA-CALEND-GIU 1..6
    a(day.tipoGiorno, 2),
    a('', 15), // CAMPO-SPECIALE
    a('', 1), // FLAG-IMPORT
    day.contractMin == null ? n(0, 5) : hours5(day.contractMin),
    n(0, 5), // PERC-PART-TIME
    a('', 2), // CODICE CANTIERE
    a('', 16), // COD. FISC. FIGLIO
    a('', 7), // CAMPO VUOTO
  ]);
}

interface Type2Row {
  code: string; // export form (already resolved)
  descr: string;
  minutes: number;
  donazione: boolean;
}

function type2(
  input: CentroPagheInput,
  emp: CentroPagheEmployee,
  progressivo: number,
  row: Type2Row
): string {
  return record([
    header(input, emp, '2'),
    n(input.periodoAAAAMM, 6),
    n(progressivo, 8),
    a(row.code, 4),
    hours5(row.minutes),
    a(row.descr, 30),
    a('', 8), // DATA FINE GIUSTIFICATIVO (Mal/Mat/Inf oltre mese)
    a('', 1), // PREFISSO VOCE
    a('', 4), // CODICE VOCE
    a('', 1), // SUFFISSO VOCE
    n(0, 7), // OG-VOCE
    n(0, 15), // CU-VOCE
    n(0, 15), // IMPORTO-VOCE
    a(row.donazione ? input.donazioneCf : '', 11), // CF UNITA RACCOLTA
    a('', 54), // CAMPO VUOTO
  ]);
}

function type3(
  input: CentroPagheInput,
  emp: CentroPagheEmployee,
  progressivo: number,
  ev: CentroPagheInpsEvent
): string {
  return record([
    header(input, emp, '3'),
    n(input.periodoAAAAMM, 6),
    n(progressivo, 8),
    a(ev.tipo, 2),
    a(ev.code, 20),
    date8(ev.start),
    date8(ev.end),
    a('', 117), // CAMPO VUOTO
  ]);
}

/* ── assembly ─────────────────────────────────────────────────────────── */

/** INP code whose record-2 row carries the blood-collection-centre CF. */
const DONAZIONE_INP = 'DS';

export function buildEmployeeRecords(
  input: CentroPagheInput,
  emp: CentroPagheEmployee
): string[] {
  const lines: string[] = [];

  // Record type 1: one per day, chronological.
  const days = [...emp.days].sort((x, y) => x.date.localeCompare(y.date));
  for (const day of days) lines.push(type1(input, emp, day));

  // Record type 2: monthly totals. OL (worked) first, then giustificativi by
  // resolved code, then OT (theoretical). A giustificativo total is the sum of
  // that code's minutes across all days.
  const workedTotal = days.reduce((acc, d) => acc + d.workedMin, 0);
  const theoreticalTotal = days.reduce((acc, d) => acc + (d.theoreticalMin ?? 0), 0);

  const totalsByInp = new Map<string, number>();
  for (const d of days) {
    for (const g of d.giustificativi) {
      if (g.minutes <= 0) continue;
      totalsByInp.set(g.inp, (totalsByInp.get(g.inp) ?? 0) + g.minutes);
    }
  }

  const type2Rows: Type2Row[] = [];
  if (workedTotal > 0) {
    const ol = resolveInpCode(CENTRO_PAGHE_WORKED_INP, input.codeLen);
    type2Rows.push({
      code: ol?.code ?? 'OL',
      descr: ol?.descr ?? 'ORE LAVORATE',
      minutes: workedTotal,
      donazione: false,
    });
  }
  for (const [inp, minutes] of totalsByInp) {
    const resolved = resolveInpCode(inp, input.codeLen);
    if (!resolved) continue;
    type2Rows.push({
      code: resolved.code,
      descr: resolved.descr,
      minutes,
      donazione: inp === DONAZIONE_INP,
    });
  }
  if (theoreticalTotal > 0) {
    type2Rows.push({
      code: 'OT',
      descr: 'ORE TEORICHE',
      minutes: theoreticalTotal,
      donazione: false,
    });
  }

  let prog = 1;
  for (const row of type2Rows) lines.push(type2(input, emp, prog++, row));

  // Record type 3: INPS events.
  let inpsProg = 1;
  for (const ev of emp.inpsEvents) lines.push(type3(input, emp, inpsProg++, ev));

  return lines;
}

export function buildCentroPagheFile(input: CentroPagheInput): Buffer {
  const lines: string[] = [];
  for (const emp of input.employees) lines.push(...buildEmployeeRecords(input, emp));
  // Trailing CRLF after the last record (each record terminated by 0D0A).
  const body = lines.length ? lines.join(EOL) + EOL : '';
  return Buffer.from(body, 'latin1');
}
