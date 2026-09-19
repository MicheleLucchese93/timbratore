import type { Lang } from '../i18n/ui';
import { contentRevision } from './revisions.mjs';

export const SITE_URL = 'https://sonoqui.pro';
// Stable identifiers for the site-wide entity nodes. Every page emits the full
// Organization/WebSite once and references them by @id everywhere else
// (publisher, author, about, isPartOf) — one entity, not nine look-alike copies.
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const APP_STORE_URL = 'https://apps.apple.com/it/app/sonoqui/id6772960002';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=app.sonoqui.mobile';
export const WEB_APP_URL = 'https://app.sonoqui.pro/login';
// Self-service registration (step 1 of the signup flow; the rest happens in the
// web app). Pricing CTAs append ?piano=free|piccola|media.
export const SIGNUP_PATH = '/it/registrazione/';
// Reseller console (partner program). Existing partners log in here.
export const PARTNER_APP_URL = 'https://partners.sonoqui.pro';

// Legal identity of the seller (Specs/SELF_SERVICE_BILLING.md, decision D16):
// Idealcopy S.r.l. sells the service, holds the Stripe account and issues the
// fatture. Rendered in the footer and on the legal pages (D.Lgs. 70/2003 art. 7,
// art. 2250 c.c., GDPR art. 13) — and deliberately NOT in the Organization
// JSON-LD (see Specs/WEBSITE_SEO_GEO.md). The bracketed values are VISIBLE
// placeholders until the company data arrives: fill them here, once, and every
// page follows. Go-live blocker: no payment may be taken while any is left.
export const SELLER = {
  name: 'Idealcopy S.r.l.',
  street: 'Viale della Fiera 6/B',
  cap: '[CAP da inserire]', // TODO(legal): CAP della sede legale
  city: 'Verona',
  province: 'VR',
  vatNumber: '[P.IVA da inserire]', // TODO(legal): Partita IVA
  taxCode: '[C.F. da inserire]', // TODO(legal): codice fiscale (se diverso dalla P.IVA)
  rea: '[REA da inserire]', // TODO(legal): numero REA, es. "VR-000000"
  shareCapital: '[capitale sociale da inserire]', // TODO(legal): capitale sociale ("… € i.v." se interamente versato)
  pec: '[PEC da inserire]', // TODO(legal): indirizzo PEC
} as const;
export const SELLER_ADDRESS = `${SELLER.street}, ${SELLER.cap} ${SELLER.city} (${SELLER.province})`;
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

// The self-service registration page (/it/registrazione/).
export const signupMeta: Record<Lang, { title: string; description: string }> = {
  it: {
    title: 'Registrati gratis | sonoQui, rilevazione presenze per PMI',
    description:
      'Registra gratis la tua azienda su sonoQui: piano gratuito per sempre fino a 3 utenti e 1 sede, senza carta di credito. Bastano nome ed email per iniziare.',
  },
};

