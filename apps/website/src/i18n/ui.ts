export const languages = { it: 'Italiano' } as const;
export type Lang = keyof typeof languages;
export const defaultLang: Lang = 'it';

export const ui = {
  it: {
    // Nav
    'nav.features': 'Funzionalità',
    'nav.video': 'Demo',
    'nav.screenshots': 'App',
    'nav.web': 'Dashboard',
    'nav.moduli': 'Moduli',
    'nav.pricing': 'Prezzi',
    'nav.faq': 'FAQ',
    'nav.partner': 'Partner',
    'nav.contact': 'Contatti',
    'nav.download': "Richiedi l'accesso",

    // Video
    'video.title': 'Guarda sonoQui in azione',
    'video.subtitle':
      'Meno di due minuti: dalla timbratura in un tap alla dashboard per chi amministra.',
    'video.play': 'Riproduci il video demo',

    // Hero
    'hero.tagline': 'La timbratura è qui: rilevazione presenze con GPS',
    'hero.subtitle':
      "sonoQui è l'app di rilevazione presenze pensata per le PMI italiane. Timbra in un tap, gestisci ferie e correzioni, esporta tutto per il commercialista.",
    'hero.cta.appstore': 'App Store',
    'hero.cta.playstore': 'Google Play',
    'hero.cta.web': 'Apri la dashboard',

    // Features
    'features.title': 'Rilevazione presenze: quello che ti serve, niente di più',
    'features.subtitle':
      'Semplice per chi timbra. Potente per chi amministra. Nel rispetto della normativa italiana.',

    // Screenshots (mobile)
    'screenshots.title': 'sonoQui in mano ai dipendenti',
    'screenshots.subtitle':
      'Un tap per timbrare, uno per richiedere ferie. Niente burocrazia, niente fogli di carta.',
    'screenshots.login': 'Accesso sicuro',
    'screenshots.login.desc':
      'Email e password, sessione persistente. Account gestito dall\'amministratore.',
    'screenshots.dashboard': 'Schermata principale',
    'screenshots.dashboard.desc':
      'Stato giornata, prossime azioni, ferie residue. Tutto in una schermata.',
    'screenshots.clock-in': 'Timbra in un tap',
    'screenshots.clock-in.desc':
      'Posizione verificata solo al momento del tap. Conferma immediata se sei nella sede di lavoro.',
    'screenshots.clock-in-success': 'Conferma timbratura',
    'screenshots.clock-in-success.desc':
      'Riepilogo dell\'orario, della sede e dei minuti accumulati nella giornata.',
    'screenshots.history': 'Storico timbrature',
    'screenshots.history.desc':
      'Consulta le tue timbrature giorno per giorno, settimana per settimana.',
    'screenshots.history-detail': 'Dettaglio giornata',
    'screenshots.history-detail.desc':
      'Vedi ogni timbratura della giornata con orari, sede e ore lavorate.',
    'screenshots.leaves-list': 'Richieste ferie',
    'screenshots.leaves-list.desc':
      'Elenco delle richieste ferie e permessi con stato di approvazione.',
    'screenshots.leave-request': 'Nuova richiesta',
    'screenshots.leave-request.desc':
      'Richiedi ferie, permessi e malattia in pochi secondi. Notifiche all\'amministratore in tempo reale.',
    'screenshots.corrections': 'Correzioni',
    'screenshots.corrections.desc':
      'Hai dimenticato di timbrare? Chiedi una correzione e indica il motivo.',
    'screenshots.correction-form': 'Invia correzione',
    'screenshots.correction-form.desc':
      'Compila la richiesta: tipo (ingresso/uscita), orario corretto, motivo. L\'amministratore approva.',
    'screenshots.profile': 'Profilo e preferenze',
    'screenshots.profile.desc':
      'Gestisci notifiche email e push, dati anagrafici e logout.',
    'screenshots.notifications': 'Centro notifiche',
    'screenshots.notifications.desc':
      'Esiti di approvazioni ferie e correzioni in tempo reale.',

    // WebShowcase (admin dashboard)
    'web.badge': 'Dashboard amministratori',
    'web.title': 'Vista d\'insieme per chi gestisce',
    'web.subtitle':
      'Una dashboard web pensata per il responsabile delle paghe e per il commercialista. Tutto quello che serve per chiudere il mese.',
    'web.cta': 'Apri la dashboard demo',
    'web.shot.dashboard': 'Panoramica giornaliera',
    'web.shot.dashboard.desc':
      'Chi ha timbrato, chi è in ferie, anomalie del giorno. A colpo d\'occhio.',
    'web.shot.stamps': 'Timbrature',
    'web.shot.stamps.desc':
      'Elenco filtrabile per dipendente, sede e periodo. Modifica e crea timbrature a mano se serve.',
    'web.shot.anomalies': 'Anomalie',
    'web.shot.anomalies.desc':
      'Turni anomali (oltre 14 ore), pause sospette, timbrature fuori sede. Tutto evidenziato e risolvibile.',
    'web.shot.leaves': 'Ferie e permessi',
    'web.shot.leaves.desc':
      'Richieste da approvare, calendario annuale, saldo ferie residue per dipendente.',
    'web.shot.leave-detail': 'Dettaglio richiesta',
    'web.shot.leave-detail.desc':
      'Periodo, tipologia, allegati. Approva o rifiuta con un click.',
    'web.shot.corrections': 'Correzioni',
    'web.shot.corrections.desc':
      'Richieste di correzione da parte dei dipendenti, motivazione e approvazione.',
    'web.shot.export': 'Export per il commercialista',
    'web.shot.export.desc':
      'Esporta in XLSX il mese completo. Formato pensato per le paghe italiane.',
    'web.shot.users': 'Dipendenti',
    'web.shot.users.desc':
      'Crea, modifica e disabilita utenti. Imposta sede di riferimento e ruolo.',
    'web.shot.branches': 'Sedi di lavoro',
    'web.shot.branches.desc':
      'Geofence configurabile per sede. Tolleranza personalizzabile da 50m a 1500m.',
    'web.shot.settings': 'Impostazioni azienda',
    'web.shot.settings.desc':
      'Soglie anomalie, regole pause, periodo di conservazione dati e logo aziendale.',
    'web.shot.login': 'Accesso amministratore',
    'web.shot.login.desc':
      'Login con email e password. Solo gli account abilitati come amministratori vedono la dashboard.',

    // Partner program
    'partner.badge': 'Programma partner',
    'partner.title': 'Rivendi sonoQui ai tuoi clienti',
    'partner.subtitle':
      "Sei un commercialista, un consulente del lavoro o una software house? Diventa rivenditore sonoQui: attivi e gestisci le aziende dei tuoi clienti da un'unica console, con il tuo margine ricorrente. Al prodotto e all'infrastruttura pensiamo noi.",
    'partner.b1.title': 'Console dedicata',
    'partner.b1.desc':
      "Crei e gestisci le aziende clienti da una console riservata: nuovi account, limiti, sospensioni e riattivazioni, in autonomia e senza passare da noi.",
    'partner.b2.title': 'Margine ricorrente',
    'partner.b2.desc':
      "Rivendi un servizio in abbonamento alle PMI italiane e costruisci una rendita ricorrente. Pacchetto sconti incrementale a seconda dei volumi.",
    'partner.b3.title': 'Il cliente resta tuo',
    'partner.b3.desc':
      "Fatturiamo a te il servizio; tu fatturi il cliente finale. Il rapporto commerciale, il prezzo e la relazione restano tuoi.",
    'partner.b4.title': 'Pensiamo noi al resto',
    'partner.b4.desc':
      "Infrastruttura, aggiornamenti, sicurezza e backup sono a carico nostro. Tu segui i clienti, noi teniamo in piedi la piattaforma.",
    'partner.modules.badge': 'Novità · Moduli',
    'partner.modules.title': 'I moduli li gestisci tu, azienda per azienda',
    'partner.modules.desc':
      "Dalla console attivi e disattivi i moduli aggiuntivi (come Cantieri) per ogni singola azienda cliente, in autonomia e senza passare da noi. Li rivendi a consumo mensile insieme all'abbonamento, con il tuo margine.",
    'partner.cta.join': 'Diventa partner',
    'partner.cta.login': 'Accedi alla console',
    'partner.cta.note': 'Hai già un account partner?',
    'partner.page.title':
      'Rilevazione presenze per commercialisti e consulenti del lavoro: il programma partner sonoQui',
    'partner.page.lead':
      "Programma partner per commercialisti, consulenti del lavoro e software house. Attivi e gestisci le aziende dei tuoi clienti da un'unica console, con un margine ricorrente. Al prodotto, all'infrastruttura e all'assistenza pensiamo noi.",
    'partner.page.faq.title': 'Domande frequenti sul programma partner',

    // Contact / Footer
    'contact.title': 'Contattaci',
    'contact.subtitle':
      'Vuoi provare sonoQui? Scrivici e ti aiutiamo a partire.',
    'contact.name': 'Nome',
    'contact.email': 'Email',
    'contact.subject': 'Oggetto',
    'contact.message': 'Messaggio',
    'contact.send': 'Invia',
    'footer.privacy': 'Privacy Policy',
    'footer.cookies': 'Cookie Policy',
    'footer.terms': 'Termini e Condizioni',
    'footer.eula': 'EULA',
    'footer.rights': 'Tutti i diritti riservati.',

    // CTA
    'cta.title': 'Pronto a smettere di rincorrere i fogli ore?',
    'cta.subtitle': 'Scarica sonoQui sul tuo smartphone o apri la dashboard.',

    // Legal
    'legal.lastUpdated': 'Ultimo aggiornamento',
  },
} as const;
