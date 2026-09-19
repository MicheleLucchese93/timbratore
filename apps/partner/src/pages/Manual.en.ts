// English content for the partner-console manual. Kept in lockstep with the
// inline Italian source in Manual.tsx (same chapter ids / anchors).

export const TOC_EN = `
    <nav>
      <h3>Introduction</h3>
      <a href="#intro">Welcome</a>
      <a href="#concetti">Key concepts</a>
      <a href="#ruoli">Roles and permissions</a>
      <a href="#accesso">Sign-in and password</a>

      <h3>The console</h3>
      <a href="#console">Overview</a>
      <a href="#aziende">Companies</a>
      <a href="#aziende-crea" class="sub">Creating a company</a>
      <a href="#aziende-limiti" class="sub">Limits and usage</a>
      <a href="#aziende-modifica" class="sub">Editing a company</a>
      <a href="#aziende-stato" class="sub">Suspend and resume</a>
      <a href="#aziende-cantieri" class="sub">Modules</a>
      <a href="#aziende-admin" class="sub">Administrators</a>
      <a href="#aziende-supporto" class="sub">Read-only access</a>
      <a href="#aziende-elimina" class="sub">Deleting</a>
      <a href="#richieste">Requests</a>
      <a href="#richieste-lavorare" class="sub">Working a request</a>
      <a href="#partner">Partners</a>
      <a href="#partner-crea" class="sub">Creating a partner</a>
      <a href="#partner-caps" class="sub">Partner caps</a>
      <a href="#partner-stato" class="sub">Enable and disable</a>
      <a href="#selfservice">Self-service companies</a>
      <a href="#selfservice-colonne" class="sub">Columns and filters</a>
      <a href="#selfservice-abbonamento" class="sub">Subscription window</a>
      <a href="#selfservice-override" class="sub">Limit overrides</a>
      <a href="#selfservice-manuale" class="sub">Manual billing</a>
      <a href="#registrazioni">Signups</a>
      <a href="#pagamenti">Payments</a>
      <a href="#pagamenti-differita" class="sub">Deferred invoice</a>
      <a href="#audit">Activity log</a>
      <a href="#impostazioni">Settings and profile</a>

      <h3>Reference</h3>
      <a href="#glossario">Glossary</a>
      <a href="#faq">FAQ</a>
    </nav>
`;

