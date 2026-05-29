export const languages = { it: 'Italiano' } as const;
export type Lang = keyof typeof languages;
export const defaultLang: Lang = 'it';

export const ui = {
  it: {
    // Nav
    'nav.features': 'Funzionalità',
    'nav.screenshots': 'App',
    'nav.web': 'Dashboard',
    'nav.faq': 'FAQ',
    'nav.contact': 'Contatti',
    'nav.download': "Richiedi l'accesso",

    // Hero
    'hero.tagline': 'La timbratura è qui.',
    'hero.subtitle':
      'sonoQui è la app di rilevazione presenze pensata per le PMI italiane. Timbra in un tap, gestisci ferie e correzioni, esporta tutto per il commercialista.',
    'hero.cta.appstore': 'App Store',
    'hero.cta.playstore': 'Google Play',
    'hero.cta.web': 'Apri la dashboard',

    // Features
    'features.title': 'Quello che ti serve, niente di più',
    'features.subtitle':
      'Semplice per chi timbra. Potente per chi amministra. Conforme alla normativa italiana.',

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
