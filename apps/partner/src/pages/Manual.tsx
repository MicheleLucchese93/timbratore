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

      <h3>La console</h3>
      <a href="#console">Panoramica</a>
      <a href="#aziende">Aziende</a>
      <a href="#aziende-crea" class="sub">Creare un'azienda</a>
      <a href="#aziende-limiti" class="sub">Limiti e utilizzo</a>
      <a href="#aziende-modifica" class="sub">Modificare un'azienda</a>
      <a href="#aziende-stato" class="sub">Sospendere e riattivare</a>
      <a href="#aziende-cantieri" class="sub">Moduli</a>
      <a href="#aziende-admin" class="sub">Amministratori</a>
      <a href="#aziende-elimina" class="sub">Eliminare</a>
      <a href="#partner">Partner</a>
      <a href="#partner-crea" class="sub">Creare un partner</a>
      <a href="#partner-caps" class="sub">Limiti del partner</a>
      <a href="#partner-stato" class="sub">Attivare e disattivare</a>
      <a href="#audit">Registro attività</a>
      <a href="#impostazioni">Impostazioni e profilo</a>

      <h3>Riferimenti</h3>
      <a href="#glossario">Glossario</a>
      <a href="#faq">Domande frequenti</a>
    </nav>
`;

const MAIN_IT = `

    <section class="chapter" id="intro">
      <h2><span class="chapter-num">01</span>Benvenuto</h2>
      <p class="lead">La <strong>console partner</strong> di sonoQui è lo strumento con cui i rivenditori e l'amministrazione della piattaforma creano e gestiscono le aziende clienti: ne definiscono i limiti, ne gestiscono gli amministratori e ne controllano lo stato.</p>

      <div class="feature">
        <h3>Che cos'è la console partner</h3>
        <p>È un'applicazione web separata dall'app aziendale di sonoQui (quella con cui i dipendenti timbrano e gli amministratori d'azienda gestiscono presenze e ferie). La console partner serve a un livello più alto: <strong>provisioning</strong> e <strong>amministrazione delle aziende</strong> sulla piattaforma.</p>
        <p>Si raggiunge dal proprio indirizzo dedicato (es. <code class="inline">partners.sonoqui.pro</code>) e l'accesso è riservato ai soli membri della partnership.</p>
        <div class="grid-2">
          <div class="mini-card">
            <div class="mini-title">🏢 Aziende</div>
            <div class="mini-desc">Crea nuove aziende clienti, assegna i limiti del piano, gestisci gli amministratori, sospendi o riattiva l'accesso.</div>
          </div>
          <div class="mini-card">
            <div class="mini-title">🤝 Partner</div>
            <div class="mini-desc">Solo amministratore di piattaforma: crea i rivenditori, imposta i loro massimali e attiva/disattiva il loro accesso.</div>
          </div>
        </div>
      </div>
    </section>

    <section class="chapter" id="concetti">
      <h2><span class="chapter-num">02</span>Concetti chiave</h2>
      <p class="lead">Pochi termini ricorrono in tutta la console. Conoscerli aiuta a orientarsi.</p>

      <div class="feature">
        <h3>I termini fondamentali</h3>
        <table>
          <thead><tr><th>Termine</th><th>Significato</th></tr></thead>
          <tbody>
            <tr><td><strong>Azienda</strong></td><td>Il cliente finale (in inglese <em>tenant</em>): un'organizzazione con i propri utenti, sedi e dati, completamente separata dalle altre.</td></tr>
            <tr><td><strong>Partner</strong></td><td>Il rivenditore che crea e gestisce le proprie aziende. Vede solo le aziende che ha creato ed è soggetto ai limiti (caps) assegnati dall'amministratore di piattaforma.</td></tr>
            <tr><td><strong>Amministratore di piattaforma</strong></td><td>Ruolo <em>admin</em> della console: vede tutte le aziende, gestisce i partner e può riassegnare un'azienda a un partner diverso.</td></tr>
            <tr><td><strong>Super-utente</strong></td><td>L'unico account abilitato all'eliminazione definitiva di un'azienda. È un amministratore con un privilegio aggiuntivo.</td></tr>
            <tr><td><strong>Limiti (azienda)</strong></td><td>I massimali del piano di un'azienda: numero massimo di utenti, amministratori, documentali e sedi.</td></tr>
            <tr><td><strong>Caps (partner)</strong></td><td>I massimali di un partner: quante aziende può creare e quali limiti massimi può assegnare a ciascuna. Vuoto = illimitato.</td></tr>
            <tr><td><strong>Documentale</strong></td><td>Capacità aggiuntiva di un utente dell'azienda: gli permette di caricare e consultare i documenti di tutti i dipendenti. Qui se ne imposta solo il numero massimo per azienda.</td></tr>
            <tr><td><strong>Sede</strong></td><td>Luogo di lavoro di un'azienda. Qui se ne imposta solo il numero massimo consentito.</td></tr>
            <tr><td><strong>Email di accesso</strong></td><td>L'email che dà a un utente l'accesso. È un <em>invito</em> a impostare la password per chi non l'ha mai fatto, un avviso di <em>accesso all'azienda</em> (con link per accedere) per chi ha già un account, o un <em>reset password</em> quando reinvii l'accesso.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="chapter" id="ruoli">
      <h2><span class="chapter-num">03</span>Ruoli e permessi</h2>
      <p class="lead">Nella console esistono due ruoli con accessi molto diversi.</p>

      <div class="grid-2">
        <div class="feature" style="margin:0;">
          <h3>🛠️ Amministratore <span class="badge badge-admin">admin</span></h3>
          <p class="feature-sub">L'amministrazione della piattaforma sonoQui.</p>
          <ul class="tidy">
            <li>Vede <strong>tutte</strong> le aziende della piattaforma</li>
            <li>Vede e usa il menu <strong>Partner</strong></li>
            <li>Crea, modifica, attiva e disattiva i partner</li>
            <li>Imposta i <strong>caps</strong> di ogni partner</li>
            <li>Riassegna un'azienda a un partner (o alla Piattaforma)</li>
            <li>Crea e gestisce aziende e relativi amministratori</li>
          </ul>
        </div>
        <div class="feature" style="margin:0;">
          <h3>🤝 Partner <span class="badge badge-user">partner</span></h3>
          <p class="feature-sub">Il rivenditore.</p>
          <ul class="tidy">
            <li>Vede solo le aziende <strong>che ha creato</strong></li>
            <li>Crea nuove aziende entro i propri caps</li>
            <li>Imposta i limiti di ciascuna azienda, fino al proprio massimale</li>
            <li>Gestisce gli amministratori delle proprie aziende</li>
            <li>Sospende e riattiva le proprie aziende</li>
            <li><strong>Non</strong> vede il menu Partner né le aziende altrui</li>
          </ul>
        </div>
      </div>

      <div class="callout callout-info">
        <strong>Super-utente:</strong> tra gli amministratori, un solo account è designato <em>super-utente</em>. È l'unico a vedere l'azione <strong>Elimina</strong> su un'azienda (operazione irreversibile). Tutti gli altri amministratori e i partner non vedono questo pulsante.
      </div>
    </section>

    <section class="chapter" id="accesso">
      <h2><span class="chapter-num">04</span>Accesso e password</h2>
      <p class="lead">L'accesso alla console è riservato ai membri della partnership. Le credenziali sono le stesse del tuo account sonoQui.</p>

      <div class="feature">
        <h3>Effettuare l'accesso</h3>
        <ol class="steps">
          <li>Apri l'indirizzo della console partner (es. <code class="inline">partners.sonoqui.pro</code>) nel browser.</li>
          <li>Inserisci la tua <strong>email</strong>.</li>
          <li>Inserisci la <strong>password</strong>.</li>
          <li>Premi <strong>Accedi</strong>.</li>
        </ol>
        <p>Se l'account non ha accesso alla console vedrai un messaggio chiaro:</p>
        <ul class="tidy">
          <li><strong>Questo account non ha accesso alla console partner</strong> — l'email non è un membro della partnership.</li>
          <li><strong>Accesso partner disattivato</strong> — il tuo profilo partner è stato disattivato da un amministratore.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Password dimenticata</h3>
        <ol class="steps">
          <li>Nella pagina di accesso premi <strong>Password dimenticata?</strong></li>
          <li>Inserisci la tua email e premi <strong>Invia link di reset</strong>.</li>
          <li>Controlla la posta (anche lo spam) e segui il link ricevuto.</li>
          <li>Imposta una nuova password e torna ad accedere.</li>
        </ol>
        <div class="callout callout-info">
          Per ragioni di sicurezza il messaggio di conferma è sempre lo stesso, anche se l'email non è registrata: non riveliamo se un account esiste.
        </div>
      </div>

      <div class="feature">
        <h3>Cambiare la password (da loggato)</h3>
        <p>Se conosci la password attuale puoi cambiarla senza email, da <strong>Impostazioni → Sicurezza → Cambia password</strong>:</p>
        <ol class="steps">
          <li>Inserisci la <strong>password attuale</strong>.</li>
          <li>Scegli la <strong>nuova password</strong>: i requisiti si spuntano in verde man mano che vengono soddisfatti (almeno 8 caratteri, una minuscola, una maiuscola, un numero e un simbolo).</li>
          <li>Ripeti la nuova password in <strong>Conferma</strong> e premi <strong>Aggiorna password</strong>.</li>
        </ol>
      </div>
    </section>

    <hr class="section-divider">

    <div class="platform-header">
      <div class="icon">🖥️</div>
      <div>
        <h2>La console</h2>
        <div class="sub">Le aree di lavoro della console partner, dalla barra laterale.</div>
      </div>
    </div>

    <section class="chapter" id="console">
      <h2><span class="chapter-num">05</span>Panoramica console</h2>
      <p class="lead">La navigazione è sulla sinistra ed è dinamica in base al ruolo. Su schermi piccoli si apre con l'icona menu (☰); su desktop la barra è comprimibile.</p>

      <div class="feature">
        <h3>Menu di navigazione</h3>
        <div class="grid-2">
          <div class="mini-card"><div class="mini-title">Aziende</div><div class="mini-desc">Elenco e gestione delle aziende</div></div>
          <div class="mini-card"><div class="mini-title">Partner <span class="badge badge-admin">admin</span></div><div class="mini-desc">Solo amministratore: gestione dei rivenditori</div></div>
          <div class="mini-card"><div class="mini-title">Registro attività</div><div class="mini-desc">Storico di ogni operazione in console</div></div>
          <div class="mini-card"><div class="mini-title">Impostazioni</div><div class="mini-desc">Lingua e sicurezza dell'account</div></div>
          <div class="mini-card"><div class="mini-title">Manuale</div><div class="mini-desc">Questa guida</div></div>
        </div>
        <p>In basso nella barra laterale trovi il tuo <strong>profilo</strong> (avatar con email e ruolo) e il pulsante <strong>Esci</strong>. Cliccando sul profilo apri la finestra dove modificare nome e cognome.</p>
      </div>
    </section>

    <section class="chapter" id="aziende">
      <h2><span class="chapter-num">06</span>Aziende</h2>
      <p class="lead">L'elenco delle aziende. L'amministratore vede <em>tutte</em> le aziende della piattaforma; il partner vede solo quelle che ha creato.</p>

      <div class="feature">
        <h3>La tabella</h3>
        <p>Su desktop le aziende sono in tabella; su mobile diventano schede. Per ogni azienda vedi:</p>
        <ul class="tidy">
          <li><strong>Ragione sociale</strong> — il nome dell'azienda.</li>
          <li><strong>Email admin</strong> — l'amministratore principale. Se l'azienda ha più di un admin compare un suffisso <em>+N</em>.</li>
          <li><strong>Partner</strong> <span class="badge badge-admin">admin</span> — il rivenditore a cui l'azienda è assegnata, oppure <em>Piattaforma</em> se nessuno. Colonna visibile solo all'amministratore.</li>
          <li><strong>Utenti</strong>, <strong>Admin</strong>, <strong>Documentali</strong>, <strong>Sedi</strong> — utilizzo attuale / massimo (es. <code>4/20</code>).</li>
          <li><strong>Stato</strong> — <span class="pill pill-ok">Attiva</span> o <span class="pill pill-warn">Sospesa</span>.</li>
          <li><strong>Note</strong> — annotazione libera.</li>
          <li><strong>Azioni</strong> — modifica, sospendi/riattiva, amministratori e (solo super-utente) elimina.</li>
        </ul>
      </div>

      <div class="feature" id="aziende-crea">
        <h3>Creare un'azienda</h3>
        <ol class="steps">
          <li>Premi <strong>Nuova azienda</strong> in alto a destra.</li>
          <li>Inserisci la <strong>ragione sociale</strong>.</li>
          <li>Inserisci l'<strong>email dell'amministratore</strong> (obbligatoria) e, facoltativamente, nome e cognome.</li>
          <li>Scegli la <strong>lingua</strong> (Italiano o English): determina la lingua delle email che l'amministratore riceverà.</li>
          <li>Lascia spuntata <strong>Invia subito l'email di accesso all'amministratore</strong> per dargli accesso immediato. Se la togli, l'azienda viene creata senza email e gliela invierai dopo dall'icona busta.</li>
          <li>Scegli il <strong>pacchetto</strong> in linea con i piani del sito: <strong>Piccola</strong> (10 utenti, 3 sedi), <strong>Media</strong> (20 utenti, 5 sedi) o <strong>Su misura</strong> (limiti liberi). Il pacchetto imposta i valori di partenza di utenti e sedi; puoi comunque aumentarli per gli extra a consumo.</li>
          <li>Imposta i <strong>limiti</strong>: max utenti, max admin, max documentali, max sedi. Ogni limite è vincolato al tuo massimale (caps): se è impostato un tetto, il campo mostra <em>(max N)</em>.</li>
          <li>Premi <strong>Crea azienda</strong>.</li>
        </ol>
        <p>Al termine ricevi una conferma che indica anche il tipo di email inviata all'admin: <strong>invito</strong> (non ha ancora impostato la password), <strong>accesso all'azienda</strong> (account già esistente: riceve un avviso con il link per accedere, senza reset) o <strong>nessuna email</strong>.</p>
        <div class="callout callout-warn">
          Se hai raggiunto il numero massimo di aziende creabili (cap), la creazione viene bloccata con il messaggio «Hai raggiunto il numero massimo di aziende create». Chiedi all'amministratore di alzare il tuo cap.
        </div>
      </div>

      <div class="feature" id="aziende-limiti">
        <h3>Limiti e utilizzo</h3>
        <p>Per ogni azienda i contatori <em>utilizzo / massimo</em> mostrano a colpo d'occhio quanto è occupato ogni limite (utenti, admin, documentali, sedi). I limiti che assegni a un'azienda non possono superare i tuoi caps di partner.</p>
        <div class="callout callout-info">
          Un limite non può scendere <strong>sotto l'utilizzo attuale</strong>: se un'azienda ha 5 utenti attivi non puoi impostare il massimo a 4. Comparirà «Il limite non può scendere sotto l'utilizzo attuale».
        </div>
      </div>

      <div class="feature" id="aziende-modifica">
        <h3>Modificare un'azienda</h3>
        <p>L'icona <strong>matita</strong> apre la modifica:</p>
        <ul class="tidy">
          <li>Aggiorna i <strong>limiti</strong> (max utenti, admin, documentali, sedi) entro i tuoi caps e non sotto l'utilizzo attuale.</li>
          <li>Aggiungi o modifica una <strong>nota</strong>.</li>
          <li><strong>Partner assegnato</strong> <span class="badge badge-admin">admin</span> — solo l'amministratore può riassegnare l'azienda a un partner diverso o riportarla alla <em>Piattaforma</em>.</li>
        </ul>
      </div>

      <div class="feature" id="aziende-stato">
        <h3>Sospendere e riattivare</h3>
        <p>L'icona <strong>pausa</strong> sospende l'azienda; l'icona <strong>play</strong> la riattiva. Entrambe chiedono conferma.</p>
        <div class="callout callout-warn">
          Quando un'azienda è <strong>sospesa</strong> i suoi utenti non possono più accedere all'app sonoQui. I dati restano intatti: riattivandola tutto torna disponibile.
        </div>
      </div>

      <div class="feature" id="aziende-cantieri">
        <h3>Moduli</h3>
        <p>I <strong>moduli</strong> sono funzionalità aggiuntive attivabili per singola azienda. Oggi è disponibile <strong>Cantieri</strong>, che aggiunge all'app aziendale la gestione dei cantieri: anagrafica di cantieri e mezzi, campi personalizzati, registrazione delle attività giornaliere dei dipendenti da mobile e una dashboard mensile con report PDF.</p>
        <p>L'icona <strong>moduli</strong> (griglia) sulla riga dell'azienda apre l'elenco dei moduli disponibili, ognuno con un interruttore per attivarlo o disattivarlo (la disattivazione chiede conferma); gli stessi moduli sono selezionabili anche alla creazione dell'azienda. La colonna <strong>Moduli</strong> mostra i moduli attivi sull'azienda.</p>
        <ul class="tidy">
          <li><strong>Chi può attivarli</strong> — l'amministratore di piattaforma sempre; un partner solo per i moduli concessi tra i suoi limiti (li assegna l'amministratore nella sezione <em>Moduli abilitati</em> del partner). L'icona moduli e la sezione compaiono solo se c'è almeno un modulo attivabile.</li>
          <li><strong>Cosa sblocca</strong> — con Cantieri attivo, l'amministratore dell'azienda assegna i ruoli Cantieri ai propri utenti dalla pagina Utenti; chi non ha un ruolo non vede il modulo.</li>
          <li><strong>Disattivazione</strong> — nasconde il modulo a tutti gli utenti dell'azienda; i dati non vengono cancellati e tornano disponibili alla riattivazione.</li>
        </ul>
      </div>

      <div class="feature" id="aziende-admin">
        <h3>Amministratori di un'azienda</h3>
        <p>L'icona <strong>persone</strong> apre la gestione degli amministratori dell'azienda. Da qui puoi:</p>
        <ul class="tidy">
          <li>Vedere l'elenco degli admin e il contatore <em>utilizzo / massimo</em>.</li>
          <li><strong>Aggiungere</strong> un admin per email. Tieni spuntata <em>Invia subito l'email di accesso</em> per dargli accesso immediato. L'aggiunta è bloccata se è stato raggiunto il numero massimo di admin.</li>
          <li><strong>Reinviare</strong> l'email di accesso (icona busta) a un admin esistente — invito o reset a seconda dello stato del suo account.</li>
          <li><strong>Rimuovere</strong> un admin. Non puoi rimuovere l'ultimo amministratore rimasto.</li>
        </ul>
      </div>

      <div class="feature" id="aziende-elimina">
        <h3>Eliminare un'azienda <span class="badge badge-admin">super-utente</span></h3>
        <p>L'icona <strong>cestino</strong> compare <strong>solo al super-utente</strong>. L'eliminazione è <strong>irreversibile</strong>.</p>
        <ol class="steps">
          <li>Apri l'azione Elimina sulla riga dell'azienda.</li>
          <li>Per confermare, <strong>digita la ragione sociale esatta</strong> dell'azienda: il pulsante si attiva solo quando il nome corrisponde.</li>
          <li>Premi <strong>Elimina definitivamente</strong>.</li>
        </ol>
        <p>L'azienda viene eliminata e gli account degli utenti che <strong>non appartengono ad altre aziende</strong> vengono cancellati definitivamente; quelli condivisi con altre aziende vengono solo scollegati. Al termine la console riporta quanti utenti sono stati <em>cancellati</em> e quanti <em>scollegati</em>.</p>
        <div class="callout callout-danger">
          Operazione senza ritorno. Usa <em>Sospendi</em> se vuoi solo bloccare temporaneamente l'accesso senza perdere i dati.
        </div>
      </div>
    </section>

    <section class="chapter" id="partner">
      <h2><span class="chapter-num">07</span>Partner <span class="badge badge-admin">admin</span></h2>
      <p class="lead">La gestione dei rivenditori. Questa sezione è visibile <strong>solo all'amministratore di piattaforma</strong>.</p>

      <div class="feature">
        <h3>La tabella</h3>
        <p>Per ogni partner vedi: nome partner, email, numero di <strong>aziende</strong> create e i suoi <strong>caps</strong> (max aziende, max utenti/azienda, max admin/azienda, max documentali/azienda, max sedi/azienda), lo <strong>stato</strong> (<span class="pill pill-ok">Attivo</span> / <span class="pill pill-warn">Disattivato</span>) e le note. Un cap mostrato come <em>Illimitato</em> significa nessun tetto.</p>
      </div>

      <div class="feature" id="partner-crea">
        <h3>Creare un partner</h3>
        <ol class="steps">
          <li>Premi <strong>Nuovo partner</strong>.</li>
          <li>Inserisci l'<strong>email</strong> del partner (obbligatoria) e, facoltativi, nome partner, nome, cognome e note.</li>
          <li>Lascia spuntata <strong>Invia subito l'email di accesso al partner</strong> per dargli accesso immediato; se la togli, lo crei senza email e gliela invii dopo.</li>
          <li>Imposta i <strong>caps</strong>: lascia un campo <strong>vuoto</strong> per renderlo illimitato.</li>
          <li>Premi <strong>Crea partner</strong>.</li>
        </ol>
      </div>

      <div class="feature" id="partner-caps">
        <h3>Limiti del partner (caps)</h3>
        <p>I caps stabiliscono cosa il partner può fare quando crea o modifica le proprie aziende:</p>
        <table>
          <thead><tr><th>Cap</th><th>Significato</th></tr></thead>
          <tbody>
            <tr><td><strong>Max aziende creabili</strong></td><td>Quante aziende il partner può creare in totale.</td></tr>
            <tr><td><strong>Max utenti per azienda</strong></td><td>Tetto al limite utenti che può assegnare a ciascuna azienda.</td></tr>
            <tr><td><strong>Max admin per azienda</strong></td><td>Tetto al limite amministratori per azienda.</td></tr>
            <tr><td><strong>Max documentali per azienda</strong></td><td>Tetto al limite documentali per azienda.</td></tr>
            <tr><td><strong>Max sedi per azienda</strong></td><td>Tetto al limite sedi per azienda.</td></tr>
            <tr><td><strong>Moduli abilitati</strong></td><td>I moduli (es. Cantieri) che il partner può attivare o disattivare sulle proprie aziende. Ogni modulo è una casella indipendente.</td></tr>
          </tbody>
        </table>
        <p>Con l'icona <strong>matita</strong> modifichi caps, nome e note del partner. Un cap non può essere abbassato sotto un valore già in uso dalle aziende del partner.</p>
      </div>

      <div class="feature" id="partner-stato">
        <h3>Attivare, disattivare, reinvitare</h3>
        <ul class="tidy">
          <li><strong>Disattiva</strong> (icona divieto) — il partner non potrà più accedere alla console. Le sue aziende restano attive.</li>
          <li><strong>Attiva</strong> (icona spunta) — riabilita l'accesso a un partner disattivato.</li>
          <li><strong>Reinvita</strong> (icona busta) — rinvia l'email di accesso al partner (invito o reset a seconda dello stato del suo account). Chiede conferma.</li>
        </ul>
      </div>
    </section>

    <section class="chapter" id="audit">
      <h2><span class="chapter-num">08</span>Registro attività</h2>
      <p class="lead">Lo storico, in sola lettura, di ogni operazione effettuata nella console.</p>

      <div class="feature">
        <h3>Cosa registra</h3>
        <p>Ogni riga riporta <strong>data/ora</strong>, <strong>autore</strong> (email), <strong>ruolo</strong>, <strong>operazione</strong> e <strong>oggetto</strong> (l'elemento interessato). Sono tracciate, tra le altre:</p>
        <ul class="tidy">
          <li>Aziende: creazione, modifica limiti, sospensione, riattivazione, modifica note, assegnazione a partner, aggiunta/rimozione/reinvito di amministratori, eliminazione.</li>
          <li>Partner: creazione, modifica caps, modifica anagrafica, attivazione, disattivazione, reinvito.</li>
        </ul>
        <p>Il pulsante <strong>Aggiorna</strong> ricarica l'elenco. Su mobile le voci sono mostrate come schede.</p>
      </div>
    </section>

    <section class="chapter" id="impostazioni">
      <h2><span class="chapter-num">09</span>Impostazioni e profilo</h2>
      <p class="lead">Le preferenze della console e i dati del tuo account.</p>

      <div class="feature">
        <h3>Lingua</h3>
        <p>In <strong>Impostazioni</strong> scegli la lingua dell'interfaccia (Italiano o English). La scelta è memorizzata su questo browser.</p>
      </div>

      <div class="feature">
        <h3>Sicurezza</h3>
        <p>In <strong>Impostazioni → Sicurezza</strong> premi <strong>Cambia password</strong> per aggiornare la password del tuo account (vedi il capitolo <em>Accesso e password</em>).</p>
      </div>

      <div class="feature">
        <h3>Profilo</h3>
        <p>Cliccando sul tuo avatar in basso nella barra laterale apri il <strong>Profilo</strong>: qui modifichi <strong>nome</strong> e <strong>cognome</strong>. L'email non è modificabile da qui.</p>
      </div>
    </section>

    <hr class="section-divider">

    <section class="chapter" id="glossario">
      <h2><span class="chapter-num">10</span>Glossario</h2>
      <p class="lead">I termini ricorrenti, in breve.</p>

      <div class="feature">
        <table>
          <thead><tr><th>Termine</th><th>Definizione</th></tr></thead>
          <tbody>
            <tr><td><strong>Azienda (tenant)</strong></td><td>Il cliente finale: organizzazione con utenti, sedi e dati propri.</td></tr>
            <tr><td><strong>Partner</strong></td><td>Rivenditore che crea e gestisce le proprie aziende, entro i caps assegnati.</td></tr>
            <tr><td><strong>Amministratore di piattaforma</strong></td><td>Ruolo <em>admin</em> della console: vede tutto e gestisce i partner.</td></tr>
            <tr><td><strong>Super-utente</strong></td><td>L'unico admin che può eliminare definitivamente un'azienda.</td></tr>
            <tr><td><strong>Limiti</strong></td><td>Massimali di un'azienda: utenti, admin, documentali, sedi.</td></tr>
            <tr><td><strong>Caps</strong></td><td>Massimali di un partner: aziende creabili e tetti per i limiti delle sue aziende. Vuoto = illimitato.</td></tr>
            <tr><td><strong>Documentale</strong></td><td>Capacità d'azienda per consultare i documenti di tutti i dipendenti; qui se ne fissa il numero massimo.</td></tr>
            <tr><td><strong>Email di accesso</strong></td><td>Invito (prima password), accesso all'azienda (account già esistente) o reset password (al reinvio).</td></tr>
            <tr><td><strong>Sospensione</strong></td><td>Blocco temporaneo dell'accesso degli utenti di un'azienda; i dati restano.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="chapter" id="faq">
      <h2><span class="chapter-num">11</span>Domande frequenti</h2>
      <p class="lead">Le situazioni più comuni.</p>

      <div class="feature">
        <h3>Qual è la differenza tra invito, accesso all'azienda e reset password?</h3>
        <p>L'<strong>invito</strong> va a chi non ha mai impostato una password (primo accesso) e serve a crearla. Quando aggiungi a un'azienda un utente che <strong>ha già un account</strong>, riceve invece un'email di <strong>accesso all'azienda</strong> con il link per accedere: non serve reimpostare la password. Il <strong>reset password</strong> si usa quando reinvii l'accesso (icona busta) a chi ha smarrito le credenziali. La console sceglie automaticamente il tipo giusto e te lo conferma nel messaggio dopo l'invio.</p>
      </div>

      <div class="feature">
        <h3>Perché non riesco a creare un'altra azienda?</h3>
        <p>Probabilmente hai raggiunto il tuo <strong>massimo di aziende creabili</strong> (cap). Chiedi all'amministratore di piattaforma di aumentarlo.</p>
      </div>

      <div class="feature">
        <h3>Perché non posso abbassare un limite?</h3>
        <p>Un limite non può scendere <strong>sotto l'utilizzo attuale</strong> dell'azienda (es. non puoi impostare max 4 utenti se ce ne sono 5 attivi). Disattiva prima gli utenti in eccesso.</p>
      </div>

      <div class="feature">
        <h3>Chi può eliminare un'azienda?</h3>
        <p>Solo il <strong>super-utente</strong>. Gli altri amministratori e i partner non vedono il pulsante Elimina. In alternativa, <em>Sospendi</em> blocca l'accesso senza cancellare nulla.</p>
      </div>

      <div class="feature">
        <h3>Un partner vede le aziende di altri partner?</h3>
        <p>No. Ogni partner vede <strong>solo</strong> le aziende che ha creato. La visione completa è riservata all'amministratore di piattaforma.</p>
      </div>

      <div class="feature">
        <h3>Cosa succede agli utenti quando elimino un'azienda?</h3>
        <p>Gli account che appartengono <strong>solo</strong> a quell'azienda vengono cancellati definitivamente; quelli presenti anche in altre aziende vengono solo <strong>scollegati</strong>. La console riporta i due conteggi al termine.</p>
      </div>

      <div class="feature">
        <h3>In che lingua riceve le email l'amministratore di un'azienda?</h3>
        <p>Nella lingua scelta nel campo <strong>Lingua</strong> al momento della creazione dell'azienda (Italiano o English).</p>
      </div>
    </section>

    <footer>
      <p><strong>sonoQui Partner · Manuale</strong></p>
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
  return ['# sonoQui Partner — Manuale', ...blocks].join('\n\n') + '\n';
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
    a.download = 'sonoqui-partner-manuale.md';
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
  }, [en, t]);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (total) focusMatch(e.shiftKey ? cur - 1 : cur + 1);
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  };

  return (
    <div ref={rootRef} className="manuale-root">
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