export const MAIN_EN = `

    <section class="chapter" id="intro">
      <h2><span class="chapter-num">01</span>Welcome</h2>
      <p class="lead">The sonoQui <strong>partner console</strong> is where resellers and the platform administration create and manage client companies: set their limits, manage their administrators and control their status.</p>

      <div class="feature">
        <h3>What the partner console is</h3>
        <p>It is a web app separate from the sonoQui company app (the one employees use to clock in and company admins use to manage attendance and leave). The partner console works one level above: <strong>provisioning</strong> and <strong>company administration</strong> on the platform.</p>
        <p>You reach it at your dedicated address (e.g. <code class="inline">partners.sonoqui.pro</code>); access is reserved to partnership members only.</p>
        <div class="grid-2">
          <div class="mini-card">
            <div class="mini-title">🏢 Companies</div>
            <div class="mini-desc">Create new client companies, assign plan limits, manage administrators, suspend or resume access.</div>
          </div>
          <div class="mini-card">
            <div class="mini-title">🤝 Partners</div>
            <div class="mini-desc">Platform administrator only: create resellers, set their caps and enable/disable their access.</div>
          </div>
        </div>
      </div>
    </section>

    <section class="chapter" id="concetti">
      <h2><span class="chapter-num">02</span>Key concepts</h2>
      <p class="lead">A few terms recur throughout the console. Knowing them helps you find your way.</p>

      <div class="feature">
        <h3>The core terms</h3>
        <table>
          <thead><tr><th>Term</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><strong>Company</strong></td><td>The end client (the <em>tenant</em>): an organisation with its own users, branches and data, fully separate from the others.</td></tr>
            <tr><td><strong>Partner</strong></td><td>The reseller who creates and manages their own companies. They see only the companies they created and are subject to the caps assigned by the platform administrator.</td></tr>
            <tr><td><strong>Platform administrator</strong></td><td>The console <em>admin</em> role: sees every company, manages partners and can reassign a company to a different partner.</td></tr>
            <tr><td><strong>Super-user</strong></td><td>The single account allowed to permanently delete a company and to manage the subscriptions, signups and payments of self-service companies. An administrator with extra privileges.</td></tr>
            <tr><td><strong>Self-service company</strong></td><td>A company that signed up on its own from the website, on the free plan or on a paid plan paid by card (Stripe). It belongs to no partner.</td></tr>
            <tr><td><strong>Billing mode</strong></td><td><em>Stripe</em>: limits and modules derive from what the company pays for. <em>Manual billing</em>: they are set by hand, as for partner companies.</td></tr>
            <tr><td><strong>Limits (company)</strong></td><td>A company's plan caps: maximum number of users, administrators, documentali and branches.</td></tr>
            <tr><td><strong>Caps (partner)</strong></td><td>A partner's caps: how many companies they can create and the maximum limits they can assign to each. Blank = unlimited.</td></tr>
            <tr><td><strong>Documentale</strong></td><td>An extra capability of a company user: it lets them upload and view every employee's documents. Here you only set its maximum per company.</td></tr>
            <tr><td><strong>Branch</strong></td><td>A company workplace. Here you only set the maximum allowed.</td></tr>
            <tr><td><strong>Access email</strong></td><td>The email that grants a user access. It's an <em>invite</em> to set the password for someone who never did, a <em>company access</em> notice (with a sign-in link) for someone who already has an account, or a <em>password reset</em> when you resend access.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="chapter" id="ruoli">
      <h2><span class="chapter-num">03</span>Roles and permissions</h2>
      <p class="lead">The console has two roles with very different access.</p>

      <div class="grid-2">
        <div class="feature" style="margin:0;">
          <h3>🛠️ Administrator <span class="badge badge-admin">admin</span></h3>
          <p class="feature-sub">The sonoQui platform administration.</p>
          <ul class="tidy">
            <li>Sees <strong>every</strong> company on the platform</li>
            <li>Sees and uses the <strong>Partners</strong> menu</li>
            <li>Creates, edits, enables and disables partners</li>
            <li>Sets each partner's <strong>caps</strong></li>
            <li>Reassigns a company to a partner (or to the Platform)</li>
            <li>Creates and manages companies and their administrators</li>
          </ul>
        </div>
        <div class="feature" style="margin:0;">
          <h3>🤝 Partner <span class="badge badge-user">partner</span></h3>
          <p class="feature-sub">The reseller.</p>
          <ul class="tidy">
            <li>Sees only the companies <strong>they created</strong></li>
            <li>Creates new companies within their own caps</li>
            <li>Sets each company's limits, up to their own maximum</li>
            <li>Manages the administrators of their companies</li>
            <li>Suspends and resumes their companies</li>
            <li><strong>Does not</strong> see the Partners menu or other people's companies</li>
          </ul>
        </div>
      </div>

      <div class="callout callout-info">
        <strong>Super-user:</strong> among the administrators, a single account is the designated <em>super-user</em>. It is the only one that sees the <strong>Delete</strong> action on a company (an irreversible operation), the <strong>Subscription</strong> action and the <strong>Signups</strong> and <strong>Payments</strong> pages (see <em>Self-service companies</em>). All other administrators and partners do not see them.
      </div>
    </section>

    <section class="chapter" id="accesso">
      <h2><span class="chapter-num">04</span>Sign-in and password</h2>
      <p class="lead">Access to the console is reserved to partnership members. Your credentials are the same as your sonoQui account.</p>

      <div class="feature">
        <h3>Signing in</h3>
        <ol class="steps">
          <li>Open the partner console address (e.g. <code class="inline">partners.sonoqui.pro</code>) in your browser.</li>
          <li>Enter your <strong>email</strong>.</li>
          <li>Enter your <strong>password</strong>.</li>
          <li>Press <strong>Sign in</strong>.</li>
        </ol>
        <p>If the account has no console access you'll see a clear message:</p>
        <ul class="tidy">
          <li><strong>This account has no access to the partner console</strong> — the email is not a partnership member.</li>
          <li><strong>Partner access disabled</strong> — your partner profile was disabled by an administrator.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Forgot password</h3>
        <ol class="steps">
          <li>On the sign-in page press <strong>Forgot password?</strong></li>
          <li>Enter your email and press <strong>Send reset link</strong>.</li>
          <li>Check your inbox (and spam) and follow the link.</li>
          <li>Set a new password and sign back in.</li>
        </ol>
        <div class="callout callout-info">
          For security the confirmation message is always the same, even if the email isn't registered: we don't reveal whether an account exists.
        </div>
      </div>

      <div class="feature">
        <h3>Changing your password (while signed in)</h3>
        <p>If you know your current password you can change it without email, from <strong>Settings → Security → Change password</strong>:</p>
        <ol class="steps">
          <li>Enter your <strong>current password</strong>.</li>
          <li>Choose a <strong>new password</strong>: the requirements turn green as they're met (at least 8 characters, one lowercase, one uppercase, one number and one symbol).</li>
          <li>Repeat the new password in <strong>Confirm</strong> and press <strong>Update password</strong>.</li>
        </ol>
      </div>
    </section>

    <hr class="section-divider">

    <div class="platform-header">
      <div class="icon">🖥️</div>
      <div>
        <h2>The console</h2>
        <div class="sub">The work areas of the partner console, from the sidebar.</div>
      </div>
    </div>

    <section class="chapter" id="console">
      <h2><span class="chapter-num">05</span>Console overview</h2>
      <p class="lead">Navigation is on the left and adapts to your role. On small screens it opens with the menu icon (☰); on desktop the bar is collapsible.</p>

      <div class="feature">
        <h3>Navigation menu</h3>
        <div class="grid-2">
          <div class="mini-card"><div class="mini-title">Companies</div><div class="mini-desc">List and management of companies</div></div>
          <div class="mini-card"><div class="mini-title">Partners <span class="badge badge-admin">admin</span></div><div class="mini-desc">Administrator only: reseller management</div></div>
          <div class="mini-card"><div class="mini-title">Signups <span class="badge badge-admin">super-user</span></div><div class="mini-desc">Signup requests from the website and their funnel</div></div>
          <div class="mini-card"><div class="mini-title">Payments <span class="badge badge-admin">super-user</span></div><div class="mini-desc">Stripe payments to invoice</div></div>
          <div class="mini-card"><div class="mini-title">Activity log</div><div class="mini-desc">History of every operation in the console</div></div>
          <div class="mini-card"><div class="mini-title">Settings</div><div class="mini-desc">Account language and security</div></div>
          <div class="mini-card"><div class="mini-title">Manual</div><div class="mini-desc">This guide</div></div>
        </div>
        <p>At the bottom of the sidebar you'll find your <strong>profile</strong> (avatar with email and role) and the <strong>Sign out</strong> button. Clicking the profile opens the window where you edit your first and last name.</p>
      </div>
    </section>

    <section class="chapter" id="aziende">
      <h2><span class="chapter-num">06</span>Companies</h2>
      <p class="lead">The list of companies. The administrator sees <em>every</em> company on the platform; a partner sees only the ones they created.</p>

      <div class="feature">
        <h3>The table</h3>
        <p>On desktop companies are shown in a table; on mobile they become cards. For each company you see:</p>
        <ul class="tidy">
          <li><strong>Company name</strong> — the name of the company.</li>
          <li><strong>Admin email</strong> — the main administrator. If the company has more than one admin a <em>+N</em> suffix appears.</li>
          <li><strong>Partner</strong> <span class="badge badge-admin">admin</span> — the reseller the company is assigned to, or <em>Platform</em> if none. Visible only to the administrator.</li>
          <li><strong>Users</strong>, <strong>Admins</strong>, <strong>Documentali</strong>, <strong>Branches</strong> — current usage / maximum (e.g. <code>4/20</code>). <strong>Click a counter</strong> to open its list: Users shows every member (name, email and role), Documentali and Branches their detail, Admins opens admin management.</li>
          <li><strong>Status</strong> — <span class="pill pill-ok">Active</span> or <span class="pill pill-warn">Suspended</span>.</li>
          <li><strong>Note</strong> — free-text annotation.</li>
          <li><strong>Origin</strong>, <strong>Plan</strong>, <strong>Subscription</strong> <span class="badge badge-admin">admin</span> and <strong>VAT no.</strong> — where the company comes from, its plan and the VIES check of its VAT number: see <em>Self-service companies</em>.</li>
          <li><strong>Actions</strong> — edit, suspend/resume, administrators and (super-user only) subscription and delete.</li>
        </ul>
      </div>

      <div class="feature" id="aziende-crea">
        <h3>Creating a company</h3>
        <ol class="steps">
          <li>Press <strong>New company</strong> at the top right.</li>
          <li>Enter the <strong>company name</strong>.</li>
          <li>Enter the <strong>administrator email</strong> (required) and, optionally, first and last name.</li>
          <li>Choose the <strong>language</strong> (Italian or English): it sets the language of the emails the administrator receives.</li>
          <li>Leave <strong>Send the admin's access email now</strong> checked to grant immediate access. If you uncheck it, the company is created with no email and you send it later via the envelope icon.</li>
          <li>Choose the <strong>package</strong> in line with the website plans: <strong>Small</strong> (10 users, 3 branches), <strong>Medium</strong> (20 users, 5 branches) or <strong>Custom</strong> (free limits). The package sets the starting values for users and branches; you can still raise them for pay-per-use extras.</li>
          <li>Set the <strong>limits</strong>: max users, max admins, max documentali, max branches. Each limit is bound to your cap: when a cap is set, the field shows <em>(max N)</em>.</li>
          <li>Press <strong>Create company</strong>.</li>
        </ol>
        <p>When done you get a confirmation that also states which email was sent to the admin: <strong>invite</strong> (password not set yet), <strong>company access</strong> (existing account: a notice with a sign-in link, no reset) or <strong>no email</strong>.</p>
        <div class="callout callout-warn">
          If you've reached your maximum number of companies (cap), creation is blocked with the message "You have reached your maximum number of created companies". Ask the administrator to raise your cap.
        </div>
      </div>

      <div class="feature" id="aziende-limiti">
        <h3>Limits and usage</h3>
        <p>For each company the <em>usage / maximum</em> counters show at a glance how full each limit is (users, admins, documentali, branches). The limits you assign to a company can never exceed your partner caps.</p>
        <div class="callout callout-info">
          A limit can't drop <strong>below current usage</strong>: if a company has 5 active users you can't set the maximum to 4. You'll see "The limit cannot drop below current usage".
        </div>
      </div>

      <div class="feature" id="aziende-modifica">
        <h3>Editing a company</h3>
        <p>The <strong>pencil</strong> icon opens the editor:</p>
        <ul class="tidy">
          <li>Update the <strong>limits</strong> (max users, admins, documentali, branches) within your caps and not below current usage.</li>
          <li>Add or edit a <strong>note</strong>.</li>
          <li><strong>Assigned partner</strong> <span class="badge badge-admin">admin</span> — only the administrator can reassign the company to a different partner or return it to the <em>Platform</em>. A company billed through Stripe with active subscriptions can't be assigned to a partner: cancel them first (see <em>Self-service companies</em>).</li>
        </ul>
        <p>On a company billed through Stripe the limits are read-only: they derive from its subscription (see <em>Self-service companies</em>).</p>
      </div>

      <div class="feature" id="aziende-stato">
        <h3>Suspend and resume</h3>
        <p>The <strong>pause</strong> icon suspends the company; the <strong>play</strong> icon resumes it. Both ask for confirmation.</p>
        <div class="callout callout-warn">
          When a company is <strong>suspended</strong>, its users can no longer sign in to the sonoQui app. The data stays intact: resuming the company makes everything available again.
        </div>
      </div>

      <div class="feature" id="aziende-cantieri">
        <h3>Modules</h3>
        <p><strong>Modules</strong> are add-on features you enable per company. Today <strong>Cantieri</strong> is available: it adds construction-site management to the company app — a registry of sites and vehicles, custom fields, employees logging their daily activities from mobile, and a monthly dashboard with PDF reports.</p>
        <p>The <strong>modules</strong> icon (grid) on the company row opens the list of available modules, each with a switch to enable or disable it (disabling asks for confirmation); the same modules can also be picked when creating the company. The <strong>Modules</strong> column shows which modules are active on the company.</p>
        <ul class="tidy">
          <li><strong>Who can enable them</strong> — the platform administrator always; a partner only for the modules granted among their caps (assigned by the administrator in the partner's <em>Enabled modules</em> section). The modules icon and section appear only when at least one module is enableable.</li>
          <li><strong>What it unlocks</strong> — with Cantieri enabled, the company administrator assigns Cantieri roles to their users from the Users page; users without a role don't see the module.</li>
          <li><strong>Disabling</strong> — hides the module from every user of the company; no data is deleted and everything comes back on re-enable.</li>
        </ul>
      </div>

      <div class="feature" id="aziende-admin">
        <h3>A company's administrators</h3>
        <p>The <strong>people</strong> icon opens the company's administrator management. From here you can:</p>
        <ul class="tidy">
          <li>See the list of admins and the <em>usage / maximum</em> counter.</li>
          <li><strong>Add</strong> an admin by email. Keep <em>Send the access email now</em> checked to grant immediate access. Adding is blocked once the maximum number of admins is reached.</li>
          <li><strong>Resend</strong> the access email (envelope icon) to an existing admin — invite or reset depending on their account state.</li>
          <li><strong>Remove</strong> an admin. You can't remove the last remaining administrator.</li>
        </ul>
      </div>

      <div class="feature" id="aziende-supporto">
        <h3>Read-only access</h3>
        <p>The <strong>eye</strong> icon opens the company's environment in the sonoQui web app, <strong>read-only</strong>: you see what the customer sees (stamps, users, schedules, requests, anomalies) without being able to change anything. It exists so you can answer a report without asking the customer for credentials.</p>
        <ol class="steps">
          <li>Open the <strong>Open read-only</strong> action on the company row.</li>
          <li>Give a <strong>reason</strong> (optional — it lands in both logs).</li>
          <li>Press <strong>Open environment</strong>: a new tab opens straight inside the customer's environment.</li>
        </ol>
        <ul class="tidy">
          <li><strong>Genuinely read-only</strong> — every change attempt is refused by the server, not merely hidden in the interface. A yellow bar at the top is a constant reminder that you are in a support session.</li>
          <li><strong>Duration</strong> — 30 minutes, no renewal. <em>End session</em> closes it earlier.</li>
          <li><strong>Recorded in the console</strong> — every opening lands in the console's activity log, with your email address, the reason you gave and the company. It does not appear in the customer's own activity log.</li>
          <li><strong>Out of reach</strong> — employee documents and export downloads stay inaccessible even during the session.</li>
          <li><strong>Who can use it</strong> — the platform administrator always; a partner only with the <em>Read-only access to companies</em> ability, and only on their own companies.</li>
        </ul>
      </div>

      <div class="feature" id="aziende-elimina">
        <h3>Deleting a company <span class="badge badge-admin">super-user</span></h3>
        <p>The <strong>trash</strong> icon appears <strong>only to the super-user</strong>. Deletion is <strong>irreversible</strong>.</p>
        <ol class="steps">
          <li>Open the Delete action on the company row.</li>
          <li>To confirm, <strong>type the exact company name</strong>: the button only enables when the name matches.</li>
          <li>Press <strong>Delete permanently</strong>.</li>
        </ol>
        <p>The company is deleted and the accounts of users who <strong>don't belong to any other company</strong> are permanently removed; those shared with other companies are only unlinked. When done, the console reports how many users were <em>removed</em> and how many <em>unlinked</em>.</p>
        <div class="callout callout-danger">
          No way back. Use <em>Suspend</em> if you only want to temporarily block access without losing data.
        </div>
        <p>A company with active Stripe subscriptions can't be deleted: cancel them first from <strong>Subscription → Switch to manual billing</strong>.</p>
      </div>
    </section>

    <section class="chapter" id="richieste">
      <h2><span class="chapter-num">06a</span>Requests</h2>
      <p class="lead">The support queue: the requests customers open from the <strong>Support</strong> entry in their web panel. You read and answer them here, and the answer lands inside the customer's application — not in a mailbox they then have to cross-reference with a ticket.</p>

      <div class="feature">
        <h3>What you see</h3>
        <p>A <strong>platform administrator</strong> sees every company's requests. A <strong>partner</strong> sees only those of the companies they created: a company created by the platform belongs to no partner and stays platform work.</p>
        <p>The grid shows when it was opened, the <strong>reference</strong> (e.g. <em>SQ-20260824-0431</em>, the code the customer quotes), the <strong>company</strong>, the subject, the <strong>state</strong>, the <strong>assignee</strong> and how many customer replies are still unread.</p>
        <ul class="tidy">
          <li><strong>To work on</strong> — everything neither resolved nor closed, oldest first: a queue is worked from the front. Requests the <strong>customer</strong> has already marked resolved are not here: "I no longer need an answer" means there is no work left, whatever state we had reached. They stay visible under <em>All states</em>, and if the customer reopens one it is back in the queue immediately.</li>
          <li><strong>Waiting on customer</strong> — the ball is on the other side.</li>
          <li><strong>Resolved</strong>, <strong>All states</strong> — the archive, newest first.</li>
          <li><strong>All / Mine / Unassigned</strong> — the second filter, on assignment.</li>
        </ul>
        <p>The search box filters by reference, subject, company and the writer's email.</p>
      </div>

      <div class="feature" id="richieste-lavorare">
        <h3>Working a request</h3>
        <p>Click a row to open it. You get the <strong>full</strong> text of the report, the customer's attachments, the whole thread and the company's details (who wrote, category, priority, the company's partner).</p>
        <ul class="tidy">
          <li><strong>Take it</strong> — assigns the request to you. A <em>New</em> request moves to <em>In progress</em> at the same time: a request taken in charge and still marked new tells the queue nothing. <strong>Release</strong> hands it back to nobody.</li>
          <li><strong>State</strong> — <em>New</em>, <em>In progress</em>, <em>Waiting on customer</em>, <em>Resolved</em>, <em>Closed</em>. The customer is emailed when it moves to <em>In progress</em>, <em>Resolved</em> or <em>Closed</em>.</li>
          <li><strong>Assign to</strong> (platform administrators only) — hand the request to another active operator. A partner can only take it or release it.</li>
          <li><strong>Internal note</strong> — operators only. It never appears in the customer's panel and is never quoted in any email.</li>
          <li><strong>Reply</strong> — lands in the customer's thread and in their inbox, carrying the text. The menu next to it decides <strong>where the reply leaves the request</strong>: the person writing chooses, because the same paragraph can mean “resolved” or “waiting on you”. Up to 3 files of 10 MB.</li>
        </ul>
        <p>Opening a request marks it read for the team. The operator's name shows in the console but <strong>not</strong> to the customer: for them the answer comes from support, not from a person.</p>
      </div>

      <div class="feature">
        <h3>What you cannot touch</h3>
        <p>The customer's own tick (“I no longer need an answer”) is theirs: no control in the console changes it. You see it because it is useful information — a request the customer considers closed is worked with less urgency — but it stays their statement.</p>
        <p>A request you close can still be reopened by a customer reply: it goes back to <em>In progress</em>. A reply that vanishes is worse than a reopened request.</p>
      </div>

      <div class="callout callout-warn">
        <strong>You are reading somebody else's data.</strong> A request's text and attachments can name an employee of the company. Every write from this page — state change, assignment, note, reply — lands in the <strong>Activity log</strong> with the request's reference.
      </div>
    </section>

    <section class="chapter" id="partner">
      <h2><span class="chapter-num">07</span>Partners <span class="badge badge-admin">admin</span></h2>
      <p class="lead">Reseller management. This section is visible <strong>only to the platform administrator</strong>.</p>

      <div class="feature">
        <h3>The table</h3>
        <p>For each partner you see: partner name, email, number of <strong>companies</strong> created and their <strong>caps</strong> (max companies, max users/company, max admins/company, max documentali/company, max branches/company), the <strong>status</strong> (<span class="pill pill-ok">Active</span> / <span class="pill pill-warn">Disabled</span>) and notes. A cap shown as <em>Unlimited</em> means no ceiling.</p>
      </div>

      <div class="feature" id="partner-crea">
        <h3>Creating a partner</h3>
        <ol class="steps">
          <li>Press <strong>New partner</strong>.</li>
          <li>Enter the partner's <strong>email</strong> (required) and, optionally, partner name, first name, last name and notes.</li>
          <li>Leave <strong>Send the partner's access email now</strong> checked to grant immediate access; if you uncheck it, you create them with no email and send it later.</li>
          <li>Set the <strong>caps</strong>: leave a field <strong>blank</strong> to make it unlimited.</li>
          <li>Press <strong>Create partner</strong>.</li>
        </ol>
      </div>

      <div class="feature" id="partner-caps">
        <h3>Partner caps</h3>
        <p>Caps define what the partner can do when creating or editing their companies:</p>
        <table>
          <thead><tr><th>Cap</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><strong>Max companies they can create</strong></td><td>How many companies the partner can create in total.</td></tr>
            <tr><td><strong>Max users per company</strong></td><td>Ceiling on the user limit they can assign to each company.</td></tr>
            <tr><td><strong>Max admins per company</strong></td><td>Ceiling on the administrator limit per company.</td></tr>
            <tr><td><strong>Max documentali per company</strong></td><td>Ceiling on the documentali limit per company.</td></tr>
            <tr><td><strong>Max branches per company</strong></td><td>Ceiling on the branch limit per company.</td></tr>
            <tr><td><strong>Read-only access to companies</strong></td><td>Whether the partner may open their companies' environment read-only for support. On for new partners; uncheck to deny it.</td></tr>
            <tr><td><strong>Enabled modules</strong></td><td>The modules (e.g. Cantieri) the partner can enable or disable on their companies. Each module is an independent checkbox.</td></tr>
          </tbody>
        </table>
        <p>With the <strong>pencil</strong> icon you edit the partner's caps, name and notes. A cap can't be lowered below a value already in use by the partner's companies.</p>
      </div>

      <div class="feature" id="partner-stato">
        <h3>Enable, disable, resend</h3>
        <ul class="tidy">
          <li><strong>Disable</strong> (ban icon) — the partner can no longer sign in to the console. Their companies stay active.</li>
          <li><strong>Activate</strong> (check icon) — re-enable access for a disabled partner.</li>
          <li><strong>Resend</strong> (envelope icon) — re-send the access email to the partner (invite or reset depending on their account state). Asks for confirmation.</li>
        </ul>
      </div>
    </section>

    <section class="chapter" id="selfservice">
      <h2><span class="chapter-num">07a</span>Self-service companies <span class="badge badge-admin">super-user</span></h2>
      <p class="lead">Companies can sign up on their own from the sonoQui website, start on the <strong>Free</strong> plan and move to a paid plan, or buy a module, paying by card on Stripe. This chapter and the next two explain how the <strong>super-user</strong> follows them from the console.</p>

      <div class="feature">
        <h3>Who sees what</h3>
        <ul class="tidy">
          <li><strong>Partners</strong> — <strong>never</strong> see self-service companies: they only see the companies they created, and a company that signed up from the website belongs to no partner.</li>
          <li><strong>Platform administrators</strong> — see self-service companies under <em>Companies</em>, with the Origin, Plan and Subscription columns, but cannot touch their subscriptions and payments.</li>
          <li><strong>Super-user</strong> — the only one with the <strong>Subscription</strong> action and with <strong>Signups</strong> and <strong>Payments</strong> in the menu. The server refuses these operations to anyone else.</li>
        </ul>
      </div>

      <div class="feature" id="selfservice-colonne">
        <h3>Columns and filters in Companies</h3>
        <p>For platform administrators the Companies table also shows:</p>
        <ul class="tidy">
          <li><strong>Origin</strong> — <span class="pill pill-info">Self-service</span> if the company signed up from the website, <em>Partner</em> if it was created from the console (by a partner or by the platform).</li>
          <li><strong>Plan</strong> — <em>Free</em>, <em>Piccola</em>, <em>Media</em> or <em>Custom</em> (companies under manual billing). <em>→ Piccola pending</em> marks a plan chosen but not paid yet; <span class="pill pill-err">Over the limits</span> a company back on the free plan with more users or branches than it allows.</li>
          <li><strong>Subscription</strong> — the state of the plan subscription on Stripe: <span class="pill pill-ok">Active</span>, <span class="pill pill-warn">Payment past due</span> (the card was declined and Stripe is retrying: meanwhile the company keeps its plan), <em>Ended</em>, or — when there is no subscription.</li>
          <li><strong>VAT no.</strong> — with the outcome of the VIES check: <span class="pill pill-ok">verified</span>; <span class="pill pill-warn">not in VIES</span> (many Italian micro-businesses are not registered on VIES: the signup is accepted but must be reviewed); <em>to check</em> (VIES unreachable at signup time); <em>reviewed</em> once the number has been checked by hand.</li>
        </ul>
        <p>Above the table, the <strong>All</strong>, <strong>Self-service</strong>, <strong>Partner</strong> and <strong>VAT to review</strong> filters — the queue of VAT numbers not in VIES or not verifiable and not yet reviewed — each with its count. The search box filters by company name, admin email, VAT number, partner and note.</p>
        <div class="callout callout-info">
          On a company billed through Stripe, limits and modules <strong>derive from what it pays for</strong>: in the editor (pencil icon) the limits are read-only and the modules icon is disabled, with the notice "Managed by the Stripe subscription — use Subscription". Note and assigned partner stay editable.
        </div>
      </div>

      <div class="feature" id="selfservice-abbonamento">
        <h3>The Subscription window</h3>
        <p>The <strong>credit card</strong> icon on the company row opens the <strong>Subscription</strong> window:</p>
        <ul class="tidy">
          <li><strong>Summary</strong> — origin, plan, billing mode, the limits in force and the <strong>Open in Stripe</strong> link to the customer's page in the Stripe dashboard.</li>
          <li><strong>Stripe subscriptions</strong> — one per item (plan, Cantieri module, API module), with its state and renewal or end date.</li>
          <li><strong>Payments</strong> — how many payments, for what total and how many are still to invoice. <em>Open in Payments</em> opens the ledger filtered on this company.</li>
          <li><strong>Billing details</strong> — the ones the customer entered for the e-invoice: company name, VAT number, tax code, address, SDI code or PEC, accounts email, with the VIES consultation number.</li>
          <li><strong>Signup</strong> — who signed up, when, with which chosen plan and from which campaign (UTM).</li>
        </ul>
        <p>And the commands:</p>
        <ul class="tidy">
          <li><strong>Review VAT no.</strong> — marks the VAT number as checked by hand and takes it out of the <em>VAT to review</em> filter. Tick <em>Re-run the VIES check first</em> to query VIES again.</li>
          <li><strong>Limit overrides</strong> and <strong>Billing mode</strong> — see below.</li>
          <li><strong>Sync with Stripe</strong> — re-reads subscriptions and their state from Stripe and recomputes limits and modules. Use it when an update from Stripe did not arrive; an automatic check also does it every night.</li>
        </ul>
      </div>

      <div class="feature" id="selfservice-override">
        <h3>Limit overrides</h3>
        <p>Overrides are <strong>courtesy extras</strong> on top of what the company pays for, without taking it off Stripe. For each limit (users, branches, admins, documentali) the higher of plan and override wins; a ticked module (Cantieri, API) stays on even without a subscription.</p>
        <ol class="steps">
          <li>Open <strong>Subscription</strong> on the company row.</li>
          <li>Under <strong>Limit overrides</strong> fill in only the limits to raise (the placeholder shows the plan's value) and tick the modules to give away.</li>
          <li>Press <strong>Save overrides</strong>. <strong>Remove overrides</strong> clears them all.</li>
        </ol>
        <p>An override never takes away anything the customer paid for. It only applies under Stripe billing: under manual billing the fields are disabled.</p>
      </div>

      <div class="feature" id="selfservice-manuale">
        <h3>Manual billing</h3>
        <p>For a custom deal, or to hand the company to a partner, switch it to <strong>manual billing</strong>: from then on limits and modules are edited by hand like for any other company, and Stripe no longer touches them.</p>
        <ol class="steps">
          <li>In the Subscription window press <strong>Switch to manual billing</strong>.</li>
          <li>If the company has active subscriptions, choose what to do with them: <strong>Keep them active</strong> (Stripe keeps charging), <strong>Cancel at period end</strong> (they stay active until the end of the period already paid) or <strong>Cancel now</strong> (no refund, cannot be undone).</li>
          <li>Confirm. Limits and modules keep their current values until you change them with the pencil and modules icons.</li>
        </ol>
        <p><strong>Switch to Stripe billing</strong> does the opposite: limits and modules are recomputed from the subscriptions (plus overrides) and the values set by hand are replaced. With no active subscription the company falls back to the free plan's limits.</p>
        <div class="callout callout-warn">
          A company with active Stripe subscriptions <strong>can't be deleted</strong> and, while it is billed through Stripe, <strong>can't be assigned to a partner</strong>: Stripe would keep charging a customer we no longer manage. Cancel them first with <em>Switch to manual billing</em>.
        </div>
      </div>
    </section>

    <section class="chapter" id="registrazioni">
      <h2><span class="chapter-num">07b</span>Signups <span class="badge badge-admin">super-user</span></h2>
      <p class="lead">Every request sent from the website signup form, from the email confirmation to a company that clocks in and pays.</p>

      <div class="feature">
        <h3>The funnel</h3>
        <p>At the top, five counters over the <strong>last 90 days</strong>: <strong>Requests</strong>, <strong>Emails confirmed</strong>, <strong>Companies created</strong>, <strong>Clocking in</strong> (companies with at least one clock-in) and <strong>Paying</strong> (with at least one payment), each with its share of the requests. They don't follow the table filters: they measure the channel, not the page.</p>
      </div>

      <div class="feature">
        <h3>The table</h3>
        <p>For each request: date, name, email, phone, the <strong>plan chosen</strong> on the website, the <strong>status</strong>, the company created with its VAT number and VIES outcome (hover the badge for the consultation number), the declared employees, the last clock-in and the source (UTM).</p>
        <ul class="tidy">
          <li><strong>Email to confirm</strong> — the confirmation link has been sent and not used yet.</li>
          <li><strong>Email confirmed</strong> — the account exists, the company doesn't yet.</li>
          <li><strong>Company created</strong> — the company is live; <span class="pill pill-ok">Paying</span> if it has at least one payment.</li>
          <li><strong>Expired</strong> — the link was not used in time.</li>
          <li><strong>Rejected</strong> — closed by the super-user; hover the badge for the reason.</li>
        </ul>
        <p>The filters at the top pick the status; the search finds name, email, company and VAT number.</p>
      </div>

      <div class="feature">
        <h3>Actions</h3>
        <ul class="tidy">
          <li><strong>Resend email</strong> (envelope icon) — only for requests still to confirm or expired: sends a new confirmation link, and the previous one stops working.</li>
          <li><strong>Reject</strong> (ban icon) — closes a request that has not created a company yet, with an optional reason: the link stops working and the requester receives no email.</li>
          <li><strong>Open company</strong> (building icon) — goes to <em>Companies</em> already filtered on that company.</li>
        </ul>
      </div>
    </section>

    <section class="chapter" id="pagamenti">
      <h2><span class="chapter-num">07c</span>Payments <span class="badge badge-admin">super-user</span></h2>
      <p class="lead">The ledger of payments to invoice. Stripe collects the money but <strong>issues no invoices</strong>: the e-invoice (fattura elettronica) is issued by the seller from its own invoicing software, outside sonoQui, and this page keeps track of what is still missing.</p>

      <div class="callout callout-warn">
        If the <strong>SANDBOX mode</strong> notice appears at the top, Stripe is running in test mode: the list only shows payments made with test cards and <strong>must not be invoiced</strong>. Real payments stay recorded and reappear once the mode is back to live.
      </div>

      <div class="feature">
        <h3>The flow</h3>
        <ol class="steps">
          <li>The customer pays a plan or a module by card: Stripe collects.</li>
          <li>The payment shows up here as <span class="pill pill-warn">To invoice</span>, with a <strong>copy of the customer's billing details</strong> as they were at payment time.</li>
          <li>Issue the e-invoice from your invoicing software, outside sonoQui, using the data in the <strong>detail</strong>.</li>
          <li>Press <strong>Mark as invoiced</strong> and enter the invoice number and date: the row becomes <span class="pill pill-ok">Invoiced no. … of …</span>.</li>
        </ol>
      </div>

      <div class="feature">
        <h3>Filters, totals and columns</h3>
        <p>The <strong>To invoice</strong>, <strong>Invoiced</strong> and <strong>All</strong> filters, the <strong>month paid</strong> (the current month when the page opens; <em>All months</em> to see them all) and the search by company, VAT number or invoice number. When payments are still to invoice in other months, a notice says so, with a <em>Show all months</em> button.</p>
        <p>The totals strip shows net, VAT, total collected, Stripe fees and how many payments are still to invoice. For each payment: payment date (Italian time), company, VAT number, SDI code or PEC, items with their period, amounts, Stripe fee, status and <strong>Invoice by</strong>.</p>
        <ul class="tidy">
          <li><strong>Invoice by</strong> — <em>immediate</em>: within 12 days of the payment; <em>deferred</em>: by the 15th of the following month (DPR 633/72, art. 21 c.4). The date turns red once it has passed. Always check with your accountant.</li>
          <li><span class="pill pill-err">Refunded</span> and <span class="pill pill-err">Disputed</span> — a refund or a dispute coming from Stripe: a payment already invoiced needs a credit note.</li>
          <li><strong>Test</strong> — a payment from Stripe's test environment: do not invoice it.</li>
        </ul>
      </div>

      <div class="feature" id="pagamenti-differita">
        <h3>Deferred invoice: group by company and month</h3>
        <p>With the <strong>Group by company and month</strong> switch the table shows one row per company per month, with the totals and the deferred-invoice deadline. A single deferred invoice can cover all of a company's payments for the month:</p>
        <ol class="steps">
          <li>Turn on <strong>Group by company and month</strong>.</li>
          <li>Open the month detail (eye icon) to check the payments it covers.</li>
          <li>Issue the deferred invoice with the group's totals.</li>
          <li>Press <strong>Mark … payments as invoiced</strong>: the same number and date are recorded on all of them.</li>
        </ol>
      </div>

      <div class="feature">
        <h3>Detail, undo, export</h3>
        <ul class="tidy">
          <li><strong>Detail</strong> (eye icon) — every piece of data needed to write the invoice, each with its <strong>copy</strong> button (and <em>Copy all</em>), the items with their period, the amounts, the Stripe fee and the net received, the Stripe identifiers.</li>
          <li><strong>Undo invoicing</strong> (back arrow) — puts a payment back to <em>to invoice</em>, e.g. after a wrong number. An invoice already issued must be reversed with a credit note in your software.</li>
          <li><strong>Export CSV</strong> (download icon at the top) — downloads the payments of the current filters as a semicolon-separated file with Italian number formatting, ready for Excel or your accountant.</li>
        </ul>
        <div class="callout callout-info">
          Every mark and every undo lands in the console's <strong>Activity log</strong>, with the amount and the invoice number.
        </div>
      </div>
    </section>

    <section class="chapter" id="audit">
      <h2><span class="chapter-num">08</span>Activity log</h2>
      <p class="lead">The read-only history of every operation performed in the console.</p>

      <div class="feature">
        <h3>What it records</h3>
        <p>Each row shows <strong>when</strong>, the <strong>actor</strong> (email), the <strong>role</strong>, the <strong>operation</strong> and the <strong>target</strong> (the affected item). Tracked, among others:</p>
        <ul class="tidy">
          <li>Companies: creation, limit changes, suspension, resume, note changes, partner assignment, adding/removing/re-inviting administrators, deletion.</li>
          <li>Partners: creation, caps changes, profile changes, activation, disabling, resend.</li>
          <li>Self-service companies (super-user): billing-mode changes, limit overrides, VAT-number reviews, Stripe subscription cancellations, signup resends and rejections, payments marked as invoiced and undone.</li>
          <li>Support requests: state change, assignment, reply to the customer, internal-note change. The target is the request's reference (e.g. <em>SQ-20260824-0431</em>) rather than the customer's subject line, which could carry an employee's name into a log that is never erased.</li>
        </ul>
        <p>The <strong>Refresh</strong> button reloads the list. On mobile entries are shown as cards.</p>
      </div>
    </section>

    <section class="chapter" id="impostazioni">
      <h2><span class="chapter-num">09</span>Settings and profile</h2>
      <p class="lead">The console preferences and your account details.</p>

      <div class="feature">
        <h3>Language</h3>
        <p>In <strong>Settings</strong> you pick the interface language (Italian or English). The choice is stored on this browser.</p>
      </div>

      <div class="feature">
        <h3>Security</h3>
        <p>In <strong>Settings → Security</strong> press <strong>Change password</strong> to update your account password (see the <em>Sign-in and password</em> chapter).</p>
      </div>

      <div class="feature">
        <h3>Profile</h3>
        <p>Clicking your avatar at the bottom of the sidebar opens the <strong>Profile</strong>: here you edit your <strong>first name</strong> and <strong>last name</strong>. The email can't be changed from here.</p>
      </div>
    </section>

    <hr class="section-divider">

    <section class="chapter" id="glossario">
      <h2><span class="chapter-num">10</span>Glossary</h2>
      <p class="lead">The recurring terms, in brief.</p>

      <div class="feature">
        <table>
          <thead><tr><th>Term</th><th>Definition</th></tr></thead>
          <tbody>
            <tr><td><strong>Company (tenant)</strong></td><td>The end client: an organisation with its own users, branches and data.</td></tr>
            <tr><td><strong>Partner</strong></td><td>Reseller who creates and manages their own companies, within assigned caps.</td></tr>
            <tr><td><strong>Platform administrator</strong></td><td>The console <em>admin</em> role: sees everything and manages partners.</td></tr>
            <tr><td><strong>Super-user</strong></td><td>The only admin able to permanently delete a company.</td></tr>
            <tr><td><strong>Limits</strong></td><td>A company's maximums: users, admins, documentali, branches.</td></tr>
            <tr><td><strong>Caps</strong></td><td>A partner's maximums: companies they can create and ceilings for their companies' limits. Blank = unlimited.</td></tr>
            <tr><td><strong>Documentale</strong></td><td>Company capability to view all employees' documents; here you set its maximum.</td></tr>
            <tr><td><strong>Access email</strong></td><td>Invite (first password), company access (existing account) or password reset (on resend).</td></tr>
            <tr><td><strong>Suspension</strong></td><td>Temporary block of a company's users' access; the data remains.</td></tr>
            <tr><td><strong>Self-service</strong></td><td>A company that signed up on its own from the website; free plan or paid by card (Stripe).</td></tr>
            <tr><td><strong>Override</strong></td><td>A courtesy limit or module on top of what the company pays for; the higher value wins.</td></tr>
            <tr><td><strong>Deferred invoice</strong></td><td>One invoice (fattura differita) for all of a company's payments in a month, issued by the 15th of the following month.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="chapter" id="faq">
      <h2><span class="chapter-num">11</span>FAQ</h2>
      <p class="lead">The most common situations.</p>

      <div class="feature">
        <h3>What's the difference between invite, company access and password reset?</h3>
        <p>The <strong>invite</strong> goes to someone who never set a password (first access) and is used to create one. When you add a user who <strong>already has an account</strong> to a company, they instead get a <strong>company access</strong> email with a sign-in link — no password reset needed. The <strong>password reset</strong> is used when you resend access (envelope icon) to someone who lost their credentials. The console picks the right type automatically and confirms which one in the message after sending.</p>
      </div>

      <div class="feature">
        <h3>Why can't I create another company?</h3>
        <p>You've likely reached your <strong>maximum number of companies</strong> (cap). Ask the platform administrator to raise it.</p>
      </div>

      <div class="feature">
        <h3>Why can't I lower a limit?</h3>
        <p>A limit can't drop <strong>below the company's current usage</strong> (e.g. you can't set max 4 users if there are 5 active). Deactivate the excess users first.</p>
      </div>

      <div class="feature">
        <h3>Who can delete a company?</h3>
        <p>Only the <strong>super-user</strong>. Other administrators and partners don't see the Delete button. As an alternative, <em>Suspend</em> blocks access without deleting anything.</p>
      </div>

      <div class="feature">
        <h3>Can a partner see other partners' companies?</h3>
        <p>No. Each partner sees <strong>only</strong> the companies they created. The full view is reserved to the platform administrator.</p>
      </div>

      <div class="feature">
        <h3>Can a partner see the companies that signed up from the website?</h3>
        <p>No, never. Self-service companies belong to no partner: platform administrators see them, and only the super-user manages their subscriptions and payments. If a self-service company has to move to a partner, the super-user first switches it to manual billing (cancelling the Stripe subscriptions) and then assigns it.</p>
      </div>

      <div class="feature">
        <h3>Who issues the invoices for card payments?</h3>
        <p>Neither Stripe nor sonoQui: the e-invoice is issued by the seller from its own invoicing software. The <strong>Payments</strong> page lists the payments with the data for the invoice and keeps track of what has already been invoiced.</p>
      </div>

      <div class="feature">
        <h3>What happens to users when I delete a company?</h3>
        <p>Accounts that belong <strong>only</strong> to that company are permanently removed; those present in other companies too are only <strong>unlinked</strong>. The console reports both counts when done.</p>
      </div>

      <div class="feature">
        <h3>Which language are the company admin's emails in?</h3>
        <p>The language chosen in the <strong>Language</strong> field when the company was created (Italian or English).</p>
      </div>
    </section>

    <footer>
      <p><strong>sonoQui Partner · Manual</strong></p>
    </footer>
`;
