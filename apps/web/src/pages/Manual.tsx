import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { TOC_EN, MAIN_EN } from './Manual.en.ts';
import './Manual.css';

const TOC_IT = `
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
      <a href="#web-admin-residui" class="sub">Residui</a>
      <a href="#web-admin-esportazioni" class="sub">Esportazioni</a>
      <a href="#web-admin-documenti" class="sub">Documenti</a>
      <a href="#web-admin-impostazioni" class="sub">Impostazioni</a>

      <h3>Web · Dipendente</h3>
      <a href="#web-user">Panoramica</a>
      <a href="#web-user-dashboard" class="sub">La mia Dashboard</a>
      <a href="#web-user-stamps" class="sub">Le mie timbrature</a>
      <a href="#web-user-corr" class="sub">Le mie richieste</a>
      <a href="#web-user-documenti" class="sub">I miei documenti</a>
      <a href="#web-user-residui" class="sub">Residui</a>

      <h3>App Mobile · Dipendente</h3>
      <a href="#mob-user">Panoramica</a>
      <a href="#mob-user-timbra" class="sub">Timbrature</a>
      <a href="#mob-user-storico" class="sub">Storico</a>
      <a href="#mob-user-correzioni" class="sub">Correzioni</a>
      <a href="#mob-user-richieste" class="sub">Ferie / Permessi / Malattia</a>
      <a href="#mob-user-profilo" class="sub">Profilo</a>

      <h3>App Mobile · Amministratore</h3>
      <a href="#mob-admin">Panoramica</a>
      <a href="#mob-admin-dashboard" class="sub">Dashboard</a>
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
`;