// Per-page meta descriptions for the legal pages, so each indexable URL gets a
// unique description instead of inheriting the BaseLayout default (duplicate meta).
export const legalMeta: Record<string, { it: string }> = {
  'privacy-policy': {
    it: 'Informativa privacy di sonoQui: titolare Idealcopy S.r.l., dati di registrazione, timbratura e fatturazione, GPS solo al momento del tap, basi giuridiche e diritti GDPR.',
  },
  'cookie-policy': {
    it: 'Cookie policy di sonoQui: quali cookie e tecnologie usiamo su sonoqui.pro, finalità, durata e come gestire il consenso. Cookie analitici solo previo consenso.',
  },
  'termini-e-condizioni': {
    it: 'Termini e condizioni di sonoQui per le aziende: registrazione, piano gratuito, abbonamenti con rinnovo automatico, moduli, pagamenti, fattura elettronica e disdetta.',
  },
  eula: {
    it: "EULA di sonoQui: contratto di licenza d'uso dell'app mobile e della dashboard web per i dipendenti, permessi del dispositivo, limitazioni e durata della licenza.",
  },
  dpa: {
    it: "Accordo sul trattamento dei dati (art. 28 GDPR) tra l'azienda cliente e Idealcopy S.r.l. per sonoQui: dati trattati, misure di sicurezza, sub-responsabili e data breach.",
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
        "sonoQui è progettata nel rispetto dell'art. 4: rileva la posizione solo al momento della timbratura, mai in continuo, e non utilizza riconoscimento facciale né dati biometrici. Le coordinate GPS non vengono conservate: la posizione è letta solo nell'istante della timbratura per verificare se il dipendente è nell'area della sede, e subito scartata. Sulla timbratura restano sede, data e ora. L'attivazione resta comunque subordinata agli obblighi dell'art. 4 a carico del datore di lavoro (accordo sindacale aziendale o autorizzazione dell'Ispettorato Territoriale del Lavoro).",
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
        "Le timbrature sono conservate per 5 anni di default (configurabili fino a 10). Le coordinate GPS non vengono conservate affatto: la posizione è letta solo nell'istante della timbratura, per verificare se il dipendente è nell'area della sede, e subito scartata. Sulla timbratura restano sede, data e ora, più i contrassegni «fuori area» (con la distanza dalla sede) e «posizione sospetta». Puoi richiedere la cancellazione anticipata in qualsiasi momento.",
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
        "sonoQui è gratuita per sempre fino a 3 utenti (amministratore compreso) e 1 sede. Quando cresci, il piano Piccola costa 24,99 €/mese fino a 10 dipendenti e 3 sedi, il piano Media 39,99 €/mese fino a 20 dipendenti e 5 sedi; con la fatturazione annuale hai 1 mese gratis. Tutta la rilevazione presenze è inclusa in ogni piano, senza costi nascosti. I moduli aggiuntivi Cantieri e API sono facoltativi e costano 50 €/mese ciascuno. Oltre i limiti dei piani, dipendenti (1,99 €/mese) e sedi (2,99 €/mese) aggiuntivi si concordano su richiesta. Prezzi IVA esclusa; l'app è gratuita da scaricare.",
    },
    {
      question: "C'è un piano gratuito?",
      answer:
        "Sì. Il piano Gratuito non scade e comprende tutta la rilevazione presenze per 3 utenti in totale, amministratore compreso (quindi tu più 2 collaboratori), e 1 sede. Non serve la carta di credito: registri l'azienda dal sito con nome ed email e inizi subito. Quando l'azienda cresce passi al piano Piccola o Media direttamente dall'app, senza perdere nessun dato.",
    },
    {
      question: "Cosa sono i moduli aggiuntivi?",
      answer:
        "Oltre alla rilevazione presenze (inclusa in ogni piano), sonoQui offre moduli opzionali per esigenze specifiche di settore. Oggi sono due. Cantieri: gli addetti registrano dal telefono le attività di cantiere (tempo di viaggio, ore di lavoro, mezzi e campi su misura) e l'azienda ottiene report mensili per cantiere in PDF o via email. API: l'azienda crea chiavi di accesso con cui i propri sistemi — gestionale del personale, tornelli e lettori badge, strumenti di analisi — leggono e scrivono i dati di sonoQui senza inserimenti manuali, con permessi separati per tipo di dato e ogni operazione tracciata nel registro attività. Ogni modulo costa 50 €/mese + IVA e si aggiunge a qualsiasi piano, anche a quello gratuito. Possiamo anche sviluppare moduli su misura per il tuo settore.",
    },
    {
      question: "Come si attivano i moduli e quanto costano?",
      answer:
        "Ogni modulo, Cantieri o API, costa 50 €/mese + IVA. Lo attiva l'amministratore in autonomia da Impostazioni, nella dashboard web, con qualsiasi piano, anche quello gratuito: paghi con carta e il modulo è subito disponibile. Si rinnova ogni mese e lo disattivi quando vuoi, con effetto alla fine del mese già pagato. Se la tua azienda è seguita da un partner sonoQui, i moduli li attiva il partner.",
    },
    {
      question: "Come si paga? Ricevo la fattura elettronica?",
      answer:
        "Piani e moduli a pagamento si acquistano dall'app e si pagano con carta tramite Stripe, in anticipo per il mese o l'anno scelto; l'abbonamento si rinnova automaticamente finché non lo disdici. Per i pagamenti ricevi la fattura elettronica tramite il Sistema di Interscambio (SdI), emessa da Idealcopy S.r.l., la società che commercializza sonoQui: basta indicare nell'app il codice destinatario SDI o la PEC dell'azienda. I prezzi sono IVA esclusa: l'IVA al 22% si aggiunge al momento del pagamento.",
    },
    {
      question: "Posso disdire l'abbonamento?",
      answer:
        "Sì, quando vuoi, direttamente dall'app. La disdetta ha effetto alla fine del periodo già pagato, mensile o annuale: fino ad allora il piano resta attivo, poi l'azienda torna al piano gratuito senza perdere i dati. Non sono previsti rimborsi per il periodo in corso. Se a quel punto hai più utenti o sedi di quelli del piano gratuito, hai 14 giorni per rientrare nei limiti prima che le esportazioni vengano sospese; la timbratura non viene mai bloccata.",
    },
    {
      question: "Come iniziamo a usare sonoQui?",
      answer:
        "Registri l'azienda gratis dal sito con nome ed email, confermi l'indirizzo dal link che ti inviamo e scegli la password. Nell'app inserisci la Partita IVA (recuperiamo ragione sociale e indirizzo dal VIES) e sei operativo con il piano gratuito; se hai scelto Piccola o Media completi il pagamento con carta. Poi crei la sede, inviti i dipendenti e imposti gli orari: loro scaricano l'app gratuita da App Store o Google Play e iniziano a timbrare.",
    },
  ],
};

// Content pages quote a few homepage answers verbatim (the canonical ones).
// Looked up by question, never by array index: an index silently pointed at the
// wrong answer once a new FAQ was inserted above it, while a renamed question
// here fails the build instead.
function homeFaqItem(question: string): FaqItem {
  const item = homeFaq.it.find((faq) => faq.question === question);
  if (!item) throw new Error(`homeFaq has no question "${question}" — update the content page reference`);
  return item;
}

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
        "Sì. Dalla console attivi e disattivi i moduli aggiuntivi (Cantieri e API) per ogni singola azienda cliente, in autonomia. I moduli si fatturano a consumo mensile in aggiunta all'abbonamento e li rivendi al cliente finale con il tuo margine.",
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
    '@id': ORGANIZATION_ID,
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
    '@id': WEBSITE_ID,
    name: 'sonoQui',
    url: SITE_URL,
    inLanguage: 'it-IT',
    publisher: { '@id': ORGANIZATION_ID },
  };
}

