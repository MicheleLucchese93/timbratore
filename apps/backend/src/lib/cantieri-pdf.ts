import PDFDocument from 'pdfkit';
import {
  cantieriIntervalMinutes,
  type CantieriCustomValues,
  type CantieriFieldDef,
} from '@sonoqui/shared';

// One row of the monthly per-site report — the admin drill-in entry shape
// (cantiere_entries joined with the author's display name and the vehicle name).
export interface CantiereReportEntry {
  entry_date: string; // YYYY-MM-DD
  user_name: string;
  travel_start: string | null; // HH:MM
  travel_end: string | null;
  activity_start: string | null;
  activity_end: string | null;
  activity_text: string | null;
  mezzo_name: string | null;
  custom_values: CantieriCustomValues;
}

export interface CantiereReportInput {
  tenantName: string;
  site: { name: string; address: string | null };
  /** Localized month label, e.g. 'giugno 2026'. */
  monthLabel: string;
  /** 'YYYY-MM' — printed in the footer next to the site name. */
  month: string;
  /** Chronologically ordered (grouping by entry_date relies on it). */
  entries: CantiereReportEntry[];
  /** Entry-scope custom field defs, in display order. */
  fields: CantieriFieldDef[];
  language?: 'it' | 'en';
}

const LABELS = {
  it: {
    title: 'Rapporto mensile cantiere',
    month: 'Mese',
    travel: 'Viaggio',
    activity: 'Attività',
    vehicle: 'Mezzo',
    description: 'Attività svolta',
    totals: 'Totali',
    entriesCount: 'Registrazioni',
    totalTravel: 'Totale viaggio',
    totalActivity: 'Totale attività',
    page: 'Pagina',
    of: 'di',
    noEntries: 'Nessuna registrazione nel mese selezionato.',
    yes: 'Sì',
    no: 'No',
  },
  en: {
    title: 'Monthly site report',
    month: 'Month',
    travel: 'Travel',
    activity: 'Activity',
    vehicle: 'Vehicle',
    description: 'Work performed',
    totals: 'Totals',
    entriesCount: 'Entries',
    totalTravel: 'Total travel',
    totalActivity: 'Total activity',
    page: 'Page',
    of: 'of',
    noEntries: 'No entries in the selected month.',
    yes: 'Yes',
    no: 'No',
  },
} as const;

const MARGIN = 40;
const FOOTER_H = 24; // space reserved at the bottom of every page for the page number

function fmtMinutes(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

// '08:00 – 12:30 (4:30)' or null when both bounds are missing.
function fmtInterval(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  const range = `${start ?? '—'} – ${end ?? '—'}`;
  const min = cantieriIntervalMinutes(start, end);
  return min === null ? range : `${range} (${fmtMinutes(min)})`;
}

function fmtDate(iso: string, language: 'it' | 'en'): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(language === 'it' ? 'it-IT' : 'en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function fmtCustomValue(
  value: CantieriCustomValues[string] | undefined,
  labels: (typeof LABELS)['it' | 'en']
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? labels.yes : labels.no;
  return String(value);
}

/**
 * Render the monthly per-site activity report (A4 portrait). The same buffer
 * feeds both the download endpoint and the email attachment.
 */
export function buildCantiereReportPdf(input: CantiereReportInput): Promise<Buffer> {
  const language = input.language ?? 'it';
  const labels = LABELS[language];

  return new Promise<Buffer>((resolve, reject) => {
    // bufferPages so page numbers can be stamped once the total is known.
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const contentW = doc.page.width - MARGIN * 2;
    const bottomLimit = (): number => doc.page.height - MARGIN - FOOTER_H;
    const ensureSpace = (needed: number): void => {
      if (doc.y + needed > bottomLimit()) doc.addPage();
    };

    /* ----- Header ----- */
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a').text(input.tenantName);
    doc.moveDown(0.2);
    doc.fontSize(12).fillColor('#15569e').text(`${labels.title} — ${input.site.name}`);
    doc.font('Helvetica').fontSize(9).fillColor('#475569');
    if (input.site.address) doc.text(input.site.address);
    doc.text(`${labels.month}: ${input.monthLabel}`);
    doc.moveDown(0.4);
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(MARGIN + contentW, doc.y)
      .strokeColor('#cbd5e1')
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.6);

    /* ----- Entries grouped by date ----- */
    let totalTravel = 0;
    let totalActivity = 0;
    let currentDate: string | null = null;

    if (input.entries.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor('#475569').text(labels.noEntries);
    }

    for (const entry of input.entries) {
      totalTravel += cantieriIntervalMinutes(entry.travel_start, entry.travel_end) ?? 0;
      totalActivity += cantieriIntervalMinutes(entry.activity_start, entry.activity_end) ?? 0;

      if (entry.entry_date !== currentDate) {
        currentDate = entry.entry_date;
        ensureSpace(60); // keep the date heading attached to at least one row
        doc.moveDown(0.3);
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor('#0f172a')
          .text(fmtDate(entry.entry_date, language));
        doc.moveDown(0.15);
      }

      // Pre-compute the lines so the block never straddles a page break badly.
      const detailParts: string[] = [];
      const travel = fmtInterval(entry.travel_start, entry.travel_end);
      if (travel) detailParts.push(`${labels.travel}: ${travel}`);
      const activity = fmtInterval(entry.activity_start, entry.activity_end);
      if (activity) detailParts.push(`${labels.activity}: ${activity}`);
      if (entry.mezzo_name) detailParts.push(`${labels.vehicle}: ${entry.mezzo_name}`);
      const customParts: string[] = [];
      for (const field of input.fields) {
        const v = fmtCustomValue(entry.custom_values?.[field.key], labels);
        if (v !== null) customParts.push(`${field.label}: ${v}`);
      }

      ensureSpace(40);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#334155').text(entry.user_name, {
        width: contentW,
      });
      doc.font('Helvetica').fontSize(9).fillColor('#334155');
      if (detailParts.length > 0) doc.text(detailParts.join('    '), { width: contentW });
      if (entry.activity_text) {
        doc.text(`${labels.description}: ${entry.activity_text}`, { width: contentW });
      }
      if (customParts.length > 0) {
        doc.fillColor('#475569').text(customParts.join('    '), { width: contentW });
      }
      doc.moveDown(0.35);
    }

    /* ----- Totals ----- */
    ensureSpace(70);
    doc.moveDown(0.5);
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(MARGIN + contentW, doc.y)
      .strokeColor('#cbd5e1')
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(labels.totals);
    doc.font('Helvetica').fontSize(9).fillColor('#334155');
    doc.text(`${labels.entriesCount}: ${input.entries.length}`);
    doc.text(`${labels.totalTravel}: ${fmtMinutes(totalTravel)}`);
    doc.text(`${labels.totalActivity}: ${fmtMinutes(totalActivity)}`);

    /* ----- Page numbers (all pages buffered) ----- */
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#94a3b8')
        .text(
          `${input.site.name} — ${input.month}    ${labels.page} ${i + 1} ${labels.of} ${range.count}`,
          MARGIN,
          doc.page.height - MARGIN - 10,
          { width: contentW, align: 'right', lineBreak: false }
        );
    }

    doc.end();
  });
}
