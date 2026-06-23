import type { Lang } from '../i18n/ui';

export const SITE_URL = 'https://sonoqui.pro';
export const APP_STORE_URL = 'https://apps.apple.com/it/app/sonoqui/id6772960002';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=app.sonoqui.mobile';
export const WEB_APP_URL = 'https://app.sonoqui.pro/login';
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
      question: "Cosa succede se il dipendente non ha campo o internet?",
      answer:
        "La timbratura non va persa: viene messa in coda e inviata automaticamente appena il telefono torna online, anche dopo aver chiuso l'app. Un sistema anti-doppioni evita timbrature duplicate. Utile per cantieri, trasferte e zone senza copertura.",
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
        "Il prezzo dipende dal numero di dipendenti e dalle funzioni attivate. Non c'è una registrazione pubblica con prezzo a listino: ti prepariamo un preventivo su misura per la tua azienda. Compila il modulo di contatto qui sotto indicando quanti dipendenti gestisci e ti rispondiamo con una proposta, in genere entro 1-2 giorni lavorativi.",
    },
    {
      question: "Come iniziamo a usare sonoQui?",
      answer:
        "Non c'è registrazione pubblica: attiviamo noi l'azienda e creiamo il primo account amministratore. Da lì inviti i dipendenti, configuri sedi e orari e sei operativo. Compila il modulo di contatto qui sotto e ti rispondiamo al più presto, in genere entro 1-2 giorni lavorativi.",
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
      'Funziona offline con coda di sincronizzazione',
      "Conforme all'art. 4 dello Statuto dei Lavoratori e al GDPR",
    ],
    screenshot: [
      { '@type': 'ImageObject', url: `${SITE_URL}/screenshots/timbra.png`, caption: 'Timbra in un tap' },
      { '@type': 'ImageObject', url: `${SITE_URL}/screenshots/storico.png`, caption: 'Storico delle timbrature' },
      { '@type': 'ImageObject', url: `${SITE_URL}/screenshots-web/dashboard.png`, caption: 'Dashboard amministratori' },
    ],
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
      description: 'App gratuita da scaricare; attivazione del servizio su richiesta. Preventivo su misura per la tua azienda.',
      url: `${SITE_URL}/it/#contact`,
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
export function buildFaqSchema(lang: Lang) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: 'it-IT',
    mainEntity: homeFaq[lang].map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
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