const MAIN_IT = `

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
            <tr><td><strong>Sede</strong></td><td>Luogo di lavoro. Può richiedere geofencing GPS o essere "fuori sede" (nessun GPS).</td></tr>
            <tr><td><strong>Orario di lavoro</strong></td><td>Modello settimanale di slot lavorativi assegnato a un utente, usato per calcolare anomalie e ore.</td></tr>
            <tr><td><strong>Anomalia</strong></td><td>Deviazione tra timbrature reali e orario atteso (ritardo, assenza, pausa lunga, ecc.).</td></tr>
            <tr><td><strong>Correzione</strong></td><td>Richiesta del dipendente per modificare o aggiungere una timbratura dimenticata.</td></tr>
            <tr><td><strong>Correggi anomalia</strong></td><td>Menù dell'amministratore sull'anomalia: timbratura standard, inserimento ferie/permesso, o giustificazione con nota. Ogni intervento è tracciato nelle esportazioni.</td></tr>
            <tr><td><strong>Ferie</strong></td><td>Giorni di vacanza retribuiti. Consumano la quota ferie del dipendente.</td></tr>
            <tr><td><strong>Permesso</strong></td><td>Assenza a ore, con granularità di 15 minuti. Consuma la quota permessi.</td></tr>
            <tr><td><strong>Malattia</strong></td><td>Assenza per motivi sanitari con protocollo INPS. Auto-approvata.</td></tr>
            <tr><td><strong>Assenza</strong></td><td>Assenza generica (motivi personali, lutto, congedo, ecc.) retribuita o non retribuita. Non consuma quote.</td></tr>
            <tr><td><strong>Chiusura aziendale</strong></td><td>Evento creato dall'admin per più dipendenti in una volta (es. agosto). Può scalare le ferie o non intaccarle.</td></tr>
            <tr><td><strong>Festività</strong></td><td>Festività nazionali italiane (Capodanno, Pasqua, 15 agosto, Natale…) evidenziate automaticamente sul calendario.</td></tr>
            <tr><td><strong>Promemoria 24h</strong></td><td>Avviso inviato la sera prima dell'inizio di un'assenza approvata (es. "domani ferie").</td></tr>
            <tr><td><strong>Quota</strong></td><td>Saldo di ore disponibili per ferie/permessi, con accantonamento periodico.</td></tr>
            <tr><td><strong>Approvatore</strong></td><td>Utente (di solito admin) designato a decidere richieste di un dipendente.</td></tr>
            <tr><td><strong>Geofence</strong></td><td>Area geografica intorno alla sede entro cui sono accettate le timbrature.</td></tr>
            <tr><td><strong>Esportazione</strong></td><td>File XLSX, JSON o tracciato Centro Paghe (LUL) con timbrature, ferie e anomalie del periodo, scaricabile dal commercialista.</td></tr>
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
      <p class="lead">Stesse credenziali per Web e Mobile. L'amministratore crea il tuo account e ti invia l'email per impostare la password e accedere.</p>

      <div class="feature">
        <h3>Effettuare l'accesso</h3>
        <ol class="steps">
          <li>Apri <code class="inline">sonoqui.app</code> nel browser (Web) o l'app sonoQui (Mobile).</li>
          <li>Inserisci la tua email aziendale.</li>
          <li>Inserisci la password (l'icona occhio permette di mostrarla/nasconderla).</li>
          <li>Premi <strong>Accedi</strong>.</li>
        </ol>
        <p>Al primo accesso verrai indirizzato alla pagina iniziale del tuo ruolo: <em>Dashboard</em> per gli amministratori (sia su Web sia su Mobile), <em>La mia dashboard</em> (Web) o <em>Timbrature</em> (Mobile) per i dipendenti.</p>
        <div class="callout callout-info">
          Sull'app mobile puoi attivare lo <strong>sblocco con Face ID / Touch ID / impronta</strong> da <strong>Profilo → Sicurezza</strong>: l'app chiederà la biometria all'avvio invece di tenere la sessione sempre aperta. Vedi il capitolo <em>Profilo</em> (mobile).
        </div>
      </div>

      <div class="feature">
        <h3>Più aziende sullo stesso account</h3>
        <p>Se la tua email è associata a più aziende, dopo l'accesso comparirà la schermata <strong>Scegli l'azienda</strong>: seleziona quella su cui vuoi lavorare. Se invece appartieni a una sola azienda entri direttamente, senza passaggi extra.</p>
        <p>Puoi cambiare azienda in qualsiasi momento: sul <strong>Web</strong> dal nome dell'azienda in alto a sinistra (barra laterale) oppure da <strong>Impostazioni → Azienda attiva</strong>; nell'<strong>App Mobile</strong> da <strong>Profilo → Cambia azienda</strong>. L'app si ricarica con i dati e il ruolo della nuova azienda: potresti essere amministratore in un'azienda e dipendente in un'altra.</p>
        <div class="callout callout-info">
          Ogni azienda resta separata: timbrature, ferie e impostazioni non si mescolano mai tra aziende diverse.
        </div>
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
        <p class="muted">In alternativa, l'amministratore può reinviarti l'email di reimpostazione dalla pagina <strong>Utenti</strong> (icona a forma di chiave sulla tua riga).</p>
      </div>

      <div class="feature">
        <h3>Non hai ancora un account?</h3>
        <p>Solo l'amministratore della tua azienda può crearti l'utenza. Quando avvia la procedura di accesso riceverai un'email per impostare la password ed entrare.</p>
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
          <div class="mini-card"><div class="mini-title">Ferie &amp; Permessi</div><div class="mini-desc">Richieste, quote, modelli e residui</div></div>
          <div class="mini-card"><div class="mini-title">Esportazioni</div><div class="mini-desc">Export XLSX/JSON/Centro Paghe per il commercialista</div></div>
          <div class="mini-card"><div class="mini-title">Impostazioni</div><div class="mini-desc">Configurazione azienda</div></div>
        </div>
        <p>In basso nella sidebar trovi il tuo avatar con email, ruolo <em>Amministratore</em> e il pulsante <strong>Esci</strong>.</p>
        <div class="callout callout-tip">
          <strong>Scorciatoia:</strong> qualunque finestra di dialogo (creazione, modifica, conferma) si chiude premendo il tasto <strong>Esc</strong> sulla tastiera, oltre che con il pulsante <strong>Annulla</strong>.
        </div>
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
          <li><strong>Sedi</strong>: numero di sedi configurate / massimo previste dal piano.</li>
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
        <h3>Due viste: Lista e Griglia mensile</h3>
        <p>In alto trovi un selettore con due viste della stessa sezione:</p>
        <ul class="tidy">
          <li><strong>Lista</strong> — la tabella storica di tutte le timbrature (descritta qui sotto).</li>
          <li><strong>Griglia mensile</strong> — una matrice <em>dipendenti × giorni del mese</em>: ogni cella mostra le timbrature di quel dipendente in quel giorno (es. <em>08:30–12:30</em>), pensata per lavorare velocemente su un intero mese.</li>
        </ul>
        <p>Nella Griglia mensile:</p>
        <ul class="tidy">
          <li>Naviga tra i mesi con le frecce <strong>‹ ›</strong> o torna al mese corrente con <strong>Oggi</strong>.</li>
          <li>I dipendenti sono in <strong>colonna</strong> e i giorni in <strong>riga</strong>; il pulsante <strong>Inverti righe/colonne</strong> scambia gli assi.</li>
          <li>I colori segnalano lo stato della cella: <em>weekend</em> e <em>festività</em> in grigio/azzurro, <em>turno aperto</em> (uscita mancante in un giorno passato) in ambra.</li>
          <li>Filtra per <strong>dipendente</strong> (ricerca per nome o email) o per <strong>sede</strong>. I <strong>totali</strong> dipendono dall'orientamento: con i dipendenti in colonna, l'ultima colonna riporta il totale ore di <em>tutti</em> i dipendenti per ogni giorno e una riga finale <strong>Totale mese</strong> mostra il totale di ogni dipendente più il totale generale; invertendo gli assi, l'ultima colonna diventa il <strong>totale mese per dipendente</strong> e la riga finale i totali per giorno.</li>
          <li>Ogni cella mostra le coppie <em>ingresso–uscita</em> (es. <em>08:30–12:30</em>); un turno aperto mostra un <strong>·</strong> rosso al posto dell'uscita. Un'icona <strong>☕</strong> segnala la presenza di pause/pranzo e sotto compare il totale ore lavorate del giorno. Le celle vuote mostrano un <strong>+</strong> e restano cliccabili per inserire timbrature.</li>
          <li>La griglia carica fino a <strong>1000 timbrature</strong> per mese: se il limite viene raggiunto compare l'avviso «Troppe timbrature nel periodo: restringi con un filtro» — filtra per dipendente o sede per vedere il dato completo.</li>
          <li><strong>Clicca una cella</strong> per aprire l'editor del giorno: aggiungi, modifica o elimina le singole timbrature (ingresso/uscita/pause). La <strong>motivazione</strong> è precompilata e modificabile; ogni intervento resta tracciato in audit log esattamente come nella vista Lista.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>La tabella</h3>
        <p>Colonne disponibili:</p>
        <ul class="tidy">
          <li><strong>Quando</strong> — data e ora in formato italiano.</li>
          <li><strong>Utente</strong> — email del dipendente.</li>
          <li><strong>Evento</strong> — badge colorato (Ingresso, Uscita, Inizio/Fine pausa, Inizio/Fine pausa pranzo).</li>
          <li><strong>Origine</strong> — <em>app</em> (mobile), <em>correz.</em> (correzione approvata), <em>admin</em> (inserimento manuale) o <em>auto</em> (generata dal sistema, es. chiusura automatica oltre 15h).</li>
          <li><strong>Sede</strong> — la filiale registrata, o "—" se nessuna.</li>
          <li><strong>Note</strong> — eventuali annotazioni. Compare un indicatore <em>mock</em> se la posizione GPS è sospetta e <em>fuori area</em> se l'uscita è stata timbrata fuori dall'area della sede.</li>
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

      <div class="feature">
        <h3>Chiusura automatica dei turni oltre 15 ore</h3>
        <p>Per evitare turni rimasti aperti all'infinito (un dipendente che dimentica di timbrare l'uscita), il sistema chiude automaticamente ogni turno ancora aperto dopo <strong>15 ore</strong> dall'ingresso.</p>
        <ul class="tidy">
          <li>Viene inserita una timbratura di <strong>uscita</strong> esattamente a <strong>ingresso + 15h</strong> (può cadere il giorno successivo).</li>
          <li>L'origine della timbratura è <em>auto</em>, così la distingui da quelle inserite manualmente.</li>
          <li>Il controllo gira di continuo: un turno viene chiuso entro pochi minuti dal superamento delle 15h.</li>
        </ul>
        <div class="callout callout-info">
          A 14 ore il dipendente riceve già un <strong>promemoria</strong> "hai dimenticato di timbrare l'uscita?". La chiusura automatica a 15h è la rete di sicurezza se il promemoria viene ignorato. Se l'orario reale di uscita era diverso, correggi la timbratura manualmente.
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

      <div class="feature">
        <h3>Inviare una propria richiesta</h3>
        <p>Con il pulsante <strong>+ Nuova richiesta</strong> (in alto) anche l'amministratore può inviare una correzione per le <em>proprie</em> timbrature, con lo stesso flusso in tre passi dell'app mobile: scegli il giorno, seleziona la timbratura da correggere o segnala una mancante, poi indica evento, ora, sede e motivazione.</p>
        <div class="callout callout-info">
          Un amministratore vede <strong>Approva</strong>/<strong>Rifiuta</strong> anche sulle proprie richieste (tracciamento richiesta→approvazione); un dipendente, invece, sulle proprie richieste vede solo lo stato e non i pulsanti di decisione.
        </div>
      </div>
    </section>

    <section class="chapter" id="web-admin-utenti">
      <h2><span class="chapter-num">09</span>Utenti <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">L'anagrafica dipendenti, con ruolo, attivazione, sedi, orari e approvatori.</p>

      <div class="feature">
        <h3>Utilizzo licenze</h3>
        <p>In testa alla pagina dei contatori indicano <strong>Utenti</strong> attivi / massimo previsti dal piano, <strong>Amministratori</strong> attivi / massimo e <strong>Documentali</strong> attivi / massimo. Se raggiungi il limite il pulsante <em>Invita utente</em> viene disabilitato.</p>
      </div>

      <div class="feature">
        <h3>Invitare un nuovo dipendente</h3>
        <ol class="steps">
          <li>Premi <strong>Invita utente</strong>.</li>
          <li>Inserisci email (obbligatorio), nome e cognome (opzionali).</li>
          <li>Scegli il ruolo: <em>Utente</em> o <em>Admin</em>.</li>
          <li>Facoltativo: spunta <strong>Documentale</strong> per attribuire all'utente la capacità di caricare e consultare i documenti di <em>tutti</em> i dipendenti (vedi capitolo <em>Documenti</em>). È una capacità aggiuntiva, indipendente dal ruolo, assegnabile sia a un Admin sia a un dipendente. È limitata a <strong>1 Documentale per azienda</strong> (configurabile): se il tetto è già raggiunto la casella appare disabilitata.</li>
          <li>Scegli la <strong>lingua</strong> (Italiano o English): determina la lingua delle email che riceverà (reset password, notifiche). Preimpostata sulla lingua dell'interfaccia.</li>
          <li>Seleziona una o più <strong>sedi</strong> di assegnazione.</li>
          <li>Facoltativo: compila i <strong>dati paghe (Centro Paghe)</strong> — <em>codice fiscale</em>, <em>matricola</em> ed eventuali INAIL/qualifica. Puoi sempre aggiungerli o modificarli dopo dalla tabella utenti.</li>
          <li>Lascia spuntata <strong>Invia subito l'email per impostare la password</strong> (preimpostata) per dare accesso immediato: l'utente riceverà l'email e potrà accedere senza altri passaggi. Togli la spunta se preferisci crearlo ora e inviargli l'email più tardi.</li>
          <li>Premi <strong>Invita</strong>.</li>
        </ol>
        <p>Con la spunta attiva l'utente <strong>riceve subito l'email</strong> per impostare la password ed entrare. Se l'hai tolta, l'utente viene creato senza email: per dargli accesso premi poi l'icona <strong>reimposta password</strong> (a forma di chiave) sulla sua riga — oppure selezionalo e usa l'operazione in massa <strong>Invia reset password</strong>.</p>
      </div>

      <div class="feature">
        <h3>Operazioni sulla tabella utenti</h3>
        <p>Per ogni riga della tabella puoi:</p>
        <ul class="tidy">
          <li>Cambiare il <strong>ruolo</strong> (Admin / Utente) tramite select. <em>Non puoi cambiare il ruolo del tuo account</em>: la select è disabilitata sulla tua riga, così un admin non può declassarsi a Utente e perdere l'accesso.</li>
          <li>Attribuire o revocare la capacità <strong>Documentale</strong> con l'apposita spunta. È indipendente dal ruolo (può averla un Admin o un dipendente) e abilita l'utente a caricare e consultare i documenti di tutti i dipendenti (vedi capitolo <em>Documenti</em>). Vale il tetto di <strong>1 Documentale per azienda</strong> (configurabile): se è già occupato, la spunta è disabilitata sugli altri utenti.</li>
          <li>Attivare o disattivare l'utente con il toggle <strong>Attivo</strong>.</li>
          <li>Scegliere i <strong>metodi di timbratura</strong> consentiti (colonna <em>Timbratura</em>): <strong>GPS</strong> (da app mobile, presso la sede) e/o <strong>Da remoto</strong> (da web, senza verifica della posizione). Nessun metodo selezionato = l'utente non può timbrare e l'app non mostra il menu di timbratura.</li>
          <li>Modificare le <strong>sedi</strong> assegnate (multi-select).</li>
          <li>Assegnare un <strong>orario di lavoro</strong> (template + data inizio validità).</li>
          <li>Configurare gli <strong>approvatori</strong> per Correzioni, Ferie, Permessi, Malattia.</li>
          <li>Modificare nome e cognome.</li>
          <li>Compilare i <strong>dati paghe (Centro Paghe)</strong>: <em>codice fiscale</em>, <em>matricola</em> e, se servono, <em>INAIL</em> e <em>qualifica</em>. Servono per l'export Centro Paghe (LUL) e devono coincidere con l'anagrafica dipendente in paghe.</li>
          <li><strong>Reimpostare la password</strong> (icona a forma di chiave) — invia all'utente un'email per scegliere una nuova password. Serve a dare il <strong>primo accesso</strong> a un utente appena creato, o se ha smarrito le credenziali / dimenticato la password.</li>
          <li>Disattivare o eliminare definitivamente l'utente.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Operazioni in massa</h3>
        <p>Selezionando più utenti con il checkbox appare una barra dedicata:</p>
        <ul class="tidy">
          <li><strong>Assegna sedi</strong> — aggiunge le stesse sedi a tutti i selezionati.</li>
          <li><strong>Rimuovi sedi</strong> — toglie le sedi indicate da tutti.</li>
          <li><strong>Assegna orario</strong> — assegna lo stesso orario di lavoro a tutti (sostituisce quello attuale).</li>
          <li><strong>Timbratura</strong> — imposta gli stessi metodi di timbratura (GPS / Da remoto) su tutti.</li>
          <li><strong>Approvatori ferie</strong> e <strong>Approvatori correzioni</strong> — impostano gli stessi approvatori su tutti (sostituiscono quelli attuali).</li>
          <li><strong>Invia reset password</strong> — invia a tutti i selezionati l'email per impostare la password (comodo per il primo accesso di utenti appena creati).</li>
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
        <p>La colonna <strong>Metodi timbratura</strong> è inclusa nell'export ed è riconosciuta in import: valori <em>GPS</em>, <em>Da remoto</em> (anche combinati con la virgola) oppure <em>Nessuno</em>. Se la colonna è assente o la cella è vuota, i metodi dell'utente restano invariati.</p>
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
      <p class="lead">I luoghi di lavoro dell'azienda. Possono richiedere il GPS (geofencing) oppure essere fuori sede.</p>

      <div class="feature">
        <h3>Utilizzo licenze</h3>
        <p>In testa alla pagina un contatore indica le <strong>Sedi</strong> attive / massimo previste dal piano. Se raggiungi il limite il pulsante <em>Nuova sede</em> viene disabilitato.</p>
      </div>

      <div class="feature">
        <h3>Creare una nuova sede</h3>
        <ol class="steps">
          <li>Premi <strong>Nuova sede</strong>.</li>
          <li>Inserisci un <strong>nome</strong> identificativo.</li>
          <li>Digita l'<strong>indirizzo</strong> nell'autocomplete (suggerimenti Google Places).</li>
          <li>Se l'indirizzo suggerito non è preciso, <strong>clicca o trascina il punto sulla mappa</strong>: l'indirizzo viene ricavato automaticamente dal punto scelto (reverse geocoding). Il punto sulla mappa è sempre la posizione che fa fede.</li>
          <li>Decidi se è una sede <strong>Fuori sede</strong>: se sì, GPS e raggio non servono.</li>
          <li>Altrimenti imposta latitudine, longitudine (già popolate dall'indirizzo o dal punto sulla mappa).</li>
          <li>Decidi se <strong>limitare la timbratura entro un raggio</strong>:
            <ul class="tidy">
              <li><strong>Attivo</strong> (default): imposta il <strong>raggio</strong> in metri (default 300m). La timbratura di ingresso fuori dal raggio viene rifiutata; l'uscita viene accettata ma segnalata come anomalia.</li>
              <li><strong>Disattivo</strong>: la timbratura è accettata indipendentemente dalla distanza dalla sede. Il GPS viene comunque registrato sulla timbratura per audit. La sede non viene auto-rilevata: il dipendente deve selezionarla manualmente nell'app.</li>
            </ul>
          </li>
          <li>Premi <strong>Salva</strong>.</li>
        </ol>
      </div>

      <div class="feature">
        <h3>Card sede</h3>
        <p>Ogni sede appare come una card con nome, indirizzo, tipo (fuori sede, geolocalizzata con raggio, o geolocalizzata senza raggio) e — per le sedi con raggio attivo — un'anteprima della mappa con cerchio del raggio.</p>
        <p>Pulsanti per modificare o eliminare la sede. L'eliminazione richiede conferma.</p>
      </div>

      <div class="callout callout-info">
        Una sede <strong>fuori sede</strong> non ha GPS: il dipendente può timbrare ovunque senza vincoli di geolocalizzazione (lavoro da remoto, trasferte, cantieri). Una sede <strong>senza raggio</strong> registra comunque il GPS ma non lo confronta con un'area: utile per sedi con perimetro non definibile (cantieri estesi, trasferte presso clienti).
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
          <li>Scegli se conteggiare gli <strong>straordinari</strong> e il <strong>blocco</strong> di calcolo (15, 30 o 60 minuti): il tempo oltre l'orario previsto è contato in blocchi interi, un blocco non completo non viene contato (es. uscita prevista 18:00, reale 18:28 → con blocchi da 30 min nessuno straordinario, da 15 min vengono contati 15 minuti).</li>
          <li>Per ogni giorno della settimana aggiungi uno o più <strong>slot</strong> (orario inizio - orario fine). Aggiungendo un secondo slot nello stesso giorno, gli orari del precedente vengono copiati come punto di partenza, così basta modificarli.</li>
          <li>Imposta le <strong>penalità</strong> per superamento tolleranze su entrata, uscita e pausa. Un permesso o una ferie approvati che coprono lo scostamento (es. permesso 16:00–18:00 a fine turno) annullano la penalità su entrata/uscita.</li>
          <li>Opzionale: attiva <strong>Orario flessibile</strong> e/o imposta la pausa pranzo automatica per giorno (vedi sotto).</li>
          <li>Premi <strong>Salva</strong>.</li>
        </ol>
      </div>

      <div class="feature">
        <h3>Orario flessibile (flextime)</h3>
        <p>Attivando <strong>Orario flessibile</strong> l'orario passa da "a fasce fisse" a <strong>flextime</strong>: l'obiettivo diventa il <strong>totale di ore lavorate</strong> (la somma delle fasce), non l'orario fisso di entrata/uscita.</p>
        <ul class="tidy">
          <li><strong>Entrata / Uscita — prima e dopo</strong>: minuti di flessibilità attorno agli orari previsti. Entro la finestra non scattano "Entrata in ritardo" né "Uscita anticipata"; oltre la finestra valgono le normali tolleranze e penalità.</li>
          <li><strong>Pausa pranzo — prima e dopo</strong>: per i turni spezzati, allarga la finestra in cui la pausa pranzo può essere timbrata. La <em>durata</em> resta governata da pausa pranzo min/max: questa finestra controlla solo <em>quando</em> viene presa. Una pausa fuori finestra genera l'anomalia "Pausa pranzo fuori finestra".</li>
          <li><strong>Straordinario e ore mancanti</strong>: in flextime si calcolano sulla durata lavorata. Es. entrata 10:00, uscita 19:00, pausa 30 min, obiettivo 8h → nessuno straordinario né ammanco; chi entra alle 10:00 ed esce alle 18:00 ha "Ore insufficienti".</li>
        </ul>
        <div class="callout callout-info">
          Le finestre di entrata, uscita e pausa pranzo sono <strong>indipendenti</strong>: arrivare tardi (entro la flessibilità) non sposta la finestra della pausa o dell'uscita. A contare è sempre il totale di ore lavorate.
        </div>
      </div>

      <div class="feature">
        <h3>Pausa pranzo automatica (senza spezzare la fascia)</h3>
        <p>Per ogni giorno con <strong>un'unica fascia</strong> puoi indicare i minuti di <strong>pausa pranzo</strong> accanto agli orari. Quei minuti vengono <strong>detratti automaticamente</strong> dal tempo di presenza e la pausa può essere presa a piacere, <em>senza timbrarla</em>.</p>
        <p>Esempio: fascia 09:00–17:30 con 30 minuti di pausa pranzo → vengono conteggiate 8h. Nei giorni con pausa automatica l'app mobile <strong>nasconde il pulsante "Inizio pranzo"</strong> e le anomalie sulla durata di pausa/pausa pranzo non si applicano.</p>
        <div class="callout callout-tip">
          La pausa pranzo automatica è alternativa al turno spezzato: usa il turno spezzato (due fasce) quando l'orario della pausa è fisso, la pausa automatica quando il dipendente può sceglierlo liberamente.
        </div>
      </div>

      <div class="feature">
        <h3>Card orario</h3>
        <p>Ogni modello mostra nome, descrizione, tolleranze, totale ore settimanali e un'anteprima a griglia degli slot per giorno.</p>
        <p>Pulsanti per duplicare, modificare o eliminare il modello (è bloccata l'eliminazione se ci sono utenti attivi assegnati). Il pulsante <strong>Duplica</strong> crea una copia identica (orari e impostazioni) chiamata "Copia di …", da aprire e adattare senza ripartire da zero.</p>
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
            <tr><td><span class="pill pill-warn">Entrata in ritardo</span></td><td>Ingresso oltre la tolleranza configurata, salvo permesso/ferie approvati che coprono il ritardo.</td></tr>
            <tr><td><span class="pill pill-warn">Uscita anticipata</span></td><td>Uscita prima della tolleranza configurata, salvo permesso/ferie approvati che coprono l'anticipo.</td></tr>
            <tr><td><span class="pill pill-warn">Ore insufficienti</span></td><td>Ore lavorate inferiori all'orario atteso.</td></tr>
            <tr><td><span class="pill pill-purple">Lavoro in giorno di riposo</span></td><td>Timbrature in un giorno non previsto dal turno.</td></tr>
            <tr><td><span class="pill pill-info">Pausa troppo breve</span></td><td>Pausa inferiore al minimo atteso.</td></tr>
            <tr><td><span class="pill pill-info">Pausa troppo lunga</span></td><td>Pausa superiore al massimo atteso.</td></tr>
            <tr><td><span class="pill pill-info">Pausa pranzo troppo breve</span></td><td>Pausa pranzo inferiore al minimo atteso.</td></tr>
            <tr><td><span class="pill pill-info">Pausa pranzo troppo lunga</span></td><td>Pausa pranzo superiore al massimo atteso.</td></tr>
            <tr><td><span class="pill pill-info">Pausa pranzo fuori finestra</span></td><td>In orario flessibile, pausa pranzo timbrata fuori dalla finestra consentita (pausa prevista ± la flessibilità impostata).</td></tr>
            <tr><td><span class="pill pill-purple">Uscita fuori area</span></td><td>Uscita timbrata fuori dall'area della sede (es. da casa). L'uscita è sempre permessa ma viene registrata con questa anomalia, con la distanza dalla sede quando disponibile. Indipendente dal turno: compare anche per utenti senza orario assegnato.</td></tr>
          </tbody>
        </table>
      </div>

      <div class="feature">
        <h3>Correggere un'anomalia</h3>
        <p>Su ogni anomalia premi <strong>Correggi</strong>: si apre un menù a tendina con le correzioni tipiche. Scegli l'azione, controlla il <strong>riepilogo</strong> delle modifiche e premi <strong>Conferma</strong>.</p>
        <table>
          <thead><tr><th>Azione</th><th>Cosa fa</th></tr></thead>
          <tbody>
            <tr><td><strong>Timbratura standard (orari del giorno)</strong></td><td>Aggiunge i soli timbri mancanti (ingresso e/o uscita) agli orari previsti dal turno. Non modifica i timbri reali già presenti. Disponibile solo quando manca un timbro.</td></tr>
            <tr><td><strong>Inserisci ferie</strong></td><td>Crea le ferie sul giorno dell'anomalia per conto del dipendente. Già approvate; le ore sono calcolate dall'orario assegnato.</td></tr>
            <tr><td><strong>Inserisci permesso</strong></td><td>Crea un permesso a ore. La finestra proposta copre il periodo non lavorato (gap), modificabile con i pulsanti −/+ a passi di 15 minuti.</td></tr>
            <tr><td><strong>Giustifica con nota</strong></td><td>Annota l'anomalia con una motivazione, senza modificare timbri o assenze. L'anomalia resta visibile ma giustificata. Disponibile per qualsiasi tipo.</td></tr>
          </tbody>
        </table>
        <p><strong>Notifica al dipendente:</strong> per ferie e permessi inseriti dall'admin il dipendente riceve una notifica dedicata (push ed email) che spiega che è stata l'amministrazione a inserire l'assenza per correggere un'anomalia — distinta dalla conferma di una richiesta approvata. L'eventuale <em>nota per il dipendente</em> è inclusa nella notifica.</p>
        <p><strong>Tracciabilità nelle esportazioni:</strong> ogni correzione resta documentata nei file XLSX/JSON. I timbri aggiunti compaiono nel foglio <em>Timbrature</em> con origine "Manuale (admin)" e nota; le ferie/permessi inseriti dall'admin nel foglio <em>Ferie e Permessi</em> con colonna <em>Origine</em> = "Inserito da admin"; le giustificazioni con nota nel foglio dedicato <em>Giustifiche anomalie</em>.</p>
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
        <p>Con il pulsante <strong>+ Nuova richiesta</strong> (in alto a destra) anche l'amministratore può inviare una propria richiesta di Ferie, Permesso, Malattia o Assenza, esattamente come dall'app mobile.</p>
      </div>

      <div class="feature">
        <h3>Compilare una richiesta</h3>
        <p>Nel modulo <strong>+ Nuova richiesta</strong> scegli prima il <strong>Tipo</strong> (Ferie, Permesso, Malattia, Assenza). Per Ferie e Permessi indichi il periodo in due modi, con <strong>data e orario su campi separati</strong>:</p>
        <ul class="tidy">
          <li><strong>Tutto il giorno</strong> (predefinito) — selezioni un intervallo di date <em>Dal</em> … <em>Al</em>: l'assenza copre l'intera giornata lavorativa di ogni giorno del periodo.</li>
          <li><strong>Permesso a ore</strong> — togli la spunta da <em>Tutto il giorno</em>: compaiono il campo <em>Giorno</em> e, separati, l'ora di inizio (<em>Dalle ore</em>) e di fine (<em>Alle ore</em>), regolabili a passi di 15 minuti.</li>
        </ul>
        <p>Sotto i campi compare in tempo reale il <strong>Totale richiesto</strong> in ore, già limitato all'orario di lavoro assegnato (un permesso non può valere più della giornata prevista).</p>
      </div>

      <div class="feature">
        <h3>Tab Calendario</h3>
        <p>Una vista calendario di tutte le assenze aziendali, con selettore <strong>Giorno / Settimana / Mese / Anno</strong>. Ogni evento è colorato per tipo (Ferie, Permesso, Malattia, Assenza, Chiusura) e le <strong>festività nazionali italiane</strong> (Capodanno, Pasqua, 25 aprile, Ferragosto, Natale…) sono evidenziate automaticamente.</p>
        <ul class="tidy">
          <li><strong>Filtro utenti</strong> — i chip in alto attivano/disattivano i singoli dipendenti; "Tutti"/"Nessuno" per selezione rapida.</li>
          <li><strong>+ Inserisci evento</strong> — apre il modulo per assegnare un evento a più dipendenti in una volta (es. <em>Chiusura aziendale agosto</em>).</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Inserire un evento aziendale</h3>
        <p>Dal pulsante <strong>+ Inserisci evento</strong> nel Calendario indichi:</p>
        <ul class="tidy">
          <li><strong>Titolo</strong> (es. "Chiusura aziendale agosto"), <strong>Dal</strong> e <strong>Al</strong>.</li>
          <li><strong>Conteggia come ferie</strong> — se attivo l'evento scala dal monte ore ferie di ciascun dipendente; se disattivo è una chiusura che non intacca le ferie.</li>
          <li><strong>Destinatari</strong> — Tutti i dipendenti attivi, oppure una selezione.</li>
        </ul>
        <p>Alla conferma ogni destinatario riceve una <strong>notifica</strong> (push ed email, secondo le sue preferenze) e l'evento compare subito sul suo calendario.</p>
      </div>

      <div class="feature">
        <h3>Tab Quote</h3>
        <p>Per ogni utente vedi il <strong>saldo Ferie</strong> e il <strong>saldo Permessi</strong> con il relativo accredito automatico. Premi sul saldo (o su <strong>Assegna</strong> se manca) per cambiare l'assegnazione: template, saldo iniziale e data inizio.</p>
        <p><strong>Assegnazione multipla:</strong> seleziona più dipendenti con le caselle a sinistra (o la casella in testata per tutti), poi premi <strong>Assegna quota</strong> nella barra che compare in alto. Scegli tipo (Ferie o Permessi), modello, saldo iniziale e data: la quota viene assegnata a tutti i selezionati in un colpo. Chi ha già una quota dello stesso tipo viene sovrascritto (la precedente si chiude).</p>
        <p>Nella colonna <strong>Azioni</strong> trovi due strumenti per ogni dipendente:</p>
        <ul class="tidy">
          <li><strong>Modifica manuale ore</strong> (icona ±) — apre una finestra dove scegli il tipo (Ferie o Permessi), l'operazione <strong>Aggiungi</strong> o <strong>Rimuovi</strong>, il numero di ore, la data e una nota facoltativa. È il modo per correggere a mano il saldo di un singolo dipendente (es. accreditare ore residue dell'anno precedente o scalare un permesso gestito fuori sistema). La modifica si riflette <em>subito</em> sul residuo del dipendente, anche nella sua app.</li>
          <li><strong>Storico modifiche</strong> (icona orologio) — apre il registro completo di tutti gli accrediti e le modifiche di quell'utente: data, tipo, variazione (in verde le aggiunte, in rosso le rimozioni), sorgente (<em>Automatico</em> per gli accrediti periodici, <em>Manuale</em> o <em>Rettifica</em> per gli interventi dell'admin), nota e <strong>chi</strong> ha eseguito l'operazione.</li>
        </ul>
        <div class="callout callout-info">
          <strong>Residuo</strong> = saldo iniziale + accantonamenti (automatici e manuali) − usati approvati. I "pending" non si contano subito, quindi il counter può diventare negativo se le richieste in attesa superano il residuo.
        </div>
        <div class="callout callout-info">
          Il registro è <strong>append-only</strong>: una rimozione viene salvata come riga negativa, non cancella lo storico. Così ogni intervento manuale resta sempre tracciato e verificabile.
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

      <div class="feature" id="web-admin-residui">
        <h3>Tab Residui</h3>
        <p>La <strong>tab Residui</strong> (l'ultima in Ferie &amp; Permessi) mostra una tabella con le ore residue di ferie e permessi di <strong>tutti i dipendenti</strong>. Anche chi non ha una quota assegnata compare in elenco, con i valori indicati come «—». Una riga per dipendente e tipo, con le colonne:</p>
        <ul class="tidy">
          <li><strong>Saldo iniziale</strong> — ore assegnate all'avvio della quota.</li>
          <li><strong>Maturato</strong> — accantonamenti accumulati nel tempo.</li>
          <li><strong>Usato</strong> — ore già approvate e consumate.</li>
          <li><strong>In attesa</strong> — ore di richieste pending non ancora decise.</li>
          <li><strong>Residuo</strong> — saldo iniziale + maturato − usato approvato.</li>
          <li><strong>Residuo con pending</strong> — cosa resterebbe se tutte le richieste in attesa venissero approvate.</li>
        </ul>
        <p>La tabella è ordinabile, filtrabile ed esportabile dai pulsanti in alto a destra. È una vista in sola lettura: per <em>modificare</em> le quote usa la tab <strong>Quote</strong> di Ferie &amp; Permessi.</p>
      </div>
    </section>

    <section class="chapter" id="web-admin-esportazioni">
      <h2><span class="chapter-num">14</span>Esportazioni <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Genera file da consegnare al commercialista o da archiviare.</p>

      <div class="feature">
        <h3>Generare un'esportazione</h3>
        <ol class="steps">
          <li>Imposta <strong>Dal</strong> e <strong>Al</strong>.</li>
          <li>Scegli il <strong>formato</strong>: <em>XLSX (commercialista)</em>, <em>JSON</em> oppure <em>Centro Paghe (LUL)</em>.</li>
          <li>Premi <strong>Genera</strong>.</li>
        </ol>
        <p>Il job entra in coda e si elabora in background.</p>
        <div class="callout callout-tip">
          Con il formato <strong>Centro Paghe</strong> il periodo è bloccato su un mese intero (dal primo all'ultimo giorno): il file è per singola azienda e singolo mese.
        </div>
      </div>

      <div class="feature">
        <h3>Storico esportazioni</h3>
        <p>La tabella mostra periodo, formato, stato (<span class="pill">In coda</span> <span class="pill pill-warn">In elaborazione</span> <span class="pill pill-ok">Pronta</span> <span class="pill pill-err">Errore</span>) e data di creazione.</p>
        <p>Per i job pronti l'icona <strong>Scarica</strong> (freccia verso il basso) avvia lo scaricamento. L'icona rossa del cestino rimuove la voce dallo storico (dopo conferma) ed è disponibile per qualsiasi stato: utile per ripulire i job in errore o in coda.</p>
        <div class="callout callout-tip">
          La tabella si aggiorna automaticamente ogni 2 secondi finché ci sono job in coda o in elaborazione.
        </div>
      </div>

      <div class="feature">
        <h3>Cosa contiene il file XLSX</h3>
        <p>Il file XLSX è un foglio di calcolo multi-scheda pensato per il commercialista e per la busta paga. Contiene:</p>
        <ul class="tidy">
          <li><strong>Riepilogo</strong>: una riga per dipendente con ore lavorate, straordinari, pause, ferie, permessi, malattia, giorni lavorati e residui di ferie e permessi.</li>
          <li><strong>Una scheda per dipendente</strong>: dettaglio giorno per giorno (ore lavorate, straordinari, ferie/permessi/malattia, pause, marker assenza).</li>
          <li><strong>Timbrature</strong>: ogni timbratura con data e ora, evento, origine, sede, GPS, dispositivo e note.</li>
          <li><strong>Correzioni</strong>: le richieste di correzione del periodo con stato, esito e nota di risoluzione.</li>
          <li><strong>Ferie e Permessi</strong>: ferie, permessi, malattia e assenze con ore, retribuzione, sottotipo, protocollo INPS ed esito.</li>
          <li><strong>Eventi aziendali</strong>: chiusure e altri eventi imposti dall'azienda, con dipendenti coinvolti e ore totali.</li>
          <li><strong>Ferie residue</strong>: saldo iniziale, maturato, usato e residuo per ogni dipendente.</li>
          <li><strong>Metadati</strong>: periodo, data di generazione e conteggi.</li>
        </ul>
        <p>Il formato <strong>JSON</strong> contiene il riepilogo aggregato per dipendente, utile per integrazioni con altri software.</p>
      </div>

      <div class="feature">
        <h3>Formato Centro Paghe (LUL)</h3>
        <p>Il formato <strong>Centro Paghe</strong> genera il tracciato a lunghezza fissa <em>ORARIO</em> (record da 200 byte) per l'import delle presenze e dei giustificativi nel LIBRO UNICO. Il file segue lo standard Centro Paghe: un record di tipo 1 per ogni giorno, i totali mensili (tipo 2) e gli eventi INPS di malattia (tipo 3). Il nome file è <code>ORARIO_&lt;codice ditta&gt;_&lt;MMAAAA&gt;.TXT</code>.</p>
        <div class="callout callout-warn">
          Prima del primo export configura in <strong>Impostazioni → Centro Paghe</strong>: il <strong>codice ditta</strong> (7 caratteri), la lunghezza dei codici (2 o 4 caratteri) e l'associazione dei <strong>codici giustificativo</strong> (ferie, malattia, straordinario, ecc.). Per ogni dipendente compila in <strong>Utenti</strong> i campi paghe: <em>codice fiscale</em>, <em>matricola</em> ed eventuali INAIL/qualifica. Questi dati devono coincidere con l'anagrafica in Centro Paghe.
        </div>
        <ul class="tidy">
          <li><strong>Ore lavorate</strong> ordinarie e <strong>straordinario</strong> (codice separato) per giorno e in totale.</li>
          <li><strong>Giustificativi</strong> (ferie, permessi, malattia, assenze e sottotipi) mappati sui codici Centro Paghe scelti in Impostazioni.</li>
          <li><strong>Timbrature</strong> entrata/uscita (fino a 4 coppie al giorno) e ore teoriche dal turno assegnato.</li>
          <li><strong>Eventi INPS</strong> di malattia con protocollo, quando presente.</li>
        </ul>
      </div>
    </section>

    <section class="chapter" id="web-admin-impostazioni">
      <h2><span class="chapter-num">15</span>Impostazioni <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Configurazione globale dell'azienda. Le modifiche si applicano a tutti gli utenti e si salvano automaticamente.</p>

      <div class="feature">
        <h3>Anagrafica e localizzazione</h3>
        <ul class="tidy">
          <li><strong>Ragione sociale</strong> — sola lettura (modificabile dal provider). <strong>Partita IVA</strong> — modificabile dall'amministratore (11 cifre).</li>
          <li><strong>Timezone</strong> — fuso orario aziendale (Europe/Rome di default).</li>
          <li><strong>Lingua</strong> — Italiano o English. All'inizio l'app usa la lingua del browser (le lingue diverse da italiano e inglese ripiegano su <em>English</em>); resta una preferenza <em>personale</em> che vale solo per il tuo account e la cambi qui (su mobile da <em>Profilo → Lingua</em>).</li>
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
        <h3>Centro Paghe (export LUL)</h3>
        <p>Sezione visibile solo agli amministratori, per configurare l'export <strong>Centro Paghe</strong> (vedi cap. Esportazioni). Le modifiche si salvano automaticamente.</p>
        <ul class="tidy">
          <li><strong>Codice ditta</strong> — 7 caratteri, deve coincidere con il codice azienda in Centro Paghe.</li>
          <li><strong>Lunghezza codici giustificativo</strong> — <em>4 caratteri</em> (mnemonico completo) oppure <em>2 caratteri</em> (per le ditte con stampa a pagina unica / LUL).</li>
          <li><strong>CF centro trasfusionale</strong> — CF/P.IVA del centro raccolta, riportato nelle righe di donazione sangue.</li>
          <li><strong>Codici giustificativo</strong> — per ogni voce (ferie, permessi, malattia, straordinario, chiusura e i sottotipi di assenza) scegli il codice Centro Paghe corrispondente. Lascia vuoto per non esportare quella voce. <em>Chiusura aziendale</em> non ha un default: va scelto in base al CCNL.</li>
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

      <div class="feature">
        <h3>Azienda attiva</h3>
        <p>Se il tuo account è collegato a <strong>più aziende</strong>, qui compare la sezione <strong>Azienda attiva</strong> con un menù a tendina per scegliere su quale azienda lavorare. Selezionandone un'altra, l'app si ricarica con i dati e il ruolo della nuova azienda (potresti essere amministratore in una e dipendente in un'altra) e vieni riportato alla dashboard. Se appartieni a una sola azienda, la sezione non compare.</p>
      </div>
    </section>

    <section class="chapter" id="web-admin-documenti">
      <h2><span class="chapter-num">15a</span>Documenti <span class="badge badge-both">documentale</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Carica e gestisci i documenti personali dei dipendenti: cedolini, CU, contratti, comunicazioni. Ogni documento è un PDF associato a un singolo dipendente, che lo consulta dalla sua sezione <em>I miei documenti</em> (Web) o dal tab <em>Documenti</em> dell'app mobile.</p>

      <div class="callout callout-warn">
        <strong>Richiede la capacità Documentale.</strong> Questa pagina è riservata agli utenti con la capacità <strong>Documentale</strong> — può essere un amministratore o un dipendente (vedi capitolo <em>Utenti</em>). Solo un Documentale può caricare documenti e consultare i documenti di <em>tutti</em> i dipendenti. Un amministratore <em>senza</em> questa capacità <strong>non vede</strong> i documenti degli altri: chi deve gestirli assegna la capacità Documentale al proprio account o a un dipendente di fiducia.
      </div>

      <div class="feature">
        <h3>Sblocco con codice di verifica (OTP)</h3>
        <p>Per proteggere dati sensibili, all'apertura della pagina <strong>Documenti</strong>, <em>prima</em> che venga mostrato l'elenco dei documenti, il sistema invia un <strong>codice di verifica a 6 cifre</strong> (codice usa-e-getta, OTP) all'indirizzo email del Documentale stesso. Inserisci il codice per sbloccare la consultazione.</p>
        <ul class="tidy">
          <li>Una verifica riuscita sblocca consultazione e download per circa <strong>10 minuti</strong>; trascorso questo tempo il codice viene richiesto di nuovo.</li>
          <li>Il <strong>caricamento</strong> di un documento <em>non</em> richiede il codice: solo la consultazione e il download dei documenti esistenti lo richiedono.</li>
          <li>Il codice è valido circa 10 minuti ed esiste un limite ai tentativi errati.</li>
          <li>Ogni <strong>consultazione</strong>, <strong>download</strong> ed <strong>eliminazione</strong> effettuati dal Documentale vengono registrati in un <strong>log degli accessi</strong> (traccia di audit).</li>
        </ul>
      </div>

      <div class="feature">
        <h3>La tabella documenti</h3>
        <p>L'elenco mostra tutti i documenti caricati per l'azienda, con le colonne:</p>
        <ul class="tidy">
          <li><strong>Dipendente</strong> — destinatario del documento.</li>
          <li><strong>Categoria</strong> — Cedolino, CU, Contratto, Comunicazione o Altro.</li>
          <li><strong>Titolo</strong> — il nome assegnato in fase di caricamento.</li>
          <li><strong>Caricato il</strong> — data e ora di caricamento.</li>
          <li><strong>Archiviato fino al</strong> — la data oltre la quale il documento viene eliminato automaticamente (36 mesi dal caricamento).</li>
          <li><strong>Presa visione</strong> — la <strong>data e ora</strong> in cui il dipendente (destinatario) ha aperto il documento la prima volta (salvata nel sistema), oppure <span class="pill pill-warn">Non visto</span> se non l'ha ancora consultato. <em>Le aperture e i download effettuati dal Documentale non contano mai come presa visione: il documento resta <span class="pill pill-warn">Non visto</span> finché non lo apre il dipendente stesso.</em></li>
          <li><strong>Azioni</strong> — scarica ed elimina.</li>
        </ul>
        <p>In alto puoi <strong>filtrare per dipendente</strong> per vedere solo i suoi documenti.</p>
      </div>

      <div class="feature">
        <h3>Caricamento in massa</h3>
        <p>Premi <strong>Carica documenti</strong> e seleziona <strong>uno o più PDF</strong> (max 15MB ciascuno; sono accettati solo PDF). Per ogni file il sistema prova ad <strong>abbinarlo automaticamente al dipendente</strong> cercando nel nome del file il suo <em>codice fiscale</em> (impostato in <strong>Utenti</strong>, colonna <em>Codice fiscale</em>).</p>
        <ol class="steps">
          <li>Seleziona i PDF da caricare.</li>
          <li>Controlla la tabella di abbinamento: per ogni file vedi il dipendente proposto (con indicazione del criterio di abbinamento), la categoria e il titolo modificabili.</li>
          <li>Per i file <strong>non abbinati</strong> scegli manualmente il dipendente dal menù a tendina.</li>
          <li>Imposta la <strong>categoria</strong> (predefinita <em>Cedolino</em>) e, se vuoi, modifica il <strong>titolo</strong>.</li>
          <li>Premi <strong>Carica</strong>: i file vengono inviati uno per uno e per ciascuno vedi lo stato (Pronto, Caricamento, Caricato o Errore).</li>
        </ol>
        <div class="callout callout-info">
          Quando un documento viene caricato il dipendente riceve una <strong>notifica</strong> (push ed email, secondo le sue preferenze; l'email per i documenti è attiva di default).
        </div>
      </div>

      <div class="feature">
        <h3>Sostituire o eliminare</h3>
        <p>Non esiste la modifica di un documento già caricato: per correggerlo, <strong>elimina</strong> quello errato (icona cestino, con conferma) e <strong>ricarica</strong> il file corretto. L'eliminazione rimuove definitivamente il file e il dipendente non potrà più consultarlo.</p>
      </div>

      <div class="callout callout-info">
        <strong>Archiviazione (36 mesi):</strong> ogni documento viene archiviato per 36 mesi dalla data di caricamento, poi viene eliminato automaticamente da una procedura giornaliera. La data limite è sempre visibile nella colonna <em>Archiviato fino al</em>.
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
      <p class="lead">Sul Web il dipendente consulta la propria posizione e storico e, dalla sezione Ferie &amp; Permessi, invia richieste e consulta il calendario.</p>

      <div class="feature">
        <h3>Menu di navigazione</h3>
        <p>La sidebar di un dipendente contiene cinque voci:</p>
        <div class="grid-2">
          <div class="mini-card"><div class="mini-title">Dashboard</div><div class="mini-desc">Il tuo stato attuale e ultime timbrature</div></div>
          <div class="mini-card"><div class="mini-title">Le mie timbrature</div><div class="mini-desc">Storico delle tue timbrature</div></div>
          <div class="mini-card"><div class="mini-title">Le mie richieste</div><div class="mini-desc">Richieste di correzione inviate</div></div>
          <div class="mini-card"><div class="mini-title">Ferie &amp; Permessi</div><div class="mini-desc">Le tue assenze, il calendario, le richieste da approvare</div></div>
          <div class="mini-card"><div class="mini-title">Residui</div><div class="mini-desc">Le tue ore residue di ferie e permessi</div></div>
        </div>
        <p>In basso trovi il tuo avatar con email, ruolo <em>Dipendente</em> e il pulsante <strong>Esci</strong>.</p>
        <div class="callout callout-info">
          Le funzioni di timbratura ingresso/uscita si trovano nell'app mobile, non sul Web (se non esplicitamente abilitato dall'amministratore).
        </div>
      </div>

      <div class="feature">
        <h3>Ferie &amp; Permessi (web)</h3>
        <p>La pagina ha tre tab:</p>
        <ul class="tidy">
          <li><strong>Le mie</strong> — in cima trovi le <strong>schede riepilogo (KPI)</strong>: per <strong>Ferie</strong> e <strong>Permessi</strong> il <strong>Residuo</strong> in evidenza (ore disponibili) con sotto il <strong>Totale</strong> assegnato e le ore <strong>Usate</strong>, più il numero di richieste <strong>In attesa</strong>. Sotto, l'elenco delle tue richieste con stato; pulsante <strong>+ Nuova richiesta</strong> per inviarne una (Ferie, Permesso, Malattia, Assenza), <strong>Annulla</strong> sulle pending e <strong>Richiedi annullamento</strong> sulle approvate.</li>
          <li><strong>Calendario</strong> — vista Giorno/Settimana/Mese/Anno delle tue assenze, con festività nazionali evidenziate.</li>
          <li><strong>Da approvare</strong> — compare solo se sei stato designato approvatore di altri dipendenti.</li>
        </ul>
      </div>

      <div class="feature" id="web-user-residui">
        <h3>Tab Residui</h3>
        <p>La <strong>tab Residui</strong> in Ferie &amp; Permessi mostra una scheda per i tuoi residui di <strong>Ferie</strong> e <strong>Permessi</strong>. Per ciascuno vedi il <strong>residuo disponibile</strong> in evidenza e il dettaglio: saldo iniziale, maturato, usato approvato e ore di richieste ancora in attesa.</p>
        <div class="callout callout-info">
          Le richieste <em>in attesa</em> non vengono scalate finché non sono approvate. Sotto al residuo trovi quindi anche cosa resterebbe se quelle pending venissero approvate.
        </div>
      </div>
    </section>

    <section class="chapter" id="web-user-dashboard">
      <h2><span class="chapter-num">17</span>La mia Dashboard <span class="badge badge-user">user</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">La tua home da dipendente: timbri la giornata e vedi a colpo d'occhio le ore di oggi, l'orario previsto e le ultime timbrature. Le stesse funzioni dell'app mobile, dal browser.</p>

      <div class="feature">
        <h3>Timbrare dal web</h3>
        <p>Se per il tuo profilo è abilitata la modalità <strong>remoto</strong>, trovi i pulsanti per registrare la giornata, che cambiano in base allo stato:</p>
        <table>
          <thead><tr><th>Stato attuale</th><th>Azioni disponibili</th></tr></thead>
          <tbody>
            <tr><td><span class="pill">Fuori servizio</span></td><td><strong>Timbra ingresso</strong></td></tr>
            <tr><td><span class="pill pill-ok">Al lavoro</span></td><td><strong>Timbra uscita</strong> · <strong>Inizia pausa</strong> · <strong>Inizia pausa pranzo</strong></td></tr>
            <tr><td><span class="pill pill-warn">In pausa</span></td><td><strong>Termina pausa</strong></td></tr>
            <tr><td><span class="pill pill-warn">In pausa pranzo</span></td><td><strong>Termina pausa pranzo</strong></td></tr>
          </tbody>
        </table>
        <p>Appena timbrato hai <strong>60 secondi</strong> per annullare con <em>Annulla ultima timbratura</em>. Se sei assegnato a più sedi puoi sceglierla; una volta timbrato l'ingresso la sede resta bloccata fino all'uscita.</p>
        <div class="callout callout-info">
          La timbratura da web è <strong>"da remoto"</strong>: non richiede il GPS e non applica il controllo dell'area (geofence). Per questo è disponibile solo se l'amministratore ti ha assegnato la modalità <strong>remoto</strong>. Se non ce l'hai, vedrai l'avviso <em>"La timbratura da web non è abilitata"</em> e dovrai usare l'app mobile.
        </div>
      </div>

      <div class="feature">
        <h3>Riepilogo della giornata</h3>
        <p>In alto la card mostra <strong>Ore lavorate</strong> e <strong>Ore conteggiate</strong> (in base all'orario assegnato, arrotondate per difetto a blocchi di 15 minuti) più <strong>Entrata</strong>, <strong>Pause</strong> e <strong>Uscita</strong> della giornata. Si aggiorna in tempo reale.</p>
      </div>

      <div class="feature">
        <h3>Orario di oggi e orario settimanale</h3>
        <p>Se hai un orario assegnato, vedi i <strong>turni previsti per oggi</strong> come pillole (es. "09:00–18:00") con il <strong>Totale</strong> di ore attese, oppure "Oggi è un giorno di riposo". Il pulsante <strong>📅 Settimana</strong> apre l'<strong>orario settimanale</strong> completo (lunedì–domenica) con i turni e il totale di ore di ogni giorno, con il giorno corrente evidenziato.</p>
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
      <p class="lead">Le richieste di correzione timbratura che hai inviato — e da qui puoi crearne di nuove, come dall'app mobile.</p>

      <div class="feature">
        <h3>Lista richieste</h3>
        <p>Ogni richiesta è una card che mostra: data invio, stato (<span class="pill pill-warn">In attesa</span> <span class="pill pill-ok">Approvata</span> <span class="pill pill-err">Rifiutata</span> <span class="pill">Superata</span>), differenza tra valori attuali e richiesti, motivazione e — se decisa — nota dell'amministratore. Sulle tue richieste vedi solo lo stato: la decisione spetta all'amministratore.</p>
      </div>

      <div class="feature">
        <h3>Creare una nuova richiesta</h3>
        <p>Premi <strong>+ Nuova richiesta</strong> e segui i tre passi:</p>
        <ol class="steps">
          <li><strong>Quale giorno?</strong> — scegli la data da correggere; carichiamo le tue timbrature di quel giorno.</li>
          <li><strong>Quale timbratura?</strong> — seleziona una timbratura esistente da modificare, oppure <em>Aggiungi una timbratura mancante</em>.</li>
          <li><strong>Dettagli</strong> — indica tipo evento, ora, sede (se ne hai più di una) e una motivazione (almeno 5 caratteri), poi <strong>Invia richiesta</strong>.</li>
        </ol>
        <p>La richiesta resta <span class="pill pill-warn">In attesa</span> finché un amministratore non la approva o rifiuta; riceverai una notifica della decisione.</p>
      </div>
    </section>

    <section class="chapter" id="web-user-documenti">
      <h2><span class="chapter-num">19a</span>I miei documenti <span class="badge badge-user">user</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">I documenti che l'azienda ha caricato per te: cedolini, CU, contratti e comunicazioni. Vedi solo i tuoi.</p>

      <div class="callout callout-info">
        Qui <strong>ognuno vede esclusivamente i propri documenti</strong>, <strong>amministratori compresi</strong>. Un amministratore <em>non</em> vede da qui i documenti degli altri dipendenti: il caricamento e la consultazione dei documenti di tutti avvengono solo tramite la capacità <strong>Documentale</strong> (vedi capitolo <em>Documenti</em>).
      </div>

      <div class="feature">
        <h3>Consultare e scaricare</h3>
        <p>La tabella elenca, per ogni documento: <strong>Categoria</strong>, <strong>Titolo</strong>, <strong>Caricato il</strong>, <strong>Archiviato fino al</strong> e la <strong>presa visione</strong> (la <strong>data e ora</strong> della prima apertura, oppure <span class="pill pill-warn">Non visto</span>).</p>
        <p>Premi l'icona <strong>Scarica</strong> per aprire il PDF in una nuova scheda. La <strong>prima apertura</strong> di un documento viene registrata come <em>presa visione</em>: da quel momento la colonna mostra la <strong>data e ora</strong> della tua presa visione e l'azienda sa che l'hai consultato. La presa visione viene registrata <strong>solo quando lo apri tu</strong> (il destinatario): le aperture del Documentale non la attivano. Vale anche per un amministratore che è destinatario di un proprio documento: aprendolo da qui registra la propria presa visione.</p>
        <div class="callout callout-info">
          Riceverai una <strong>notifica</strong> (push ed email) ogni volta che l'azienda carica un nuovo documento per te. Puoi disattivare l'email da <strong>Impostazioni → Notifiche email</strong> e la push dall'app mobile (<em>Profilo</em>).
        </div>
      </div>

      <div class="callout callout-info">
        Sull'<strong>app mobile</strong> la sezione <strong>Documenti</strong> è protetta: all'apertura viene richiesto lo sblocco con <strong>biometria</strong> (Face ID / Touch ID / impronta) o, in mancanza, il codice del dispositivo — indipendentemente dal blocco app generale. I documenti restano archiviati 36 mesi, poi vengono rimossi automaticamente.
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
      <p class="lead">L'app mobile è disponibile per iOS e Android. La navigazione principale è una barra in basso con le schede Timbrature, Storico, Richieste e Documenti (e Dashboard per gli admin).</p>

      <div class="feature">
        <h3>Le schede principali</h3>
        <div class="grid-2">
          <div class="mini-card"><div class="mini-title">⏱ Timbrature</div><div class="mini-desc">Schermata principale per timbrare ingresso, uscita, pause</div></div>
          <div class="mini-card"><div class="mini-title">📅 Storico</div><div class="mini-desc">Storico delle tue timbrature per giorno</div></div>
          <div class="mini-card"><div class="mini-title">💼 Richieste</div><div class="mini-desc">Ferie, permessi, malattia</div></div>
          <div class="mini-card"><div class="mini-title">📄 Documenti</div><div class="mini-desc">I tuoi documenti personali condivisi dall'azienda</div></div>
        </div>
        <p>Le <strong>correzioni</strong> non sono più una scheda a sé: vivono ora dentro <strong>Timbrature</strong>, nella tab <strong>Correggi</strong>.</p>
        <p>In alto a sinistra di ogni schermata trovi il tuo <strong>avatar</strong> (apre il Profilo). In alto a destra c'è la <strong>campanella notifiche</strong> con badge di non lette. La campanella raccoglie gli aggiornamenti su <strong>richieste</strong> (ferie, permessi, assenze) e <strong>correzioni</strong>: le decisioni sulle tue richieste e — per chi approva — quelle in attesa della tua decisione. Toccando una notifica apri direttamente la scheda corrispondente (Richieste o, per le correzioni, la tab Correggi dentro Timbrature).</p>
      </div>
    </section>

    <section class="chapter" id="mob-user-timbra">
      <h2><span class="chapter-num">21</span>Timbrature <span class="badge badge-user">user</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">La home dell'app mobile. Da qui registri tutti gli eventi della tua giornata lavorativa.</p>
      <p>La scheda Timbrature ha <strong>due tab</strong> in alto: <strong>Timbra</strong> (questa pagina) e <strong>Correggi</strong>. Le correzioni — prima in una scheda separata in fondo — vivono ora qui dentro: tocca le tab oppure <strong>scorri a destra/sinistra</strong> per cambiare vista (vedi il capitolo Correzioni).</p>

      <div class="feature">
        <h3>Card principale</h3>
        <p>In alto vedi sempre:</p>
        <ul class="tidy">
          <li><strong>Ore lavorate</strong> — totale aggiornato in tempo reale.</li>
          <li><strong>Ore conteggiate</strong> — basato sull'orario assegnato (se presente), arrotondato per difetto a blocchi di 15 minuti (es. 14 minuti = 0).</li>
          <li><strong>Entrata</strong>, <strong>Pause</strong>, <strong>Uscita</strong> — riepilogo della giornata.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Orario di oggi</h3>
        <p>Sotto la card principale, se hai un orario di lavoro assegnato, vedi i <strong>turni previsti per oggi</strong> come pillole (es. "09:00–18:00", o più pillole in caso di turno spezzato) e a destra il <strong>Totale</strong> di ore attese: così sai sempre quanto sei tenuto a lavorare nella giornata. Nei giorni di riposo (es. sabato/domenica secondo il tuo orario) compare "Oggi è un giorno di riposo". Senza orario assegnato la sezione non viene mostrata.</p>
        <p>Tocca l'<strong>icona calendario</strong> in alto a destra della sezione per aprire l'<strong>orario settimanale</strong> completo: tutti i giorni da lunedì a domenica con i turni previsti e il totale di ore di ciascun giorno (il giorno corrente è evidenziato). Utile per sapere in anticipo cosa ti aspetta nei prossimi giorni.</p>
      </div>

      <div class="feature">
        <h3>Selezione sede</h3>
        <p>Se sei assegnato a più di una sede vedrai una serie di "pillole" orizzontali per scegliere dove stai lavorando. L'icona è un edificio per la sede in presenza, un laptop per le sedi fuori sede.</p>
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
        <div class="callout callout-info">
          <strong>Uscita sempre possibile.</strong> La <strong>Timbra uscita</strong> non viene mai bloccata dal controllo dell'area: se hai dimenticato di timbrare e sei lontano dalla sede (es. da casa), l'uscita viene comunque registrata. Se la posizione risulta fuori area, vedrai l'avviso <em>"Uscita fuori area"</em> e la timbratura viene salvata con un'<strong>anomalia</strong> visibile all'amministratore. Ingresso e pause restano invece soggetti al controllo dell'area.
        </div>
      </div>

      <div class="feature">
        <h3>Annullare l'ultima timbratura</h3>
        <p>Appena registrata, sotto la card principale appare il link <strong>Annulla ultima timbratura</strong>. Hai 60 secondi per annullarla se hai sbagliato.</p>
        <div class="callout callout-warn">
          Dopo 60 secondi non è più annullabile direttamente: dovrai inviare una richiesta di <strong>correzione</strong>.
        </div>
      </div>

      <div class="feature">
        <h3>Hai dimenticato di timbrare l'uscita?</h3>
        <p>Niente panico, ci sono due reti di sicurezza:</p>
        <ul class="tidy">
          <li>Dopo <strong>14 ore</strong> dall'ingresso ricevi un <strong>promemoria</strong> che ti invita a timbrare l'uscita.</li>
          <li>Se il turno resta aperto oltre <strong>15 ore</strong>, il sistema lo chiude da solo inserendo l'uscita a <strong>ingresso + 15 ore</strong> (può cadere il giorno successivo). La timbratura risulta di origine <em>automatica</em>.</li>
        </ul>
        <div class="callout callout-info">
          Se l'orario reale di uscita era diverso da quello calcolato in automatico, invia una richiesta di <strong>correzione</strong> dalla tab Correggi (dentro Timbrature): l'amministratore la sistemerà.
        </div>
      </div>

      <div class="feature">
        <h3>Cosa fare se la timbratura fallisce</h3>
        <ul class="tidy">
          <li><strong>"Senza connessione"</strong> — la timbratura viene messa in coda e inviata quando torni online. Apparirà l'avviso: <em>"Timbratura accodata. Verrà inviata quando torni online."</em></li>
          <li><strong>"Sei fuori dell'area consentita"</strong> — vale per <strong>ingresso</strong> e <strong>pause</strong>: sei troppo distante dalla sede, avvicinati o cambia sede. La <strong>uscita</strong> non viene mai bloccata (viene registrata con anomalia, vedi sopra).</li>
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
        <p>Una card riassuntiva mostra il <strong>Totale conteggiato</strong> nel periodo (es. "156h 45m"), con sotto le <strong>Lavorate</strong> (somma grezza) e a destra il numero di <strong>giorni</strong> con almeno una timbratura.</p>
      </div>

      <div class="feature">
        <h3>Card per giorno</h3>
        <p>Ogni giorno è una card collassabile che mostra entrambe le misure:</p>
        <ul class="tidy">
          <li>Etichetta: "Oggi", "Ieri" o data per esteso ("giovedì 23 maggio").</li>
          <li>Tempo di pausa se &gt; 0.</li>
          <li><strong>Lavorate</strong> — ore effettive del giorno (somma grezza dei segmenti).</li>
          <li><strong>Conteggiate</strong> — ore valide a fini busta paga: <strong>Lavorate</strong> meno le decurtazioni per sforamento (ritardo in entrata, uscita anticipata, pause oltre il massimo) più gli straordinari, il tutto arrotondato per difetto a blocchi di 15 minuti. La decurtazione per ritardo o uscita anticipata non si applica se un permesso o una ferie approvati coprono quello scostamento. Se ci sono straordinari, una riga lo specifica ("di cui …").</li>
        </ul>
        <p>Senza orario di lavoro assegnato le <strong>Conteggiate</strong> coincidono con le <strong>Lavorate</strong> (solo arrotondate a 15 min). Tocca la card per espanderla e vedere ogni singola timbratura del giorno con icona colorata (verde ingresso, rosso uscita, arancione pausa) e ora HH:MM.</p>
      </div>

      <div class="feature">
        <h3>Giorni di riposo</h3>
        <p>Se hai un orario di lavoro assegnato, i <strong>giorni di riposo</strong> (quelli senza turno previsto, es. sabato/domenica) <strong>non compaiono</strong> nello storico, per tenerlo pulito. Fanno eccezione i giorni di riposo in cui hai effettivamente lavorato: se quel giorno risultano ore lavorate, la card viene comunque mostrata. Senza orario assegnato vengono elencati tutti i giorni con almeno una timbratura.</p>
      </div>
    </section>

    <section class="chapter" id="mob-user-correzioni">
      <h2><span class="chapter-num">23</span>Correzioni <span class="badge badge-user">user</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">Richiedi la correzione di una timbratura sbagliata o l'aggiunta di una dimenticata. Le correzioni si trovano nella scheda <strong>Timbrature</strong>, nella tab <strong>Correggi</strong>.</p>

      <div class="feature">
        <h3>Le tue richieste</h3>
        <p>Dentro Timbrature, la tab <strong>Correggi</strong> mostra un <strong>unico elenco</strong> con tutte le richieste: quelle <strong>in attesa</strong> sono sempre in cima, seguite da quelle già decise. Il badge sulla tab "Correggi" mostra il numero di richieste ancora da decidere.</p>
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
              <li>Tipo evento (Ingresso, Uscita, inizio/fine pausa, inizio/fine pausa pranzo).</li>
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
      <h2><span class="chapter-num">24</span>Ferie / Permessi / Malattia / Assenza <span class="badge badge-user">user</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">Tutte le richieste di assenza si gestiscono dalla scheda Richieste.</p>

      <div class="feature">
        <h3>Tab "Le mie", "Calendario" e "Da approvare"</h3>
        <p>La scheda Richieste ha tre tab: <strong>Le mie</strong> (le tue richieste), <strong>Calendario</strong> e — per gli approvatori/amministratori — <strong>Da approvare</strong> (con badge sul numero pending). Tocca le tab oppure <strong>scorri a destra/sinistra</strong> per cambiare vista.</p>
      </div>

      <div class="feature">
        <h3>Tab "Calendario"</h3>
        <p>Vista calendario delle assenze con selettore <strong>Giorno / Settimana / Mese / Anno</strong>. I giorni con assenze mostrano puntini colorati per tipo e le <strong>festività nazionali</strong> sono evidenziate. Il dipendente vede le proprie assenze; l'amministratore vede tutti, con i chip in alto per filtrare per dipendente.</p>
      </div>

      <div class="feature">
        <h3>Riepilogo e quota disponibile</h3>
        <p>In cima alla tab "Le mie" trovi delle <strong>schede riepilogo (KPI)</strong> per avere la situazione sempre aggiornata:</p>
        <ul class="tidy">
          <li><strong>Ferie</strong> e <strong>Permessi</strong>: il <strong>Residuo</strong> (ore ancora disponibili) in evidenza, con sotto il <strong>Totale</strong> assegnato e le ore <strong>Usate</strong>.</li>
        </ul>
        <p>Sotto, la card <strong>Disponibilità</strong> mostra il dettaglio per tipo: saldo iniziale, maturato, usato e ore in attesa, con l'hint sul residuo dopo le richieste pending (es. "(15.75h dopo richieste in attesa)").</p>
      </div>

      <div class="feature">
        <h3>Inviare una richiesta</h3>
        <p>Tocca <strong>+</strong> in basso a destra. Si apre il modulo:</p>
        <ol class="steps">
          <li>Scegli il <strong>tipo</strong>: <span class="pill pill-info">Ferie</span> <span class="pill pill-warn">Permessi</span> <span class="pill pill-err">Malattia</span> <span class="pill">Assenza</span>.</li>
          <li>Indica <strong>Dal</strong> e <strong>Al</strong> (date).</li>
          <li>Per Ferie/Permessi puoi scegliere <em>Tutto il giorno</em> oppure attivare <strong>Orario specifico</strong> (ora inizio/fine).</li>
          <li>Per Malattia: inserisci il <strong>numero protocollo INPS</strong> (obbligatorio).</li>
          <li>Per Assenza: scegli la <strong>tipologia</strong> (Motivi personali, Lutto, ecc.) e indica se è <strong>retribuita</strong> o no.</li>
          <li>Vedi chi è l'<strong>approvatore</strong> designato (o "Nessun approvatore configurato").</li>
          <li>Aggiungi una <strong>nota</strong> opzionale (es. "matrimonio fratello", "visita medica"). Per Assenza il campo si chiama <strong>Motivazione</strong> ed è anch'esso facoltativo.</li>
          <li>Premi <strong>Invia richiesta</strong> (per Ferie/Permessi/Assenza) o <strong>Invia segnalazione</strong> (per Malattia).</li>
        </ol>
        <p><strong>Totale richiesto:</strong> il modulo mostra in tempo reale le ore della richiesta, calcolate dal periodo scelto e dal tuo <strong>orario assegnato</strong>. Un permesso <em>Tutto il giorno</em> vale le ore previste per quel giorno (es. 8h, non 24h) e i giorni non lavorativi contano 0. Una richiesta interamente fuori dal tuo orario (es. ferie solo di domenica) viene bloccata; un intervallo misto (es. lun→dom) conteggia solo i giorni lavorativi.</p>
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
          <li><strong>Azienda</strong>: ragione sociale (e, se appartieni a più aziende, il pulsante <strong>Cambia azienda</strong>).</li>
          <li><strong>Sedi assegnate</strong>: lista con icona edificio o laptop e tag "In sede" o "Fuori sede".</li>
          <li><strong>Lingua</strong>: scegli la lingua dell'app — Italiano o English.</li>
          <li><strong>Notifiche</strong>: stato delle push e dei singoli toggle (le notifiche email si gestiscono dal Web → Impostazioni).</li>
          <li><strong>Sicurezza</strong>: attiva l'accesso biometrico (Face ID, Touch ID o impronta).</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Lingua</h3>
        <p>Nella sezione <strong>Lingua</strong> tocca <strong>Italiano</strong> o <strong>English</strong> per cambiare subito la lingua dell'app. È una preferenza <em>personale</em> (vale solo per il tuo account) e viene ricordata al prossimo avvio; le email e le notifiche push che ricevi seguono la stessa scelta. Sul Web la cambi da <strong>Impostazioni → Lingua interfaccia</strong>.</p>
      </div>

      <div class="feature">
        <h3>Gestire le notifiche push</h3>
        <p>Se le push sono <strong>attive</strong> sul dispositivo, vedi i toggle:</p>
        <ul class="tidy">
          <li><strong>Esiti ferie e permessi</strong> — quando vengono approvate o rifiutate.</li>
          <li><strong>Esiti correzioni</strong> — decisioni sulle tue correzioni.</li>
          <li><strong>Promemoria 24h prima</strong> — avviso la sera prima di una tua assenza (es. "domani ferie").</li>
        </ul>
        <p>Se le push sono <strong>non attive</strong>: devi abilitarle nelle impostazioni del telefono.</p>
      </div>

      <div class="feature">
        <h3>Sicurezza · Accesso biometrico</h3>
        <p>Nella sezione <strong>Sicurezza</strong> puoi attivare l'<strong>accesso biometrico</strong> (Face ID, Touch ID o impronta digitale, a seconda del dispositivo). Quando è attivo, l'app chiede di sbloccarla con la biometria all'avvio — e quando la riapri dopo averla lasciata in background per qualche minuto — prima di mostrare i tuoi dati.</p>
        <ul class="tidy">
          <li>Il toggle è disponibile solo se sul telefono è già configurata una biometria; altrimenti appare disattivato con la relativa indicazione.</li>
          <li>Le riaperture rapide (entro pochi minuti) non richiedono di nuovo lo sblocco, così timbrare resta veloce.</li>
          <li>Se lo sblocco non riesce puoi sempre toccare <strong>Esci e usa la password</strong> per rientrare con email e password.</li>
        </ul>
        <div class="callout callout-info">
          La sessione resta protetta nel portachiavi sicuro del telefono: la biometria aggiunge un blocco all'apertura dell'app. Lo sblocco è solo locale, non viene inviata alcuna impronta o immagine del volto a sonoQui.
        </div>
      </div>

      <div class="feature">
        <h3>Cambia azienda</h3>
        <p>Se il tuo account è collegato a <strong>più aziende</strong>, nella sezione <strong>Azienda</strong> trovi <strong>Cambia azienda</strong>. Toccalo per scegliere un'altra azienda: l'app si ricarica con i dati e il ruolo di quell'azienda (puoi essere amministratore in una e dipendente in un'altra). Al login, se appartieni a più aziende, la scelta ti viene chiesta subito dopo l'accesso.</p>
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
      <p class="lead">Se sei amministratore, sull'app mobile apri direttamente sulla <strong>Dashboard</strong>: una tab dedicata con il riepilogo della giornata. In più hai una tab di approvazioni e ricevi notifiche push per le nuove richieste. Puoi comunque timbrare per te stesso dalla tab Timbrature.</p>

      <div class="callout callout-info">
        Sull'app mobile l'admin <strong>non</strong> gestisce utenti, sedi, orari, esportazioni o impostazioni: per queste funzioni serve il Web.
      </div>

      <div class="feature" id="mob-admin-dashboard">
        <h3>Dashboard — il riepilogo della giornata</h3>
        <p>All'avvio l'amministratore vede la <strong>Dashboard</strong> (primo tab della barra in basso), pensata per capire a colpo d'occhio chi sta lavorando e chi è assente. Mostra:</p>
        <ul class="tidy">
          <li><strong>Schede riepilogo</strong> — Presenti ora (sul totale dipendenti), In pausa e Assenti oggi.</li>
          <li><strong>Assenti</strong> — chi è in ferie, permesso o malattia, con il tipo e le date. Un selettore <strong>Oggi · 7 gg · 14 gg</strong> allarga l'elenco a chi sarà assente nei prossimi 7 o 14 giorni.</li>
          <li><strong>Stato attuale</strong> — la lista dei dipendenti con il loro stato (<span class="pill pill-ok">Al lavoro</span>, <span class="pill pill-warn">In pausa</span> o <span class="pill">Fuori servizio</span>) e la sede; chi sta lavorando appare in cima. Con il selettore <strong>Elenco · Per sede</strong> puoi raggruppare i presenti per sede, come sul Web.</li>
        </ul>
        <p>Trascina verso il basso per aggiornare i dati. La Dashboard è visibile solo agli amministratori; i dipendenti aprono come sempre sulla tab Timbrature.</p>
      </div>
    </section>

    <section class="chapter" id="mob-admin-correzioni">
      <h2><span class="chapter-num">27</span>Approvare correzioni <span class="badge badge-admin">admin</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">Dalla scheda <strong>Timbrature</strong>, nella tab <strong>Correggi</strong>, vedi anche le richieste da decidere.</p>

      <div class="feature">
        <h3>Tab "Correggi"</h3>
        <p>Mostra un unico elenco di tutte le richieste di correzione: quelle <strong>in attesa</strong> che spettano a te (in base alla configurazione approvatori) sono in cima, le altre già decise seguono come storico.</p>
        <p>Ogni card mostra il dipendente, la differenza prima/dopo e la motivazione, con i pulsanti:</p>
        <ul class="tidy">
          <li><span class="pill pill-ok">Approva</span> — chiede conferma e applica la correzione.</li>
          <li><span class="pill pill-err">Rifiuta</span> — chiede il motivo del rifiuto e lo registra.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Inviare una propria richiesta</h3>
        <p>Anche l'amministratore può toccare il pulsante <strong>+</strong> (in basso a destra) per inviare una correzione sulle <em>proprie</em> timbrature, con lo stesso flusso in tre passi del dipendente — utile per tenere un tracciamento richiesta→approvazione invece di modificare la timbratura direttamente dal Web.</p>
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
        Il badge sull'icona dell'app (a livello di sistema operativo) riflette il numero di notifiche non lette nella campanella — in primis le richieste e correzioni in attesa di tua decisione: capisci al volo se c'è qualcosa da fare anche senza aprire l'app.
      </div>
    </section>

    <hr class="section-divider">

    <section class="chapter" id="geofence">
      <h2><span class="chapter-num">30</span>Geolocalizzazione</h2>
      <p class="lead">Come funziona il controllo della posizione durante le timbrature.</p>

      <div class="feature">
        <h3>Metodi di timbratura per utente</h3>
        <p>Per ogni utente l'admin sceglie (in <strong>Utenti → colonna Timbratura</strong>) con quali metodi può timbrare:</p>
        <ul class="tidy">
          <li><strong>GPS</strong> — timbratura dall'app mobile, con verifica della posizione (geofence) come descritto sotto.</li>
          <li><strong>Da remoto</strong> — timbratura dal web senza verifica della posizione. Utile per chi lavora da remoto.</li>
          <li><strong>Nessun metodo</strong> — l'utente non può timbrare: nell'app mobile la voce <em>Timbrature</em> non viene nemmeno mostrata.</li>
        </ul>
        <p>I metodi si combinano (es. GPS + Da remoto). Il controllo del geofence descritto qui sotto si applica solo al metodo GPS.</p>
      </div>

      <div class="feature">
        <h3>Geofence</h3>
        <p>Per ogni sede l'admin definisce coordinate GPS e — opzionalmente — un <strong>raggio</strong> in metri. Quando il raggio è attivo, la timbratura è valida solo se sei entro questa area circolare.</p>
        <p>Se sei fuori vedi il messaggio <em>"Sei fuori dell'area consentita"</em>: la timbratura di <strong>ingresso</strong> viene rifiutata, mentre l'<strong>uscita</strong> viene sempre accettata ma segnalata come anomalia.</p>
      </div>

      <div class="feature">
        <h3>Sede senza raggio</h3>
        <p>Se l'admin disattiva il raggio per una sede, la timbratura viene accettata ovunque tu sia: la posizione GPS è comunque registrata sulla timbratura per audit, ma senza confronto con un'area. La sede non compare nell'auto-rilevamento: per usarla devi selezionarla manualmente nell'app prima di timbrare.</p>
      </div>

      <div class="feature">
        <h3>Fuori sede</h3>
        <p>Le sedi marcate come "fuori sede" non richiedono GPS. Tipico caso d'uso: lavoro da remoto, trasferta o cantiere.</p>
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
            <tr><td>Nuova richiesta ferie</td><td>All'invio da un dipendente</td><td>Admin / approvatore</td></tr>
            <tr><td>Nuova correzione</td><td>All'invio da un dipendente</td><td>Admin / approvatore</td></tr>
            <tr><td>Promemoria 24h</td><td>La sera prima di una tua assenza approvata (es. "domani ferie")</td><td>Dipendente</td></tr>
            <tr><td>Evento aziendale</td><td>Quando l'admin inserisce un evento sul tuo calendario</td><td>Dipendente</td></tr>
          </tbody>
        </table>
        <div class="callout callout-info">
          Il <strong>promemoria 24h</strong> parte ogni sera per le assenze che iniziano il giorno successivo (escluse le malattie). La malattia, essendo registrata a posteriori, non genera promemoria.
        </div>
      </div>

      <div class="feature">
        <h3>Configurare le notifiche</h3>
        <ul class="tidy">
          <li><strong>Email</strong>: nelle Impostazioni (web) puoi attivare/disattivare l'email <em>per categoria</em>, esattamente come le push: esiti richieste, nuove richieste da approvare, esiti correzioni, nuove correzioni e <strong>promemoria 24h</strong>. Disattivate di default.</li>
          <li><strong>Push</strong>: toggle granulari per ciascun tipo nel Profilo dell'app mobile, incluso il <strong>Promemoria 24h prima</strong>. Le push richiedono il permesso del sistema operativo.</li>
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
            <tr><td><strong>Assenza</strong></td><td>Richiesta generica con tipologia (motivi personali, lutto, congedo, ecc.) e flag retribuita/non retribuita. Motivazione facoltativa.</td></tr>
            <tr><td><strong>Audit log</strong></td><td>Registro delle modifiche manuali su timbrature (chi, quando, perché).</td></tr>
            <tr><td><strong>Badge</strong></td><td>Pillola colorata che indica stato o tipo (ferie, malattia, ecc.).</td></tr>
            <tr><td><strong>Chiusura aziendale</strong></td><td>Evento che l'admin assegna a più dipendenti insieme; tipo <em>chiusura</em> (non scala ferie) o conteggiato come ferie.</td></tr>
            <tr><td><strong>Correzione</strong></td><td>Richiesta del dipendente di modificare o aggiungere una timbratura.</td></tr>
            <tr><td><strong>Esportazione</strong></td><td>Job che produce un file XLSX o JSON con dati di un periodo.</td></tr>
            <tr><td><strong>Ferie</strong></td><td>Assenza retribuita a giornate, consuma quota ferie.</td></tr>
            <tr><td><strong>Festività</strong></td><td>Giorni festivi nazionali italiani, evidenziati sul calendario (festivi mobili come Pasqua inclusi).</td></tr>
            <tr><td><strong>Fuori sede</strong></td><td>Sede senza GPS: il dipendente può timbrare ovunque (lavoro da remoto, trasferta, cantiere).</td></tr>
            <tr><td><strong>Geofence</strong></td><td>Area circolare attorno a una sede, definita da centro GPS e raggio in metri.</td></tr>
            <tr><td><strong>Malattia</strong></td><td>Assenza per motivi sanitari, auto-approvata, richiede protocollo INPS.</td></tr>
            <tr><td><strong>Mock location</strong></td><td>Posizione GPS finta generata da app esterne.</td></tr>
            <tr><td><strong>Permesso</strong></td><td>Assenza retribuita a ore, granularità 15 minuti.</td></tr>
            <tr><td><strong>Promemoria 24h</strong></td><td>Notifica (push/email) inviata la sera prima dell'inizio di un'assenza approvata.</td></tr>
            <tr><td><strong>Quota</strong></td><td>Saldo di ore disponibili per ferie o permessi.</td></tr>
            <tr><td><strong>Revoca</strong></td><td>Annullamento di una ferie già approvata, su iniziativa dell'admin.</td></tr>
            <tr><td><strong>Sede</strong></td><td>Luogo di lavoro, con o senza geofencing. Il raggio può essere disattivato: in tal caso il GPS è registrato ma non confrontato con un'area.</td></tr>
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
        <p>Solo se l'amministratore ha abilitato il metodo <strong>Da remoto</strong> per il tuo profilo (in Utenti → colonna <em>Timbratura</em>). Di default è attivo solo il <strong>GPS</strong> da app mobile, per evitare timbrature non geolocalizzate.</p>
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

      <div class="feature">
        <h3>C'è un calendario delle assenze?</h3>
        <p>Sì. Sul Web in <strong>Ferie &amp; Permessi → Calendario</strong> (anche per i dipendenti su <em>/me/leaves</em>) e nell'app mobile nella scheda <strong>Richieste → Calendario</strong>. Puoi scegliere la vista Giorno, Settimana, Mese o Anno. Il dipendente vede le proprie assenze, l'amministratore quelle di tutti (con filtro per dipendente). Le festività nazionali sono evidenziate automaticamente.</p>
      </div>

      <div class="feature">
        <h3>Ricevo un avviso prima dell'inizio delle ferie?</h3>
        <p>Sì: la sera prima ricevi un <strong>promemoria 24h</strong> ("domani inizia…"). Puoi attivarlo/disattivarlo come push dall'app mobile (<strong>Profilo → Notifiche → Promemoria 24h prima</strong>) e come email dal Web (<strong>Impostazioni → Notifiche email</strong>). Le malattie, registrate a posteriori, non generano promemoria.</p>
      </div>

      <div class="feature">
        <h3>Sono admin: come imposto una chiusura aziendale per tutti?</h3>
        <p>Sul Web → <strong>Ferie &amp; Permessi → Calendario → + Inserisci evento</strong>. Indica titolo (es. "Chiusura aziendale agosto") e periodo, scegli se <strong>conteggiarla come ferie</strong> o no, e seleziona tutti i dipendenti o un sottoinsieme. Ognuno riceve una notifica e l'evento compare sul suo calendario. Puoi revocare l'intero blocco in un secondo momento.</p>
      </div>
    </section>

    <footer>
      <p><strong>sonoQui · Manuale Utente</strong></p>
    </footer>
`;