// A recurring net price per month: every paid price on the site is IVA esclusa.
function monthlyPrice(price: string) {
  return {
    '@type': 'UnitPriceSpecification',
    price,
    priceCurrency: 'EUR',
    unitCode: 'MON',
    unitText: 'mese',
    referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' },
    valueAddedTaxIncluded: false,
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
      'Piano gratuito per sempre fino a 3 utenti e 1 sede',
      'Moduli opzionali Cantieri e API (50 €/mese ciascuno)',
      "Conforme all'art. 4 dello Statuto dei Lavoratori e al GDPR",
    ],
    screenshot: [
      { '@type': 'ImageObject', url: `${SITE_URL}/screenshots/timbra.png`, caption: 'Timbra in un tap' },
      { '@type': 'ImageObject', url: `${SITE_URL}/screenshots/storico.png`, caption: 'Storico delle timbrature' },
      { '@type': 'ImageObject', url: `${SITE_URL}/screenshots-web/dashboard.png`, caption: 'Dashboard amministratori' },
    ],
    // AggregateOffer summarises the range; the named offers live in an
    // OfferCatalog. An Offer has no `offers` property in the vocabulary, so the
    // plans used to be nested somewhere every parser silently dropped. The
    // summary covers exactly the five catalog offers below (Free 0 € … a
    // module at 50 €/month): keep lowPrice/highPrice/offerCount in step with it.
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'EUR',
      lowPrice: '0',
      highPrice: '50.00',
      offerCount: 5,
      url: `${SITE_URL}/it/#pricing`,
      description: 'Piano gratuito per sempre fino a 3 utenti e 1 sede; piani Piccola (24,99 €/mese) e Media (39,99 €/mese) con tutta la rilevazione presenze inclusa e fatturazione annuale con 1 mese gratis. Moduli opzionali Cantieri e API a 50 €/mese ciascuno. Dipendenti e sedi aggiuntivi su richiesta. Prezzi IVA esclusa.',
    },
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Piani e moduli sonoQui',
      itemListElement: [
        {
          '@type': 'Offer',
          name: 'Gratuito',
          price: '0',
          priceCurrency: 'EUR',
          description: 'Gratis per sempre: fino a 3 utenti (amministratore compreso) e 1 sede, rilevazione presenze completa inclusa. Nessuna carta richiesta.',
          url: `${SITE_URL}/it/#pricing`,
        },
        {
          '@type': 'Offer',
          name: 'Piccola',
          price: '24.99',
          priceCurrency: 'EUR',
          priceSpecification: monthlyPrice('24.99'),
          description: 'Fino a 10 dipendenti, massimo 3 sedi. Rilevazione presenze completa inclusa, al mese.',
          url: `${SITE_URL}/it/#pricing`,
        },
        {
          '@type': 'Offer',
          name: 'Media',
          price: '39.99',
          priceCurrency: 'EUR',
          priceSpecification: monthlyPrice('39.99'),
          description: 'Fino a 20 dipendenti, massimo 5 sedi. Rilevazione presenze completa inclusa, al mese.',
          url: `${SITE_URL}/it/#pricing`,
        },
        {
          '@type': 'Offer',
          name: 'Modulo Cantieri',
          price: '50.00',
          priceCurrency: 'EUR',
          priceSpecification: monthlyPrice('50.00'),
          description: 'Modulo aggiuntivo per le attività di cantiere, attivabile da Impostazioni con qualsiasi piano, anche gratuito. Abbonamento mensile.',
          url: `${SITE_URL}/it/#moduli`,
        },
        {
          '@type': 'Offer',
          name: 'Modulo API',
          price: '50.00',
          priceCurrency: 'EUR',
          priceSpecification: monthlyPrice('50.00'),
          description: 'Modulo aggiuntivo per integrare gestionali, tornelli e strumenti di analisi, attivabile da Impostazioni con qualsiasi piano, anche gratuito. Abbonamento mensile.',
          url: `${SITE_URL}/it/#moduli`,
        },
      ],
    },
    publisher: { '@id': ORGANIZATION_ID },
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
  const revision = contentRevision('partner');
  const webPage = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: meta.title,
    description: meta.description,
    url,
    inLanguage: 'it-IT',
    datePublished: revision.published,
    dateModified: revision.updated,
    isPartOf: { '@id': WEBSITE_ID },
    about: { '@id': ORGANIZATION_ID },
    publisher: { '@id': ORGANIZATION_ID },
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
  return [webPage, breadcrumb, buildOrganizationSchema(), buildWebSiteSchema(), faqPageSchema(partnerFaq[lang])];
}

// Body sections for the partner page, rendered by src/pages/it/partner.astro
// between the hero and the FAQ. The page used to be badge + lead + six short
// Q&As (~566 words), under the ~800-word floor for a solution page and thin on
// the questions a commercialista actually arrives with.
export const partnerSections: Record<Lang, ContentSection[]> = {
  it: [
    {
      heading: 'A chi è rivolto il programma partner',
      body: [
        "Il programma partner sonoQui è pensato per chi segue già le piccole e medie imprese italiane sul fronte del personale e vuole aggiungere la rilevazione presenze ai propri servizi senza sviluppare o mantenere un prodotto: commercialisti e consulenti del lavoro che gestiscono le paghe di più aziende, software house e agenzie IT che offrono soluzioni gestionali, system integrator che seguono i clienti nella digitalizzazione.",
        "In tutti questi casi il rapporto commerciale resta tuo: il cliente conosce te, tu conosci le sue esigenze, e sonoQui è lo strumento con cui rispondi alla domanda «come rileviamo le presenze in modo conforme e senza hardware?». Non serve una struttura tecnica dedicata, né un volume minimo di aziende per iniziare.",
      ],
    },
    {
      heading: "Come funziona l'attivazione di un cliente",
      body: [
        "Dalla console partner su partners.sonoqui.pro crei l'azienda cliente, imposti i limiti del piano (dipendenti e sedi) e generi il primo account amministratore. Da quel momento il cliente invita i dipendenti, configura sedi e orari e inizia a timbrare dall'app; tu mantieni la visione d'insieme di tutte le aziende che gestisci.",
        "Le operazioni ricorrenti — sospendere o riattivare un servizio, alzare i limiti, attivare o disattivare i moduli aggiuntivi Cantieri e API per una singola azienda — le fai in autonomia dalla stessa console, senza dover passare da noi per ogni richiesta. Infrastruttura, aggiornamenti, sicurezza e backup restano a carico di sonoQui.",
      ],
    },
    {
      heading: 'Margine e fatturazione',
      body: [
        "Il modello è semplice: sonoQui fattura a te il servizio a un prezzo riservato ai partner, e tu fatturi il cliente finale al prezzo che decidi. Il margine è ricorrente, mese dopo mese, e cresce con i volumi grazie a uno sconto incrementale a scaglioni: più aziende gestisci, più il prezzo partner scende.",
        "I moduli aggiuntivi seguono la stessa logica — li attivi per il singolo cliente, si fatturano a consumo mensile in aggiunta all'abbonamento e li rivendi con il tuo margine. Le condizioni economiche complete vengono illustrate nella chiamata di attivazione del partner, che di norma fissiamo entro 1-2 giorni lavorativi dalla richiesta.",
      ],
    },
  ],
};

