import type { Lang } from '../i18n/ui';

export const SITE_URL = 'https://sonoqui.pro';
export const APP_STORE_URL = 'https://apps.apple.com/it/app/sonoqui/id6772960002';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=app.sonoqui.mobile';
export const WEB_APP_URL = 'https://app.sonoqui.pro/login';
// Reseller console (partner program). Existing partners log in here.
export const PARTNER_APP_URL = 'https://partners.sonoqui.pro';
// 1200x630 branded social card (generated, see public/og-default.png). The square
// /icon.png stays as favicon/app icon only.
export const DEFAULT_IMAGE = '/og-default.png';
// Kept in sync with the mobile release (versionCode 10 / 10.0.0).
export const SOFTWARE_VERSION = '10.0.0';

export const homeMeta: Record<Lang, { title: string; description: string }> = {
  it: {
    title: 'sonoQui | Rilevazione presenze con GPS per PMI italiane',
    description:
      "sonoQui è l'app di rilevazione presenze per PMI italiane: timbratura GPS al tap, ferie e correzioni in app, export per il commercialista. Pensata per l'art. 4 dello Statuto dei Lavoratori.",
  },
};

// Standalone, indexable partner-program landing page (/it/partner/). The reseller
// console itself (partners.sonoqui.pro) stays noindex; this page is the public,
// search-discoverable entry point for the partner program.
export const partnerMeta: Record<Lang, { title: string; description: string }> = {
  it: {
    title: 'Diventa partner sonoQui | Rivendi la rilevazione presenze',
    description:
      "Programma partner sonoQui per commercialisti, consulenti del lavoro e software house: gestisci le aziende dei tuoi clienti da un'unica console, con margine ricorrente. Pensiamo noi a prodotto, infrastruttura e assistenza.",
  },
};

// Per-page meta descriptions for the legal pages, so each indexable URL gets a
// unique description instead of inheriting the BaseLayout default (duplicate meta).
export const legalMeta: Record<string, { it: string }> = {
  'privacy-policy': {
    it: 'Informativa privacy di sonoQui: titolare del trattamento, dati raccolti, GPS rilevato solo al momento della timbratura, base giuridica, conservazione e diritti GDPR.',
  },
  'cookie-policy': {
    it: 'Cookie policy di sonoQui: quali cookie e tecnologie usiamo su sonoqui.pro, finalità, durata e come gestire il consenso. Usiamo solo cookie tecnici necessari.',
  },
  'termini-e-condizioni': {
    it: 'Termini e condizioni del servizio sonoQui per le aziende clienti: attivazione, uso della piattaforma SaaS di rilevazione presenze, responsabilità e durata.',
  },
  eula: {
    it: "EULA di sonoQui: contratto di licenza d'uso dell'app mobile e della dashboard web per i dipendenti, permessi del dispositivo, limitazioni e durata della licenza.",
  },
};

export type FaqItem = { question: string; answer: string };

