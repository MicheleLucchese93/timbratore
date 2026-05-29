import type { Lang } from '../i18n/ui';

export const SITE_URL = 'https://sonoqui.xdevapp.it';
export const APP_STORE_URL = 'https://apps.apple.com/it/app/sonoqui/id000000000';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=app.sonoqui.mobile';
export const WEB_APP_URL = 'https://app-sonoqui.xdevapp.it/login';
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
        "sonoQui è progettato per piccole imprese italiane fino a 20 dipendenti, dove la timbratura cartolare o i fogli Excel non bastano più ma i gestionali enterprise sono troppo.",
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
        "Sì. I dati sono cifrati e conservati su server nell'Unione Europea. I dati di ogni azienda sono isolati e non visibili ad altre aziende, con backup cifrati nel rispetto del GDPR.",
    },
    {
      question: "Quanto durano i miei dati?",
      answer:
        "Le timbrature sono conservate per 5 anni di default (configurabili fino a 10). I dati GPS dettagliati vengono mascherati dopo 90 giorni: rimane solo l'identificativo della sede. Puoi richiedere la cancellazione anticipata in qualsiasi momento.",
    },
    {
      question: "Chi può approvare ferie, permessi e correzioni?",
      answer:
        "Gli amministratori dell'azienda. Puoi anche nominare approvatori dedicati per singola sede, così ogni responsabile gestisce solo i dipendenti della propria sede.",
    },
    {
      question: "Supportate lo smart working?",
      answer:
        "Sì. Una sede può essere impostata come smart working: per quei dipendenti la timbratura avviene senza verifica della posizione, mentre per le sedi fisiche la verifica GPS resta attiva.",
    },
    {
      question: "I dati restano della nostra azienda? Possiamo esportarli?",
      answer:
        "Sì. I dati sono solo della tua azienda e puoi esportarli in Excel in qualsiasi momento, già nel formato utile al commercialista. Alla cessazione del servizio i dati vengono restituiti o cancellati su tua richiesta.",
    },
    {
      question: "Come iniziamo a usare sonoQui?",
      answer:
        "Non c'è registrazione pubblica: attiviamo noi l'azienda e creiamo il primo account amministratore. Da lì inviti i dipendenti, configuri sedi e orari e sei operativo. Compila il modulo di contatto qui sotto e ti rispondiamo entro 24 ore lavorative.",
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
    inLanguage: 'it-IT',
    audience: {
      '@type': 'BusinessAudience',
      audienceType: 'Piccole e medie imprese italiane',
    },
  };
}