// Structured data for the registration page. No dates on purpose: the page
// shows none, and a schema date with no visible counterpart is exactly what the
// revisions registry exists to prevent (the sitemap still reads the registry).
export function buildSignupSchemas(lang: Lang) {
  const meta = signupMeta[lang];
  const url = `${SITE_URL}${SIGNUP_PATH}`;
  const webPage = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': url,
    name: meta.title,
    description: meta.description,
    url,
    inLanguage: 'it-IT',
    isPartOf: { '@id': WEBSITE_ID },
    about: { '@id': ORGANIZATION_ID },
    publisher: { '@id': ORGANIZATION_ID },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/it/` },
      { '@type': 'ListItem', position: 2, name: 'Registrazione', item: url },
    ],
  };
  return [webPage, breadcrumb, buildOrganizationSchema(), buildWebSiteSchema()];
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

// `id` gives a section a stable in-page anchor (the buyer guide's per-tool
// headings), which the ItemList JSON-LD and the comparison table link to.
export type ContentSection = { heading: string; body: string[]; id?: string };
// A primary source the page's legal/statistical claims can be checked against.
// Rendered as a "Fonti" list; the whole point is that a reader (or an AI
// answer engine) can verify the claim without trusting us.
export type ContentSource = { label: string; url: string };
export type ComparisonRow = { name: string; anchor: string; cells: string[] };
export type Comparison = { caption: string; columns: string[]; rows: ComparisonRow[]; note?: string };
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
  // Page-specific social/preview image; falls back to the site default.
  image?: string;
  sources?: ContentSource[];
  // Structured comparison rendered as a real <table> (buyer-guide page only).
  comparison?: Comparison;
  // Tool names for the ItemList node (buyer-guide page only). Each must match a
  // section `id` so the list items can deep-link into the page.
  itemList?: { name: string; anchor: string }[];
};

export const contentPages: ContentPage[] = [
  {
    key: 'timbratura-gps-app',
    slug: 'timbratura-gps-app',
    breadcrumb: 'Timbratura GPS',
    title: 'App di timbratura GPS: timbra il cartellino dallo smartphone | sonoQui',
    description:
      "App di timbratura GPS per PMI italiane: i dipendenti timbrano il cartellino dallo smartphone, con la posizione verificata solo al tap. Nel rispetto dell'art. 4. Gratis fino a 3 utenti.",
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
        heading: "La timbratura GPS è conforme all'art. 4 dello Statuto dei Lavoratori?",
        body: [
          "sonoQui è progettata nel rispetto dell'art. 4 dello Statuto dei Lavoratori (Legge 20 maggio 1970, n. 300): rileva la posizione del dipendente solo al momento del tap su «Timbra», mai in modo continuativo, e non utilizza riconoscimento facciale né altri dati biometrici. Le coordinate GPS non vengono conservate: la posizione è letta una sola volta, nell'istante della timbratura, per verificare che il dipendente si trovi nell'area della sede di lavoro (raggio configurabile da 50 a 1500 metri), e viene subito scartata; sulla timbratura restano solo sede, data e ora. L'uso della localizzazione resta comunque subordinato agli obblighi che l'art. 4 impone al datore di lavoro: un accordo con le rappresentanze sindacali aziendali oppure, in mancanza, l'autorizzazione dell'Ispettorato Territoriale del Lavoro competente. È uno strumento pensato per aiutarti a rispettare la norma, non per aggirarla.",
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
    // Two entries are shared with the homepage on purpose (they are the
    // canonical answers); the pricing and onboarding ones are phrased for this
    // page so the same 130 words are not indexed verbatim on three URLs.
    faq: [
      homeFaqItem('Come funziona la timbratura GPS?'),
      homeFaqItem('Che succede se un dipendente si dimentica di timbrare?'),
      {
        question: 'Quanto costa la timbratura GPS con sonoQui?',
        answer:
          "La timbratura GPS è inclusa in ogni piano, senza hardware da acquistare, ed è gratuita per sempre fino a 3 utenti e 1 sede. Oltre si passa a 24,99 €/mese fino a 10 dipendenti e 3 sedi, oppure 39,99 €/mese fino a 20 dipendenti e 5 sedi (IVA esclusa), con 1 mese gratis se paghi annualmente. Dipendenti e sedi oltre i limiti del piano si aggiungono su richiesta. L'app è gratuita da scaricare per i dipendenti.",
      },
      {
        question: 'Serve una registrazione per iniziare a timbrare?',
        answer:
          "Solo per l'azienda, e bastano pochi minuti: l'amministratore la registra gratis dal sito sonoqui.pro con nome ed email, conferma l'indirizzo e inserisce la Partita IVA nell'app. Poi invita i dipendenti, che non devono registrarsi: scaricano l'app gratuita da App Store o Google Play, accedono con l'invito ricevuto e iniziano a timbrare.",
      },
    ],
    cta: {
      title: 'Porta la timbratura nello smartphone dei tuoi dipendenti',
      text: "Registra la tua azienda gratis: fino a 3 utenti non paghi nulla, per sempre, e non serve la carta di credito. L'app è gratuita da scaricare per i dipendenti.",
    },
    image: '/screenshots/timbra.png',
    sources: [
      { label: 'Art. 4, Legge 20 maggio 1970, n. 300 (Statuto dei Lavoratori) — Normattiva', url: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1970-05-20;300~art4' },
      { label: 'Regolamento (UE) 2016/679 (GDPR) — EUR-Lex', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita' },
    ],
  },
  {
    key: 'rilevazione-presenze-pmi',
    slug: 'rilevazione-presenze-pmi',
    breadcrumb: 'Rilevazione presenze per PMI',
    title: 'Software di rilevazione presenze per PMI italiane | sonoQui',
    description:
      'Software di rilevazione presenze dipendenti pensato per le PMI italiane: timbratura GPS, ferie, permessi, anomalie ed export per il commercialista. Gratis fino a 3 utenti, poi da 24,99 €/mese.',
    h1: 'Il software di rilevazione presenze pensato per le PMI italiane',
    intro:
      "sonoQui è il sistema di rilevazione presenze su misura per le piccole e medie imprese italiane: semplice per chi timbra, completo per chi amministra e già pronto per il commercialista. Tutta la rilevazione presenze è inclusa in ogni piano; i moduli aggiuntivi — Cantieri e API — sono opzionali.",
    highlights: [
      'Timbratura, ferie, permessi e anomalie in un’unica app',
      'Export XLSX mensile pronto per le paghe italiane',
      'Gratis fino a 3 utenti, poi da 24,99 €/mese per fascia di dipendenti',
    ],
    sections: [
      {
        heading: 'Perché una PMI ha bisogno di un sistema di rilevazione presenze?',
        body: [
          "Dal 14 maggio 2019 le PMI italiane sono obbligate per legge a un sistema oggettivo di rilevazione dell'orario di lavoro: i fogli presenze cartacei e i file Excel non firmati non bastano più come documentazione. Lo stabilisce la sentenza della Corte di Giustizia dell'Unione Europea nella causa C-55/18 (caso CCOO), che impone ai datori di lavoro uno strumento oggettivo, affidabile e accessibile per misurare l'orario di ciascun dipendente. In Italia questo obbligo si affianca a quelli dell'art. 4 dello Statuto dei Lavoratori quando la rilevazione utilizza strumenti come il GPS. Per una piccola o media impresa, rispettarlo non richiede una suite HR complessa: basta un'app di rilevazione presenze — come sonoQui — che i dipendenti usino davvero ogni giorno e che produca un documento verificabile, pronto per il commercialista, senza rincorrere firme cartacee o fogli Excel a fine mese.",
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
          "sonoQui è gratuita per sempre fino a 3 utenti (amministratore compreso) e 1 sede, senza carta di credito: le micro-imprese possono usarla senza costi. Quando cresci, il piano Piccola costa 24,99 €/mese fino a 10 dipendenti (massimo 3 sedi) e il piano Media 39,99 €/mese fino a 20 dipendenti (massimo 5 sedi). Tutta la rilevazione presenze è inclusa in ogni piano, senza costi nascosti; i moduli aggiuntivi Cantieri e API sono opzionali e costano 50 €/mese ciascuno.",
          "Con la fatturazione annuale hai 1 mese gratis e oltre i limiti del piano puoi concordare dipendenti (1,99 €/mese) e sedi (2,99 €/mese) aggiuntivi. Ti registri online in pochi minuti, paghi con carta e ricevi la fattura elettronica; disdici quando vuoi, con effetto a fine periodo. Prezzi IVA esclusa; l'app è gratuita da scaricare.",
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
      homeFaqItem('Posso esportare i dati per il commercialista?'),
      homeFaqItem('I miei dati sono al sicuro?'),
      {
        question: 'Quanto costa un software di rilevazione presenze per una PMI?',
        answer:
          "Con sonoQui il prezzo è per fascia di dipendenti, non per singola funzione: gratis per sempre fino a 3 utenti e 1 sede, poi 24,99 €/mese fino a 10 dipendenti e 3 sedi o 39,99 €/mese fino a 20 dipendenti e 5 sedi, IVA esclusa, con tutta la rilevazione presenze inclusa. Se paghi annualmente un mese è gratis; oltre i limiti del piano un dipendente costa 1,99 €/mese e una sede 2,99 €/mese. Non servono badge, totem o altro hardware.",
      },
      homeFaqItem('Come iniziamo a usare sonoQui?'),
    ],
    cta: {
      title: 'Prova sonoQui gratis nella tua PMI',
      text: 'Registra la tua azienda in pochi minuti: il piano gratuito include fino a 3 utenti e 1 sede, per sempre e senza carta di credito. Quando cresci, passi a un piano a pagamento dall’app.',
    },
    image: '/screenshots-web/dashboard.png',
    sources: [
      { label: 'CGUE, causa C-55/18, Federación de Servicios de Comisiones Obreras (CCOO) c. Deutsche Bank, sentenza del 14 maggio 2019 — EUR-Lex', url: 'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:62018CJ0055' },
      { label: 'Art. 4, Legge 20 maggio 1970, n. 300 (Statuto dei Lavoratori) — Normattiva', url: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1970-05-20;300~art4' },
      { label: 'Regolamento (UE) 2016/679 (GDPR) — EUR-Lex', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita' },
    ],
  },
  {
    key: 'migliori-app-rilevazione-presenze',
    slug: 'migliori-app-rilevazione-presenze-2026',
    breadcrumb: 'Migliori app rilevazione presenze 2026',
    title: 'Migliori app rilevazione presenze per PMI: confronto 2026 | sonoQui',
    description:
      'Confronto 2026 tra le 6 app di rilevazione presenze più usate dalle PMI italiane — sonoQui, Fluida, Factorial, Jibble, Dipendenti in Cloud e Zucchetti — con tabella, criteri di scelta e per chi è adatta ciascuna.',
    h1: 'Le 6 migliori app di rilevazione presenze per PMI italiane: confronto 2026',
    // The verdict comes first: an AI answer engine or a skimming reader gets
    // the conditional recommendation in the opening sentence instead of after
    // eight sections. The "how to choose" framing follows.
    intro:
      "Per una PMI italiana che vuole timbratura GPS da smartphone senza hardware, conformità all'art. 4 dello Statuto dei Lavoratori ed export pronto per il commercialista a un prezzo fisso, sonoQui è l'app pensata esattamente per questo caso: gratuita fino a 3 utenti, poi da 24,99 €/mese. Se invece servono una suite HR completa, un'integrazione stretta con lo studio paghe o una piattaforma enterprise, Factorial, Dipendenti in Cloud o Zucchetti possono essere scelte più adatte. Qui sotto i criteri che contano, una tabella di confronto e una scheda onesta per ciascuna delle sei soluzioni.",
    highlights: [
      'I criteri di scelta che contano per una PMI',
      'Tabella di confronto tra le 6 soluzioni principali',
      'Per chi è adatta ciascuna app, sonoQui inclusa',
    ],
    sections: [
      {
        heading: 'Come scegliere: i criteri che contano',
        body: [
          "Conformità normativa: l'app deve aiutarti a rispettare l'art. 4 dello Statuto dei Lavoratori (Legge 300/1970) e il GDPR, e a soddisfare l'obbligo — fissato dalla Corte di Giustizia UE nella causa C-55/18 (caso CCOO, 14 maggio 2019) — di un sistema oggettivo, affidabile e accessibile di misurazione dell'orario di lavoro.",
          "Timbratura mobile e senza hardware: per una PMI la soluzione più sostenibile è la timbratura da smartphone, con verifica GPS della sede, senza badge fisici né lettori a muro.",
          "Gestione completa e export per le paghe: ferie, permessi, anomalie e soprattutto un export mensile nel formato utile al commercialista fanno la differenza sul tempo risparmiato. Infine il prezzo: chiaro, prevedibile e proporzionato ai numeri di una piccola azienda.",
        ],
      },
      {
        heading: 'Come abbiamo valutato le soluzioni',
        body: [
          "Abbiamo confrontato le sei soluzioni sui quattro criteri sopra, usando le informazioni che ciascun fornitore pubblica nelle proprie pagine ufficiali (schede prodotto, listini, documentazione) consultate a settembre 2026. Dove un dato non è dichiarato pubblicamente — per esempio il prezzo di alcune suite, disponibile solo su preventivo — lo indichiamo come «n.d.» invece di stimarlo.",
          "Una premessa doverosa: sonoQui è il nostro prodotto. Per questo la scheda di ciascun concorrente riporta i punti di forza reali e il tipo di azienda per cui è la scelta migliore, anche quando quell'azienda non siamo noi. Le informazioni sui fornitori terzi possono cambiare: verifica sempre i listini aggiornati prima di decidere.",
        ],
      },
      {
        id: 'sonoqui',
        heading: 'sonoQui',
        body: [
          "Pensata specificamente per le PMI italiane: timbratura GPS al tap, gestione di ferie, permessi e anomalie, ed export XLSX pronto per il commercialista. Il focus è la conformità all'art. 4 (posizione solo al tap, nessun dato biometrico, coordinate GPS mai conservate) e un prezzo per fascia di dipendenti — gratis fino a 3 utenti, poi da 24,99 €/mese, rilevazione presenze inclusa, senza hardware.",
          "Per chi è: aziende fino a circa 20 dipendenti che vogliono uno strumento semplice per chi timbra e completo per chi amministra, con un costo mensile fisso. La registrazione è self-service e il piano gratuito, senza scadenza, basta alle micro-imprese fino a 3 utenti e 1 sede.",
        ],
      },
      {
        id: 'fluida',
        heading: 'Fluida',
        body: [
          "App italiana con forte focus sulla geolocalizzazione (Bluetooth, GPS, NFC), adatta a team distribuiti, lavoratori in mobilità e cantieri. Copre presenze, ferie e permessi e note spese, con listino a consumo per dipendente.",
          "Per chi è: aziende con personale in movimento o su più sedi che vogliono più modalità di timbratura e non temono un costo che cresce con ogni dipendente.",
        ],
      },
      {
        id: 'factorial',
        heading: 'Factorial',
        body: [
          "Piattaforma HR all-in-one di origine spagnola, molto diffusa tra le PMI in crescita. Oltre alla rilevazione presenze con geolocalizzazione al momento della timbratura, offre un ventaglio ampio di funzioni HR (buste paga, documenti, reportistica). Adatta a chi cerca una suite completa più che un singolo strumento presenze.",
          "Per chi è: aziende che stanno crescendo e vogliono gestire presenze, documenti e paghe in un unico sistema, accettando una piattaforma più ampia e articolata.",
        ],
      },
      {
        id: 'jibble',
        heading: 'Jibble',
        body: [
          "Soluzione internazionale con un piano gratuito, app mobile che funziona offline, geofencing e riconoscimento facciale. È un'opzione conveniente per piccole imprese e startup; valuta con attenzione l'uso del riconoscimento facciale alla luce dell'art. 4 e del GDPR nel contesto italiano.",
          "Per chi è: micro-imprese e startup con budget minimo, purché rinuncino al riconoscimento facciale o ne valutino la liceità con il proprio consulente.",
        ],
      },
      {
        id: 'dipendenti-in-cloud',
        heading: 'Dipendenti in Cloud',
        body: [
          "Piattaforma HR italiana molto diffusa tra commercialisti e consulenti del lavoro, integrata con diversi software di paghe italiani. Copre timbrature, ferie e documenti: una scelta naturale per gli studi che gestiscono più aziende clienti.",
          "Per chi è: aziende il cui studio paghe la usa già, o studi professionali che vogliono un'unica piattaforma per tutti i clienti.",
        ],
      },
      {
        id: 'zucchetti-hr-infinity',
        heading: 'Zucchetti HR Infinity',
        body: [
          "La suite HR completa del principale fornitore italiano di gestionali: rilevazione presenze, paghe, controllo accessi e molto altro. È la scelta tipica di medie e grandi aziende con esigenze articolate, più che della piccola impresa che cerca semplicità.",
          "Per chi è: medie e grandi aziende con un ufficio HR strutturato, turnistica complessa e controllo accessi fisico da integrare.",
        ],
      },
      {
        heading: 'In sintesi: qual è la scelta giusta?',
        body: [
          "Non esiste un'app «migliore» in assoluto: dipende dai tuoi numeri e dalle tue priorità. Per una PMI italiana che vuole timbratura GPS senza hardware, conformità all'art. 4 ed export pronto per il commercialista, con un prezzo fisso e prevedibile, sonoQui è pensata esattamente per questo caso.",
          "Se ti serve una suite HR ampia (Factorial), un'integrazione stretta con lo studio paghe (Dipendenti in Cloud), o una piattaforma enterprise (Zucchetti), quelle soluzioni possono essere più adatte. L'importante è partire dai criteri, non dall'elenco di funzioni.",
        ],
      },
    ],
    comparison: {
      caption: 'Confronto 2026 tra le app di rilevazione presenze per PMI (fonte: pagine pubbliche dei fornitori, settembre 2026)',
      columns: ['Soluzione', 'Modello di prezzo', 'Timbratura da smartphone', 'Verifica della posizione', 'Dati biometrici', 'Export paghe', 'Hardware richiesto', 'Per chi è'],
      rows: [
        { name: 'sonoQui', anchor: 'sonoqui', cells: ['Gratis fino a 3 utenti; poi per fascia di dipendenti, da 24,99 €/mese', 'Sì, iOS e Android', 'GPS solo al tap, coordinate non conservate', 'No', 'XLSX mensile per il commercialista', 'Nessuno', 'PMI fino a ~20 dipendenti'] },
        { name: 'Fluida', anchor: 'fluida', cells: ['A consumo per dipendente', 'Sì', 'GPS, Bluetooth, NFC', 'n.d.', 'Presenze, ferie, note spese', 'Nessuno', 'Team distribuiti, mobilità, cantieri'] },
        { name: 'Factorial', anchor: 'factorial', cells: ['Suite HR, n.d.', 'Sì', 'Geolocalizzazione al momento della timbratura', 'n.d.', 'Buste paga e reportistica in suite', 'Nessuno', 'PMI in crescita che vogliono una suite HR'] },
        { name: 'Jibble', anchor: 'jibble', cells: ['Piano gratuito disponibile', 'Sì, anche offline', 'Geofencing', 'Riconoscimento facciale (da valutare per art. 4 e GDPR)', 'n.d.', 'Nessuno', 'Micro-imprese e startup'] },
        { name: 'Dipendenti in Cloud', anchor: 'dipendenti-in-cloud', cells: ['n.d.', 'Sì', 'n.d.', 'n.d.', 'Integrato con software paghe italiani', 'Nessuno', 'Studi di commercialisti e consulenti del lavoro'] },
        { name: 'Zucchetti HR Infinity', anchor: 'zucchetti-hr-infinity', cells: ['Suite enterprise, n.d.', 'Sì', 'n.d.', 'n.d.', 'Paghe integrate', 'Controllo accessi opzionale', 'Medie e grandi aziende'] },
      ],
      note: 'n.d. = non dichiarato nelle pagine pubbliche del fornitore al momento della verifica. I dati dei fornitori terzi possono cambiare: verifica sempre i listini aggiornati.',
    },
    faq: [
      {
        question: "Qual è la migliore app di rilevazione presenze per una PMI?",
        answer:
          "Per una PMI italiana che cerca timbratura GPS da smartphone, conformità all'art. 4 dello Statuto dei Lavoratori ed export pronto per il commercialista a un prezzo fisso, sonoQui è la scelta pensata esattamente per questo caso: gratuita fino a 3 utenti, poi da 24,99 €/mese fino a 10 dipendenti, senza hardware e senza costi nascosti. La scelta giusta però dipende dai numeri e dalle priorità dell'azienda: chi cerca una suite HR più ampia con buste paga e reportistica può valutare Factorial; chi vuole un'integrazione stretta con lo studio paghe può guardare a Dipendenti in Cloud; le aziende medio-grandi con esigenze articolate trovano in Zucchetti HR Infinity una piattaforma più completa. Non esiste un'unica app migliore in assoluto: conviene partire dai criteri — conformità normativa, timbratura mobile, export per le paghe e prezzo — non dall'elenco delle funzioni, valutando sempre una prova pratica con i propri dipendenti prima di decidere.",
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
          "I modelli variano tra prezzo per dipendente e prezzo per fascia. sonoQui è gratuita fino a 3 utenti e 1 sede, poi costa 24,99 €/mese fino a 10 dipendenti e 39,99 €/mese fino a 20, con la rilevazione presenze inclusa e nessun costo hardware; i moduli aggiuntivi (50 €/mese ciascuno) sono opzionali. Altre soluzioni adottano listini a consumo per dipendente.",
      },
      {
        question: 'Esiste una prova gratuita di sonoQui?',
        answer:
          "Più di una prova: sonoQui ha un piano gratuito senza scadenza, per 3 utenti in totale (amministratore compreso) e 1 sede, con tutta la rilevazione presenze inclusa. Registri l'azienda dal sito con nome ed email, senza carta di credito, e passi a un piano a pagamento solo quando ti serve. L'app è gratuita da scaricare per i dipendenti; sul sito trovi anche un video dimostrativo e le schermate dell'app e della dashboard.",
      },
    ],
    cta: {
      title: 'Cerchi la rilevazione presenze giusta per la tua PMI?',
      text: 'Prova sonoQui gratis: timbratura GPS, gestione presenze completa ed export per il commercialista. Gratis fino a 3 utenti, poi un prezzo fisso e trasparente.',
    },
    sources: [
      { label: 'CGUE, causa C-55/18, Federación de Servicios de Comisiones Obreras (CCOO) c. Deutsche Bank, sentenza del 14 maggio 2019 — EUR-Lex', url: 'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:62018CJ0055' },
      { label: 'Art. 4, Legge 20 maggio 1970, n. 300 (Statuto dei Lavoratori) — Normattiva', url: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1970-05-20;300~art4' },
      { label: 'Regolamento (UE) 2016/679 (GDPR) — EUR-Lex', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita' },
    ],
    itemList: [
      { name: 'sonoQui', anchor: 'sonoqui' },
      { name: 'Fluida', anchor: 'fluida' },
      { name: 'Factorial', anchor: 'factorial' },
      { name: 'Jibble', anchor: 'jibble' },
      { name: 'Dipendenti in Cloud', anchor: 'dipendenti-in-cloud' },
      { name: 'Zucchetti HR Infinity', anchor: 'zucchetti-hr-infinity' },
    ],
  },
];

// Sibling content pages, for the "Leggi anche" module: each page gets real
// in-article links to the other two instead of relying on the sitewide footer
// (which was the ONLY inlink each page had — one boilerplate anchor apiece).
export function relatedContentPages(slug: string) {
  return contentPages
    .filter((page) => page.slug !== slug)
    .map((page) => ({ href: `/it/${page.slug}/`, label: page.breadcrumb, description: page.description }));
}

export const getContentPages = () => contentPages;
export const getContentPage = (slug: string) =>
  contentPages.find((page) => page.slug === slug);

// Internal links to the content pages, for footer / cross-linking.
export const contentPageLinks = contentPages.map((page) => ({
  href: `/it/${page.slug}/`,
  label: page.breadcrumb,
}));

// Structured data for a content page: WebPage + Article + Breadcrumb +
// Organization + WebSite + FAQ, plus an ItemList on the buyer-guide page.
//
// The Article dates are the SAME values the page renders as "Pubblicato il /
// Aggiornato il" (both come from src/data/revisions.mjs). Google treats dates
// in markup with no matching visible date as misleading structured data, so
// the two must never be allowed to diverge — which is why neither is typed
// here by hand.
export function buildContentPageSchemas(page: ContentPage) {
  const url = `${SITE_URL}/it/${page.slug}/`;
  const revision = contentRevision(page.slug);
  const image = `${SITE_URL}${page.image ?? DEFAULT_IMAGE}`;
  const webPage = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': url,
    name: page.title,
    description: page.description,
    url,
    inLanguage: 'it-IT',
    datePublished: revision.published,
    dateModified: revision.updated,
    isPartOf: { '@id': WEBSITE_ID },
    about: { '@id': ORGANIZATION_ID },
    publisher: { '@id': ORGANIZATION_ID },
    primaryImageOfPage: { '@type': 'ImageObject', url: image },
  };
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: page.h1,
    description: page.description,
    inLanguage: 'it-IT',
    datePublished: revision.published,
    dateModified: revision.updated,
    author: { '@id': ORGANIZATION_ID },
    publisher: { '@id': ORGANIZATION_ID },
    mainEntityOfPage: { '@id': url },
    image,
    ...(page.sources ? { citation: page.sources.map((source) => source.url) } : {}),
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
    article,
    breadcrumb,
    buildOrganizationSchema(),
    buildWebSiteSchema(),
    faqPageSchema(page.faq),
  ];
  if (page.itemList) {
    nodes.push({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: page.h1,
      itemListElement: page.itemList.map(({ name, anchor }, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name,
        url: `${url}#${anchor}`,
      })),
    });
  }
  return nodes;
}