export const homeFaq: Record<Lang, FaqItem[]> = {
  it: [
    {
      question: "Come funziona la timbratura GPS?",
      answer:
        "Quando tocchi 'Timbra', sonoQui rileva la tua posizione una sola volta e verifica che tu sia entro la tolleranza della sede di lavoro (configurabile da 50m a 1500m, di default 300m). La posizione NON viene mai tracciata in background.",
    },
    {
      question: "sonoQui è conforme all'art. 4 dello Statuto dei Lavoratori?",
      answer:
        "sonoQui è progettata nel rispetto dell'art. 4: rileva la posizione solo al momento della timbratura, mai in continuo, e non utilizza riconoscimento facciale né dati biometrici. I dati GPS vengono mascherati dopo 90 giorni: rimane solo la sede di riferimento. L'attivazione resta comunque subordinata agli obblighi dell'art. 4 a carico del datore di lavoro (accordo sindacale aziendale o autorizzazione dell'Ispettorato Territoriale del Lavoro).",
    },
    {
      question: "Posso esportare i dati per il commercialista?",
      answer:
        "Sì. La dashboard amministratori genera un export XLSX mensile nel formato utile alle paghe italiane: ore ordinarie e straordinari, anomalie evidenziate, ferie e permessi, con i totali divisi per dipendente, sede e tipologia. Lo scarichi con un click a fine mese e lo consegni al commercialista, senza ricopiare nulla a mano.",
    },
    {
      question: "Posso condividere cedolini e documenti con i dipendenti?",
      answer:
        "Sì. Carichi i PDF (cedolini, CU, contratti, comunicazioni) e li assegni a ogni dipendente, che li trova nella sezione «I miei documenti» sul web e nel tab «Documenti» dell'app. Ogni documento registra la presa visione e viene archiviato per 36 mesi; sull'app la sezione è protetta da sblocco biometrico. L'accesso all'archivio di tutti i dipendenti è riservato a un responsabile autorizzato («Documentale»): ogni consultazione richiede un codice di verifica inviato via email e viene registrata, mentre ciascun dipendente vede esclusivamente i propri documenti.",
    },
    {
      question: "Che succede se un dipendente si dimentica di timbrare?",
      answer:
        "Può richiedere una correzione direttamente dall'app indicando orario e motivo. L'amministratore approva o rifiuta. La timbratura corretta viene tracciata con audit log completo.",
    },
    {
      question: "I miei dati sono al sicuro?",
      answer:
        "Sì. I dati sono cifrati in transito (TLS) e a riposo, e conservati su server nell'Unione Europea. I dati di ogni azienda sono isolati con Row Level Security e non sono mai visibili ad altre aziende. I backup sono cifrati e l'intero trattamento avviene nel rispetto del GDPR.",
    },
    {
      question: "Quanto durano i miei dati?",
      answer:
        "Le timbrature sono conservate per 5 anni di default (configurabili fino a 10). I dati GPS dettagliati vengono mascherati dopo 90 giorni: rimane solo l'identificativo della sede. Puoi richiedere la cancellazione anticipata in qualsiasi momento.",
    },
    {
      question: "Chi può approvare ferie, permessi e correzioni?",
      answer:
        "Gli amministratori dell'azienda approvano ferie, permessi e correzioni dalla dashboard web o dall'app, con una notifica in tempo reale a ogni nuova richiesta. Puoi anche nominare approvatori dedicati per singola sede, così ogni responsabile gestisce solo i dipendenti della propria sede mentre l'amministratore mantiene la visione d'insieme.",
    },
    {
      question: "Supportate il lavoro fuori sede (smart working)?",
      answer:
        "Sì. Una sede può essere impostata come «fuori sede»: per quei dipendenti la timbratura avviene senza verifica della posizione (GPS), mentre per le sedi fisiche la verifica GPS resta attiva. Ideale per lavoro da remoto, trasferte o cantieri.",
    },
    {
      question: "I dati restano della nostra azienda? Possiamo esportarli?",
      answer:
        "Sì. I dati sono solo della tua azienda e puoi esportarli in Excel in qualsiasi momento, già nel formato utile al commercialista. Alla cessazione del servizio i dati vengono restituiti o cancellati su tua richiesta.",
    },
    {
      question: "Quanto costa sonoQui?",
      answer:
        "sonoQui parte da 24,99 €/mese per le aziende fino a 10 dipendenti (massimo 3 sedi) e 39,99 €/mese fino a 20 dipendenti (massimo 5 sedi). Il prezzo dipende dai tuoi dipendenti e tutta la rilevazione presenze è inclusa in entrambi i piani, senza costi nascosti. Con la fatturazione annuale hai 1 mese gratis. Oltre i limiti del piano aggiungi singoli dipendenti a 1,99 €/mese e sedi a 2,99 €/mese. I moduli aggiuntivi (come Cantieri) sono opzionali, si attivano a parte e si pagano a consumo mensile con prezzo su richiesta. Prezzi IVA esclusa; l'app è gratuita da scaricare e l'attivazione del servizio avviene su richiesta.",
    },
    {
      question: "Cosa sono i moduli aggiuntivi?",
      answer:
        "Oltre alla rilevazione presenze (inclusa in ogni piano), sonoQui offre moduli opzionali per esigenze specifiche di settore. Il primo disponibile è Cantieri: gli addetti registrano dal telefono le attività di cantiere (tempo di viaggio, ore di lavoro, mezzi e campi su misura) e l'azienda ottiene report mensili per cantiere in PDF o via email. I moduli si attivano su richiesta e si fatturano a consumo mensile in aggiunta all'abbonamento, con prezzo su richiesta. Possiamo anche sviluppare moduli su misura per il tuo settore.",
    },
    {
      question: "Come iniziamo a usare sonoQui?",
      answer:
        "Non c'è registrazione pubblica: attiviamo noi l'azienda e creiamo il primo account amministratore. Da lì inviti i dipendenti, configuri sedi e orari e sei operativo. Compila il modulo di contatto qui sotto e ti rispondiamo al più presto, in genere entro 1-2 giorni lavorativi.",
    },
  ],
};

