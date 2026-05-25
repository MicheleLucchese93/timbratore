import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  AlignmentType,
} from 'docx';

type Tenant = { ragione_sociale: string; country: string; retention_years: number };

function h1(text: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
}
function h2(text: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
}
function p(...runs: Array<string | TextRun>): Paragraph {
  return new Paragraph({
    children: runs.map((r) => (typeof r === 'string' ? new TextRun(r) : r)),
  });
}
function bullet(text: string): Paragraph {
  return new Paragraph({ bullet: { level: 0 }, children: [new TextRun(text)] });
}
function check(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun(`☐  ${text}`)] });
}
function disclaimer(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 480 },
    children: [new TextRun({ text, italics: true, size: 18, color: '666666' })],
  });
}

export async function renderDpiaDocx(tenant: Tenant): Promise<Buffer> {
  const doc = new Document({
    creator: 'ciSono',
    title: `DPIA — ${tenant.ragione_sociale}`,
    sections: [
      {
        children: [
          h1("Valutazione d'Impatto sulla Protezione dei Dati (DPIA)"),
          p(
            new TextRun({ text: 'Titolare: ', bold: true }),
            new TextRun(`${tenant.ragione_sociale} (${tenant.country})`)
          ),
          h2('1. Finalità del trattamento'),
          p('Rilevazione presenze ai fini gestionali e amministrativi, per il calcolo delle ore lavorate del personale dipendente.'),
          h2('2. Categorie di dati'),
          bullet('Identificativi del dipendente (nome, email)'),
          bullet('Eventi di timbratura (ingresso, uscita, pausa) con orario'),
          bullet('Coordinate GPS al momento della timbratura (cancellate dopo 90 giorni)'),
          bullet('Identificativo della sede'),
          h2('3. Base giuridica'),
          p('Art. 6.1.b GDPR (esecuzione del contratto di lavoro), art. 88 GDPR e provvedimenti del Garante Privacy in materia di rilevazione presenze.'),
          h2('4. Conservazione'),
          p(
            'Dati conservati per ',
            new TextRun({ text: `${tenant.retention_years} anni`, bold: true }),
            '. Coordinate GPS anonimizzate dopo 90 giorni: viene mantenuto solo l\'identificativo della sede.'
          ),
          h2('5. Sub-fornitori'),
          bullet('OVHcloud (hosting, IT/FR)'),
          bullet('Cloudflare (CDN/DNS, EU)'),
          bullet('Apple/Google (notifiche push, EU/US — SCC)'),
          bullet('Brevo (email transazionale, EU)'),
          h2('6. Misure di sicurezza'),
          bullet('Cifratura TLS in transito; cifratura at-rest del database'),
          bullet('Isolamento multi-tenant via Row-Level Security PostgreSQL'),
          bullet('Backup giornalieri 30gg; audit log immutabile'),
          bullet('Nessun tracciamento continuo della posizione; nessun riconoscimento facciale'),
          h2('7. Diritti dell\'interessato'),
          p('Accesso, rettifica, cancellazione tramite l\'app o richiesta scritta al titolare.'),
          disclaimer('Modello generato da ciSono. Da rivedere e personalizzare con il proprio DPO o legale prima della firma.'),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

export async function renderPrivacyNoticeDocx(tenant: { ragione_sociale: string; country: string }): Promise<Buffer> {
  const domain = tenant.ragione_sociale.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const doc = new Document({
    creator: 'ciSono',
    title: `Informativa privacy — ${tenant.ragione_sociale}`,
    sections: [
      {
        children: [
          h1('Informativa sul trattamento dei dati personali (art. 13 GDPR)'),
          p(
            new TextRun({ text: 'Titolare: ', bold: true }),
            new TextRun(`${tenant.ragione_sociale} (${tenant.country})`)
          ),
          p(
            new TextRun({ text: 'Responsabile del trattamento: ', bold: true }),
            new TextRun('Archiva Group — ciSono.')
          ),
          p('I dati raccolti tramite l\'app ciSono sono utilizzati esclusivamente per la rilevazione presenze. La posizione GPS è acquisita solo al momento della timbratura e mai in background.'),
          p(`L'interessato può esercitare i propri diritti contattando il titolare oppure scrivendo a privacy@${domain}.it.`),
          disclaimer('Modello generato da ciSono — da personalizzare con il proprio referente legale.'),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

export async function renderArt4ChecklistDocx(tenant: { ragione_sociale: string }): Promise<Buffer> {
  const doc = new Document({
    creator: 'ciSono',
    title: `Checklist Art. 4 — ${tenant.ragione_sociale}`,
    sections: [
      {
        children: [
          h1(`Checklist art. 4 Statuto dei Lavoratori — ${tenant.ragione_sociale}`),
          p('Passi consigliati per adempiere all\'art. 4 L. 300/1970 quando si introduce un sistema di rilevazione presenze.'),
          check('Verificare se l\'attività rientra fra gli strumenti di lavoro (comma 2) — Cisono lo è.'),
          check('Predisporre informativa preventiva ai lavoratori sulle modalità d\'uso.'),
          check('Predisporre accordo aziendale con RSA/RSU (se presenti) oppure istanza all\'Ispettorato Territoriale del Lavoro.'),
          check('Conservare copia firmata di accordo o autorizzazione.'),
          check('Aggiornare il Registro dei trattamenti (art. 30 GDPR).'),
          check('Conservare valutazione di impatto (DPIA) firmata dal Titolare.'),
          check('Formare il personale e gli amministratori sull\'uso dell\'app.'),
          disclaimer('Da rivedere con il proprio legale del lavoro / consulente.'),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