const SEARCH_HL = 'manual-search-hl';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ---------- HTML → Markdown (powers "Scarica Markdown") ---------- */

function inlineMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const inner = Array.from(el.childNodes).map(inlineMd).join('');
  switch (tag) {
    case 'strong':
    case 'b':
      return `**${inner.trim()}**`;
    case 'em':
    case 'i':
      return `*${inner.trim()}*`;
    case 'code':
      return `\`${inner.trim()}\``;
    case 'br':
      return '\n';
    case 'a': {
      const href = el.getAttribute('href') ?? '';
      return href && !href.startsWith('#') ? `[${inner.trim()}](${href})` : inner;
    }
    case 'span':
      if (el.classList.contains('chapter-num')) return inner.trim() ? `${inner.trim()} ` : '';
      if (el.classList.contains('badge') || el.classList.contains('pill'))
        return inner.trim() ? ` (${inner.trim()})` : '';
      return inner;
    default:
      return inner;
  }
}

function listMd(el: Element, depth: number, ordered: boolean): string {
  const pad = '  '.repeat(depth);
  const lines: string[] = [];
  let i = 1;
  for (const li of Array.from(el.children).filter((c) => c.tagName === 'LI')) {
    const clone = li.cloneNode(true) as HTMLElement;
    Array.from(clone.children)
      .filter((c) => c.tagName === 'UL' || c.tagName === 'OL')
      .forEach((c) => c.remove());
    const text = inlineMd(clone).replace(/\s+/g, ' ').trim();
    lines.push(`${pad}${ordered ? `${i}.` : '-'} ${text}`);
    for (const nested of Array.from(li.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL')) {
      lines.push(listMd(nested, depth + 1, nested.tagName === 'OL'));
    }
    i++;
  }
  return lines.join('\n');
}

function tableMd(table: Element): string {
  const cellsOf = (row: Element) =>
    Array.from(row.children).map((c) => inlineMd(c).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
  const head = table.querySelector('thead tr');
  const header = head ? cellsOf(head) : [];
  const bodyRows = head
    ? Array.from(table.querySelectorAll('tbody tr'))
    : Array.from(table.querySelectorAll('tr'));
  const cols = header.length || (bodyRows[0] ? bodyRows[0].children.length : 0);
  if (!cols) return '';
  const headerCells = header.length ? header : Array(cols).fill('');
  const lines = [
    `| ${headerCells.join(' | ')} |`,
    `| ${headerCells.map(() => '---').join(' | ')} |`,
    ...bodyRows.map((r) => `| ${cellsOf(r).join(' | ')} |`),
  ];
  return lines.join('\n');
}

function serializeBlocks(el: Element): string[] {
  const out: string[] = [];
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = (child.nodeValue ?? '').replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const e = child as HTMLElement;
    const tag = e.tagName.toLowerCase();
    if (e.classList.contains('callout')) {
      const hasBlock = !!e.querySelector('p,ul,ol,table,div,h1,h2,h3,h4,hr,blockquote,section,footer');
      const blocks = hasBlock ? serializeBlocks(e) : [inlineMd(e).replace(/\s+/g, ' ').trim()];
      out.push(
        blocks
          .filter((b) => b.trim().length)
          .map((b) => b.split('\n').map((l) => `> ${l}`).join('\n'))
          .join('\n>\n'),
      );
      continue;
    }
    switch (tag) {
      case 'h1':
        out.push(`# ${inlineMd(e).replace(/\s+/g, ' ').trim()}`);
        break;
      case 'h2':
        out.push(`${e.closest('.platform-header') ? '# ' : '## '}${inlineMd(e).replace(/\s+/g, ' ').trim()}`);
        break;
      case 'h3':
        out.push(`### ${inlineMd(e).replace(/\s+/g, ' ').trim()}`);
        break;
      case 'h4':
        out.push(`#### ${inlineMd(e).replace(/\s+/g, ' ').trim()}`);
        break;
      case 'p': {
        const t = inlineMd(e).replace(/\s+/g, ' ').trim();
        if (t) out.push(t);
        break;
      }
      case 'ul':
        out.push(listMd(e, 0, false));
        break;
      case 'ol':
        out.push(listMd(e, 0, true));
        break;
      case 'table':
        out.push(tableMd(e));
        break;
      case 'hr':
        out.push('---');
        break;
      case 'footer':
        break;
      default:
        if (e.classList.contains('icon')) break;
        if (e.classList.contains('mini-title')) {
          out.push(`**${inlineMd(e).replace(/\s+/g, ' ').trim()}**`);
          break;
        }
        out.push(...serializeBlocks(e));
    }
  }
  return out;
}

function contentToMarkdown(root: Element): string {
  const blocks = serializeBlocks(root).filter((b) => b.trim().length);
  return ['# sonoQui — Manuale Utente', ...blocks].join('\n\n') + '\n';
}

const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.5" y2="16.5" />
  </svg>
);