export const partnerFaq: Record<Lang, FaqItem[]> = {
  it: [
    {
      question: "Chi può diventare partner sonoQui?",
      answer:
        "Il programma è pensato per commercialisti, consulenti del lavoro, software house, agenzie IT e system integrator che seguono piccole e medie imprese italiane e vogliono offrire loro la rilevazione presenze come servizio, mantenendo il proprio rapporto commerciale con il cliente.",
    },
    {
      question: "Come funzionano margine e fatturazione?",
      answer:
        "Fatturiamo a te il servizio a un prezzo riservato ai partner; tu fatturi il cliente finale al prezzo che decidi. Il margine è ricorrente e cresce con i volumi grazie a uno sconto incrementale a scaglioni.",
    },
    {
      question: "Devo occuparmi io di infrastruttura e assistenza tecnica?",
      answer:
        "No. Infrastruttura, aggiornamenti, sicurezza e backup restano a carico nostro. Tu segui la relazione con il cliente e la configurazione iniziale; alla piattaforma pensiamo noi.",
    },
    {
      question: "Come gestisco le aziende dei miei clienti?",
      answer:
        "Da una console dedicata su partners.sonoqui.pro: crei nuovi account azienda, imposti i limiti, sospendi e riattivi i servizi in autonomia, senza dover passare da noi per ogni operazione.",
    },
    {
      question: "Posso gestire i moduli aggiuntivi dei miei clienti?",
      answer:
        "Sì. Dalla console attivi e disattivi i moduli aggiuntivi (come Cantieri) per ogni singola azienda cliente, in autonomia. I moduli si fatturano a consumo mensile in aggiunta all'abbonamento e li rivendi al cliente finale con il tuo margine.",
    },
    {
      question: "Come divento partner sonoQui?",
      answer:
        "Compila il modulo di contatto qui sotto indicando la tua attività e quante aziende gestisci. Ti ricontattiamo, di norma entro 1-2 giorni lavorativi, e attiviamo il tuo accesso alla console partner.",
    },
  ],
};

const LOGO_URL = `${SITE_URL}/icon-512.png`;

// Reusable Organization node. Public-facing identity is the "sonoQui" brand
// (matching the legal pages); the parent legal entity is intentionally not
// exposed here. Used standalone and as publisher/author on other nodes.
export function buildOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'sonoQui',
    url: SITE_URL,
    logo: LOGO_URL,
    description:
      "sonoQui è la piattaforma di rilevazione presenze con timbratura GPS per le piccole e medie imprese italiane.",
    sameAs: [APP_STORE_URL, PLAY_STORE_URL],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'sales',
      availableLanguage: 'Italian',
      areaServed: 'IT',
      url: `${SITE_URL}/it/#contact`,
    },
  };
}

export function buildWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'sonoQui',
    url: SITE_URL,
    inLanguage: 'it-IT',
    publisher: { '@type': 'Organization', name: 'sonoQui', url: SITE_URL },
  };
}

