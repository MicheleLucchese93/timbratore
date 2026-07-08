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
      <a href="#aziende-elimina" class="sub">Deleting</a>
      <a href="#partner">Partners</a>
      <a href="#partner-crea" class="sub">Creating a partner</a>
      <a href="#partner-caps" class="sub">Partner caps</a>
      <a href="#partner-stato" class="sub">Enable and disable</a>
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
            <tr><td><strong>Super-user</strong></td><td>The single account allowed to permanently delete a company. An administrator with one extra privilege.</td></tr>
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
        <strong>Super-user:</strong> among the administrators, a single account is the designated <em>super-user</em>. It is the only one that sees the <strong>Delete</strong> action on a company (an irreversible operation). All other administrators and partners do not see that button.
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
          <li><strong>Users</strong>, <strong>Admins</strong>, <strong>Documentali</strong>, <strong>Branches</strong> — current usage / maximum (e.g. <code>4/20</code>).</li>
          <li><strong>Status</strong> — <span class="pill pill-ok">Active</span> or <span class="pill pill-warn">Suspended</span>.</li>
          <li><strong>Note</strong> — free-text annotation.</li>
          <li><strong>Actions</strong> — edit, suspend/resume, administrators and (super-user only) delete.</li>
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
          <li><strong>Assigned partner</strong> <span class="badge badge-admin">admin</span> — only the administrator can reassign the company to a different partner or return it to the <em>Platform</em>.</li>
        </ul>
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

    <section class="chapter" id="audit">
      <h2><span class="chapter-num">08</span>Activity log</h2>
      <p class="lead">The read-only history of every operation performed in the console.</p>

      <div class="feature">
        <h3>What it records</h3>
        <p>Each row shows <strong>when</strong>, the <strong>actor</strong> (email), the <strong>role</strong>, the <strong>operation</strong> and the <strong>target</strong> (the affected item). Tracked, among others:</p>
        <ul class="tidy">
          <li>Companies: creation, limit changes, suspension, resume, note changes, partner assignment, adding/removing/re-inviting administrators, deletion.</li>
          <li>Partners: creation, caps changes, profile changes, activation, disabling, resend.</li>
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
