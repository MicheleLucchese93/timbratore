import { useEffect, useRef } from 'react';
import './Manual.css';

const MANUAL_BODY = `
<div class="layout">

  <aside class="toc">
    <nav>
      <h3>Introduzione</h3>
      <a href="#intro">Benvenuto</a>
      <a href="#concetti">Concetti chiave</a>
      <a href="#ruoli">Ruoli e permessi</a>
      <a href="#accesso">Accesso e password</a>

      <h3>Web · Amministratore</h3>
      <a href="#web-admin">Panoramica</a>
      <a href="#web-admin-dashboard" class="sub">Dashboard</a>
      <a href="#web-admin-timbrature" class="sub">Timbrature</a>
      <a href="#web-admin-correzioni" class="sub">Correzioni</a>
      <a href="#web-admin-utenti" class="sub">Utenti</a>
      <a href="#web-admin-sedi" class="sub">Sedi</a>
      <a href="#web-admin-orari" class="sub">Orari</a>
      <a href="#web-admin-anomalie" class="sub">Anomalie</a>
      <a href="#web-admin-ferie" class="sub">Ferie &amp; Permessi</a>
      <a href="#web-admin-esportazioni" class="sub">Esportazioni</a>
      <a href="#web-admin-impostazioni" class="sub">Impostazioni</a>

      <h3>Web · Dipendente</h3>
      <a href="#web-user">Panoramica</a>
      <a href="#web-user-dashboard" class="sub">La mia Dashboard</a>
      <a href="#web-user-stamps" class="sub">Le mie timbrature</a>
      <a href="#web-user-corr" class="sub">Le mie richieste</a>

      <h3>App Mobile · Dipendente</h3>
      <a href="#mob-user">Panoramica</a>
      <a href="#mob-user-timbra" class="sub">Timbrature</a>
      <a href="#mob-user-storico" class="sub">Storico</a>
      <a href="#mob-user-correzioni" class="sub">Correzioni</a>
      <a href="#mob-user-richieste" class="sub">Ferie / Permessi / Malattia</a>
      <a href="#mob-user-profilo" class="sub">Profilo</a>

      <h3>App Mobile · Amministratore</h3>
      <a href="#mob-admin">Panoramica</a>
      <a href="#mob-admin-correzioni" class="sub">Approvazione correzioni</a>
      <a href="#mob-admin-richieste" class="sub">Approvazione richieste</a>
      <a href="#mob-admin-notifiche" class="sub">Notifiche push</a>

      <h3>Riferimenti</h3>
      <a href="#geofence">Geolocalizzazione</a>
      <a href="#notifiche">Notifiche</a>
      <a href="#offline">Modalità offline</a>
      <a href="#glossario">Glossario</a>
      <a href="#faq">Domande frequenti</a>
    </nav>
  </aside>

  <main>

    <section class="chapter" id="intro">
      <h2><span class="chapter-num">01</span>Benvenuto</h2>
      <p class="lead">sonoQui è la piattaforma che permette ai tuoi dipendenti di timbrare l'ingresso e l'uscita dal lavoro, richiedere ferie, permessi e malattia, e all'azienda di gestire orari, anomalie e adempimenti verso il commercialista.</p>

      <div class="feature">
        <h3>Che cos'è sonoQui</h3>
        <p>sonoQui sostituisce il classico cartellino: il dipendente registra le proprie presenze dall'app mobile (con GPS dove richiesto) e l'amministratore ha sempre sotto controllo presenze, assenze, anomalie e quote ferie.</p>
        <p>La piattaforma è composta da due applicazioni che lavorano insieme:</p>
        <div class="grid-2">
          <div class="mini-card">
            <div class="mini-title">💻 Web app</div>
            <div class="mini-desc">Per l'amministratore: dashboard, gestione utenti, sedi, orari, esportazioni. Per il dipendente: consultazione delle proprie timbrature e richieste.</div>
          </div>
          <div class="mini-card">
            <div class="mini-title">📱 App mobile</div>
            <div class="mini-desc">Per timbrare ingresso/uscita/pause con GPS, richiedere ferie e correzioni, ricevere notifiche push delle decisioni dell'amministratore.</div>
          </div>
        </div>
      </div>
    </section>

    <section class="chapter" id="concetti">
      <h2><span class="chapter-num">02</span>Concetti chiave</h2>
      <p class="lead">Pochi termini ricorrono ovunque nella piattaforma. Conoscerli aiuta a orientarsi sia da amministratore sia da dipendente.</p>

      <div class="feature">
        <h3>I termini fondamentali</h3>
        <table>
          <thead><tr><th>Termine</th><th>Significato</th></tr></thead>
          <tbody>
            <tr><td><strong>Timbratura</strong></td><td>Evento registrato dal dipendente: ingresso, uscita, inizio/fine pausa o inizio/fine pausa pranzo.</td></tr>
            <tr><td><strong>Sede</strong></td><td>Luogo di lavoro. Può richiedere geofencing GPS o essere "smart working" (nessun GPS).</td></tr>
            <tr><td><strong>Orario di lavoro</strong></td><td>Modello settimanale di slot lavorativi assegnato a un utente, usato per calcolare anomalie e ore.</td></tr>
            <tr><td><strong>Anomalia</strong></td><td>Deviazione tra timbrature reali e orario atteso (ritardo, assenza, pausa lunga, ecc.).</td></tr>
            <tr><td><strong>Correzione</strong></td><td>Richiesta del dipendente per modificare o aggiungere una timbratura dimenticata.</td></tr>
            <tr><td><strong>Ferie</strong></td><td>Giorni di vacanza retribuiti. Consumano la quota ferie del dipendente.</td></tr>
            <tr><td><strong>Permesso</strong></td><td>Assenza a ore, con granularità di 15 minuti. Consuma la quota permessi.</td></tr>
            <tr><td><strong>Malattia</strong></td><td>Assenza per motivi sanitari con protocollo INPS. Auto-approvata.</td></tr>
            <tr><td><strong>Quota</strong></td><td>Saldo di ore disponibili per ferie/permessi, con accantonamento periodico.</td></tr>
            <tr><td><strong>Approvatore</strong></td><td>Utente (di solito admin) designato a decidere richieste di un dipendente.</td></tr>
            <tr><td><strong>Geofence</strong></td><td>Area geografica intorno alla sede entro cui sono accettate le timbrature.</td></tr>
            <tr><td><strong>Esportazione</strong></td><td>File XLSX o JSON con timbrature, ferie e anomalie del periodo, scaricabile dal commercialista.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="chapter" id="ruoli">
      <h2><span class="chapter-num">03</span>Ruoli e permessi</h2>
      <p class="lead">In sonoQui esistono due ruoli, con accessi molto diversi sia su Web sia su Mobile.</p>

      <div class="grid-2">
        <div class="feature" style="margin:0;">
          <h3>👔 Amministratore <span class="badge badge-admin">admin</span></h3>
          <p class="feature-sub">Tipicamente il titolare, il responsabile risorse umane o l'amministratore di sistema.</p>
          <ul class="tidy">
            <li>Vede dashboard aziendale con tutti i dipendenti</li>
            <li>Crea, modifica, disattiva utenti</li>
            <li>Configura sedi, orari, quote ferie</li>
            <li>Approva o rifiuta correzioni, ferie, permessi e revoche</li>
            <li>Inserisce timbrature manuali per i dipendenti</li>
            <li>Esporta dati per il commercialista</li>
            <li>Configura impostazioni dell'azienda</li>
          </ul>
        </div>
        <div class="feature" style="margin:0;">
          <h3>👤 Dipendente <span class="badge badge-user">user</span></h3>
          <p class="feature-sub">L'utente standard che lavora in azienda.</p>
          <ul class="tidy">
            <li>Timbra ingresso, uscita e pause dall'app mobile</li>
            <li>Consulta storico delle proprie timbrature</li>
            <li>Richiede correzioni di timbrature dimenticate</li>
            <li>Richiede ferie, permessi, segnala malattie</li>
            <li>Vede saldo ferie/permessi residue</li>
            <li>Riceve notifiche push e email delle decisioni</li>
            <li>Configura le proprie preferenze di notifica</li>
          </ul>
        </div>
      </div>

      <div class="callout callout-info">
        <strong>Approvatori dedicati:</strong> per ciascun dipendente è possibile designare uno o più amministratori specifici come approvatori di ferie, permessi o correzioni. Se nessuno è configurato, qualunque admin può decidere. <em>Vince il primo che decide.</em>
      </div>
    </section>

    <section class="chapter" id="accesso">
      <h2><span class="chapter-num">04</span>Accesso e password</h2>
      <p class="lead">Stesse credenziali per Web e Mobile. L'invito iniziale arriva dall'amministratore via email.</p>

      <div class="feature">
        <h3>Effettuare l'accesso</h3>
        <ol class="steps">
          <li>Apri <code class="inline">sonoqui.app</code> nel browser (Web) o l'app sonoQui (Mobile).</li>
          <li>Inserisci la tua email aziendale.</li>
          <li>Inserisci la password (l'icona occhio permette di mostrarla/nasconderla).</li>
          <li>Premi <strong>Accedi</strong>.</li>
        </ol>
        <p>Al primo accesso verrai indirizzato alla pagina iniziale del tuo ruolo: <em>Dashboard</em> per gli amministratori, <em>La mia dashboard</em> o <em>Timbrature</em> per i dipendenti.</p>
      </div>

      <div class="feature">
        <h3>Password dimenticata</h3>
        <ol class="steps">
          <li>Nella pagina di login premi <strong>Password dimenticata?</strong></li>
          <li>Inserisci la tua email.</li>
          <li>Premi <strong>Invia link di reset</strong>.</li>
          <li>Controlla la posta (anche lo spam) e segui il link ricevuto.</li>
          <li>Imposta una nuova password (minimo 8 caratteri) e accedi normalmente.</li>
        </ol>
        <div class="callout callout-info">
          Per ragioni di sicurezza il sistema mostra sempre lo stesso messaggio di conferma, anche se l'email non è registrata. Non riveliamo se un account esiste o meno.
        </div>
      </div>

      <div class="feature">
        <h3>Non hai ancora un account?</h3>
        <p>Solo l'amministratore della tua azienda può crearti l'utenza. Una volta invitato riceverai via email le credenziali iniziali.</p>
      </div>
    </section>

    <hr class="section-divider">

    <div class="platform-header">
      <div class="icon">💻</div>
      <div>
        <h2>Web · Amministratore</h2>
        <div class="sub">Tutte le funzioni di gestione dell'azienda, accessibili dal browser.</div>
      </div>
    </div>

    <section class="chapter" id="web-admin">
      <h2><span class="chapter-num">05</span>Panoramica Web Admin</h2>
      <p class="lead">Dal browser l'amministratore controlla l'intera operatività dell'azienda. La navigazione principale è sulla sinistra ed è dinamica in base al ruolo.</p>

      <div class="feature">
        <h3>Menu di navigazione</h3>
        <p>La barra laterale mostra le voci dell'amministratore. È comprimibile (icona freccia) per recuperare spazio sullo schermo.</p>
        <div class="grid-2">
          <div class="mini-card"><div class="mini-title">Dashboard</div><div class="mini-desc">Stato in tempo reale di presenze e richieste</div></div>
          <div class="mini-card"><div class="mini-title">Timbrature</div><div class="mini-desc">Archivio storico di tutte le timbrature</div></div>
          <div class="mini-card"><div class="mini-title">Correzioni</div><div class="mini-desc">Richieste di correzione da approvare</div></div>
          <div class="mini-card"><div class="mini-title">Utenti</div><div class="mini-desc">Anagrafica dipendenti, ruoli, sedi, orari</div></div>
          <div class="mini-card"><div class="mini-title">Sedi</div><div class="mini-desc">Luoghi di lavoro con geofencing GPS</div></div>
          <div class="mini-card"><div class="mini-title">Orari</div><div class="mini-desc">Modelli settimanali di turni</div></div>
          <div class="mini-card"><div class="mini-title">Anomalie</div><div class="mini-desc">Deviazioni rispetto agli orari attesi</div></div>
          <div class="mini-card"><div class="mini-title">Ferie &amp; Permessi</div><div class="mini-desc">Richieste, quote e modelli</div></div>
          <div class="mini-card"><div class="mini-title">Esportazioni</div><div class="mini-desc">Export XLSX/JSON per il commercialista</div></div>
          <div class="mini-card"><div class="mini-title">Impostazioni</div><div class="mini-desc">Configurazione azienda</div></div>
        </div>
        <p>In basso nella sidebar trovi il tuo avatar con email, ruolo <em>Amministratore</em> e il pulsante <strong>Esci</strong>.</p>
      </div>
    </section>

    <section class="chapter" id="web-admin-dashboard">
      <h2><span class="chapter-num">06</span>Dashboard <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Il pannello di controllo aziendale. Si aggiorna automaticamente e mostra in un colpo d'occhio tutto ciò che richiede la tua attenzione.</p>

      <div class="feature">
        <h3>Statistiche rapide</h3>
        <p>In cima alla pagina trovi sei contatori sempre aggiornati:</p>
        <ul class="tidy">
          <li><strong>Presenti ora</strong>: dipendenti attualmente al lavoro / totale attivi.</li>
          <li><strong>In pausa</strong>: dipendenti in pausa in questo momento.</li>
          <li><strong>Assenti oggi</strong>: persone in ferie, permesso o malattia (badge giallo se &gt; 0).</li>
          <li><strong>Da approvare</strong>: totale richieste in coda (badge rosso se &gt; 0).</li>
          <li><strong>Anomalie 7 gg</strong>: anomalie rilevate negli ultimi 7 giorni.</li>
          <li><strong>Sedi</strong>: numero di sedi configurate.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Inbox · Da approvare</h3>
        <p>Tre schede per smaltire rapidamente le richieste dei dipendenti:</p>
        <ul class="tidy">
          <li><strong>Correzioni</strong>: richieste di correzione timbrature in attesa.</li>
          <li><strong>Ferie / Permessi / Malattia</strong>: richieste di assenza in attesa.</li>
          <li><strong>Revoche</strong>: richieste di annullamento di ferie già approvate.</li>
        </ul>
        <p>Per ogni voce hai i pulsanti <span class="pill pill-ok">Approva</span> <span class="pill pill-err">Rifiuta</span> e <strong>Apri dettaglio</strong>. In caso di rifiuto/revoca si apre un dialog dove inserire opzionalmente la motivazione (max 500 caratteri).</p>
      </div>

      <div class="feature">
        <h3>Assenti ora e Prossime 14 giorni</h3>
        <p>Due colonne ti mostrano chi è assente in questo momento e chi lo sarà nelle prossime due settimane. Per ogni voce: tipo assenza, nome, range date e ore totali.</p>
      </div>

      <div class="feature">
        <h3>Stato attuale dei dipendenti</h3>
        <p>Una griglia con una card per ogni dipendente. Ogni card mostra avatar, email, stato (<span class="pill pill-ok">Al lavoro</span> <span class="pill pill-warn">In pausa</span> <span class="pill">Fuori servizio</span>), sede attuale e ultimo evento timbrato con ora.</p>
        <p>Puoi cambiare la visualizzazione tra <strong>Elenco</strong> e <strong>Per sede</strong> (raggruppa i dipendenti per filiale).</p>
      </div>

      <div class="feature">
        <h3>Anomalie ultimi 7 giorni</h3>
        <p>Riepilogo per tipo di anomalia (es. "Entrata mancante: 3") e lista delle più recenti con nome utente, data e delta in minuti.</p>
        <p>Il link <strong>Vedi tutte →</strong> porta alla pagina completa Anomalie.</p>
      </div>

      <div class="callout callout-tip">
        Premi <strong>Aggiorna</strong> per forzare il refresh manuale. La dashboard si aggiorna anche automaticamente in background.
      </div>
    </section>

    <section class="chapter" id="web-admin-timbrature">
      <h2><span class="chapter-num">07</span>Timbrature <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">L'archivio storico di tutte le timbrature aziendali, per impostazione predefinita gli ultimi 90 giorni.</p>

      <div class="feature">
        <h3>La tabella</h3>
        <p>Colonne disponibili:</p>
        <ul class="tidy">
          <li><strong>Quando</strong> — data e ora in formato italiano.</li>
          <li><strong>Utente</strong> — email del dipendente.</li>
          <li><strong>Evento</strong> — badge colorato (Ingresso, Uscita, Inizio/Fine pausa, Inizio/Fine pausa pranzo).</li>
          <li><strong>Origine</strong> — app mobile, correzione approvata o inserimento admin.</li>
          <li><strong>Sede</strong> — la filiale registrata, o "—" se nessuna.</li>
          <li><strong>Note</strong> — eventuali annotazioni. Compare un indicatore <em>mock</em> se la posizione GPS è sospetta.</li>
          <li><strong>Azioni</strong> — modifica e elimina.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Inserire una timbratura manuale</h3>
        <ol class="steps">
          <li>Premi <strong>Nuova timbratura</strong> in alto a destra.</li>
          <li>Seleziona l'<strong>utente</strong> per cui inserire.</li>
          <li>Scegli l'<strong>evento</strong> (Ingresso / Uscita / Inizio pausa / Fine pausa / Inizio pausa pranzo / Fine pausa pranzo).</li>
          <li>Imposta <strong>data e ora</strong> tramite il campo datetime.</li>
          <li>Opzionale: seleziona la <strong>sede</strong>.</li>
          <li>Indica una <strong>motivazione</strong> (es. "timbratura dimenticata").</li>
          <li>Premi <strong>Salva</strong>.</li>
        </ol>
      </div>

      <div class="feature">
        <h3>Modificare o eliminare</h3>
        <p>Le icone azione nella riga aprono:</p>
        <ul class="tidy">
          <li><strong>Modifica</strong> — riapri il dialog con i valori correnti.</li>
          <li><strong>Elimina</strong> — chiede di confermare e di indicare il motivo dell'eliminazione (resta traccia nel log).</li>
        </ul>
        <div class="callout callout-warn">
          Ogni intervento manuale viene registrato in audit log. Inserire sempre una motivazione chiara: serve sia al dipendente sia in caso di controlli.
        </div>
      </div>
    </section>

    <section class="chapter" id="web-admin-correzioni">
      <h2><span class="chapter-num">08</span>Correzioni <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Tutte le richieste di correzione timbratura inviate dai dipendenti, da gestire singolarmente.</p>

      <div class="feature">
        <h3>Lista delle richieste</h3>
        <p>Ogni richiesta è una card che mostra: nome utente, data invio, stato (<span class="pill pill-warn">In attesa</span> <span class="pill pill-ok">Approvata</span> <span class="pill pill-err">Rifiutata</span> <span class="pill">Superata</span>), motivazione del dipendente e — se decisa — la nota della decisione.</p>
        <p>Il filtro in alto consente di vedere <strong>Solo in attesa</strong> o <strong>Tutte</strong>.</p>
      </div>

      <div class="feature">
        <h3>Diff prima/dopo</h3>
        <p>La card mostra in modo chiaro la differenza:</p>
        <ul class="tidy">
          <li>Se la richiesta è di <strong>aggiungere</strong> una timbratura mancante: un unico riquadro con evento, data/ora e sede proposti.</li>
          <li>Se è di <strong>modificare</strong> una timbratura esistente: due colonne affiancate — a sinistra in rosso i valori attuali, a destra in verde quelli richiesti (con le celle cambiate in grassetto).</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Approvare o rifiutare</h3>
        <ol class="steps">
          <li>Leggi la motivazione del dipendente.</li>
          <li>Confronta i valori attuali con quelli richiesti.</li>
          <li>Premi <strong>Approva</strong> per applicare la correzione, oppure <strong>Rifiuta</strong>.</li>
          <li>In caso di rifiuto si apre un dialog: inserisci una nota opzionale (fino a 500 caratteri) e conferma.</li>
        </ol>
        <p>L'approvazione crea o modifica la timbratura corrispondente nell'archivio. Il dipendente riceve notifica della decisione.</p>
      </div>
    </section>

    <section class="chapter" id="web-admin-utenti">
      <h2><span class="chapter-num">09</span>Utenti <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">L'anagrafica dipendenti, con ruolo, attivazione, sedi, orari e approvatori.</p>

      <div class="feature">
        <h3>Utilizzo licenze</h3>
        <p>In testa alla pagina due contatori indicano <strong>Utenti</strong> attivi / massimo previsti dal piano e <strong>Amministratori</strong> attivi / massimo. Se raggiungi il limite il pulsante <em>Invita utente</em> viene disabilitato.</p>
      </div>

      <div class="feature">
        <h3>Invitare un nuovo dipendente</h3>
        <ol class="steps">
          <li>Premi <strong>Invita utente</strong>.</li>
          <li>Inserisci email (obbligatorio), nome e cognome (opzionali).</li>
          <li>Scegli il ruolo: <em>Utente</em> o <em>Admin</em>.</li>
          <li>Seleziona una o più <strong>sedi</strong> di assegnazione.</li>
          <li>Premi <strong>Invita</strong>.</li>
        </ol>
        <p>Il dipendente riceverà un'email per impostare la password e accedere.</p>
      </div>

      <div class="feature">
        <h3>Operazioni sulla tabella utenti</h3>
        <p>Per ogni riga della tabella puoi:</p>
        <ul class="tidy">
          <li>Cambiare il <strong>ruolo</strong> (Admin / Utente) tramite select.</li>
          <li>Attivare o disattivare l'utente con il toggle <strong>Attivo</strong>.</li>
          <li>Bloccare l'uso del clock-in da Web con il toggle <strong>Desktop clock-in disabilitato</strong>.</li>
          <li>Modificare le <strong>sedi</strong> assegnate (multi-select).</li>
          <li>Assegnare un <strong>orario di lavoro</strong> (template + data inizio validità).</li>
          <li>Configurare gli <strong>approvatori</strong> per Correzioni, Ferie, Permessi, Malattia.</li>
          <li>Modificare nome e cognome.</li>
          <li>Disattivare o eliminare definitivamente l'utente.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Operazioni in massa</h3>
        <p>Selezionando più utenti con il checkbox appare una barra dedicata:</p>
        <ul class="tidy">
          <li><strong>Assegna sedi</strong> — aggiunge le stesse sedi a tutti i selezionati.</li>
          <li><strong>Rimuovi sedi</strong> — toglie le sedi indicate da tutti.</li>
          <li><strong>Annulla</strong> — deseleziona.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Import / Export Excel</h3>
        <p>In alto a destra:</p>
        <ul class="tidy">
          <li><strong>Esporta XLSX</strong> — scarica la lista utenti corrente.</li>
          <li><strong>Importa XLSX</strong> — carica un file Excel per creare/aggiornare utenti in massa (la chiave è l'email).</li>
        </ul>
        <div class="callout callout-info">
          In caso di errori nel file importato vengono mostrati i primi 5 errori riga per riga, con il totale se sono di più.
        </div>
      </div>

      <div class="feature">
        <h3>Approvatori</h3>
        <p>Cliccando <strong>Configura</strong> sotto la colonna Approvatori per un utente si apre un dialog dove indicare, per ciascun tipo (correzioni, ferie, permessi, malattia), uno o più utenti admin che devono decidere.</p>
        <div class="callout callout-tip">
          <p><strong>Regola fondamentale</strong>: se nessun approvatore è configurato, qualunque admin può decidere. Se almeno uno è configurato, solo quelli elencati possono. <em>Vince il primo che decide.</em></p>
        </div>
      </div>
    </section>

    <section class="chapter" id="web-admin-sedi">
      <h2><span class="chapter-num">10</span>Sedi <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">I luoghi di lavoro dell'azienda. Possono richiedere il GPS (geofencing) oppure essere in smart working.</p>

      <div class="feature">
        <h3>Creare una nuova sede</h3>
        <ol class="steps">
          <li>Premi <strong>Nuova sede</strong>.</li>
          <li>Inserisci un <strong>nome</strong> identificativo.</li>
          <li>Digita l'<strong>indirizzo</strong> nell'autocomplete (suggerimenti Google Places).</li>
          <li>Decidi se è una sede <strong>Smart working</strong>: se sì, GPS e raggio non servono.</li>
          <li>Altrimenti imposta latitudine, longitudine (già popolate dall'indirizzo).</li>
          <li>Decidi se <strong>limitare la timbratura entro un raggio</strong>:
            <ul class="tidy">
              <li><strong>Attivo</strong> (default): imposta il <strong>raggio</strong> in metri (default 300m), la <strong>politica geofence</strong> (<em>Lenient</em> avviso / <em>Strict</em> rifiuto) e il ceiling di <strong>accuratezza GPS</strong> (default 100m).</li>
              <li><strong>Disattivo</strong>: la timbratura è accettata indipendentemente dalla distanza dalla sede. Il GPS viene comunque registrato sulla timbratura per audit. La sede non viene auto-rilevata: il dipendente deve selezionarla manualmente nell'app.</li>
            </ul>
          </li>
          <li>Premi <strong>Salva</strong>.</li>
        </ol>
      </div>

      <div class="feature">
        <h3>Card sede</h3>
        <p>Ogni sede appare come una card con nome, indirizzo, tipo (smart working, geolocalizzata con raggio, o geolocalizzata senza raggio) e — per le sedi con raggio attivo — un'anteprima della mappa con cerchio del raggio.</p>
        <p>Pulsanti per modificare o eliminare la sede. L'eliminazione richiede conferma.</p>
      </div>

      <div class="callout callout-info">
        Lo <strong>smart working</strong> è una sede senza GPS: il dipendente può timbrare ovunque senza vincoli di geolocalizzazione. Una sede <strong>senza raggio</strong> registra comunque il GPS ma non lo confronta con un'area: utile per sedi con perimetro non definibile (cantieri estesi, trasferte presso clienti).
      </div>
    </section>

    <section class="chapter" id="web-admin-orari">
      <h2><span class="chapter-num">11</span>Orari di lavoro <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Modelli settimanali assegnabili agli utenti. Le anomalie vengono calcolate confrontando le timbrature con questi orari.</p>

      <div class="feature">
        <h3>Creare un modello orario</h3>
        <ol class="steps">
          <li>Premi <strong>Nuovo orario</strong>.</li>
          <li>Indica <strong>nome</strong> e <strong>descrizione</strong> opzionale.</li>
          <li>Imposta le <strong>tolleranze</strong> in minuti per entrata e uscita (default ±10').</li>
          <li>Definisci pausa minima/massima e pausa pranzo minima/massima attese.</li>
          <li>Scegli la <strong>soglia straordinari</strong> (1, 15 o 30 minuti) e se conteggiarli.</li>
          <li>Per ogni giorno della settimana aggiungi uno o più <strong>slot</strong> (orario inizio - orario fine).</li>
          <li>Imposta le <strong>penalità</strong> per superamento tolleranze su entrata, uscita e pausa.</li>
          <li>Premi <strong>Salva</strong>.</li>
        </ol>
      </div>

      <div class="feature">
        <h3>Card orario</h3>
        <p>Ogni modello mostra nome, descrizione, tolleranze, totale ore settimanali e un'anteprima a griglia degli slot per giorno.</p>
        <p>Pulsanti per modificare o eliminare il modello (è bloccata l'eliminazione se ci sono utenti attivi assegnati).</p>
      </div>

      <div class="callout callout-tip">
        Per assegnare un orario a un dipendente vai in <strong>Utenti → colonna Orario → Assegna</strong>. L'assegnazione precedente viene chiusa automaticamente alla data di validità della nuova.
      </div>
    </section>

    <section class="chapter" id="web-admin-anomalie">
      <h2><span class="chapter-num">12</span>Anomalie orario <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Le deviazioni rispetto all'orario atteso. Vengono calcolate confrontando timbrature reali e turno assegnato.</p>

      <div class="feature">
        <h3>Filtrare le anomalie</h3>
        <ol class="steps">
          <li>Imposta il range <strong>Da</strong> / <strong>Al</strong>.</li>
          <li>Opzionale: filtra per uno o più <strong>utenti</strong>.</li>
          <li>Premi <strong>Filtra</strong>.</li>
        </ol>
        <p>I risultati sono raggruppati per data (più recenti in alto).</p>
      </div>

      <div class="feature">
        <h3>Tipi di anomalia</h3>
        <table>
          <thead><tr><th>Tipo</th><th>Quando viene rilevata</th></tr></thead>
          <tbody>
            <tr><td><span class="pill pill-err">Entrata mancante</span></td><td>Nessuna timbratura ingresso in un giorno lavorativo previsto.</td></tr>
            <tr><td><span class="pill pill-err">Uscita mancante</span></td><td>Nessuna timbratura uscita dopo un ingresso.</td></tr>
            <tr><td><span class="pill pill-warn">Entrata in ritardo</span></td><td>Ingresso oltre la tolleranza configurata.</td></tr>
            <tr><td><span class="pill pill-warn">Uscita anticipata</span></td><td>Uscita prima della tolleranza configurata.</td></tr>
            <tr><td><span class="pill pill-warn">Ore insufficienti</span></td><td>Ore lavorate inferiori all'orario atteso.</td></tr>
            <tr><td><span class="pill pill-purple">Lavoro in giorno di riposo</span></td><td>Timbrature in un giorno non previsto dal turno.</td></tr>
            <tr><td><span class="pill pill-info">Pausa troppo breve</span></td><td>Pausa inferiore al minimo atteso.</td></tr>
            <tr><td><span class="pill pill-info">Pausa troppo lunga</span></td><td>Pausa superiore al massimo atteso.</td></tr>
            <tr><td><span class="pill pill-info">Pausa pranzo troppo breve</span></td><td>Pausa pranzo inferiore al minimo atteso.</td></tr>
            <tr><td><span class="pill pill-info">Pausa pranzo troppo lunga</span></td><td>Pausa pranzo superiore al massimo atteso.</td></tr>
          </tbody>
        </table>
      </div>

      <div class="feature">
        <h3>Giustificare un'anomalia</h3>
        <p>Per alcune anomalie (ore insufficienti, ingresso mancante/in ritardo, uscita anticipata) puoi cliccare <strong>Giustifica</strong>: inserisci la motivazione (max 500 caratteri) e l'anomalia resterà tracciata ma con la giustificazione associata.</p>
      </div>
    </section>

    <section class="chapter" id="web-admin-ferie">
      <h2><span class="chapter-num">13</span>Ferie &amp; Permessi <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Gestione completa di richieste, quote per utente e modelli di accantonamento.</p>

      <div class="feature">
        <h3>Tab Richieste</h3>
        <p>Filtri per stato (Tutte / In attesa / Approvate / Rifiutate) e per utente.</p>
        <p>La tabella elenca tutte le richieste con tipo (<span class="pill pill-info">Ferie</span> <span class="pill pill-warn">Permesso</span> <span class="pill pill-err">Malattia</span>), utente, periodo, ore totali, stato, note del dipendente e — se malattia — il protocollo INPS.</p>
        <p>Per le richieste pending hai i pulsanti <strong>Approva</strong> / <strong>Rifiuta</strong>:</p>
        <ul class="tidy">
          <li><strong>Approva</strong> — conferma definitiva.</li>
          <li><strong>Rifiuta</strong> — apre un dialog dove inserisci il motivo del rifiuto (obbligatorio, max 500 caratteri).</li>
          <li><strong>Revoca</strong> (su richieste già approvate) — annulla una ferie già concessa, motivando.</li>
          <li><strong>Accetta / Rifiuta annullamento</strong> — quando il dipendente chiede l'annullamento di una ferie già approvata.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Tab Quote</h3>
        <p>Per ogni utente vedi due colonne (Ferie e Permessi) con saldo iniziale, accrediti totali, usati approvati, usati in attesa e residuo.</p>
        <p>Premi <strong>Modifica</strong> per cambiare l'assegnazione: template, saldo iniziale e data inizio.</p>
        <div class="callout callout-info">
          <strong>Residuo</strong> = saldo iniziale + accantonamenti − usati approvati. I "pending" non si contano subito, quindi il counter può diventare negativo se le richieste in attesa superano il residuo.
        </div>
      </div>

      <div class="feature">
        <h3>Tab Modelli</h3>
        <p>Lista dei template di quota disponibili. Per ognuno: nome, tipo (Ferie/Permessi), ore default, accantonamento (importo e frequenza), stato attivo.</p>
        <p>Creando un nuovo modello indichi:</p>
        <ul class="tidy">
          <li><strong>Nome</strong> e <strong>tipo</strong>.</li>
          <li><strong>Ore default</strong> per richiesta.</li>
          <li><strong>Accredito</strong>: importo in ore e frequenza (<em>mensile</em> il giorno X, o <em>annuale</em> il X/Y).</li>
          <li>Stato <strong>attivo</strong>.</li>
        </ul>
      </div>

      <div class="callout callout-warn">
        Le richieste di <strong>malattia</strong> sono auto-approvate al momento della creazione e richiedono obbligatoriamente il protocollo INPS. Una malattia sovrapposta a una ferie già approvata fa apparire sulla ferie il badge "Sostituita da malattia".
      </div>
    </section>

    <section class="chapter" id="web-admin-esportazioni">
      <h2><span class="chapter-num">14</span>Esportazioni <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Genera file da consegnare al commercialista o da archiviare.</p>

      <div class="feature">
        <h3>Generare un'esportazione</h3>
        <ol class="steps">
          <li>Imposta <strong>Dal</strong> e <strong>Al</strong>.</li>
          <li>Scegli il <strong>formato</strong>: <em>XLSX (commercialista)</em> oppure <em>JSON</em>.</li>
          <li>Premi <strong>Genera</strong>.</li>
        </ol>
        <p>Il job entra in coda e si elabora in background.</p>
      </div>

      <div class="feature">
        <h3>Storico esportazioni</h3>
        <p>La tabella mostra periodo, formato, stato (<span class="pill">In coda</span> <span class="pill pill-warn">In elaborazione</span> <span class="pill pill-ok">Pronta</span> <span class="pill pill-err">Errore</span>) e data di creazione.</p>
        <p>Per i job pronti l'icona di download avvia lo scaricamento. L'icona rossa elimina lo storico.</p>
        <div class="callout callout-tip">
          La tabella si aggiorna automaticamente ogni 2 secondi finché ci sono job in coda o in elaborazione.
        </div>
      </div>

      <div class="feature">
        <h3>Cosa contiene il file</h3>
        <ul class="tidy">
          <li>Timbrature: evento, ora, sede, GPS, device.</li>
          <li>Ferie e permessi: durata, approvazione, motivo rifiuto.</li>
          <li>Anomalie rilevate nel periodo.</li>
          <li>Filtrabile per utente, sede e periodo prima della generazione.</li>
        </ul>
      </div>
    </section>

    <section class="chapter" id="web-admin-impostazioni">
      <h2><span class="chapter-num">15</span>Impostazioni <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Configurazione globale dell'azienda. Le modifiche si applicano a tutti gli utenti e si salvano automaticamente.</p>

      <div class="feature">
        <h3>Anagrafica e localizzazione</h3>
        <ul class="tidy">
          <li><strong>Ragione sociale</strong> e <strong>Partita IVA</strong> — sola lettura (modificabili dal provider).</li>
          <li><strong>Timezone</strong> — fuso orario aziendale (Europe/Rome di default).</li>
          <li><strong>Lingua</strong> — Italiano o English.</li>
          <li><strong>Paese</strong> — opzionale, sola lettura.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Politica dati</h3>
        <ul class="tidy">
          <li><strong>Retention</strong> — anni di conservazione dei dati.</li>
          <li><strong>Mock location</strong> — comportamento se viene rilevata una posizione GPS finta: <em>Consenti</em> / <em>Contrassegna</em> / <em>Blocca</em>.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Preferenze personali</h3>
        <p>Anche da admin gestisci qui le tue preferenze di notifica:</p>
        <ul class="tidy">
          <li><strong>Notifiche email</strong> — toggle per ricevere via email le decisioni e le richieste.</li>
          <li><strong>Push notifications</strong> — info sullo stato di registrazione del dispositivo (gestite dall'app mobile).</li>
        </ul>
        <p>Ogni modifica mostra un toast <em>Impostazione salvata</em> e persiste automaticamente.</p>
      </div>
    </section>

    <hr class="section-divider">

    <div class="platform-header">
      <div class="icon">👤</div>
      <div>
        <h2>Web · Dipendente</h2>
        <div class="sub">Le funzionalità a disposizione del singolo dipendente dal browser.</div>
      </div>
    </div>

    <section class="chapter" id="web-user">
      <h2><span class="chapter-num">16</span>Panoramica Web Dipendente</h2>
      <p class="lead">Sul Web il dipendente ha accesso a poche schermate: consultazione della propria posizione e storico, senza possibilità di gestione.</p>

      <div class="feature">
        <h3>Menu di navigazione</h3>
        <p>La sidebar di un dipendente contiene solo tre voci:</p>
        <div class="grid-2">
          <div class="mini-card"><div class="mini-title">Dashboard</div><div class="mini-desc">Il tuo stato attuale e ultime timbrature</div></div>
          <div class="mini-card"><div class="mini-title">Le mie timbrature</div><div class="mini-desc">Storico delle tue timbrature</div></div>
          <div class="mini-card"><div class="mini-title">Le mie richieste</div><div class="mini-desc">Richieste di correzione inviate</div></div>
        </div>
        <p>In basso trovi il tuo avatar con email, ruolo <em>Dipendente</em> e il pulsante <strong>Esci</strong>.</p>
        <div class="callout callout-info">
          Le funzioni di timbratura ingresso/uscita si trovano nell'app mobile, non sul Web (se non esplicitamente abilitato dall'amministratore).
        </div>
      </div>
    </section>

    <section class="chapter" id="web-user-dashboard">
      <h2><span class="chapter-num">17</span>La mia Dashboard <span class="badge badge-user">user</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Una pagina sintetica con il tuo stato attuale e le ultime timbrature.</p>

      <div class="feature">
        <h3>Card Stato</h3>
        <p>Mostra in evidenza:</p>
        <ul class="tidy">
          <li>Il tuo <strong>stato</strong> attuale: <span class="pill pill-ok">Al lavoro</span> / <span class="pill pill-warn">In pausa</span> / <span class="pill">Fuori servizio</span>.</li>
          <li>L'<strong>ultimo evento</strong> registrato, con orario (es. "Ingresso alle 09:15").</li>
          <li>Un suggerimento: per timbrare usa l'app mobile.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Ultime timbrature</h3>
        <p>Una tabella con le tue 8 timbrature più recenti: evento e data/ora. Il link <strong>Vedi tutte</strong> apre la pagina completa.</p>
      </div>
    </section>

    <section class="chapter" id="web-user-stamps">
      <h2><span class="chapter-num">18</span>Le mie timbrature <span class="badge badge-user">user</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Storico delle tue timbrature. Vedi solo le tue.</p>

      <div class="feature">
        <h3>La tabella</h3>
        <p>Colonne: <strong>Quando</strong> (data e ora), <strong>Evento</strong>, <strong>Origine</strong>, <strong>Note</strong>.</p>
        <p>Per impostazione predefinita vedi gli ultimi 90 giorni. Non puoi modificare o eliminare timbrature dal Web: per correzioni invia una <em>richiesta</em>.</p>
      </div>
    </section>

    <section class="chapter" id="web-user-corr">
      <h2><span class="chapter-num">19</span>Le mie richieste <span class="badge badge-user">user</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Tutte le richieste di correzione che hai inviato, in sola lettura.</p>

      <div class="feature">
        <h3>Lista richieste</h3>
        <p>Ogni richiesta è una card che mostra: data invio, stato (<span class="pill pill-warn">In attesa</span> <span class="pill pill-ok">Approvata</span> <span class="pill pill-err">Rifiutata</span> <span class="pill">Superata</span>), differenza tra valori attuali e richiesti, motivazione e — se decisa — nota dell'amministratore.</p>
        <div class="callout callout-info">
          Per <strong>creare</strong> una nuova richiesta di correzione devi usare l'app mobile.
        </div>
      </div>
    </section>

    <hr class="section-divider">

    <div class="platform-header mobile">
      <div class="icon">📱</div>
      <div>
        <h2>App Mobile · Dipendente</h2>
        <div class="sub">Il cuore quotidiano dell'app: timbrature, richieste e profilo personale.</div>
      </div>
    </div>

    <section class="chapter" id="mob-user">
      <h2><span class="chapter-num">20</span>Panoramica App Mobile</h2>
      <p class="lead">L'app mobile è disponibile per iOS e Android. La navigazione principale è una barra in basso con quattro tab.</p>

      <div class="feature">
        <h3>Le quattro schede principali</h3>
        <div class="grid-2">
          <div class="mini-card"><div class="mini-title">⏱ Timbrature</div><div class="mini-desc">Schermata principale per timbrare ingresso, uscita, pause</div></div>
          <div class="mini-card"><div class="mini-title">📅 Storico</div><div class="mini-desc">Storico delle tue timbrature per giorno</div></div>
          <div class="mini-card"><div class="mini-title">📝 Correzioni</div><div class="mini-desc">Richieste di correzione di timbrature</div></div>
          <div class="mini-card"><div class="mini-title">💼 Richieste</div><div class="mini-desc">Ferie, permessi, malattia</div></div>
        </div>
        <p>In alto a sinistra di ogni schermata trovi il tuo <strong>avatar</strong> (apre il Profilo). In alto a destra c'è la <strong>campanella notifiche</strong> con badge di non lette.</p>
      </div>
    </section>

    <section class="chapter" id="mob-user-timbra">
      <h2><span class="chapter-num">21</span>Timbrature <span class="badge badge-user">user</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">La home dell'app mobile. Da qui registri tutti gli eventi della tua giornata lavorativa.</p>

      <div class="feature">
        <h3>Card principale</h3>
        <p>In alto vedi sempre:</p>
        <ul class="tidy">
          <li><strong>Ore lavorate</strong> — totale aggiornato in tempo reale.</li>
          <li><strong>Ore conteggiate</strong> — basato sull'orario assegnato (se presente).</li>
          <li><strong>Entrata</strong>, <strong>Pause</strong>, <strong>Uscita</strong> — riepilogo della giornata.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Selezione sede</h3>
        <p>Se sei assegnato a più di una sede vedrai una serie di "pillole" orizzontali per scegliere dove stai lavorando. L'icona è un edificio per la sede in presenza, un laptop per smart working.</p>
        <div class="callout callout-info">
          Una volta timbrato l'ingresso, la sede si <strong>blocca</strong> fino alla timbratura di uscita: appare un'icona di lucchetto. Questo evita errori durante il turno.
        </div>
      </div>

      <div class="feature">
        <h3>Timbrare</h3>
        <p>I pulsanti cambiano in base allo stato:</p>
        <table>
          <thead><tr><th>Stato attuale</th><th>Azioni disponibili</th></tr></thead>
          <tbody>
            <tr><td><span class="pill">Fuori servizio</span></td><td><strong>Timbra ingresso</strong></td></tr>
            <tr><td><span class="pill pill-ok">Al lavoro</span></td><td><strong>Timbra uscita</strong> · <strong>Inizia pausa</strong> · <strong>Inizia pausa pranzo</strong></td></tr>
            <tr><td><span class="pill pill-warn">In pausa</span></td><td><strong>Termina pausa</strong></td></tr>
            <tr><td><span class="pill pill-warn">In pausa pranzo</span></td><td><strong>Termina pausa pranzo</strong></td></tr>
          </tbody>
        </table>
        <p>Tocca il pulsante e l'app:</p>
        <ol class="steps">
          <li>Verifica lo stato corrente.</li>
          <li>Se la sede richiede GPS, acquisisce la posizione (richiede permesso una volta).</li>
          <li>Invia la timbratura al server.</li>
          <li>Mostra "Timbratura riuscita" e aggiorna la schermata.</li>
        </ol>
      </div>

      <div class="feature">
        <h3>Annullare l'ultima timbratura</h3>
        <p>Appena registrata, sotto la card principale appare il link <strong>Annulla ultima timbratura</strong>. Hai 60 secondi per annullarla se hai sbagliato.</p>
        <div class="callout callout-warn">
          Dopo 60 secondi non è più annullabile direttamente: dovrai inviare una richiesta di <strong>correzione</strong>.
        </div>
      </div>

      <div class="feature">
        <h3>Cosa fare se la timbratura fallisce</h3>
        <ul class="tidy">
          <li><strong>"Senza connessione"</strong> — la timbratura viene messa in coda e inviata quando torni online. Apparirà l'avviso: <em>"Timbratura accodata. Verrà inviata quando torni online."</em></li>
          <li><strong>"Sei fuori dell'area consentita"</strong> — sei troppo distante dalla sede: avvicinati o cambia sede.</li>
          <li><strong>"Il segnale GPS è troppo debole"</strong> — l'accuratezza è insufficiente: esci all'aperto o riprova.</li>
          <li><strong>"Operazione non valida per lo stato attuale"</strong> — non puoi timbrare ingresso se sei già al lavoro, ecc.</li>
          <li><strong>"Hai già timbrato pochi secondi fa"</strong> — protezione contro doppio click.</li>
        </ul>
      </div>
    </section>

    <section class="chapter" id="mob-user-storico">
      <h2><span class="chapter-num">22</span>Storico timbrature <span class="badge badge-user">user</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">Riepilogo delle tue timbrature, raggruppate per giorno.</p>

      <div class="feature">
        <h3>Filtri rapidi</h3>
        <p>In alto tre pillole: <strong>7 giorni</strong>, <strong>30 giorni</strong>, <strong>90 giorni</strong>. Quella attiva è evidenziata.</p>
      </div>

      <div class="feature">
        <h3>Riepilogo totale</h3>
        <p>Una card riassuntiva mostra <strong>Totale lavorato</strong> nel periodo (es. "156h 45m") e il numero di <strong>giorni</strong> con almeno una timbratura.</p>
      </div>

      <div class="feature">
        <h3>Card per giorno</h3>
        <p>Ogni giorno è una card collassabile:</p>
        <ul class="tidy">
          <li>Etichetta: "Oggi", "Ieri" o data per esteso ("giovedì 23 maggio").</li>
          <li>Tempo di pausa se &gt; 0.</li>
          <li>Totale ore del giorno (badge arancione).</li>
        </ul>
        <p>Tocca la card per espanderla e vedere ogni singola timbratura del giorno con icona colorata (verde ingresso, rosso uscita, arancione pausa) e ora HH:MM.</p>
      </div>
    </section>

    <section class="chapter" id="mob-user-correzioni">
      <h2><span class="chapter-num">23</span>Correzioni <span class="badge badge-user">user</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">Richiedi la correzione di una timbratura sbagliata o l'aggiunta di una dimenticata.</p>

      <div class="feature">
        <h3>Le tue richieste</h3>
        <p>Due tab: <strong>In attesa</strong> e <strong>Tutte</strong>. Il badge sulla tab "In attesa" mostra il numero di richieste ancora da decidere. Tocca le tab oppure <strong>scorri a destra/sinistra</strong> sull'elenco per passare da una vista all'altra.</p>
        <p>Ogni richiesta è una card con: tipo evento (Ingresso/Uscita/...), stato (<span class="pill pill-warn">In attesa</span> <span class="pill pill-ok">Approvata</span> <span class="pill pill-err">Rifiutata</span>), differenza prima/dopo, motivazione e nota dell'approvatore se decisa.</p>
      </div>

      <div class="feature">
        <h3>Creare una nuova richiesta</h3>
        <p>Tocca il pulsante <strong>+</strong> in basso a destra. Si apre una procedura guidata in 3 passi:</p>
        <ol class="steps">
          <li><strong>Quale giorno?</strong> Seleziona dal calendario il giorno della timbratura da correggere (max oggi).</li>
          <li><strong>Quale timbratura?</strong> Tocca una timbratura del giorno per modificarla, oppure scegli <em>"Aggiungi una timbratura mancante"</em>.</li>
          <li><strong>Modifica</strong>:
            <ul class="tidy">
              <li>Tipo evento (4 opzioni).</li>
              <li>Orario corretto (selettore HH:MM, intervalli di 5 minuti).</li>
              <li>Sede (se ne hai più di una).</li>
              <li><strong>Motivazione</strong> (minimo 5 caratteri).</li>
            </ul>
          </li>
        </ol>
        <p>Premi <strong>Invia richiesta</strong>. L'amministratore (o l'approvatore designato) riceverà una notifica e deciderà.</p>
      </div>
    </section>

    <section class="chapter" id="mob-user-richieste">
      <h2><span class="chapter-num">24</span>Ferie / Permessi / Malattia <span class="badge badge-user">user</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">Tutte le richieste di assenza si gestiscono dalla scheda Richieste.</p>

      <div class="feature">
        <h3>Tab "Le mie" e "Da approvare"</h3>
        <p>Se sei amministratore vedi due tab: <strong>Le mie</strong> (le tue richieste) e <strong>Da approvare</strong> (quelle dei tuoi dipendenti, con badge sul numero pending). Tocca le tab oppure <strong>scorri a destra/sinistra</strong> sull'elenco per cambiare vista.</p>
      </div>

      <div class="feature">
        <h3>Quota disponibile</h3>
        <p>In cima alla tab "Le mie" trovi una card con i tuoi <strong>residui</strong>:</p>
        <ul class="tidy">
          <li><strong>Ferie</strong>: ore disponibili, con hint sui pending (es. "(15.75h dopo richieste in attesa)").</li>
          <li><strong>Permessi</strong>: stessa logica.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Inviare una richiesta</h3>
        <p>Tocca <strong>+</strong> in basso a destra. Si apre il modulo:</p>
        <ol class="steps">
          <li>Scegli il <strong>tipo</strong>: <span class="pill pill-info">Ferie</span> <span class="pill pill-warn">Permessi</span> <span class="pill pill-err">Malattia</span>.</li>
          <li>Indica <strong>Dal</strong> e <strong>Al</strong> (date).</li>
          <li>Per Ferie/Permessi puoi scegliere <em>Tutto il giorno</em> oppure attivare <strong>Orario specifico</strong> (ora inizio/fine).</li>
          <li>Per Malattia: inserisci il <strong>numero protocollo INPS</strong> (obbligatorio).</li>
          <li>Vedi chi è l'<strong>approvatore</strong> designato (o "Nessun approvatore configurato").</li>
          <li>Aggiungi una <strong>nota</strong> opzionale (es. "matrimonio fratello", "visita medica").</li>
          <li>Premi <strong>Invia richiesta</strong> (per Ferie/Permessi) o <strong>Invia segnalazione</strong> (per Malattia).</li>
        </ol>
      </div>

      <div class="feature">
        <h3>Le tue richieste</h3>
        <p>Ogni richiesta è una card con: tipo, stato, periodo, ore, eventuali note, motivo del rifiuto se applicabile.</p>
        <p>Stati possibili:</p>
        <table>
          <thead><tr><th>Stato</th><th>Significato</th></tr></thead>
          <tbody>
            <tr><td><span class="pill pill-warn">In attesa</span></td><td>L'approvatore deve ancora decidere.</td></tr>
            <tr><td><span class="pill pill-ok">Approvata</span></td><td>Approvata dall'amministratore.</td></tr>
            <tr><td><span class="pill pill-err">Rifiutata</span></td><td>Rifiutata, con motivo dichiarato.</td></tr>
            <tr><td><span class="pill">Annullata</span></td><td>Annullata da te o dall'admin.</td></tr>
            <tr><td><span class="pill pill-warn">Annullamento richiesto</span></td><td>Hai chiesto di annullare una ferie già approvata.</td></tr>
            <tr><td><span class="pill">Sostituita da malattia</span></td><td>Una malattia ha coperto lo stesso periodo.</td></tr>
          </tbody>
        </table>
      </div>

      <div class="feature">
        <h3>Annullare o richiedere annullamento</h3>
        <ul class="tidy">
          <li>Se la richiesta è <em>In attesa</em>: pulsante <strong>Annulla</strong> per ritirarla.</li>
          <li>Se è <em>Approvata</em> (e non malattia): pulsante <strong>Richiedi annullamento</strong> per chiedere all'admin di annullarla. Verrà richiesta una motivazione.</li>
        </ul>
        <div class="callout callout-info">
          La malattia è auto-approvata appena la invii: non passa dall'approvatore. Però necessita sempre del protocollo INPS.
        </div>
      </div>
    </section>

    <section class="chapter" id="mob-user-profilo">
      <h2><span class="chapter-num">25</span>Profilo <span class="badge badge-user">user</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">Le tue informazioni, le sedi assegnate e le preferenze di notifica.</p>

      <div class="feature">
        <h3>Apri il profilo</h3>
        <p>Tocca il tuo avatar in alto a sinistra in qualsiasi schermata.</p>
      </div>

      <div class="feature">
        <h3>Cosa vedi</h3>
        <ul class="tidy">
          <li><strong>Avatar</strong>, nome, email, ruolo (<em>Dipendente</em> o <em>Amministratore</em>).</li>
          <li><strong>Azienda</strong>: ragione sociale.</li>
          <li><strong>Sedi assegnate</strong>: lista con icona edificio o laptop e tag "In sede" o "Smart working".</li>
          <li><strong>Notifiche</strong>: stato delle push e dei singoli toggle.</li>
          <li><strong>Email</strong>: toggle per ricevere anche via email.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Gestire le notifiche push</h3>
        <p>Se le push sono <strong>attive</strong> sul dispositivo, vedi i toggle:</p>
        <ul class="tidy">
          <li><strong>Esiti ferie e permessi</strong> — quando vengono approvate o rifiutate.</li>
          <li><strong>Esiti correzioni</strong> — decisioni sulle tue correzioni.</li>
        </ul>
        <p>Se le push sono <strong>non attive</strong>: devi abilitarle nelle impostazioni del telefono.</p>
      </div>

      <div class="feature">
        <h3>Logout</h3>
        <p>In fondo alla schermata tocca <strong>Esci</strong> (rosso). Ti verrà chiesta una conferma.</p>
      </div>
    </section>

    <hr class="section-divider">

    <div class="platform-header mobile">
      <div class="icon">👔</div>
      <div>
        <h2>App Mobile · Amministratore</h2>
        <div class="sub">L'admin sull'app mobile ha tutte le funzioni del dipendente più quelle di approvazione.</div>
      </div>
    </div>

    <section class="chapter" id="mob-admin">
      <h2><span class="chapter-num">26</span>Panoramica Mobile Admin</h2>
      <p class="lead">Se sei amministratore, sull'app mobile puoi anche timbrare per te stesso, ma in più hai una tab di approvazioni e ricevi notifiche push per le nuove richieste.</p>

      <div class="callout callout-info">
        Sull'app mobile l'admin <strong>non</strong> gestisce utenti, sedi, orari, esportazioni o impostazioni: per queste funzioni serve il Web.
      </div>
    </section>

    <section class="chapter" id="mob-admin-correzioni">
      <h2><span class="chapter-num">27</span>Approvare correzioni <span class="badge badge-admin">admin</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">Dalla scheda <strong>Correzioni</strong>, oltre alla tab "Le mie", vedi anche le richieste da decidere.</p>

      <div class="feature">
        <h3>Tab "In attesa"</h3>
        <p>Mostra tutte le richieste di correzione che spettano a te (in base alla configurazione approvatori). Passa a <strong>Tutte</strong> per lo storico — tocca la tab o <strong>scorri a destra/sinistra</strong>.</p>
        <p>Ogni card mostra il dipendente, la differenza prima/dopo e la motivazione, con i pulsanti:</p>
        <ul class="tidy">
          <li><span class="pill pill-ok">Approva</span> — chiede conferma e applica la correzione.</li>
          <li><span class="pill pill-err">Rifiuta</span> — chiede il motivo del rifiuto e lo registra.</li>
        </ul>
      </div>
    </section>

    <section class="chapter" id="mob-admin-richieste">
      <h2><span class="chapter-num">28</span>Approvare ferie e permessi <span class="badge badge-admin">admin</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">Nella scheda <strong>Richieste</strong> appare la tab "Da approvare".</p>

      <div class="feature">
        <h3>Tab "Da approvare"</h3>
        <p>Vedi tutte le richieste pending. Tocca la tab oppure <strong>scorri a destra/sinistra</strong> per spostarti tra "Le mie" e "Da approvare". Per ognuna:</p>
        <ul class="tidy">
          <li><span class="pill pill-ok">Approva</span> — conferma con dialog riepilogativo.</li>
          <li><span class="pill pill-err">Rifiuta</span> — prompt obbligatorio per il motivo.</li>
        </ul>
        <p>Se la richiesta è in stato "Annullamento richiesto":</p>
        <ul class="tidy">
          <li><strong>Accetta annullamento</strong> — concede la cancellazione e libera la quota.</li>
          <li><strong>Rifiuta</strong> — mantiene la ferie approvata.</li>
        </ul>
      </div>
    </section>

    <section class="chapter" id="mob-admin-notifiche">
      <h2><span class="chapter-num">29</span>Notifiche admin <span class="badge badge-admin">admin</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">Solo per chi è amministratore: ulteriori toggle nel profilo.</p>

      <div class="feature">
        <h3>Toggle aggiuntivi nel profilo</h3>
        <ul class="tidy">
          <li><strong>Nuove richieste ferie e permessi</strong> — push quando un dipendente invia o richiede di annullare.</li>
          <li><strong>Nuove correzioni da approvare</strong> — push quando un dipendente invia una correzione.</li>
        </ul>
      </div>

      <div class="callout callout-tip">
        Il badge sull'icona dell'app (a livello di sistema operativo) riflette il numero di richieste in attesa di tua decisione: puoi capire al volo se c'è qualcosa da fare anche senza aprire l'app.
      </div>
    </section>

    <hr class="section-divider">

    <section class="chapter" id="geofence">
      <h2><span class="chapter-num">30</span>Geolocalizzazione</h2>
      <p class="lead">Come funziona il controllo della posizione durante le timbrature.</p>

      <div class="feature">
        <h3>Geofence</h3>
        <p>Per ogni sede l'admin definisce coordinate GPS e — opzionalmente — un <strong>raggio</strong> in metri. Quando il raggio è attivo, la timbratura è valida solo se sei entro questa area circolare.</p>
        <p>Se sei fuori vedi il messaggio <em>"Sei fuori dell'area consentita"</em> e — in base alla politica — la timbratura viene rifiutata (Strict) o solo segnalata (Lenient).</p>
      </div>

      <div class="feature">
        <h3>Sede senza raggio</h3>
        <p>Se l'admin disattiva il raggio per una sede, la timbratura viene accettata ovunque tu sia: la posizione GPS è comunque registrata sulla timbratura per audit, ma senza confronto con un'area. La sede non compare nell'auto-rilevamento: per usarla devi selezionarla manualmente nell'app prima di timbrare.</p>
      </div>

      <div class="feature">
        <h3>Smart working</h3>
        <p>Le sedi marcate come "smart working" non richiedono GPS. Tipico caso d'uso: lavoro da casa o trasferta.</p>
      </div>

      <div class="feature">
        <h3>Accuratezza GPS</h3>
        <p>L'app accetta solo posizioni con accuratezza migliore di un certo limite (default 100m). In ambienti chiusi o con cielo coperto il GPS può essere meno preciso: in quel caso esci all'aperto e riprova.</p>
      </div>

      <div class="feature">
        <h3>Mock location</h3>
        <p>Se il dispositivo rileva un'app di simulazione GPS, la timbratura viene contrassegnata come <em>sospetta</em> e gestita secondo l'impostazione dell'azienda:</p>
        <ul class="tidy">
          <li><strong>Consenti</strong> — la timbratura passa.</li>
          <li><strong>Contrassegna</strong> — la timbratura passa con marcatura visibile all'admin.</li>
          <li><strong>Blocca</strong> — la timbratura viene rifiutata.</li>
        </ul>
      </div>
    </section>

    <section class="chapter" id="notifiche">
      <h2><span class="chapter-num">31</span>Notifiche</h2>
      <p class="lead">Email e push notification: tipologie disponibili e dove configurarle.</p>

      <div class="feature">
        <h3>Quali notifiche puoi ricevere</h3>
        <table>
          <thead><tr><th>Tipo</th><th>Quando</th><th>Per chi</th></tr></thead>
          <tbody>
            <tr><td>Decisione ferie/permessi</td><td>Quando l'admin decide</td><td>Dipendente</td></tr>
            <tr><td>Decisione correzione</td><td>Quando l'admin decide</td><td>Dipendente</td></tr>
            <tr><td>Nuova richiesta ferie</td><td>All'invio da un dipendente</td><td>Admin</td></tr>
            <tr><td>Nuova correzione</td><td>All'invio da un dipendente</td><td>Admin</td></tr>
          </tbody>
        </table>
      </div>

      <div class="feature">
        <h3>Configurare le notifiche</h3>
        <ul class="tidy">
          <li><strong>Email</strong>: toggle nelle Impostazioni (web) o nel Profilo (mobile).</li>
          <li><strong>Push</strong>: toggle granulari per ciascun tipo nel Profilo dell'app mobile. Le push richiedono il permesso del sistema operativo.</li>
        </ul>
      </div>
    </section>

    <section class="chapter" id="offline">
      <h2><span class="chapter-num">32</span>Modalità offline</h2>
      <p class="lead">Cosa succede quando il telefono non ha connessione.</p>

      <div class="feature">
        <h3>Coda offline</h3>
        <p>Se provi a timbrare senza rete, l'app non perde il dato: lo mette in coda e lo invierà appena torni online. Appare l'avviso:</p>
        <p style="font-style: italic; padding: 12px; background: var(--color-surface-variant); border-radius: 6px;">"Timbratura accodata. Verrà inviata quando torni online."</p>
        <p>La coda è persistente: anche se chiudi l'app, alla riapertura — appena c'è connessione — i dati partono.</p>
      </div>

      <div class="feature">
        <h3>Protezione dai doppioni</h3>
        <p>Ogni timbratura ha una chiave di idempotenza: se per errore l'app prova a inviare due volte la stessa, il server ne accetta una sola.</p>
      </div>
    </section>

    <section class="chapter" id="glossario">
      <h2><span class="chapter-num">33</span>Glossario</h2>
      <p class="lead">Tutti i termini in ordine alfabetico.</p>

      <div class="feature">
        <table>
          <tbody>
            <tr><td><strong>Accantonamento</strong></td><td>L'accredito automatico di ore ferie/permessi a cadenza mensile o annuale.</td></tr>
            <tr><td><strong>Anomalia</strong></td><td>Deviazione tra timbrature e orario atteso.</td></tr>
            <tr><td><strong>Approvatore</strong></td><td>Admin designato a decidere su un tipo di richiesta per un dipendente specifico.</td></tr>
            <tr><td><strong>Audit log</strong></td><td>Registro delle modifiche manuali su timbrature (chi, quando, perché).</td></tr>
            <tr><td><strong>Badge</strong></td><td>Pillola colorata che indica stato o tipo (ferie, malattia, ecc.).</td></tr>
            <tr><td><strong>Correzione</strong></td><td>Richiesta del dipendente di modificare o aggiungere una timbratura.</td></tr>
            <tr><td><strong>Esportazione</strong></td><td>Job che produce un file XLSX o JSON con dati di un periodo.</td></tr>
            <tr><td><strong>Ferie</strong></td><td>Assenza retribuita a giornate, consuma quota ferie.</td></tr>
            <tr><td><strong>Geofence</strong></td><td>Area circolare attorno a una sede, definita da centro GPS e raggio in metri.</td></tr>
            <tr><td><strong>Lenient (geofence)</strong></td><td>Politica permissiva: timbratura fuori area passa ma viene segnalata.</td></tr>
            <tr><td><strong>Malattia</strong></td><td>Assenza per motivi sanitari, auto-approvata, richiede protocollo INPS.</td></tr>
            <tr><td><strong>Mock location</strong></td><td>Posizione GPS finta generata da app esterne.</td></tr>
            <tr><td><strong>Permesso</strong></td><td>Assenza retribuita a ore, granularità 15 minuti.</td></tr>
            <tr><td><strong>Quota</strong></td><td>Saldo di ore disponibili per ferie o permessi.</td></tr>
            <tr><td><strong>Revoca</strong></td><td>Annullamento di una ferie già approvata, su iniziativa dell'admin.</td></tr>
            <tr><td><strong>Sede</strong></td><td>Luogo di lavoro, con o senza geofencing. Il raggio può essere disattivato: in tal caso il GPS è registrato ma non confrontato con un'area.</td></tr>
            <tr><td><strong>Smart working</strong></td><td>Sede senza GPS, il dipendente lavora da remoto.</td></tr>
            <tr><td><strong>Strict (geofence)</strong></td><td>Politica restrittiva: timbratura fuori area viene rifiutata.</td></tr>
            <tr><td><strong>Superata</strong></td><td>Stato di una correzione obsoleta perché la timbratura è cambiata altrove.</td></tr>
            <tr><td><strong>Template orario</strong></td><td>Modello settimanale di slot lavorativi.</td></tr>
            <tr><td><strong>Template quota</strong></td><td>Modello di calcolo accantonamento ferie/permessi.</td></tr>
            <tr><td><strong>Timbratura</strong></td><td>Evento di ingresso, uscita, inizio/fine pausa o inizio/fine pausa pranzo.</td></tr>
            <tr><td><strong>Tolleranza</strong></td><td>Minuti di scostamento ammessi tra timbratura e orario atteso.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="chapter" id="faq">
      <h2><span class="chapter-num">34</span>Domande frequenti</h2>
      <p class="lead">Le situazioni più comuni e come gestirle.</p>

      <div class="feature">
        <h3>Ho dimenticato di timbrare l'ingresso. Cosa faccio?</h3>
        <p>Apri l'app mobile, vai nella scheda <strong>Correzioni</strong>, premi <strong>+</strong>, seleziona il giorno e scegli <em>"Aggiungi una timbratura mancante"</em>. Inserisci tipo, orario corretto e motivazione. L'admin riceverà la richiesta.</p>
      </div>

      <div class="feature">
        <h3>Ho timbrato dieci secondi fa per sbaglio. Posso annullare?</h3>
        <p>Sì, hai 60 secondi. Nella schermata Timbrature, sotto la card principale, appare il link <strong>Annulla ultima timbratura</strong>.</p>
      </div>

      <div class="feature">
        <h3>L'app dice che sono "fuori dall'area consentita" ma sono in ufficio.</h3>
        <p>Verifica che il GPS sia attivo, esci all'aperto qualche secondo per migliorare la precisione, poi riprova. Se il problema persiste contatta l'admin per controllare il raggio della sede.</p>
      </div>

      <div class="feature">
        <h3>Posso timbrare dal browser sul PC?</h3>
        <p>Solo se l'admin lo ha esplicitamente abilitato per te. Di default il clock-in da Web è disabilitato per evitare timbrature non geolocalizzate.</p>
      </div>

      <div class="feature">
        <h3>Quante ore di ferie ho?</h3>
        <p>Apri l'app mobile e vai nella scheda <strong>Richieste</strong>. In cima vedi i tuoi residui di Ferie e Permessi, con anche l'indicazione di cosa accadrebbe se le richieste pending venissero approvate.</p>
      </div>

      <div class="feature">
        <h3>Cosa succede se chiedo più ferie di quelle che ho?</h3>
        <p>La richiesta non viene bloccata: il counter può diventare negativo. È l'admin a decidere se approvarla. Puoi sempre verificare il residuo prima di inviare.</p>
      </div>

      <div class="feature">
        <h3>Sono in malattia, cosa devo fare?</h3>
        <p>Dall'app mobile → scheda <strong>Richieste</strong> → <strong>+</strong> → seleziona <strong>Malattia</strong>. Inserisci il protocollo INPS e le date. La richiesta è auto-approvata e copre eventuali ferie sovrapposte.</p>
      </div>

      <div class="feature">
        <h3>L'admin ha rifiutato la mia richiesta. Posso vedere perché?</h3>
        <p>Sì. La card della richiesta nella schermata mostra il motivo del rifiuto in un banner rosso.</p>
      </div>

      <div class="feature">
        <h3>Voglio cancellare una ferie già approvata.</h3>
        <p>Sulla card della richiesta approvata trovi il pulsante <strong>Richiedi annullamento</strong>. Indica il motivo: l'admin riceverà la tua richiesta di annullamento e potrà accettarla o rifiutarla.</p>
      </div>

      <div class="feature">
        <h3>Come cambio password?</h3>
        <p>Vai sulla pagina di login (sia Web sia Mobile), premi <strong>Password dimenticata?</strong>, inserisci la tua email e segui il link che ricevi via mail.</p>
      </div>

      <div class="feature">
        <h3>Non ricevo le notifiche push.</h3>
        <p>Verifica nell'app mobile: <strong>Profilo → Notifiche</strong>. Se la sezione dice "Non attive su questo dispositivo", apri le impostazioni del telefono e concedi alle notifiche all'app sonoQui. Poi torna nel profilo e attiva i singoli toggle.</p>
      </div>

      <div class="feature">
        <h3>Sono admin: dove gestisco gli utenti?</h3>
        <p>Sul Web → <strong>Utenti</strong>. L'app mobile non ha questa funzione: per modificare ruoli, sedi, orari o invitare nuovi dipendenti usa il browser.</p>
      </div>
    </section>

    <footer>
      <p><strong>sonoQui · Manuale Utente</strong></p>
    </footer>

  </main>
</div>
`;

export function Manual() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const scrollToHash = (hash: string) => {
      const id = hash.replace(/^#/, '');
      if (!id) return;
      const target = root.querySelector(`#${CSS.escape(id)}`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href^="#"]') as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      if (!href.startsWith('#') || href === '#') return;
      e.preventDefault();
      window.history.replaceState(null, '', `${window.location.pathname}${href}`);
      scrollToHash(href);
    };

    root.addEventListener('click', onClick);
    if (window.location.hash) scrollToHash(window.location.hash);
    return () => root.removeEventListener('click', onClick);
  }, []);

  return (
    <div
      ref={rootRef}
      className="manuale-root"
      style={{ margin: '-1.5rem -2rem -2.5rem' }}
      dangerouslySetInnerHTML={{ __html: MANUAL_BODY }}
    />
  );
}