export function buildHomeSchema(lang: Lang) {
  const meta = homeMeta[lang];
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'sonoQui',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Time and Attendance',
    operatingSystem: 'iOS, Android, Web',
    description: meta.description,
    url: `${SITE_URL}/it/`,
    inLanguage: 'it-IT',
    image: LOGO_URL,
    softwareVersion: SOFTWARE_VERSION,
    downloadUrl: [APP_STORE_URL, PLAY_STORE_URL],
    sameAs: [APP_STORE_URL, PLAY_STORE_URL],
    featureList: [
      'Timbratura GPS al momento del tap',
      'Gestione ferie, permessi e malattia',
      'Correzioni con audit log',
      'Anomalie orario segnalate in automatico',
      'Dashboard amministratori',
      'Export XLSX per il commercialista',
      'Documenti dei dipendenti con presa visione',
      'Smart working e sedi multiple',
      'Modulo Cantieri opzionale (a consumo mensile)',
      "Conforme all'art. 4 dello Statuto dei Lavoratori e al GDPR",
    ],
    screenshot: [
      { '@type': 'ImageObject', url: `${SITE_URL}/screenshots/timbra.png`, caption: 'Timbra in un tap' },
      { '@type': 'ImageObject', url: `${SITE_URL}/screenshots/storico.png`, caption: 'Storico delle timbrature' },
      { '@type': 'ImageObject', url: `${SITE_URL}/screenshots-web/dashboard.png`, caption: 'Dashboard amministratori' },
    ],
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'EUR',
      lowPrice: '24.99',
      highPrice: '39.99',
      offerCount: 2,
      url: `${SITE_URL}/it/#pricing`,
      description: 'Due piani in abbonamento mensile con tutta la rilevazione presenze inclusa; prezzo in base ai dipendenti. Fatturazione annuale con 1 mese gratis. Dipendenti aggiuntivi 1,99 €/mese, sedi aggiuntive 2,99 €/mese. Moduli aggiuntivi opzionali (es. Cantieri) a consumo mensile, prezzo su richiesta. Prezzi IVA esclusa.',
      offers: [
        {
          '@type': 'Offer',
          name: 'Piccola',
          price: '24.99',
          priceCurrency: 'EUR',
          description: 'Fino a 10 dipendenti, massimo 3 sedi. Rilevazione presenze completa inclusa, al mese.',
          url: `${SITE_URL}/it/#pricing`,
        },
        {
          '@type': 'Offer',
          name: 'Media',
          price: '39.99',
          priceCurrency: 'EUR',
          description: 'Fino a 20 dipendenti, massimo 5 sedi. Rilevazione presenze completa inclusa, al mese.',
          url: `${SITE_URL}/it/#pricing`,
        },
      ],
    },
    publisher: buildOrganizationSchema(),
    audience: {
      '@type': 'BusinessAudience',
      audienceType: 'Piccole e medie imprese italiane',
    },
  };
}

