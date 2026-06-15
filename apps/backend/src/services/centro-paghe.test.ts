import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCentroPagheFile,
  buildEmployeeRecords,
  type CentroPagheInput,
} from './centro-paghe.js';

function baseInput(overrides: Partial<CentroPagheInput> = {}): CentroPagheInput {
  return {
    codiceDitta: 'ML10028',
    periodoAAAAMM: '202605',
    codeLen: 4,
    donazioneCf: '99999999999',
    employees: [
      {
        inail: null,
        qualifica: null,
        qualifica2: null,
        matricola: '53',
        codiceFiscale: 'MNTGRG67B17L781L',
        days: [
          {
            date: '2026-05-04',
            punches: [{ in: '06:42', out: '15:05' }],
            workedMin: 480,
            theoreticalMin: 480,
            contractMin: 480,
            tipoGiorno: 'GL',
            giustificativi: [],
          },
          {
            date: '2026-05-05',
            punches: [],
            workedMin: 0,
            theoreticalMin: 480,
            contractMin: 480,
            tipoGiorno: 'GL',
            giustificativi: [{ inp: 'FE', minutes: 480 }],
          },
          {
            date: '2026-05-06',
            punches: [],
            workedMin: 0,
            theoreticalMin: 480,
            contractMin: 480,
            tipoGiorno: 'GL',
            giustificativi: [{ inp: 'DS', minutes: 480 }],
          },
        ],
        inpsEvents: [{ tipo: 'PR', code: 'PROT123', start: '2026-05-19', end: '2026-05-19' }],
      },
    ],
    ...overrides,
  };
}

function lines(input: CentroPagheInput): string[] {
  return buildCentroPagheFile(input).toString('latin1').split('\r\n').filter(Boolean);
}

test('every record is exactly 200 bytes + CRLF-terminated', () => {
  const buf = buildCentroPagheFile(baseInput());
  const text = buf.toString('latin1');
  assert.ok(text.endsWith('\r\n'), 'file ends with CRLF');
  for (const ln of text.split('\r\n').filter(Boolean)) {
    assert.equal(ln.length, 200, `record length 200, got ${ln.length}`);
  }
});

test('type-1 header + punches + hour fields (HHMM-minutes encoding)', () => {
  const ln = lines(baseInput()).find((l) => l[30] === '1' && l.slice(37, 45) === '20260504')!;
  assert.ok(ln, 'found 2026-05-04 type-1 record');
  assert.equal(ln.slice(0, 7), 'ML10028'); // CODICE DITTA
  assert.equal(ln.slice(10, 14), '0053'); // MATRICOLA zero-padded
  assert.equal(ln.slice(14, 30), 'MNTGRG67B17L781L'); // CF
  assert.equal(ln[30], '1'); // TIPO RECORD
  assert.equal(ln.slice(31, 37), '202605'); // PERIODO AAAAMM
  assert.equal(ln.slice(45, 49), '0642'); // ENTRATA 1
  assert.equal(ln.slice(49, 53), '1505'); // USCITA 1
  assert.equal(ln.slice(53, 57), '0000'); // ENTRATA 2 (absent)
  assert.equal(ln.slice(77, 82), '00800'); // ORE TEORICHE 8h
  assert.equal(ln.slice(82, 87), '00800'); // ORE LAVORATE 8h
  assert.equal(ln.slice(147, 149), 'GL'); // TIPO-GIORNO
});

test('type-1 giustificativo resolves to 4-char code at codeLen 4', () => {
  const ln = lines(baseInput()).find((l) => l[30] === '1' && l.slice(37, 45) === '20260505')!;
  assert.equal(ln.slice(82, 87), '00000'); // ORE LAVORATE 0 (ferie day)
  assert.equal(ln.slice(87, 91), 'FERI'); // CODICE GIUSTIFICATIVO 1 (FE→FERI)
  assert.equal(ln.slice(91, 96), '00800'); // ORE GIUSTIFICATIVO 1 = 8h
});

test('type-1 giustificativo uses 2-char code at codeLen 2', () => {
  const ln = lines(baseInput({ codeLen: 2 })).find(
    (l) => l[30] === '1' && l.slice(37, 45) === '20260505'
  )!;
  assert.equal(ln.slice(87, 91), 'FE  '); // 2-char INP, space-padded
});

test('type-2 emits OL worked total, giustificativo totals, OT theoretical total', () => {
  const t2 = lines(baseInput()).filter((l) => l[30] === '2');
  const ol = t2.find((l) => l.slice(45, 49).trim() === 'OL')!;
  assert.ok(ol, 'OL total present');
  assert.equal(ol.slice(49, 54), '00800'); // 480 min worked total
  const feri = t2.find((l) => l.slice(45, 49) === 'FERI')!;
  assert.equal(feri.slice(49, 54), '00800');
  const ot = t2.find((l) => l.slice(45, 49).trim() === 'OT')!;
  assert.equal(ot.slice(49, 54), '02400'); // 3 × 8h theoretical = 24h
  // PROGRESSIVO restarts at 1 and increments.
  assert.equal(ol.slice(37, 45), '00000001');
});

test('type-2 donazione sangue row carries the collection-centre CF', () => {
  const t2 = lines(baseInput()).filter((l) => l[30] === '2');
  const don = t2.find((l) => l.slice(45, 49).trim() === 'DON')!; // DS→DON at codeLen 4
  assert.ok(don, 'donazione row present');
  assert.equal(don.slice(135, 146), '99999999999'); // CF UNITA RACCOLTA
});

test('type-3 INPS event fields', () => {
  const ln = lines(baseInput()).find((l) => l[30] === '3')!;
  assert.ok(ln, 'type-3 present');
  assert.equal(ln.slice(37, 45), '00000001'); // PROGRESSIVO
  assert.equal(ln.slice(45, 47), 'PR'); // TIPO EVENTO
  assert.equal(ln.slice(47, 67), 'PROT123'.padEnd(20, ' ')); // CODICE EVENTO
  assert.equal(ln.slice(67, 75), '20260519'); // DATA INIZIO
  assert.equal(ln.slice(75, 83), '20260519'); // DATA FINE
});

test('empty employee list yields empty buffer', () => {
  assert.equal(buildCentroPagheFile(baseInput({ employees: [] })).length, 0);
});

test('buildEmployeeRecords ordering: all type-1, then type-2, then type-3', () => {
  const recs = buildEmployeeRecords(baseInput(), baseInput().employees[0]!);
  const tipos = recs.map((r) => r[30]).join('');
  assert.match(tipos, /^1+2+3+$/, `expected 1*2*3* ordering, got ${tipos}`);
});
