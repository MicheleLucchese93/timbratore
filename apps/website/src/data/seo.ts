import type { Lang } from '../i18n/ui';

export const SITE_URL = 'https://sonoqui.xdevapp.it';
export const APP_STORE_URL = 'https://apps.apple.com/it/app/sonoqui/id000000000';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=app.sonoqui.mobile';
export const WEB_APP_URL = 'https://app-sonoqui.xdevapp.it/login';
export const CONTACT_EMAIL = 'michele.lucchese@outlook.it';
export const LINKEDIN_URL = 'https://www.linkedin.com/in/michele-lucchese/';
export const DEFAULT_IMAGE = '/icon.png';

export const homeMeta: Record<Lang, { title: string; description: string }> = {
  it: {
    title: 'sonoQui | Rilevazione presenze con GPS per piccole aziende italiane',
    description:
      "sonoQui è l'app di rilevazione presenze per piccole imprese italiane: timbratura GPS al tap, ferie e correzioni in app, export per il commercialista. Conforme art. 4 Statuto dei Lavoratori.",
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
        "Sì. sonoQui rileva la posizione solo al momento della timbratura, mai in continuo. Non utilizza riconoscimento facciale né dati biometrici. I dati GPS vengono mascherati dopo 90 giorni: rimane solo la sede di riferimento.",
    },
    {
      question: "Per quante persone è pensato?",
      answer:
        "sonoQui è progettato per piccole imprese italiane fino a 20 dipendenti. Pricing target 3€/utente attivo al mese, senza canone fisso.",
    },
    {
      question: "Posso esportare i dati per il commercialista?",
      answer:
        "Sì. La dashboard amministratori genera export XLSX mensili nel formato richiesto dalle paghe italiane. Anomalie evidenziate, totali per dipendente, sede e tipologia.",
    },
    {
      question: "Che succede se un dipendente si dimentica di timbrare?",
      answer:
        "Può richiedere una correzione direttamente dall'app indicando orario e motivo. L'amministratore approva o rifiuta. La timbratura corretta viene tracciata con audit log completo.",
    },
    {
      question: "I miei dati sono al sicuro?",
      answer:
        "Cifratura in transito (TLS 1.2+) e a riposo (LUKS / AES-256). Database PostgreSQL su server UE con Row Level Security (RLS) che garantisce l'isolamento dei dati per azienda. Backup cifrati nell'UE.",
    },
    {
      question: "Quanto durano i miei dati?",
      answer:
        "Le timbrature sono conservate per 5 anni di default (configurabili fino a 10). I dati GPS dettagliati vengono mascherati dopo 90 giorni: rimane solo l'identificativo della sede. Puoi richiedere la cancellazione anticipata in qualsiasi momento.",
    },
    {
      question: "Serve un contratto?",
      answer:
        "L'account viene creato dal nostro team al momento dell'attivazione. Scrivici a " +
        CONTACT_EMAIL +
        " e ti rispondiamo entro 24 ore lavorative.",
    },
  ],
};

export function buildHomeSchema(lang: Lang) {
  const meta = homeMeta[lang];
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'sonoQui',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'iOS, Android, Web',
    description: meta.description,
    url: SITE_URL,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'EUR',
      price: '3.00',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: '3.00',
        priceCurrency: 'EUR',
        unitText: 'utente attivo al mese',
      },
    },
    inLanguage: 'it-IT',
    audience: {
      '@type': 'BusinessAudience',
      audienceType: 'Piccole e medie imprese italiane',
    },
  };
}