// FAQPage JSON-LD. Google retired FAQ rich results (May 2026), so this carries
// no SERP feature — it is kept for GEO / AI-answer-engine citability.
function faqPageSchema(items: FaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: 'it-IT',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export function buildFaqSchema(lang: Lang) {
  return faqPageSchema(homeFaq[lang]);
}

// All structured-data nodes for the standalone partner page. WebPage + breadcrumb
// + Organization for entity consistency, plus the partner FAQ for GEO citability.
export function buildPartnerSchemas(lang: Lang) {
  const meta = partnerMeta[lang];
  const url = `${SITE_URL}/it/partner/`;
  const webPage = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: meta.title,
    description: meta.description,
    url,
    inLanguage: 'it-IT',
    isPartOf: { '@type': 'WebSite', name: 'sonoQui', url: SITE_URL },
    about: buildOrganizationSchema(),
    primaryImageOfPage: { '@type': 'ImageObject', url: `${SITE_URL}${DEFAULT_IMAGE}` },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/it/` },
      { '@type': 'ListItem', position: 2, name: 'Programma partner', item: url },
    ],
  };
  return [webPage, breadcrumb, buildOrganizationSchema(), faqPageSchema(partnerFaq[lang])];
}

// All structured-data nodes for the homepage, emitted as separate JSON-LD blocks.
export function buildHomeSchemas(lang: Lang) {
  return [
    buildHomeSchema(lang),
    buildOrganizationSchema(),
    buildWebSiteSchema(),
    buildFaqSchema(lang),
  ];
}

// ---------------------------------------------------------------------------
// Standalone content/landing pages (rendered by src/pages/it/[slug].astro).
// These earn the non-brand search footprint the homepage alone can't: dedicated
// solution pages for "timbratura GPS" and "rilevazione presenze PMI", plus a
// buyer-guide listicle. Italian-only, matching the rest of the site.
// ---------------------------------------------------------------------------

export type ContentSection = { heading: string; body: string[] };
export type ContentPage = {
  key: string;
  slug: string;
  breadcrumb: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
  highlights: string[];
  sections: ContentSection[];
  faq: FaqItem[];
  cta: { title: string; text: string };
  // Tool names for the ItemList node (buyer-guide page only).
  itemList?: string[];
};

export const contentPages: ContentPage[] = [
  {
    key: 'timbratura-gps-app',
    slug: 'timbratura-gps-app',
    breadcrumb: 'Timbratura GPS',
    title: 'App di timbratura GPS: timbra il cartellino dallo smartphone | sonoQui',
    description:
      "App di timbratura GPS per PMI italiane: i dipendenti timbrano il cartellino dallo smartphone, con la posizione verificata solo al momento del tap. Nel rispetto dell'art. 4. Da 24,99 €/mese.",
    h1: 'Timbratura GPS: il cartellino è nello smartphone dei tuoi dipendenti',
    intro:
      "sonoQui trasforma lo smartphone in un cartellino digitale: un tap per timbrare, con la posizione verificata solo in quel momento per confermare che il dipendente sia nella sede di lavoro. Niente badge, niente totem, niente hardware da installare.",
    highlights: [
      'Timbratura in un tap da iOS e Android',
      'Posizione rilevata solo al momento del tap, mai in background',
      "Progettata nel rispetto dell'art. 4 dello Statuto dei Lavoratori",
    ],
    sections: [
      {
        heading: 'Come funziona la timbratura GPS',
        body: [
          "Quando un dipendente tocca «Timbra», sonoQui rileva la posizione una sola volta e verifica che sia entro la tolleranza della sede di lavoro. Il raggio è configurabile per sede, da 50 a 1500 metri (di default 300 m), così puoi adattarlo a un ufficio, a un negozio o a un cantiere.",
          "La posizione non viene mai tracciata di continuo né in background: il GPS entra in gioco solo nell'istante della timbratura, e il dipendente riceve subito la conferma se è nel posto giusto.",
        ],
      },
      {
        heading: 'Timbrare senza badge né hardware',
        body: [
          "Il cartellino fisico e i lettori a muro diventano superflui: ogni dipendente usa il proprio telefono. Questo azzera i costi di installazione e manutenzione dell'hardware e rende la timbratura immediata anche per chi lavora su più sedi o in mobilità.",
          "Per chi amministra, ogni timbratura arriva in tempo reale nella dashboard web, con orario, sede e stato della giornata già pronti per l'export di fine mese.",
        ],
      },
      {
        heading: "Timbratura GPS e art. 4 dello Statuto dei Lavoratori",
        body: [
          "sonoQui è progettata nel rispetto dell'art. 4: rileva la posizione solo al momento della timbratura, mai in continuo, e non utilizza riconoscimento facciale né dati biometrici. I dati GPS di dettaglio vengono mascherati dopo 90 giorni, lasciando solo la sede di riferimento.",
          "L'attivazione resta comunque subordinata agli obblighi dell'art. 4 a carico del datore di lavoro: accordo sindacale aziendale oppure autorizzazione dell'Ispettorato Territoriale del Lavoro. È uno strumento pensato per aiutarti a rispettare la norma, non per aggirarla.",
        ],
      },
      {
        heading: 'Fuori sede, cantieri e smart working',
        body: [
          "Una sede può essere impostata come «fuori sede»: per quei dipendenti la timbratura avviene senza verifica della posizione, mentre per le sedi fisiche la verifica GPS resta attiva. È la soluzione per trasferte, lavoro da remoto e cantieri, senza rinunciare al controllo dove serve.",
          "Se un dipendente dimentica di timbrare, può richiedere una correzione dall'app indicando orario e motivo; l'amministratore approva o rifiuta e ogni modifica resta tracciata con audit log completo.",
        ],
      },
    ],
    faq: [
      homeFaq.it[0], // Come funziona la timbratura GPS?
      homeFaq.it[1], // conforme art. 4?
      homeFaq.it[4], // dimenticanza timbratura
      homeFaq.it[9], // quanto costa
    ],
    cta: {
      title: 'Porta la timbratura nello smartphone dei tuoi dipendenti',
      text: 'Scarica sonoQui o richiedi l’attivazione per la tua azienda: ti aiutiamo a partire in pochi giorni.',
    },
  },
  {
    key: 'rilevazione-presenze-pmi',
    slug: 'rilevazione-presenze-pmi',
    breadcrumb: 'Rilevazione presenze per PMI',
    title: 'Software di rilevazione presenze per PMI italiane | sonoQui',
    description:
      'Software di rilevazione presenze pensato per le PMI italiane: timbratura GPS, ferie, permessi, anomalie ed export per il commercialista. Da 24,99 €/mese, prezzo in base ai dipendenti.',
    h1: 'Il software di rilevazione presenze pensato per le PMI italiane',
    intro:
      "sonoQui è il sistema di rilevazione presenze su misura per le piccole e medie imprese italiane: semplice per chi timbra, completo per chi amministra e già pronto per il commercialista. Tutta la rilevazione presenze è inclusa in ogni piano; i moduli aggiuntivi, come Cantieri, sono opzionali.",
    highlights: [
      'Timbratura, ferie, permessi e anomalie in un’unica app',
      'Export XLSX mensile pronto per le paghe italiane',
      'Prezzo per fascia di dipendenti, rilevazione presenze inclusa, da 24,99 €/mese',
    ],
    sections: [
      {
        heading: 'Perché una PMI ha bisogno di un sistema di rilevazione presenze',
        body: [
          "La sentenza della Corte di Giustizia UE nel caso CCOO (2019) obbliga i datori di lavoro a dotarsi di un sistema oggettivo, affidabile e accessibile per misurare l'orario di lavoro. In pratica i fogli presenze cartacei e i file Excel non firmati non bastano più come documentazione.",
          "Per una PMI questo non deve tradursi in una suite HR complessa e costosa: serve uno strumento che i dipendenti usino davvero e che faccia risparmiare tempo a chi gestisce le paghe.",
        ],
      },
      {
        heading: 'Tutto quello che serve per chiudere il mese',
        body: [
          "I dipendenti timbrano in un tap, richiedono ferie, permessi e malattia e segnalano le correzioni dall'app. Gli amministratori approvano dalla dashboard web, con anomalie (turni oltre 14 ore, pause sospette, timbrature fuori sede) già evidenziate e risolvibili.",
          "A fine mese generi con un click un export XLSX nel formato utile alle paghe italiane — ore ordinarie e straordinari, ferie e permessi, totali per dipendente e sede — da consegnare al commercialista senza ricopiare nulla a mano.",
        ],
      },
      {
        heading: 'Prezzi trasparenti, pensati per le PMI',
        body: [
          "sonoQui parte da 24,99 €/mese per le aziende fino a 10 dipendenti (massimo 3 sedi) e 39,99 €/mese fino a 20 dipendenti (massimo 5 sedi). Tutta la rilevazione presenze è inclusa in entrambi i piani, senza costi nascosti; i moduli aggiuntivi (come Cantieri) sono opzionali e si pagano a consumo mensile.",
          "Con la fatturazione annuale hai 1 mese gratis. Oltre i limiti del piano aggiungi singoli dipendenti a 1,99 €/mese e sedi a 2,99 €/mese. Prezzi IVA esclusa; l'app è gratuita da scaricare e l'attivazione avviene su richiesta.",
        ],
      },
      {
        heading: 'Conforme al GDPR e alla normativa italiana',
        body: [
          "I dati sono cifrati in transito e a riposo e conservati su server nell'Unione Europea; quelli di ogni azienda sono isolati con Row Level Security e non sono mai visibili ad altre aziende. Le timbrature si conservano di default per 5 anni (configurabili fino a 10).",
          "La rilevazione della posizione avviene solo al momento della timbratura, senza riconoscimento facciale né dati biometrici, nel rispetto dell'art. 4 dello Statuto dei Lavoratori. Puoi anche gestire smart working e sedi multiple, con approvatori dedicati per singola sede.",
        ],
      },
    ],
    faq: [
      homeFaq.it[2], // export commercialista
      homeFaq.it[5], // sicurezza dati
      homeFaq.it[9], // prezzo
      homeFaq.it[11], // come iniziamo
    ],
    cta: {
      title: 'Prova sonoQui nella tua PMI',
      text: 'Compila il modulo di contatto: attiviamo noi la tua azienda e creiamo il primo account amministratore, in genere entro 1-2 giorni lavorativi.',
    },
  },
  {
    key: 'migliori-app-rilevazione-presenze',
    slug: 'migliori-app-rilevazione-presenze-2026',
    breadcrumb: 'Migliori app rilevazione presenze 2026',
    title: 'Migliori app di rilevazione presenze per PMI (2026) | sonoQui',
    description:
      'Guida 2026 alle app di rilevazione presenze per PMI italiane: i criteri per scegliere e una panoramica onesta delle soluzioni — sonoQui, Fluida, Factorial, Jibble, Dipendenti in Cloud e Zucchetti.',
    h1: 'Migliori app di rilevazione presenze per PMI italiane (2026)',
    intro:
      "Scegliere un'app di rilevazione presenze non significa cercare quella con più funzioni, ma quella che i tuoi dipendenti useranno davvero e che ti fa chiudere il mese senza fatica. Ecco i criteri che contano e una panoramica onesta delle soluzioni sul mercato italiano nel 2026, sonoQui inclusa.",
    highlights: [
      'I criteri di scelta che contano per una PMI',
      'Panoramica delle principali soluzioni italiane e internazionali',
      'Quando conviene sonoQui e quando un’altra soluzione',
    ],
    sections: [
      {
        heading: 'Come scegliere: i criteri che contano',
        body: [
          "Conformità normativa: l'app deve aiutarti a rispettare l'art. 4 dello Statuto dei Lavoratori e il GDPR, e a soddisfare l'obbligo (sentenza CGUE CCOO, 2019) di un sistema oggettivo e affidabile di misurazione dell'orario.",
          "Timbratura mobile e senza hardware: per una PMI la soluzione più sostenibile è la timbratura da smartphone, con verifica GPS della sede, senza badge fisici né lettori a muro.",
          "Gestione completa e export per le paghe: ferie, permessi, anomalie e soprattutto un export mensile nel formato utile al commercialista fanno la differenza sul tempo risparmiato. Infine il prezzo: chiaro, prevedibile e proporzionato ai numeri di una piccola azienda.",
        ],
      },
      {
        heading: 'sonoQui',
        body: [
          "Pensata specificamente per le PMI italiane: timbratura GPS al tap, gestione di ferie, permessi e anomalie, ed export XLSX pronto per il commercialista. Il focus è la conformità all'art. 4 (posizione solo al tap, nessun dato biometrico, GPS mascherato dopo 90 giorni) e un prezzo per fascia di dipendenti — da 24,99 €/mese, rilevazione presenze inclusa, senza hardware.",
        ],
      },
      {
        heading: 'Fluida',
        body: [
          "App italiana con forte focus sulla geolocalizzazione (Bluetooth, GPS, NFC), adatta a team distribuiti, lavoratori in mobilità e cantieri. Copre presenze, ferie e permessi e note spese, con listino a consumo per dipendente.",
        ],
      },
      {
        heading: 'Factorial',
        body: [
          "Piattaforma HR all-in-one di origine spagnola, molto diffusa tra le PMI in crescita. Oltre alla rilevazione presenze con geolocalizzazione al momento della timbratura, offre un ventaglio ampio di funzioni HR (buste paga, documenti, reportistica). Adatta a chi cerca una suite completa più che un singolo strumento presenze.",
        ],
      },
      {
        heading: 'Jibble',
        body: [
          "Soluzione internazionale con un piano gratuito, app mobile che funziona offline, geofencing e riconoscimento facciale. È un'opzione conveniente per piccole imprese e startup; valuta con attenzione l'uso del riconoscimento facciale alla luce dell'art. 4 e del GDPR nel contesto italiano.",
        ],
      },
      {
        heading: 'Dipendenti in Cloud',
        body: [
          "Piattaforma HR italiana molto diffusa tra commercialisti e consulenti del lavoro, integrata con diversi software di paghe italiani. Copre timbrature, ferie e documenti: una scelta naturale per gli studi che gestiscono più aziende clienti.",
        ],
      },
      {
        heading: 'Zucchetti HR Infinity',
        body: [
          "La suite HR completa del principale fornitore italiano di gestionali: rilevazione presenze, paghe, controllo accessi e molto altro. È la scelta tipica di medie e grandi aziende con esigenze articolate, più che della piccola impresa che cerca semplicità.",
        ],
      },
      {
        heading: 'In sintesi: qual è la scelta giusta',
        body: [
          "Non esiste un'app «migliore» in assoluto: dipende dai tuoi numeri e dalle tue priorità. Per una PMI italiana che vuole timbratura GPS senza hardware, conformità all'art. 4 ed export pronto per il commercialista, con un prezzo fisso e prevedibile, sonoQui è pensata esattamente per questo caso.",
          "Se ti serve una suite HR ampia (Factorial), un'integrazione stretta con lo studio paghe (Dipendenti in Cloud), o una piattaforma enterprise (Zucchetti), quelle soluzioni possono essere più adatte. L'importante è partire dai criteri, non dall'elenco di funzioni.",
        ],
      },
    ],
    faq: [
      {
        question: "Qual è la migliore app di rilevazione presenze per una PMI?",
        answer:
          "Dipende dai numeri e dalle priorità dell'azienda. Per una PMI italiana che cerca timbratura GPS da smartphone, conformità all'art. 4 ed export per il commercialista con un prezzo fisso, sonoQui è pensata per questo scenario. Aziende più grandi o con esigenze HR ampie possono trovarsi meglio con suite come Factorial o Zucchetti.",
      },
      {
        question: "Serve un badge o un hardware dedicato per timbrare?",
        answer:
          "No, con le soluzioni mobili come sonoQui i dipendenti timbrano dal proprio smartphone, con verifica GPS della sede. Non servono badge fisici né lettori a muro, azzerando i costi di installazione e manutenzione.",
      },
      {
        question: "La timbratura GPS è conforme all'art. 4 dello Statuto dei Lavoratori?",
        answer:
          "Può esserlo se la posizione viene rilevata solo al momento della timbratura, senza tracciamento continuo né dati biometrici, e se il datore di lavoro rispetta gli obblighi dell'art. 4 (accordo sindacale o autorizzazione dell'Ispettorato del Lavoro). sonoQui è progettata con questi vincoli in mente.",
      },
      {
        question: "Quanto costa un'app di rilevazione presenze?",
        answer:
          "I modelli variano tra prezzo per dipendente e prezzo per fascia. sonoQui parte da 24,99 €/mese fino a 10 dipendenti e 39,99 €/mese fino a 20, con la rilevazione presenze inclusa e nessun costo hardware; eventuali moduli aggiuntivi sono opzionali. Altre soluzioni adottano listini a consumo per dipendente.",
      },
    ],
    cta: {
      title: 'Cerchi la rilevazione presenze giusta per la tua PMI?',
      text: 'Prova sonoQui: timbratura GPS, gestione presenze completa ed export per il commercialista, a un prezzo fisso e trasparente.',
    },
    itemList: ['sonoQui', 'Fluida', 'Factorial', 'Jibble', 'Dipendenti in Cloud', 'Zucchetti HR Infinity'],
  },
];

export const getContentPages = () => contentPages;
export const getContentPage = (slug: string) =>
  contentPages.find((page) => page.slug === slug);

// Internal links to the content pages, for footer / cross-linking.
export const contentPageLinks = contentPages.map((page) => ({
  href: `/it/${page.slug}/`,
  label: page.breadcrumb,
}));

// Structured data for a content page: WebPage + Breadcrumb + Organization + FAQ,
// plus an ItemList on the buyer-guide page.
export function buildContentPageSchemas(page: ContentPage) {
  const url = `${SITE_URL}/it/${page.slug}/`;
  const webPage = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    description: page.description,
    url,
    inLanguage: 'it-IT',
    isPartOf: { '@type': 'WebSite', name: 'sonoQui', url: SITE_URL },
    about: buildOrganizationSchema(),
    primaryImageOfPage: { '@type': 'ImageObject', url: `${SITE_URL}${DEFAULT_IMAGE}` },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/it/` },
      { '@type': 'ListItem', position: 2, name: page.breadcrumb, item: url },
    ],
  };
  const nodes: Record<string, unknown>[] = [
    webPage,
    breadcrumb,
    buildOrganizationSchema(),
    faqPageSchema(page.faq),
  ];
  if (page.itemList) {
    nodes.push({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: page.title,
      itemListElement: page.itemList.map((name, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name,
      })),
    });
  }
  return nodes;
}