const IconDownload = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M5 20h14" />
  </svg>
);

// The manual body is injected once via dangerouslySetInnerHTML. It must NOT be
// reconciled on the parent's state changes (search highlights are live-DOM
// mutations that a re-render would wipe), so it lives in a memo'd child with a
// stable ref prop — it renders exactly once.
const ManualContent = memo(function ManualContent({
  innerRef,
  html,
}: {
  innerRef: Ref<HTMLDivElement>;
  html: string;
}) {
  return <div ref={innerRef} className="manual-content" dangerouslySetInnerHTML={{ __html: html }} />;
});

export function Manual() {
  const { t, i18n } = useTranslation('manual');
  const en = i18n.language === 'en';
  const TOC_HTML = en ? TOC_EN : TOC_IT;
  const MAIN_HTML = en ? MAIN_EN : MAIN_IT;

  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const marksRef = useRef<HTMLElement[]>([]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [total, setTotal] = useState(0);
  const [cur, setCur] = useState(0);

  // Smooth-scroll for the in-manual table-of-contents anchors.
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

  const clearMarks = useCallback(() => {
    const root = contentRef.current;
    if (!root) return;
    const parents = new Set<Node>();
    root.querySelectorAll(`mark.${SEARCH_HL}`).forEach((m) => {
      const p = m.parentNode;
      if (!p) return;
      p.replaceChild(document.createTextNode(m.textContent ?? ''), m);
      parents.add(p);
    });
    parents.forEach((p) => (p as Element).normalize());
    marksRef.current = [];
  }, []);

  const focusMatch = useCallback((idx: number) => {
    const marks = marksRef.current;
    if (!marks.length) return;
    const n = ((idx % marks.length) + marks.length) % marks.length;
    marks.forEach((m, j) => m.classList.toggle('is-current', j === n));
    marks[n]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setCur(n);
  }, []);

  // Highlight + count matches whenever the query changes while search is open.
  useEffect(() => {
    if (!searchOpen) return;
    clearMarks();
    const root = contentRef.current;
    const q = query.trim();
    if (!root || q.length < 2) {
      setTotal(0);
      setCur(0);
      return;
    }
    const re = new RegExp(escapeRegExp(q), 'gi');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

    const collected: HTMLElement[] = [];
    for (const tn of textNodes) {
      const text = tn.nodeValue ?? '';
      re.lastIndex = 0;
      if (!re.test(text)) continue;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const start = m.index;
        const end = start + m[0].length;
        if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
        const mark = document.createElement('mark');
        mark.className = SEARCH_HL;
        mark.textContent = m[0];
        frag.appendChild(mark);
        collected.push(mark);
        last = end;
        if (m[0].length === 0) re.lastIndex++;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      tn.parentNode?.replaceChild(frag, tn);
    }
    marksRef.current = collected;
    setTotal(collected.length);
    if (collected.length) focusMatch(0);
    else setCur(0);
  }, [query, searchOpen, clearMarks, focusMatch]);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  const closeSearch = useCallback(() => {
    clearMarks();
    setQuery('');
    setTotal(0);
    setCur(0);
    setSearchOpen(false);
  }, [clearMarks]);

  const downloadMarkdown = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    const clone = content.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(`mark.${SEARCH_HL}`).forEach((m) => m.replaceWith(document.createTextNode(m.textContent ?? '')));
    const blob = new Blob([contentToMarkdown(clone)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sonoqui-manuale.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  const downloadPdf = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    const win = window.open('', '_blank');
    if (!win) return;
    const clone = content.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(`mark.${SEARCH_HL}`).forEach((m) => m.replaceWith(document.createTextNode(m.textContent ?? '')));
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((n) => n.outerHTML)
      .join('\n');
    win.document.open();
    win.document.write(
      `<!doctype html><html lang="${en ? 'en' : 'it'}"><head><meta charset="utf-8"><title>${t('pdfTitle')}</title>${styles}` +
        `<style>body{margin:0;background:#fff}.manuale-root .layout{display:block}.manuale-root main{padding:24px;max-width:920px;margin:0 auto}</style>` +
        `</head><body class="manuale-root"><main>${clone.innerHTML}</main></body></html>`,
    );
    win.document.close();
    win.focus();
    const print = () => win.print();
    if (win.document.readyState === 'complete') setTimeout(print, 300);
    else win.addEventListener('load', () => setTimeout(print, 300));
  }, []);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (total) focusMatch(e.shiftKey ? cur - 1 : cur + 1);
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  };

  return (
    <div ref={rootRef} className="manuale-root" style={{ margin: '-1.5rem -2rem -2.5rem' }}>
      <div className="layout">
        <aside className="toc" dangerouslySetInnerHTML={{ __html: TOC_HTML }} />
        <main>
          <div className="manual-toolbar" role="toolbar" aria-label={t('toolbar')}>
            <div className="tb-left">
              {searchOpen ? (
                <div className="tb-search" role="search">
                  <span className="tb-search-ic">
                    <IconSearch />
                  </span>
                  <input
                    ref={inputRef}
                    type="search"
                    aria-label={t('search')}
                    placeholder={t('searchPlaceholder')}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onSearchKeyDown}
                  />
                  <span className="tb-count">{query.trim().length >= 2 ? `${total ? cur + 1 : 0}/${total}` : ''}</span>
                  <button type="button" className="tb-iconbtn" aria-label={t('prevResult')} onClick={() => focusMatch(cur - 1)} disabled={!total}>
                    ‹
                  </button>
                  <button type="button" className="tb-iconbtn" aria-label={t('nextResult')} onClick={() => focusMatch(cur + 1)} disabled={!total}>
                    ›
                  </button>
                  <button type="button" className="tb-iconbtn" aria-label={t('closeSearch')} onClick={closeSearch}>
                    ✕
                  </button>
                </div>
              ) : (
                <button type="button" className="manual-btn" aria-label={t('search')} onClick={() => setSearchOpen(true)}>
                  <IconSearch /> {t('searchBtn')}
                </button>
              )}
            </div>

            <div className="tb-actions">
              <button type="button" className="manual-btn" aria-label={t('downloadPdf')} onClick={downloadPdf}>
                <IconDownload /> PDF
              </button>
              <div className="tb-md">
                <button type="button" className="manual-btn manual-btn-primary" aria-label={t('downloadMarkdown')} onClick={downloadMarkdown}>
                  <IconDownload /> Markdown
                </button>
                <span className="tb-md-hint">{t('markdownHint')}</span>
              </div>
            </div>
          </div>

          <ManualContent innerRef={contentRef} html={MAIN_HTML} />
        </main>
      </div>
    </div>
  );
}
