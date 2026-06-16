export const TOC_EN = `
    <nav>
      <h3>Introduction</h3>
      <a href="#intro">Welcome</a>
      <a href="#concetti">Key concepts</a>
      <a href="#ruoli">Roles and permissions</a>
      <a href="#accesso">Access and password</a>

      <h3>Web · Administrator</h3>
      <a href="#web-admin">Overview</a>
      <a href="#web-admin-dashboard" class="sub">Dashboard</a>
      <a href="#web-admin-timbrature" class="sub">Stamps</a>
      <a href="#web-admin-correzioni" class="sub">Corrections</a>
      <a href="#web-admin-utenti" class="sub">Users</a>
      <a href="#web-admin-sedi" class="sub">Branches</a>
      <a href="#web-admin-orari" class="sub">Shifts</a>
      <a href="#web-admin-anomalie" class="sub">Anomalies</a>
      <a href="#web-admin-ferie" class="sub">Holiday &amp; Leave</a>
      <a href="#web-admin-residui" class="sub">Balances</a>
      <a href="#web-admin-esportazioni" class="sub">Exports</a>
      <a href="#web-admin-documenti" class="sub">Documents</a>
      <a href="#web-admin-impostazioni" class="sub">Settings</a>

      <h3>Web · Employee</h3>
      <a href="#web-user">Overview</a>
      <a href="#web-user-dashboard" class="sub">My Dashboard</a>
      <a href="#web-user-stamps" class="sub">My stamps</a>
      <a href="#web-user-corr" class="sub">My requests</a>
      <a href="#web-user-documenti" class="sub">My documents</a>
      <a href="#web-user-residui" class="sub">Balances</a>

      <h3>Mobile App · Employee</h3>
      <a href="#mob-user">Overview</a>
      <a href="#mob-user-timbra" class="sub">Stamps</a>
      <a href="#mob-user-storico" class="sub">History</a>
      <a href="#mob-user-correzioni" class="sub">Corrections</a>
      <a href="#mob-user-richieste" class="sub">Holiday / Leave / Sick leave</a>
      <a href="#mob-user-profilo" class="sub">Profile</a>

      <h3>Mobile App · Administrator</h3>
      <a href="#mob-admin">Overview</a>
      <a href="#mob-admin-dashboard" class="sub">Dashboard</a>
      <a href="#mob-admin-correzioni" class="sub">Approving corrections</a>
      <a href="#mob-admin-richieste" class="sub">Approving requests</a>
      <a href="#mob-admin-notifiche" class="sub">Push notifications</a>

      <h3>References</h3>
      <a href="#geofence">Geolocation</a>
      <a href="#notifiche">Notifications</a>
      <a href="#offline">Offline mode</a>
      <a href="#glossario">Glossary</a>
      <a href="#faq">FAQ</a>
    </nav>
`;

export const MAIN_EN = `

    <section class="chapter" id="intro">
      <h2><span class="chapter-num">01</span>Welcome</h2>
      <p class="lead">sonoQui is the platform that lets your employees clock in and out of work, request holiday, leave and sick leave, and lets the company manage shifts, anomalies and obligations towards the accountant.</p>

      <div class="feature">
        <h3>What sonoQui is</h3>
        <p>sonoQui replaces the traditional time card: the employee records their attendance from the mobile app (with GPS where required) and the administrator always has presences, absences, anomalies and holiday balances under control.</p>
        <p>The platform is made up of two applications that work together:</p>
        <div class="grid-2">
          <div class="mini-card">
            <div class="mini-title">💻 Web app</div>
            <div class="mini-desc">For the administrator: dashboard, user management, branches, shifts, exports. For the employee: viewing their own stamps and requests.</div>
          </div>
          <div class="mini-card">
            <div class="mini-title">📱 Mobile app</div>
            <div class="mini-desc">To clock in/out and take breaks with GPS, request holiday and corrections, and receive push notifications of the administrator's decisions.</div>
          </div>
        </div>
      </div>
    </section>

    <section class="chapter" id="concetti">
      <h2><span class="chapter-num">02</span>Key concepts</h2>
      <p class="lead">A handful of terms recur everywhere in the platform. Knowing them helps you get your bearings both as an administrator and as an employee.</p>

      <div class="feature">
        <h3>The fundamental terms</h3>
        <table>
          <thead><tr><th>Term</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><strong>Stamp</strong></td><td>Event recorded by the employee: clock-in, clock-out, break start/end or lunch start/end.</td></tr>
            <tr><td><strong>Branch</strong></td><td>Place of work. It can require GPS geofencing or be "off-site" (no GPS).</td></tr>
            <tr><td><strong>Work shift</strong></td><td>Weekly model of working slots assigned to a user, used to calculate anomalies and hours.</td></tr>
            <tr><td><strong>Anomaly</strong></td><td>Deviation between actual stamps and the expected shift (lateness, absence, long break, etc.).</td></tr>
            <tr><td><strong>Correction</strong></td><td>Employee request to change or add a forgotten stamp.</td></tr>
            <tr><td><strong>Holiday</strong></td><td>Paid vacation days. They consume the employee's holiday balance.</td></tr>
            <tr><td><strong>Leave</strong></td><td>Hourly absence, with 15-minute granularity. It consumes the leave balance.</td></tr>
            <tr><td><strong>Sick leave</strong></td><td>Absence for health reasons with INPS protocol. Auto-approved.</td></tr>
            <tr><td><strong>Absence</strong></td><td>Generic absence (personal reasons, bereavement, leave of absence, etc.), paid or unpaid. It does not consume balances.</td></tr>
            <tr><td><strong>Company closure</strong></td><td>Event created by the admin for several employees at once (e.g. August). It can deduct from holiday or leave it untouched.</td></tr>
            <tr><td><strong>Public holiday</strong></td><td>Italian national public holidays (New Year, Easter, 15 August, Christmas…) highlighted automatically on the calendar.</td></tr>
            <tr><td><strong>24h reminder</strong></td><td>Notice sent the evening before an approved absence begins (e.g. "holiday tomorrow").</td></tr>
            <tr><td><strong>Balance</strong></td><td>Balance of hours available for holiday/leave, with periodic accrual.</td></tr>
            <tr><td><strong>Approver</strong></td><td>User (usually an admin) designated to decide on an employee's requests.</td></tr>
            <tr><td><strong>Geofence</strong></td><td>Geographic area around the branch within which stamps are accepted.</td></tr>
            <tr><td><strong>Export</strong></td><td>XLSX, JSON or Centro Paghe (LUL) file with the stamps, holiday and anomalies of the period, downloadable by the accountant.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="chapter" id="ruoli">
      <h2><span class="chapter-num">03</span>Roles and permissions</h2>
      <p class="lead">In sonoQui there are two roles, with very different access both on Web and Mobile.</p>

      <div class="grid-2">
        <div class="feature" style="margin:0;">
          <h3>👔 Administrator <span class="badge badge-admin">admin</span></h3>
          <p class="feature-sub">Typically the owner, the HR manager or the system administrator.</p>
          <ul class="tidy">
            <li>Sees the company dashboard with all employees</li>
            <li>Creates, edits, deactivates users</li>
            <li>Configures branches, shifts, holiday balances</li>
            <li>Approves or rejects corrections, holiday, leave and cancellations</li>
            <li>Enters manual stamps for employees</li>
            <li>Exports data for the accountant</li>
            <li>Configures the company settings</li>
          </ul>
        </div>
        <div class="feature" style="margin:0;">
          <h3>👤 Employee <span class="badge badge-user">user</span></h3>
          <p class="feature-sub">The standard user who works at the company.</p>
          <ul class="tidy">
            <li>Clocks in, out and takes breaks from the mobile app</li>
            <li>Views the history of their own stamps</li>
            <li>Requests corrections for forgotten stamps</li>
            <li>Requests holiday, leave, reports sick leave</li>
            <li>Sees the remaining holiday/leave balance</li>
            <li>Receives push and email notifications of decisions</li>
            <li>Configures their own notification preferences</li>
          </ul>
        </div>
      </div>

      <div class="callout callout-info">
        <strong>Dedicated approvers:</strong> for each employee you can designate one or more specific administrators as approvers of holiday, leave or corrections. If none is configured, any admin can decide. <em>The first to decide wins.</em>
      </div>
    </section>

    <section class="chapter" id="accesso">
      <h2><span class="chapter-num">04</span>Access and password</h2>
      <p class="lead">Same credentials for Web and Mobile. The initial invitation comes from the administrator by email.</p>

      <div class="feature">
        <h3>Logging in</h3>
        <ol class="steps">
          <li>Open <code class="inline">sonoqui.app</code> in your browser (Web) or the sonoQui app (Mobile).</li>
          <li>Enter your company email.</li>
          <li>Enter your password (the eye icon lets you show/hide it).</li>
          <li>Press <strong>Log in</strong>.</li>
        </ol>
        <p>On your first login you will be taken to the home page for your role: <em>Dashboard</em> for administrators (both on Web and Mobile), <em>My dashboard</em> (Web) or <em>Stamps</em> (Mobile) for employees.</p>
        <div class="callout callout-info">
          On the mobile app you can enable <strong>unlock with Face ID / Touch ID / fingerprint</strong> from <strong>Profile → Security</strong>: the app will ask for biometrics on launch instead of keeping the session always open. See the <em>Profile</em> chapter (mobile).
        </div>
      </div>

      <div class="feature">
        <h3>Multiple companies on the same account</h3>
        <p>If your email is associated with more than one company, after logging in the <strong>Choose company</strong> screen will appear: select the one you want to work on. If instead you belong to a single company you go straight in, with no extra steps.</p>
        <p>You can switch company at any time: on the <strong>Web</strong> from the company name at the top-left (sidebar) or from <strong>Settings → Active company</strong>; on the <strong>Mobile App</strong> from <strong>Profile → Switch company</strong>. The app reloads with the data and role of the new company: you might be an administrator in one company and an employee in another.</p>
        <div class="callout callout-info">
          Each company stays separate: stamps, holiday and settings never mix between different companies.
        </div>
      </div>

      <div class="feature">
        <h3>Forgotten password</h3>
        <ol class="steps">
          <li>On the login page press <strong>Forgot password?</strong></li>
          <li>Enter your email.</li>
          <li>Press <strong>Send reset link</strong>.</li>
          <li>Check your inbox (and spam too) and follow the link you receive.</li>
          <li>Set a new password (at least 8 characters) and log in normally.</li>
        </ol>
        <div class="callout callout-info">
          For security reasons the system always shows the same confirmation message, even if the email is not registered. We do not reveal whether an account exists or not.
        </div>
        <p class="muted">Alternatively, the administrator can resend the password reset email from the <strong>Users</strong> page (key icon on your row).</p>
      </div>

      <div class="feature">
        <h3>Do not have an account yet?</h3>
        <p>Only your company's administrator can create your account. When they start the access procedure you will receive an email to set your password and sign in.</p>
      </div>
    </section>

    <hr class="section-divider">

    <div class="platform-header">
      <div class="icon">💻</div>
      <div>
        <h2>Web · Administrator</h2>
        <div class="sub">All the company management functions, accessible from the browser.</div>
      </div>
    </div>

    <section class="chapter" id="web-admin">
      <h2><span class="chapter-num">05</span>Web Admin Overview</h2>
      <p class="lead">From the browser the administrator controls the entire operation of the company. The main navigation is on the left and is dynamic based on the role.</p>

      <div class="feature">
        <h3>Navigation menu</h3>
        <p>The sidebar shows the administrator's items. It is collapsible (arrow icon) to free up screen space.</p>
        <div class="grid-2">
          <div class="mini-card"><div class="mini-title">Dashboard</div><div class="mini-desc">Real-time status of presences and requests</div></div>
          <div class="mini-card"><div class="mini-title">Stamps</div><div class="mini-desc">Historical archive of all stamps</div></div>
          <div class="mini-card"><div class="mini-title">Corrections</div><div class="mini-desc">Correction requests to approve</div></div>
          <div class="mini-card"><div class="mini-title">Users</div><div class="mini-desc">Employee records, roles, branches, shifts</div></div>
          <div class="mini-card"><div class="mini-title">Branches</div><div class="mini-desc">Places of work with GPS geofencing</div></div>
          <div class="mini-card"><div class="mini-title">Shifts</div><div class="mini-desc">Weekly shift models</div></div>
          <div class="mini-card"><div class="mini-title">Anomalies</div><div class="mini-desc">Deviations from the expected shifts</div></div>
          <div class="mini-card"><div class="mini-title">Holiday &amp; Leave</div><div class="mini-desc">Requests, quotas, models and balances</div></div>
          <div class="mini-card"><div class="mini-title">Exports</div><div class="mini-desc">XLSX/JSON/Centro Paghe export for the accountant</div></div>
          <div class="mini-card"><div class="mini-title">Settings</div><div class="mini-desc">Company configuration</div></div>
        </div>
        <p>At the bottom of the sidebar you find your avatar with email, the <em>Administrator</em> role and the <strong>Log out</strong> button.</p>
      </div>
    </section>

    <section class="chapter" id="web-admin-dashboard">
      <h2><span class="chapter-num">06</span>Dashboard <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">The company control panel. It refreshes automatically and shows at a glance everything that needs your attention.</p>

      <div class="feature">
        <h3>Quick stats</h3>
        <p>At the top of the page you find six always-updated counters:</p>
        <ul class="tidy">
          <li><strong>Present now</strong>: employees currently at work / total active.</li>
          <li><strong>On break</strong>: employees on break right now.</li>
          <li><strong>Absent today</strong>: people on holiday, leave or sick leave (yellow badge if &gt; 0).</li>
          <li><strong>To approve</strong>: total requests in the queue (red badge if &gt; 0).</li>
          <li><strong>Anomalies 7 days</strong>: anomalies detected in the last 7 days.</li>
          <li><strong>Branches</strong>: number of branches configured / maximum allowed by the plan.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Inbox · To approve</h3>
        <p>Three tabs to quickly clear employee requests:</p>
        <ul class="tidy">
          <li><strong>Corrections</strong>: pending stamp correction requests.</li>
          <li><strong>Holiday / Leave / Sick leave</strong>: pending absence requests.</li>
          <li><strong>Cancellations</strong>: requests to cancel already-approved holiday.</li>
        </ul>
        <p>For each item you have the buttons <span class="pill pill-ok">Approve</span> <span class="pill pill-err">Reject</span> and <strong>Open detail</strong>. In case of rejection/cancellation a dialog opens where you can optionally enter the reason (max 500 characters).</p>
      </div>

      <div class="feature">
        <h3>Absent now and Next 14 days</h3>
        <p>Two columns show you who is absent right now and who will be over the next two weeks. For each entry: absence type, name, date range and total hours.</p>
      </div>

      <div class="feature">
        <h3>Current employee status</h3>
        <p>A grid with one card per employee. Each card shows the avatar, email, status (<span class="pill pill-ok">At work</span> <span class="pill pill-warn">On break</span> <span class="pill">Off duty</span>), current branch and the last event stamped with its time.</p>
        <p>You can switch the view between <strong>List</strong> and <strong>By branch</strong> (groups employees by branch).</p>
      </div>

      <div class="feature">
        <h3>Anomalies in the last 7 days</h3>
        <p>Summary by anomaly type (e.g. "Missing clock-in: 3") and a list of the most recent ones with username, date and delta in minutes.</p>
        <p>The link <strong>See all →</strong> takes you to the full Anomalies page.</p>
      </div>

      <div class="callout callout-tip">
        Press <strong>Refresh</strong> to force a manual refresh. The dashboard also updates automatically in the background.
      </div>
    </section>

    <section class="chapter" id="web-admin-timbrature">
      <h2><span class="chapter-num">07</span>Stamps <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">The historical archive of all the company's stamps, by default the last 90 days.</p>

      <div class="feature">
        <h3>Two views: List and Monthly grid</h3>
        <p>At the top you'll find a switch with two views of the same section:</p>
        <ul class="tidy">
          <li><strong>List</strong> — the historical table of all stamps (described below).</li>
          <li><strong>Monthly grid</strong> — an <em>employees × days-of-the-month</em> matrix: each cell shows that employee's stamps on that day (e.g. <em>08:30–12:30</em>), built to work quickly across a whole month.</li>
        </ul>
        <p>In the Monthly grid:</p>
        <ul class="tidy">
          <li>Move between months with the <strong>‹ ›</strong> arrows, or jump back to the current month with <strong>Today</strong>.</li>
          <li>Employees are in <strong>columns</strong> and days in <strong>rows</strong>; the <strong>Swap rows/columns</strong> button flips the axes.</li>
          <li>Colours flag the cell status: <em>weekend</em> and <em>public holidays</em> in grey/blue, <em>open shift</em> (missing clock-out on a past day) in amber.</li>
          <li>Filter by <strong>employee</strong> (search by name or email) or by <strong>branch</strong>. The <strong>totals</strong> depend on the orientation: with employees in columns, the last column shows the total hours of <em>all</em> employees for each day and a final <strong>Month total</strong> row shows each employee's total plus a grand total; after swapping the axes, the last column becomes each employee's <strong>monthly total</strong> and the final row shows per-day totals.</li>
          <li>Each cell shows the <em>clock-in–clock-out</em> pairs (e.g. <em>08:30–12:30</em>); an open shift shows a red <strong>·</strong> in place of the clock-out. A <strong>☕</strong> icon flags breaks/lunch and the day's worked total appears below. Empty cells show a <strong>+</strong> and stay clickable to add stamps.</li>
          <li>The grid loads up to <strong>1000 stamps</strong> per month: if the limit is reached the warning "Too many stamps in this range: narrow it with a filter" appears — filter by employee or branch to see complete data.</li>
          <li><strong>Click a cell</strong> to open the day editor: add, edit or delete the individual stamps (clock-in/out, breaks). The <strong>reason</strong> is pre-filled and editable; every action is recorded in the audit log exactly as in the List view.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>The table</h3>
        <p>Available columns:</p>
        <ul class="tidy">
          <li><strong>When</strong> — date and time in Italian format.</li>
          <li><strong>User</strong> — the employee's email.</li>
          <li><strong>Event</strong> — coloured badge (Clock-in, Clock-out, Break start/end, Lunch start/end).</li>
          <li><strong>Source</strong> — <em>app</em> (mobile), <em>corr.</em> (approved correction), <em>admin</em> (manual entry) or <em>auto</em> (generated by the system, e.g. automatic closure beyond 15h).</li>
          <li><strong>Branch</strong> — the recorded branch, or "—" if none.</li>
          <li><strong>Notes</strong> — any annotations. A <em>mock</em> indicator appears if the GPS position is suspicious, and <em>out of area</em> if the clock-out was stamped outside the branch area.</li>
          <li><strong>Actions</strong> — edit and delete.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Entering a manual stamp</h3>
        <ol class="steps">
          <li>Press <strong>New stamp</strong> at the top right.</li>
          <li>Select the <strong>user</strong> to enter it for.</li>
          <li>Choose the <strong>event</strong> (Clock-in / Clock-out / Break start / Break end / Lunch start / Lunch end).</li>
          <li>Set the <strong>date and time</strong> using the datetime field.</li>
          <li>Optional: select the <strong>branch</strong>.</li>
          <li>Provide a <strong>reason</strong> (e.g. "forgotten stamp").</li>
          <li>Press <strong>Save</strong>.</li>
        </ol>
      </div>

      <div class="feature">
        <h3>Editing or deleting</h3>
        <p>The action icons in the row open:</p>
        <ul class="tidy">
          <li><strong>Edit</strong> — reopen the dialog with the current values.</li>
          <li><strong>Delete</strong> — asks to confirm and to provide the reason for deletion (a trace remains in the log).</li>
        </ul>
        <div class="callout callout-warn">
          Every manual action is recorded in the audit log. Always enter a clear reason: it serves both the employee and in case of inspections.
        </div>
      </div>

      <div class="feature">
        <h3>Automatic closure of shifts beyond 15 hours</h3>
        <p>To avoid shifts left open indefinitely (an employee who forgets to clock out), the system automatically closes any shift still open after <strong>15 hours</strong> from clock-in.</p>
        <ul class="tidy">
          <li>A <strong>clock-out</strong> stamp is entered exactly at <strong>clock-in + 15h</strong> (it may fall on the following day).</li>
          <li>The stamp source is <em>auto</em>, so you can tell it apart from manually entered ones.</li>
          <li>The check runs continuously: a shift is closed within a few minutes of exceeding 15h.</li>
        </ul>
        <div class="callout callout-info">
          At 14 hours the employee already receives a <strong>reminder</strong> "did you forget to clock out?". The automatic closure at 15h is the safety net if the reminder is ignored. If the actual clock-out time was different, correct the stamp manually.
        </div>
      </div>
    </section>

    <section class="chapter" id="web-admin-correzioni">
      <h2><span class="chapter-num">08</span>Corrections <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">All the stamp correction requests sent by employees, to be handled one by one.</p>

      <div class="feature">
        <h3>List of requests</h3>
        <p>Each request is a card that shows: username, submission date, status (<span class="pill pill-warn">Pending</span> <span class="pill pill-ok">Approved</span> <span class="pill pill-err">Rejected</span> <span class="pill">Superseded</span>), the employee's reason and — if decided — the note of the decision.</p>
        <p>The filter at the top lets you see <strong>Pending only</strong> or <strong>All</strong>.</p>
      </div>

      <div class="feature">
        <h3>Before/after diff</h3>
        <p>The card clearly shows the difference:</p>
        <ul class="tidy">
          <li>If the request is to <strong>add</strong> a missing stamp: a single box with the proposed event, date/time and branch.</li>
          <li>If it is to <strong>edit</strong> an existing stamp: two side-by-side columns — on the left in red the current values, on the right in green the requested ones (with the changed cells in bold).</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Approving or rejecting</h3>
        <ol class="steps">
          <li>Read the employee's reason.</li>
          <li>Compare the current values with the requested ones.</li>
          <li>Press <strong>Approve</strong> to apply the correction, or <strong>Reject</strong>.</li>
          <li>In case of rejection a dialog opens: enter an optional note (up to 500 characters) and confirm.</li>
        </ol>
        <p>Approval creates or modifies the corresponding stamp in the archive. The employee receives a notification of the decision.</p>
      </div>

      <div class="feature">
        <h3>Sending your own request</h3>
        <p>With the <strong>+ New request</strong> button (at the top) the administrator can also send a correction for their <em>own</em> stamps, with the same three-step flow as the mobile app: choose the day, select the stamp to correct or report a missing one, then provide the event, time, branch and reason.</p>
        <div class="callout callout-info">
          An administrator sees <strong>Approve</strong>/<strong>Reject</strong> even on their own requests (request→approval tracking); an employee, on the other hand, on their own requests sees only the status and not the decision buttons.
        </div>
      </div>
    </section>

    <section class="chapter" id="web-admin-utenti">
      <h2><span class="chapter-num">09</span>Users <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">The employee records, with role, activation, branches, shifts and approvers.</p>

      <div class="feature">
        <h3>License usage</h3>
        <p>At the top of the page two counters show <strong>Users</strong> active / maximum allowed by the plan and <strong>Administrators</strong> active / maximum. If you reach the limit the <em>Invite user</em> button is disabled.</p>
      </div>

      <div class="feature">
        <h3>Inviting a new employee</h3>
        <ol class="steps">
          <li>Press <strong>Invite user</strong>.</li>
          <li>Enter email (required), first and last name (optional).</li>
          <li>Choose the role: <em>User</em> or <em>Admin</em>.</li>
          <li>Select one or more <strong>branches</strong> to assign.</li>
          <li>Optional: fill in the <strong>payroll data (Centro Paghe)</strong> — <em>tax code</em>, <em>employee number</em> and, if needed, INAIL/qualification. You can always add or change them later from the users table.</li>
          <li>Press <strong>Invite</strong>.</li>
        </ol>
        <p>The user is created but <strong>receives no automatic email</strong>. To give them access, press the <strong>reset password</strong> icon (key-shaped) on their row — or select them and use the <strong>Send password reset</strong> bulk action: that sends the email to set their password.</p>
      </div>

      <div class="feature">
        <h3>Operations on the users table</h3>
        <p>For each row of the table you can:</p>
        <ul class="tidy">
          <li>Change the <strong>role</strong> (Admin / User) via a select. <em>You can't change your own account's role</em>: the select is disabled on your own row, so an admin can't demote themselves to User and lose access.</li>
          <li>Activate or deactivate the user with the <strong>Active</strong> toggle.</li>
          <li>Choose the allowed <strong>stamping methods</strong> (the <em>Stamping</em> column): <strong>GPS</strong> (from the mobile app, at the branch) and/or <strong>Remote</strong> (from the web, without location verification). No method selected = the user cannot stamp and the app does not show the stamping menu.</li>
          <li>Edit the assigned <strong>branches</strong> (multi-select).</li>
          <li>Assign a <strong>work shift</strong> (template + validity start date).</li>
          <li>Configure the <strong>approvers</strong> for Corrections, Holiday, Leave, Sick leave.</li>
          <li>Edit first and last name.</li>
          <li>Fill in the <strong>payroll data (Centro Paghe)</strong>: <em>tax code</em>, <em>payroll number</em> and, if needed, <em>INAIL</em> and <em>qualification</em>. Used by the Centro Paghe (LUL) export and must match the employee record in payroll.</li>
          <li><strong>Reset the password</strong> (key icon) — sends the user an email to choose a new password. Use it to give a freshly-created user their <strong>first access</strong>, or if they lost their credentials / forgot the password.</li>
          <li>Deactivate or permanently delete the user.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Bulk operations</h3>
        <p>Selecting several users with the checkbox brings up a dedicated bar:</p>
        <ul class="tidy">
          <li><strong>Assign branches</strong> — adds the same branches to all the selected users.</li>
          <li><strong>Remove branches</strong> — removes the indicated branches from everyone.</li>
          <li><strong>Assign schedule</strong> — assigns the same work schedule to everyone (replaces the current one).</li>
          <li><strong>Stamping</strong> — sets the same stamping methods (GPS / Remote) on everyone.</li>
          <li><strong>Leave approvers</strong> and <strong>Correction approvers</strong> — set the same approvers on everyone (replacing the current ones).</li>
          <li><strong>Send password reset</strong> — sends every selected user the email to set their password (handy for giving freshly-created users their first access).</li>
          <li><strong>Cancel</strong> — deselects.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Excel Import / Export</h3>
        <p>At the top right:</p>
        <ul class="tidy">
          <li><strong>Export XLSX</strong> — downloads the current user list.</li>
          <li><strong>Import XLSX</strong> — uploads an Excel file to create/update users in bulk (the key is the email).</li>
        </ul>
        <p>The <strong>Stamping methods</strong> column is included in the export and recognised on import: values <em>GPS</em>, <em>Remote</em> (also combined with a comma) or <em>None</em>. If the column is missing or the cell is empty, the user's methods stay unchanged.</p>
        <div class="callout callout-info">
          In case of errors in the imported file, the first 5 errors are shown row by row, with the total if there are more.
        </div>
      </div>

      <div class="feature">
        <h3>Approvers</h3>
        <p>Clicking <strong>Configure</strong> under the Approvers column for a user opens a dialog where you indicate, for each type (corrections, holiday, leave, sick leave), one or more admin users who must decide.</p>
        <div class="callout callout-tip">
          <p><strong>Key rule</strong>: if no approver is configured, any admin can decide. If at least one is configured, only those listed can. <em>The first to decide wins.</em></p>
        </div>
      </div>
    </section>

    <section class="chapter" id="web-admin-sedi">
      <h2><span class="chapter-num">10</span>Branches <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">The company's places of work. They can require GPS (geofencing) or be off-site.</p>

      <div class="feature">
        <h3>License usage</h3>
        <p>At the top of the page a counter shows the <strong>Branches</strong> active / maximum allowed by the plan. If you reach the limit the <em>New branch</em> button is disabled.</p>
      </div>

      <div class="feature">
        <h3>Creating a new branch</h3>
        <ol class="steps">
          <li>Press <strong>New branch</strong>.</li>
          <li>Enter an identifying <strong>name</strong>.</li>
          <li>Type the <strong>address</strong> in the autocomplete (Google Places suggestions).</li>
          <li>If the suggested address is imprecise, <strong>click or drag the point on the map</strong>: the address is derived automatically from the chosen point (reverse geocoding). The point on the map is always the authoritative location.</li>
          <li>Decide whether it is an <strong>off-site</strong> branch: if so, GPS and radius are not needed.</li>
          <li>Otherwise set latitude, longitude (already populated from the address or the point on the map).</li>
          <li>Decide whether to <strong>limit stamping within a radius</strong>:
            <ul class="tidy">
              <li><strong>Active</strong> (default): set the <strong>radius</strong> in metres (default 300m). A clock-in stamp outside the radius is rejected; the clock-out is accepted but flagged as an anomaly.</li>
              <li><strong>Inactive</strong>: the stamp is accepted regardless of the distance from the branch. The GPS is still recorded on the stamp for auditing. The branch is not auto-detected: the employee must select it manually in the app.</li>
            </ul>
          </li>
          <li>Press <strong>Save</strong>.</li>
        </ol>
      </div>

      <div class="feature">
        <h3>Branch card</h3>
        <p>Each branch appears as a card with name, address, type (off-site, geolocated with radius, or geolocated without radius) and — for branches with an active radius — a map preview with the radius circle.</p>
        <p>Buttons to edit or delete the branch. Deletion requires confirmation.</p>
      </div>

      <div class="callout callout-info">
        An <strong>off-site</strong> branch has no GPS: the employee can stamp anywhere without geolocation constraints (remote work, business trips, building sites). A branch <strong>without a radius</strong> still records the GPS but does not compare it with an area: useful for branches with a perimeter that cannot be defined (large building sites, trips to clients' premises).
      </div>
    </section>

    <section class="chapter" id="web-admin-orari">
      <h2><span class="chapter-num">11</span>Work shifts <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Weekly models that can be assigned to users. Anomalies are calculated by comparing stamps with these shifts.</p>

      <div class="feature">
        <h3>Creating a shift model</h3>
        <ol class="steps">
          <li>Press <strong>New shift</strong>.</li>
          <li>Provide an optional <strong>name</strong> and <strong>description</strong>.</li>
          <li>Set the <strong>tolerances</strong> in minutes for clock-in and clock-out (default ±10').</li>
          <li>Define the expected minimum/maximum break and minimum/maximum lunch break.</li>
          <li>Choose whether to count <strong>overtime</strong> and the calculation <strong>block</strong> (15, 30 or 60 minutes): time beyond the planned shift is counted in whole blocks, an incomplete block is not counted (e.g. planned clock-out 18:00, actual 18:28 → with 30-min blocks no overtime, with 15-min blocks 15 minutes are counted).</li>
          <li>For each day of the week add one or more <strong>slots</strong> (start time - end time). When you add a second slot on the same day, the times of the previous one are copied as a starting point, so you just need to adjust them.</li>
          <li>Set the <strong>penalties</strong> for exceeding the tolerances on clock-in, clock-out and break. An approved leave or holiday that covers the deviation (e.g. leave 16:00–18:00 at the end of the shift) cancels the penalty on clock-in/clock-out.</li>
          <li>Optional: enable <strong>Flexible schedule</strong> and/or set the per-day auto lunch break (see below).</li>
          <li>Press <strong>Save</strong>.</li>
        </ol>
      </div>

      <div class="feature">
        <h3>Flexible schedule (flextime)</h3>
        <p>Enabling <strong>Flexible schedule</strong> switches the schedule from "fixed slots" to <strong>flextime</strong>: the target becomes the <strong>total worked hours</strong> (the sum of the slots), not the fixed clock-in/clock-out times.</p>
        <ul class="tidy">
          <li><strong>Clock-in / Clock-out — before and after</strong>: flexibility minutes around the planned times. Within the window no "Late clock-in" or "Early clock-out" is raised; beyond the window the usual tolerances and penalties apply.</li>
          <li><strong>Lunch break — before and after</strong>: for split shifts, widen the window in which the lunch break may be stamped. The <em>duration</em> is still governed by lunch min/max: this window only controls <em>when</em> it is taken. A lunch outside the window raises the "Lunch break outside window" anomaly.</li>
          <li><strong>Overtime and missing hours</strong>: in flextime they are computed on worked duration. E.g. clock-in 10:00, clock-out 19:00, 30-min lunch, target 8h → no overtime and no shortfall; someone who clocks in at 10:00 and out at 18:00 gets "Insufficient hours".</li>
        </ul>
        <div class="callout callout-info">
          The clock-in, clock-out and lunch windows are <strong>independent</strong>: arriving late (within the flexibility) does not shift the lunch or clock-out window. What counts is always the total worked hours.
        </div>
      </div>

      <div class="feature">
        <h3>Automatic lunch break (without splitting the slot)</h3>
        <p>For each day with a <strong>single slot</strong> you can set the <strong>lunch break</strong> minutes next to the times. Those minutes are <strong>auto-deducted</strong> from presence and the break can be taken whenever, <em>without stamping it</em>.</p>
        <p>Example: slot 09:00–17:30 with a 30-minute lunch break → 8h are counted. On days with an automatic lunch the mobile app <strong>hides the "Start lunch" button</strong> and break/lunch duration anomalies do not apply.</p>
        <div class="callout callout-tip">
          The automatic lunch break is an alternative to a split shift: use a split shift (two slots) when the break time is fixed, the automatic lunch when the employee can choose it freely.
        </div>
      </div>

      <div class="feature">
        <h3>Shift card</h3>
        <p>Each model shows name, description, tolerances, total weekly hours and a grid preview of the slots per day.</p>
        <p>Buttons to duplicate, edit or delete the model (deletion is blocked if there are active users assigned). The <strong>Duplicate</strong> button creates an identical copy (times and settings) named "Copy of …", to open and adapt without starting from scratch.</p>
      </div>

      <div class="callout callout-tip">
        To assign a shift to an employee go to <strong>Users → Shift column → Assign</strong>. The previous assignment is closed automatically on the validity date of the new one.
      </div>
    </section>

    <section class="chapter" id="web-admin-anomalie">
      <h2><span class="chapter-num">12</span>Shift anomalies <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">The deviations from the expected shift. They are calculated by comparing actual stamps with the assigned shift.</p>

      <div class="feature">
        <h3>Filtering anomalies</h3>
        <ol class="steps">
          <li>Set the <strong>From</strong> / <strong>To</strong> range.</li>
          <li>Optional: filter by one or more <strong>users</strong>.</li>
          <li>Press <strong>Filter</strong>.</li>
        </ol>
        <p>The results are grouped by date (most recent at the top).</p>
      </div>

      <div class="feature">
        <h3>Types of anomaly</h3>
        <table>
          <thead><tr><th>Type</th><th>When it is detected</th></tr></thead>
          <tbody>
            <tr><td><span class="pill pill-err">Missing clock-in</span></td><td>No clock-in stamp on an expected working day.</td></tr>
            <tr><td><span class="pill pill-err">Missing clock-out</span></td><td>No clock-out stamp after a clock-in.</td></tr>
            <tr><td><span class="pill pill-warn">Late clock-in</span></td><td>Clock-in beyond the configured tolerance, unless an approved leave/holiday covers the lateness.</td></tr>
            <tr><td><span class="pill pill-warn">Early clock-out</span></td><td>Clock-out before the configured tolerance, unless an approved leave/holiday covers the early departure.</td></tr>
            <tr><td><span class="pill pill-warn">Insufficient hours</span></td><td>Hours worked below the expected shift.</td></tr>
            <tr><td><span class="pill pill-purple">Work on a rest day</span></td><td>Stamps on a day not planned by the shift.</td></tr>
            <tr><td><span class="pill pill-info">Break too short</span></td><td>Break below the expected minimum.</td></tr>
            <tr><td><span class="pill pill-info">Break too long</span></td><td>Break above the expected maximum.</td></tr>
            <tr><td><span class="pill pill-info">Lunch too short</span></td><td>Lunch below the expected minimum.</td></tr>
            <tr><td><span class="pill pill-info">Lunch too long</span></td><td>Lunch above the expected maximum.</td></tr>
            <tr><td><span class="pill pill-info">Lunch break outside window</span></td><td>In a flexible schedule, a lunch break stamped outside the allowed window (planned lunch ± the configured flexibility).</td></tr>
            <tr><td><span class="pill pill-purple">Clock-out out of area</span></td><td>Clock-out stamped outside the branch area (e.g. from home). The clock-out is always allowed but recorded with this anomaly, with the distance from the branch when available. Independent of the shift: it also appears for users without an assigned shift.</td></tr>
          </tbody>
        </table>
      </div>

      <div class="feature">
        <h3>Correcting an anomaly</h3>
        <p>On each anomaly press <strong>Correct</strong>: a dropdown opens with the typical corrections. Choose the action, check the <strong>summary</strong> of the changes and press <strong>Confirm</strong>.</p>
        <table>
          <thead><tr><th>Action</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td><strong>Standard stamp (shift times of the day)</strong></td><td>Adds only the missing stamps (clock-in and/or clock-out) at the times planned by the shift. It does not modify the actual stamps already present. Available only when a stamp is missing.</td></tr>
            <tr><td><strong>Insert holiday</strong></td><td>Creates the holiday on the day of the anomaly on the employee's behalf. Already approved; the hours are calculated from the assigned shift.</td></tr>
            <tr><td><strong>Insert leave</strong></td><td>Creates an hourly leave. The proposed window covers the period not worked (gap), adjustable with the −/+ buttons in 15-minute steps.</td></tr>
            <tr><td><strong>Justify with a note</strong></td><td>Annotates the anomaly with a reason, without modifying stamps or absences. The anomaly stays visible but justified. Available for any type.</td></tr>
          </tbody>
        </table>
        <p><strong>Notification to the employee:</strong> for holiday and leave entered by the admin the employee receives a notification (push and email), as for an approved request.</p>
        <p><strong>Traceability in the exports:</strong> every correction stays documented in the XLSX/JSON files. The added stamps appear in the <em>Stamps</em> sheet with source "Manual (admin)" and a note; the holiday/leave entered by the admin in the <em>Holiday and Leave</em> sheet with the <em>Source</em> column = "Entered by admin"; the note justifications in the dedicated <em>Anomaly justifications</em> sheet.</p>
      </div>
    </section>

    <section class="chapter" id="web-admin-ferie">
      <h2><span class="chapter-num">13</span>Holiday &amp; Leave <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Full management of requests, per-user balances and accrual models.</p>

      <div class="feature">
        <h3>Requests tab</h3>
        <p>Filters by status (All / Pending / Approved / Rejected) and by user.</p>
        <p>The table lists all requests with type (<span class="pill pill-info">Holiday</span> <span class="pill pill-warn">Leave</span> <span class="pill pill-err">Sick leave</span>), user, period, total hours, status, the employee's notes and — if sick leave — the INPS protocol.</p>
        <p>For pending requests you have the buttons <strong>Approve</strong> / <strong>Reject</strong>:</p>
        <ul class="tidy">
          <li><strong>Approve</strong> — final confirmation.</li>
          <li><strong>Reject</strong> — opens a dialog where you enter the reason for the rejection (required, max 500 characters).</li>
          <li><strong>Revoke</strong> (on already-approved requests) — cancels an already-granted holiday, with a reason.</li>
          <li><strong>Accept / Reject cancellation</strong> — when the employee requests the cancellation of an already-approved holiday.</li>
        </ul>
        <p>With the <strong>+ New request</strong> button (at the top right) the administrator can also submit their own request for Holiday, Leave, Sick leave or Absence, exactly as from the mobile app.</p>
      </div>

      <div class="feature">
        <h3>Filling in a request</h3>
        <p>In the <strong>+ New request</strong> form you first choose the <strong>Type</strong> (Holiday, Leave, Sick leave, Absence). For Holiday and Leave you set the period in two ways, with <strong>date and time on separate fields</strong>:</p>
        <ul class="tidy">
          <li><strong>All day</strong> (default) — you pick a date range <em>From</em> … <em>To</em>: the absence covers the whole working day for every day in the period.</li>
          <li><strong>Hourly leave</strong> — untick <em>All day</em>: a <em>Day</em> field appears and, separately, the start time (<em>Start time</em>) and end time (<em>End time</em>), adjustable in 15-minute steps.</li>
        </ul>
        <p>Below the fields the <strong>Total requested</strong> in hours updates in real time, already capped at the assigned work schedule (a leave can never be worth more than the scheduled day).</p>
      </div>

      <div class="feature">
        <h3>Calendar tab</h3>
        <p>A calendar view of all the company's absences, with a <strong>Day / Week / Month / Year</strong> selector. Each event is coloured by type (Holiday, Leave, Sick leave, Absence, Closure) and the <strong>Italian national public holidays</strong> (New Year, Easter, 25 April, 15 August, Christmas…) are highlighted automatically.</p>
        <ul class="tidy">
          <li><strong>User filter</strong> — the chips at the top enable/disable the individual employees; "All"/"None" for quick selection.</li>
          <li><strong>+ Insert event</strong> — opens the form to assign an event to several employees at once (e.g. <em>August company closure</em>).</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Inserting a company event</h3>
        <p>From the <strong>+ Insert event</strong> button in the Calendar you indicate:</p>
        <ul class="tidy">
          <li><strong>Title</strong> (e.g. "August company closure"), <strong>From</strong> and <strong>To</strong>.</li>
          <li><strong>Count as holiday</strong> — if active, the event is deducted from each employee's holiday balance; if inactive it is a closure that does not affect holiday.</li>
          <li><strong>Recipients</strong> — All active employees, or a selection.</li>
        </ul>
        <p>On confirmation each recipient receives a <strong>notification</strong> (push and email, according to their preferences) and the event appears immediately on their calendar.</p>
      </div>

      <div class="feature">
        <h3>Quotas tab</h3>
        <p>For each user you see the <strong>Holiday balance</strong> and the <strong>Leave balance</strong> with the related automatic accrual. Press on the balance (or on <strong>Assign</strong> if it is missing) to change the assignment: template, initial balance and start date.</p>
        <p><strong>Bulk assignment:</strong> select several employees with the checkboxes on the left (or the header checkbox for all), then press <strong>Assign quota</strong> in the bar that appears at the top. Pick the type (Holiday or Leave), template, initial balance and date: the quota is assigned to everyone selected at once. Anyone who already has a quota of the same type is overwritten (the previous one is closed).</p>
        <p>In the <strong>Actions</strong> column you find two tools for each employee:</p>
        <ul class="tidy">
          <li><strong>Manual hours adjustment</strong> (± icon) — opens a window where you choose the type (Holiday or Leave), the operation <strong>Add</strong> or <strong>Remove</strong>, the number of hours, the date and an optional note. It is the way to adjust a single employee's balance by hand (e.g. credit carried-over hours from the previous year or deduct leave handled outside the system). The change is reflected <em>immediately</em> on the employee's balance, including in their app.</li>
          <li><strong>Change history</strong> (clock icon) — opens the complete register of all credits and changes for that user: date, type, change (additions in green, removals in red), source (<em>Automatic</em> for periodic credits, <em>Manual</em> or <em>Adjustment</em> for the admin's actions), note and <strong>who</strong> performed the operation.</li>
        </ul>
        <div class="callout callout-info">
          <strong>Balance</strong> = initial balance + accruals (automatic and manual) − approved used. Pending requests are not counted right away, so the counter can go negative if the pending requests exceed the balance.
        </div>
        <div class="callout callout-info">
          The register is <strong>append-only</strong>: a removal is saved as a negative row, it does not erase the history. This way every manual action stays always traceable and verifiable.
        </div>
      </div>

      <div class="feature">
        <h3>Models tab</h3>
        <p>List of the available balance templates. For each one: name, type (Holiday/Leave), default hours, accrual (amount and frequency), active status.</p>
        <p>When creating a new model you indicate:</p>
        <ul class="tidy">
          <li><strong>Name</strong> and <strong>type</strong>.</li>
          <li><strong>Default hours</strong> per request.</li>
          <li><strong>Credit</strong>: amount in hours and frequency (<em>monthly</em> on day X, or <em>yearly</em> on X/Y).</li>
          <li><strong>Active</strong> status.</li>
        </ul>
      </div>

      <div class="callout callout-warn">
        <strong>Sick leave</strong> requests are auto-approved at the moment of creation and mandatorily require the INPS protocol. A sick leave overlapping an already-approved holiday makes the "Replaced by sick leave" badge appear on the holiday.
      </div>

      <div class="feature" id="web-admin-residui">
        <h3>Balances tab</h3>
        <p>The <strong>Balances</strong> tab (the last one in Holiday &amp; Leave) opens a table with the remaining holiday and leave hours of <strong>all employees</strong>. Even those without an assigned balance appear in the list, with the values shown as «—». One row per employee and type, with the columns:</p>
        <ul class="tidy">
          <li><strong>Initial balance</strong> — hours assigned at the start of the balance.</li>
          <li><strong>Accrued</strong> — accruals accumulated over time.</li>
          <li><strong>Used</strong> — hours already approved and consumed.</li>
          <li><strong>Pending</strong> — hours of pending requests not yet decided.</li>
          <li><strong>Balance</strong> — initial balance + accrued − approved used.</li>
          <li><strong>Balance with pending</strong> — what would be left if all the pending requests were approved.</li>
        </ul>
        <p>The table is sortable, filterable and exportable from the buttons at the top right. It is a read-only view: to <em>change</em> the balances use the <strong>Quotas</strong> tab of Holiday &amp; Leave.</p>
      </div>
    </section>

    <section class="chapter" id="web-admin-esportazioni">
      <h2><span class="chapter-num">14</span>Exports <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Generate files to hand to the accountant or to archive.</p>

      <div class="feature">
        <h3>Generating an export</h3>
        <ol class="steps">
          <li>Set <strong>From</strong> and <strong>To</strong>.</li>
          <li>Choose the <strong>format</strong>: <em>XLSX (accountant)</em>, <em>JSON</em> or <em>Centro Paghe (LUL)</em>.</li>
          <li>Press <strong>Generate</strong>.</li>
        </ol>
        <p>The job enters the queue and is processed in the background.</p>
        <div class="callout callout-tip">
          With the <strong>Centro Paghe</strong> format the period is locked to a whole month (first to last day): the file is per single company and single month.
        </div>
      </div>

      <div class="feature">
        <h3>Export history</h3>
        <p>The table shows period, format, status (<span class="pill">Queued</span> <span class="pill pill-warn">Processing</span> <span class="pill pill-ok">Ready</span> <span class="pill pill-err">Error</span>) and creation date.</p>
        <p>For ready jobs the <strong>Download</strong> button starts the download. The red trash icon removes the entry from the history (after confirmation) and is available for any status: useful to clean up jobs in error or queued.</p>
        <div class="callout callout-tip">
          The table refreshes automatically every 2 seconds as long as there are queued or processing jobs.
        </div>
      </div>

      <div class="feature">
        <h3>What the XLSX file contains</h3>
        <p>The XLSX file is a multi-sheet spreadsheet designed for the accountant and for payroll. It contains:</p>
        <ul class="tidy">
          <li><strong>Summary</strong>: one row per employee with hours worked, overtime, breaks, holiday, leave, sick leave, days worked and holiday and leave balances.</li>
          <li><strong>One sheet per employee</strong>: day-by-day detail (hours worked, overtime, holiday/leave/sick leave, breaks, absence marker).</li>
          <li><strong>Stamps</strong>: each stamp with date and time, event, source, branch, GPS, device and notes.</li>
          <li><strong>Corrections</strong>: the correction requests of the period with status, outcome and resolution note.</li>
          <li><strong>Holiday and Leave</strong>: holiday, leave, sick leave and absences with hours, pay, subtype, INPS protocol and outcome.</li>
          <li><strong>Company events</strong>: closures and other events imposed by the company, with the employees involved and total hours.</li>
          <li><strong>Remaining holiday</strong>: initial balance, accrued, used and balance for each employee.</li>
          <li><strong>Metadata</strong>: period, generation date and counts.</li>
        </ul>
        <p>The <strong>JSON</strong> format contains the aggregated summary per employee, useful for integrations with other software.</p>
      </div>

      <div class="feature">
        <h3>Centro Paghe (LUL) format</h3>
        <p>The <strong>Centro Paghe</strong> format produces the fixed-width <em>ORARIO</em> tracciato (200-byte records) to import attendance and giustificativi into the LIBRO UNICO. The file follows the Centro Paghe standard: one type-1 record per day, the monthly totals (type 2) and INPS sickness events (type 3). The file name is <code>ORARIO_&lt;company code&gt;_&lt;MMYYYY&gt;.TXT</code>.</p>
        <div class="callout callout-warn">
          Before the first export, configure under <strong>Settings → Centro Paghe</strong>: the <strong>company code</strong> (7 chars), the code length (2 or 4 chars) and the mapping of the <strong>giustificativo codes</strong> (holiday, sickness, overtime, etc.). For each employee fill in, under <strong>Users</strong>, the payroll fields: <em>tax code</em>, <em>payroll number</em> and optional INAIL/qualification. These must match the employee record in Centro Paghe.
        </div>
        <ul class="tidy">
          <li><strong>Ordinary worked hours</strong> and <strong>overtime</strong> (separate code) per day and as a total.</li>
          <li><strong>Giustificativi</strong> (holiday, leave, sickness, absences and subtypes) mapped to the Centro Paghe codes chosen in Settings.</li>
          <li><strong>Stamps</strong> in/out (up to 4 pairs per day) and theoretical hours from the assigned shift.</li>
          <li><strong>INPS events</strong> for sickness with protocol, when present.</li>
        </ul>
      </div>
    </section>

    <section class="chapter" id="web-admin-impostazioni">
      <h2><span class="chapter-num">15</span>Settings <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Global company configuration. The changes apply to all users and are saved automatically.</p>

      <div class="feature">
        <h3>Company details and localization</h3>
        <ul class="tidy">
          <li><strong>Company name</strong> — read-only (editable by the provider). <strong>VAT number</strong> — editable by an admin (11 digits).</li>
          <li><strong>Timezone</strong> — company time zone (Europe/Rome by default).</li>
          <li><strong>Language</strong> — Italian or English. The app initially picks your browser's language (anything other than Italian or English falls back to <em>English</em>); it stays a <em>personal</em> preference that applies only to your account and you change it here (on mobile from <em>Profile &rarr; Language</em>).</li>
          <li><strong>Country</strong> — optional, read-only.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Data policy</h3>
        <ul class="tidy">
          <li><strong>Retention</strong> — years of data retention.</li>
          <li><strong>Mock location</strong> — behaviour if a fake GPS position is detected: <em>Allow</em> / <em>Flag</em> / <em>Block</em>.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Centro Paghe (LUL export)</h3>
        <p>Admin-only section to configure the <strong>Centro Paghe</strong> export (see the Exports chapter). Changes save automatically.</p>
        <ul class="tidy">
          <li><strong>Company code</strong> — 7 characters, must match the company code in Centro Paghe.</li>
          <li><strong>Giustificativo code length</strong> — <em>4 characters</em> (full mnemonic) or <em>2 characters</em> (for companies printing on a single page / LUL).</li>
          <li><strong>Blood-centre tax code</strong> — tax code/VAT of the collection centre, written on blood-donation rows.</li>
          <li><strong>Giustificativo codes</strong> — for each item (holiday, leave, sickness, overtime, closure and the absence subtypes) pick the matching Centro Paghe code. Leave empty to skip that item. <em>Company closure</em> has no default: choose it per the applicable CCNL.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Personal preferences</h3>
        <p>As an admin too you manage your notification preferences here:</p>
        <ul class="tidy">
          <li><strong>Email notifications</strong> — toggle to receive decisions and requests by email.</li>
          <li><strong>Push notifications</strong> — info on the registration status of the device (managed by the mobile app).</li>
        </ul>
        <p>Each change shows a <em>Setting saved</em> toast and persists automatically.</p>
      </div>
    </section>

    <section class="chapter" id="web-admin-documenti">
      <h2><span class="chapter-num">15a</span>Documents <span class="badge badge-admin">admin</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Upload and manage employees' personal documents: payslips, CU, contracts, notices. Each document is a PDF tied to a single employee, who reads it from their <em>My documents</em> section (Web) or the <em>Documents</em> tab in the mobile app.</p>

      <div class="feature">
        <h3>The documents table</h3>
        <p>The list shows every document uploaded for the company, with columns:</p>
        <ul class="tidy">
          <li><strong>Employee</strong> — the document's recipient.</li>
          <li><strong>Category</strong> — Payslip, CU, Contract, Notice or Other.</li>
          <li><strong>Title</strong> — the name given at upload time.</li>
          <li><strong>Uploaded</strong> — upload date and time.</li>
          <li><strong>Kept until</strong> — the date after which the document is deleted automatically (36 months from upload).</li>
          <li><strong>Read receipt</strong> — <span class="pill pill-ok">Viewed</span> if the employee has opened it at least once, otherwise <span class="pill pill-warn">Not viewed</span>. <em>Admin opens never count as a view.</em></li>
          <li><strong>Actions</strong> — download and delete.</li>
        </ul>
        <p>At the top you can <strong>filter by employee</strong> to see only their documents.</p>
      </div>

      <div class="feature">
        <h3>Bulk upload</h3>
        <p>Press <strong>Upload documents</strong> and pick <strong>one or more PDFs</strong> (max 15MB each; PDFs only). For each file the system tries to <strong>match it to an employee automatically</strong> by looking in the filename for their <em>codice fiscale</em> (set under <strong>Users</strong>, the <em>Tax code</em> column).</p>
        <ol class="steps">
          <li>Select the PDFs to upload.</li>
          <li>Review the mapping table: for each file you see the proposed employee (with the matching criterion), the category and an editable title.</li>
          <li>For <strong>unmatched</strong> files, pick the employee manually from the dropdown.</li>
          <li>Set the <strong>category</strong> (defaults to <em>Payslip</em>) and, if you like, edit the <strong>title</strong>.</li>
          <li>Press <strong>Upload</strong>: files are sent one by one and each shows its status (Ready, Uploading, Uploaded or Error).</li>
        </ol>
        <div class="callout callout-info">
          When a document is uploaded the employee receives a <strong>notification</strong> (push and email, per their preferences; the email for documents is on by default).
        </div>
      </div>

      <div class="feature">
        <h3>Replace or delete</h3>
        <p>There is no editing of an already-uploaded document: to fix one, <strong>delete</strong> the wrong file (trash icon, with confirmation) and <strong>re-upload</strong> the correct one. Deleting permanently removes the file and the employee can no longer see it.</p>
      </div>

      <div class="callout callout-info">
        <strong>Retention (36 months):</strong> each document is kept for 36 months from its upload date, then deleted automatically by a daily job. The cut-off date is always visible in the <em>Kept until</em> column.
      </div>
    </section>

    <hr class="section-divider">

    <div class="platform-header">
      <div class="icon">👤</div>
      <div>
        <h2>Web · Employee</h2>
        <div class="sub">The features available to the individual employee from the browser.</div>
      </div>
    </div>

    <section class="chapter" id="web-user">
      <h2><span class="chapter-num">16</span>Web Employee Overview</h2>
      <p class="lead">On the Web the employee reviews their own status and history and, from the Holiday &amp; Leave section, submits requests and reviews the calendar.</p>

      <div class="feature">
        <h3>Navigation menu</h3>
        <p>An employee's sidebar contains five items:</p>
        <div class="grid-2">
          <div class="mini-card"><div class="mini-title">Dashboard</div><div class="mini-desc">Your current status and latest stamps</div></div>
          <div class="mini-card"><div class="mini-title">My stamps</div><div class="mini-desc">History of your stamps</div></div>
          <div class="mini-card"><div class="mini-title">My requests</div><div class="mini-desc">Correction requests sent</div></div>
          <div class="mini-card"><div class="mini-title">Holiday &amp; Leave</div><div class="mini-desc">Your absences, the calendar, the requests to approve</div></div>
          <div class="mini-card"><div class="mini-title">Balances</div><div class="mini-desc">Your remaining holiday and leave hours</div></div>
        </div>
        <p>At the bottom you find your avatar with email, the <em>Employee</em> role and the <strong>Log out</strong> button.</p>
        <div class="callout callout-info">
          The clock-in/clock-out stamping functions are in the mobile app, not on the Web (unless explicitly enabled by the administrator).
        </div>
      </div>

      <div class="feature">
        <h3>Holiday &amp; Leave (web)</h3>
        <p>The page has three tabs:</p>
        <ul class="tidy">
          <li><strong>Mine</strong> — at the top you find the <strong>summary cards (KPI)</strong>: for <strong>Holiday</strong> and <strong>Leave</strong> the <strong>Balance</strong> highlighted (available hours) with below the assigned <strong>Total</strong> and the <strong>Used</strong> hours, plus the number of <strong>Pending</strong> requests. Below, the list of your requests with status; a <strong>+ New request</strong> button to submit one (Holiday, Leave, Sick leave, Absence), <strong>Cancel</strong> on pending ones and <strong>Request cancellation</strong> on approved ones.</li>
          <li><strong>Calendar</strong> — Day/Week/Month/Year view of your absences, with national public holidays highlighted.</li>
          <li><strong>To approve</strong> — appears only if you have been designated as an approver of other employees.</li>
        </ul>
      </div>

      <div class="feature" id="web-user-residui">
        <h3>Balances tab</h3>
        <p>The <strong>Balances</strong> tab in Holiday &amp; Leave shows a card for your <strong>Holiday</strong> and <strong>Leave</strong> balances. For each one you see the <strong>available balance</strong> highlighted and the detail: initial balance, accrued, approved used and hours of requests still pending.</p>
        <div class="callout callout-info">
          <em>Pending</em> requests are not deducted until they are approved. Below the balance you therefore also find what would be left if those pending ones were approved.
        </div>
      </div>
    </section>

    <section class="chapter" id="web-user-dashboard">
      <h2><span class="chapter-num">17</span>My Dashboard <span class="badge badge-user">user</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">Your employee home: stamp your day and see at a glance today's hours, the planned schedule and your latest stamps. The same functions as the mobile app, from the browser.</p>

      <div class="feature">
        <h3>Stamping from the web</h3>
        <p>If the <strong>remote</strong> mode is enabled for your profile, you get the buttons to record the day, which change with your current status:</p>
        <table>
          <thead><tr><th>Current status</th><th>Available actions</th></tr></thead>
          <tbody>
            <tr><td><span class="pill">Off duty</span></td><td><strong>Clock in</strong></td></tr>
            <tr><td><span class="pill pill-ok">At work</span></td><td><strong>Clock out</strong> · <strong>Start break</strong> · <strong>Start lunch break</strong></td></tr>
            <tr><td><span class="pill pill-warn">On break</span></td><td><strong>End break</strong></td></tr>
            <tr><td><span class="pill pill-warn">On lunch break</span></td><td><strong>End lunch break</strong></td></tr>
          </tbody>
        </table>
        <p>Right after stamping you have <strong>60 seconds</strong> to undo with <em>Undo last stamp</em>. If you are assigned to several locations you can pick one; once you clock in the location stays locked until clock-out.</p>
        <div class="callout callout-info">
          Web stamping is <strong>"remote"</strong>: it requires no GPS and does not apply the area check (geofence). For this reason it is available only if the administrator assigned you the <strong>remote</strong> mode. If you don't have it, you'll see the notice <em>"Web stamping is not enabled"</em> and you'll need to use the mobile app.
        </div>
      </div>

      <div class="feature">
        <h3>Day summary</h3>
        <p>At the top the card shows <strong>Hours worked</strong> and <strong>Counted hours</strong> (based on your assigned shift, rounded down to 15-minute blocks) plus the day's <strong>Clock-in</strong>, <strong>Breaks</strong> and <strong>Clock-out</strong>. It updates in real time.</p>
      </div>

      <div class="feature">
        <h3>Today's schedule and weekly schedule</h3>
        <p>If you have an assigned shift, you see the <strong>shifts planned for today</strong> as pills (e.g. "09:00–18:00") with the <strong>Total</strong> of expected hours, or "Today is a rest day". The <strong>📅 Week</strong> button opens the full <strong>weekly schedule</strong> (Monday–Sunday) with each day's shifts and total hours, with the current day highlighted.</p>
      </div>

      <div class="feature">
        <h3>Latest stamps</h3>
        <p>A table with your 8 most recent stamps: event and date/time. The <strong>See all</strong> link opens the full page.</p>
      </div>
    </section>

    <section class="chapter" id="web-user-stamps">
      <h2><span class="chapter-num">18</span>My stamps <span class="badge badge-user">user</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">History of your stamps. You see only your own.</p>

      <div class="feature">
        <h3>The table</h3>
        <p>Columns: <strong>When</strong> (date and time), <strong>Event</strong>, <strong>Source</strong>, <strong>Notes</strong>.</p>
        <p>By default you see the last 90 days. You cannot edit or delete stamps from the Web: for corrections submit a <em>request</em>.</p>
      </div>
    </section>

    <section class="chapter" id="web-user-corr">
      <h2><span class="chapter-num">19</span>My requests <span class="badge badge-user">user</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">The stamp correction requests you have sent — and from here you can create new ones, just like in the mobile app.</p>

      <div class="feature">
        <h3>Requests list</h3>
        <p>Each request is a card that shows: submission date, status (<span class="pill pill-warn">Pending</span> <span class="pill pill-ok">Approved</span> <span class="pill pill-err">Rejected</span> <span class="pill">Superseded</span>), the difference between current and requested values, the reason and — if decided — the administrator's note. On your own requests you see only the status: the decision is up to the administrator.</p>
      </div>

      <div class="feature">
        <h3>Creating a new request</h3>
        <p>Press <strong>+ New request</strong> and follow the three steps:</p>
        <ol class="steps">
          <li><strong>Which day?</strong> — choose the date to correct; we load your stamps for that day.</li>
          <li><strong>Which stamp?</strong> — select an existing stamp to edit, or <em>Add a missing stamp</em>.</li>
          <li><strong>Details</strong> — provide the event type, time, branch (if you have more than one) and a reason (at least 5 characters), then <strong>Submit request</strong>.</li>
        </ol>
        <p>The request stays <span class="pill pill-warn">Pending</span> until an administrator approves or rejects it; you will receive a notification of the decision.</p>
      </div>
    </section>

    <section class="chapter" id="web-user-documenti">
      <h2><span class="chapter-num">19a</span>My documents <span class="badge badge-user">user</span> <span class="badge badge-web">web</span></h2>
      <p class="lead">The documents your company has uploaded for you: payslips, CU, contracts and notices. You only see your own.</p>

      <div class="feature">
        <h3>Viewing and downloading</h3>
        <p>The table lists, for each document: <strong>Category</strong>, <strong>Title</strong>, <strong>Uploaded</strong>, <strong>Kept until</strong> and the <strong>read receipt</strong> status (<span class="pill pill-ok">Viewed</span> / <span class="pill pill-warn">Not viewed</span>).</p>
        <p>Press <strong>Download</strong> to open the PDF in a new tab. The <strong>first time</strong> you open a document is recorded as <em>read</em>: from then on the badge turns <span class="pill pill-ok">Viewed</span> and the company knows you have seen it.</p>
        <div class="callout callout-info">
          You receive a <strong>notification</strong> (push and email) whenever the company uploads a new document for you. You can turn off the email from <strong>Settings → Email notifications</strong> and push from the mobile app (<em>Profile</em>).
        </div>
      </div>

      <div class="callout callout-info">
        In the <strong>mobile app</strong> the <strong>Documents</strong> section is protected: on open it asks to unlock with <strong>biometrics</strong> (Face ID / Touch ID / fingerprint) or, if unavailable, the device passcode — regardless of the global app lock. Documents are kept for 36 months, then removed automatically.
      </div>
    </section>

    <hr class="section-divider">

    <div class="platform-header mobile">
      <div class="icon">📱</div>
      <div>
        <h2>Mobile App · Employee</h2>
        <div class="sub">The daily heart of the app: stamps, requests and personal profile.</div>
      </div>
    </div>

    <section class="chapter" id="mob-user">
      <h2><span class="chapter-num">20</span>Mobile App Overview</h2>
      <p class="lead">The mobile app is available for iOS and Android. The main navigation is a bottom bar with the Stamps, History, Requests and Documents tabs (plus Dashboard for admins).</p>

      <div class="feature">
        <h3>The main tabs</h3>
        <div class="grid-2">
          <div class="mini-card"><div class="mini-title">⏱ Stamps</div><div class="mini-desc">Main screen to clock in, clock out, take breaks</div></div>
          <div class="mini-card"><div class="mini-title">📅 History</div><div class="mini-desc">History of your stamps by day</div></div>
          <div class="mini-card"><div class="mini-title">💼 Requests</div><div class="mini-desc">Holiday, leave, sick leave</div></div>
          <div class="mini-card"><div class="mini-title">📄 Documents</div><div class="mini-desc">Your personal documents shared by the company</div></div>
        </div>
        <p><strong>Corrections</strong> are no longer a separate tab: they now live inside <strong>Stamps</strong>, in the <strong>Corrections</strong> tab.</p>
        <p>At the top left of every screen you find your <strong>avatar</strong> (opens the Profile). At the top right there is the <strong>notification bell</strong> with an unread badge. The bell collects updates on <strong>requests</strong> (holiday, leave, absences) and <strong>corrections</strong>: the decisions on your requests and — for approvers — those awaiting your decision. Tapping a notification opens the corresponding tab directly (Requests, or for corrections the Corrections tab inside Stamps).</p>
      </div>
    </section>

    <section class="chapter" id="mob-user-timbra">
      <h2><span class="chapter-num">21</span>Stamps <span class="badge badge-user">user</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">The home of the mobile app. From here you record all the events of your working day.</p>
      <p>The Stamps screen has <strong>two tabs</strong> at the top: <strong>Stamp</strong> (this page) and <strong>Corrections</strong>. Corrections — previously a separate bottom tab — now live in here: tap the tabs or <strong>swipe right/left</strong> to change view (see the Corrections chapter).</p>

      <div class="feature">
        <h3>Main card</h3>
        <p>At the top you always see:</p>
        <ul class="tidy">
          <li><strong>Hours worked</strong> — total updated in real time.</li>
          <li><strong>Counted hours</strong> — based on the assigned shift (if any), rounded down to 15-minute blocks (e.g. 14 minutes = 0).</li>
          <li><strong>Clock-in</strong>, <strong>Breaks</strong>, <strong>Clock-out</strong> — summary of the day.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Today's shift</h3>
        <p>Below the main card, if you have a work shift assigned, you see the <strong>shifts planned for today</strong> as pills (e.g. "09:00–18:00", or several pills in case of a split shift) and on the right the <strong>Total</strong> of expected hours: so you always know how much you are required to work that day. On rest days (e.g. Saturday/Sunday according to your shift) "Today is a rest day" appears. Without an assigned shift the section is not shown.</p>
        <p>Tap the <strong>calendar icon</strong> at the top right of the section to open the full <strong>weekly schedule</strong>: every day from Monday to Sunday with its planned shifts and total hours (the current day is highlighted). Handy to know in advance what the next days have in store.</p>
      </div>

      <div class="feature">
        <h3>Branch selection</h3>
        <p>If you are assigned to more than one branch you will see a series of horizontal "pills" to choose where you are working. The icon is a building for an on-site branch, a laptop for off-site branches.</p>
        <div class="callout callout-info">
          Once you have clocked in, the branch is <strong>locked</strong> until the clock-out stamp: a padlock icon appears. This prevents errors during the shift.
        </div>
      </div>

      <div class="feature">
        <h3>Stamping</h3>
        <p>The buttons change based on the status:</p>
        <table>
          <thead><tr><th>Current status</th><th>Available actions</th></tr></thead>
          <tbody>
            <tr><td><span class="pill">Off duty</span></td><td><strong>Clock in</strong></td></tr>
            <tr><td><span class="pill pill-ok">At work</span></td><td><strong>Clock out</strong> · <strong>Start break</strong> · <strong>Start lunch</strong></td></tr>
            <tr><td><span class="pill pill-warn">On break</span></td><td><strong>End break</strong></td></tr>
            <tr><td><span class="pill pill-warn">On lunch break</span></td><td><strong>End lunch</strong></td></tr>
          </tbody>
        </table>
        <p>Tap the button and the app:</p>
        <ol class="steps">
          <li>Checks the current status.</li>
          <li>If the branch requires GPS, acquires the position (asks for permission once).</li>
          <li>Sends the stamp to the server.</li>
          <li>Shows "Stamp successful" and refreshes the screen.</li>
        </ol>
        <div class="callout callout-info">
          <strong>Clock-out always possible.</strong> The <strong>Clock out</strong> is never blocked by the area check: if you forgot to stamp and are far from the branch (e.g. from home), the clock-out is still recorded. If the position turns out to be out of area, you will see the notice <em>"Clock-out out of area"</em> and the stamp is saved with an <strong>anomaly</strong> visible to the administrator. Clock-in and breaks remain subject to the area check.
        </div>
      </div>

      <div class="feature">
        <h3>Undoing the last stamp</h3>
        <p>As soon as it is recorded, the <strong>Undo last stamp</strong> link appears below the main card. You have 60 seconds to undo it if you made a mistake.</p>
        <div class="callout callout-warn">
          After 60 seconds it can no longer be undone directly: you will have to submit a <strong>correction</strong> request.
        </div>
      </div>

      <div class="feature">
        <h3>Did you forget to clock out?</h3>
        <p>No panic, there are two safety nets:</p>
        <ul class="tidy">
          <li>After <strong>14 hours</strong> from clock-in you receive a <strong>reminder</strong> inviting you to clock out.</li>
          <li>If the shift stays open beyond <strong>15 hours</strong>, the system closes it itself by entering the clock-out at <strong>clock-in + 15 hours</strong> (it may fall on the following day). The stamp is shown with an <em>automatic</em> source.</li>
        </ul>
        <div class="callout callout-info">
          If the actual clock-out time was different from the one calculated automatically, submit a <strong>correction</strong> request from the Corrections tab: the administrator will sort it out.
        </div>
      </div>

      <div class="feature">
        <h3>What to do if a stamp fails</h3>
        <ul class="tidy">
          <li><strong>"No connection"</strong> — the stamp is queued and sent when you are back online. The notice will appear: <em>"Stamp queued. It will be sent when you are back online."</em></li>
          <li><strong>"You are outside the allowed area"</strong> — applies to <strong>clock-in</strong> and <strong>breaks</strong>: you are too far from the branch, get closer or change branch. The <strong>clock-out</strong> is never blocked (it is recorded with an anomaly, see above).</li>
          <li><strong>"Operation not valid for the current status"</strong> — you cannot clock in if you are already at work, etc.</li>
          <li><strong>"You already stamped a few seconds ago"</strong> — protection against double clicks.</li>
        </ul>
      </div>
    </section>

    <section class="chapter" id="mob-user-storico">
      <h2><span class="chapter-num">22</span>Stamp history <span class="badge badge-user">user</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">Summary of your stamps, grouped by day.</p>

      <div class="feature">
        <h3>Quick filters</h3>
        <p>At the top three pills: <strong>7 days</strong>, <strong>30 days</strong>, <strong>90 days</strong>. The active one is highlighted.</p>
      </div>

      <div class="feature">
        <h3>Total summary</h3>
        <p>A summary card shows the <strong>Total counted</strong> in the period (e.g. "156h 45m"), with below the <strong>Worked</strong> (raw sum) and on the right the number of <strong>days</strong> with at least one stamp.</p>
      </div>

      <div class="feature">
        <h3>Card per day</h3>
        <p>Each day is a collapsible card that shows both measures:</p>
        <ul class="tidy">
          <li>Label: "Today", "Yesterday" or the full date ("Thursday 23 May").</li>
          <li>Break time if &gt; 0.</li>
          <li><strong>Worked</strong> — actual hours of the day (raw sum of the segments).</li>
          <li><strong>Counted</strong> — hours valid for payroll: <strong>Worked</strong> minus the deductions for overruns (late clock-in, early clock-out, breaks over the maximum) plus overtime, all rounded down to 15-minute blocks. The deduction for lateness or early clock-out does not apply if an approved leave or holiday covers that deviation. If there is overtime, a row specifies it ("of which …").</li>
        </ul>
        <p>Without an assigned work shift the <strong>Counted</strong> hours match the <strong>Worked</strong> ones (only rounded to 15 min). Tap the card to expand it and see each individual stamp of the day with a coloured icon (green clock-in, red clock-out, orange break) and the time HH:MM.</p>
      </div>

      <div class="feature">
        <h3>Rest days</h3>
        <p>If you have a work shift assigned, the <strong>rest days</strong> (those without a planned shift, e.g. Saturday/Sunday) <strong>do not appear</strong> in the history, to keep it clean. The exception is rest days on which you actually worked: if hours worked are recorded on that day, the card is shown anyway. Without an assigned shift all the days with at least one stamp are listed.</p>
      </div>
    </section>

    <section class="chapter" id="mob-user-correzioni">
      <h2><span class="chapter-num">23</span>Corrections <span class="badge badge-user">user</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">Request the correction of a wrong stamp or the addition of a forgotten one. Corrections live in the <strong>Stamps</strong> screen, in the <strong>Corrections</strong> tab.</p>

      <div class="feature">
        <h3>Your requests</h3>
        <p>Inside Stamps, the <strong>Corrections</strong> tab shows a <strong>single list</strong> of all requests: the <strong>pending</strong> ones are always on top, followed by the already-decided ones. The badge on the "Corrections" tab shows the number of requests still to be decided.</p>
        <p>Each request is a card with: event type (Clock-in/Clock-out/...), status (<span class="pill pill-warn">Pending</span> <span class="pill pill-ok">Approved</span> <span class="pill pill-err">Rejected</span>), before/after difference, the reason and the approver's note if decided.</p>
      </div>

      <div class="feature">
        <h3>Creating a new request</h3>
        <p>Tap the <strong>+</strong> button at the bottom right. A 3-step guided procedure opens:</p>
        <ol class="steps">
          <li><strong>Which day?</strong> Select from the calendar the day of the stamp to correct (today at most).</li>
          <li><strong>Which stamp?</strong> Tap a stamp of the day to edit it, or choose <em>"Add a missing stamp"</em>.</li>
          <li><strong>Edit</strong>:
            <ul class="tidy">
              <li>Event type (Clock-in, Clock-out, break start/end, lunch start/end).</li>
              <li>Correct time (HH:MM selector, 5-minute intervals).</li>
              <li>Branch (if you have more than one).</li>
              <li><strong>Reason</strong> (at least 5 characters).</li>
            </ul>
          </li>
        </ol>
        <p>Press <strong>Submit request</strong>. The administrator (or the designated approver) will receive a notification and decide.</p>
      </div>
    </section>

    <section class="chapter" id="mob-user-richieste">
      <h2><span class="chapter-num">24</span>Holiday / Leave / Sick leave / Absence <span class="badge badge-user">user</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">All absence requests are managed from the Requests tab.</p>

      <div class="feature">
        <h3>"Mine", "Calendar" and "To approve" tabs</h3>
        <p>The Requests tab has three tabs: <strong>Mine</strong> (your requests), <strong>Calendar</strong> and — for approvers/administrators — <strong>To approve</strong> (with a badge on the pending count). Tap the tabs or <strong>swipe right/left</strong> to change view.</p>
      </div>

      <div class="feature">
        <h3>"Calendar" tab</h3>
        <p>Calendar view of the absences with a <strong>Day / Week / Month / Year</strong> selector. The days with absences show coloured dots by type and the <strong>national public holidays</strong> are highlighted. The employee sees their own absences; the administrator sees everyone's, with the chips at the top to filter by employee.</p>
      </div>

      <div class="feature">
        <h3>Summary and available balance</h3>
        <p>At the top of the "Mine" tab you find <strong>summary cards (KPI)</strong> to keep the situation always up to date:</p>
        <ul class="tidy">
          <li><strong>Holiday</strong> and <strong>Leave</strong>: the <strong>Balance</strong> (hours still available) highlighted, with below the assigned <strong>Total</strong> and the <strong>Used</strong> hours.</li>
        </ul>
        <p>Below, the <strong>Availability</strong> card shows the detail by type: initial balance, accrued, used and pending hours, with the hint on the balance after the pending requests (e.g. "(15.75h after pending requests)").</p>
      </div>

      <div class="feature">
        <h3>Submitting a request</h3>
        <p>Tap <strong>+</strong> at the bottom right. The form opens:</p>
        <ol class="steps">
          <li>Choose the <strong>type</strong>: <span class="pill pill-info">Holiday</span> <span class="pill pill-warn">Leave</span> <span class="pill pill-err">Sick leave</span> <span class="pill">Absence</span>.</li>
          <li>Indicate <strong>From</strong> and <strong>To</strong> (dates).</li>
          <li>For Holiday/Leave you can choose <em>All day</em> or enable <strong>Specific time</strong> (start/end time).</li>
          <li>For Sick leave: enter the <strong>INPS protocol number</strong> (required).</li>
          <li>For Absence: choose the <strong>category</strong> (Personal reasons, Bereavement, etc.) and indicate whether it is <strong>paid</strong> or not.</li>
          <li>See who the designated <strong>approver</strong> is (or "No approver configured").</li>
          <li>Add an optional <strong>note</strong> (e.g. "brother's wedding", "medical appointment"). For Absence the field is called <strong>Reason</strong> and is also optional.</li>
          <li>Press <strong>Submit request</strong> (for Holiday/Leave/Absence) or <strong>Submit report</strong> (for Sick leave).</li>
        </ol>
        <p><strong>Total requested:</strong> the form shows the request's hours live, computed from the chosen period and your <strong>assigned schedule</strong>. An <em>All day</em> leave counts that day's scheduled hours (e.g. 8h, not 24h) and non-working days count 0. A request falling entirely outside your schedule (e.g. holiday on a Sunday only) is blocked; a mixed range (e.g. Mon→Sun) counts only the working days.</p>
      </div>

      <div class="feature">
        <h3>Your requests</h3>
        <p>Each request is a card with: type, status, period, hours, any notes, the reason for rejection if applicable.</p>
        <p>Possible statuses:</p>
        <table>
          <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><span class="pill pill-warn">Pending</span></td><td>The approver has yet to decide.</td></tr>
            <tr><td><span class="pill pill-ok">Approved</span></td><td>Approved by the administrator.</td></tr>
            <tr><td><span class="pill pill-err">Rejected</span></td><td>Rejected, with a stated reason.</td></tr>
            <tr><td><span class="pill">Cancelled</span></td><td>Cancelled by you or by the admin.</td></tr>
            <tr><td><span class="pill pill-warn">Cancellation requested</span></td><td>You have asked to cancel an already-approved holiday.</td></tr>
            <tr><td><span class="pill">Replaced by sick leave</span></td><td>A sick leave covered the same period.</td></tr>
          </tbody>
        </table>
      </div>

      <div class="feature">
        <h3>Cancelling or requesting cancellation</h3>
        <ul class="tidy">
          <li>If the request is <em>Pending</em>: <strong>Cancel</strong> button to withdraw it.</li>
          <li>If it is <em>Approved</em> (and not sick leave): <strong>Request cancellation</strong> button to ask the admin to cancel it. A reason will be requested.</li>
        </ul>
        <div class="callout callout-info">
          Sick leave is auto-approved as soon as you submit it: it does not go through the approver. However it always needs the INPS protocol.
        </div>
      </div>
    </section>

    <section class="chapter" id="mob-user-profilo">
      <h2><span class="chapter-num">25</span>Profile <span class="badge badge-user">user</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">Your information, the assigned branches and the notification preferences.</p>

      <div class="feature">
        <h3>Open the profile</h3>
        <p>Tap your avatar at the top left on any screen.</p>
      </div>

      <div class="feature">
        <h3>What you see</h3>
        <ul class="tidy">
          <li><strong>Avatar</strong>, name, email, role (<em>Employee</em> or <em>Administrator</em>).</li>
          <li><strong>Company</strong>: company name.</li>
          <li><strong>Assigned branches</strong>: list with a building or laptop icon and an "On-site" or "Off-site" tag.</li>
          <li><strong>Language</strong>: choose the app language — Italian or English.</li>
          <li><strong>Notifications</strong>: status of the push and of the individual toggles.</li>
          <li><strong>Email</strong>: toggle to also receive notifications by email.</li>
          <li><strong>Security</strong>: enable biometric access (Face ID, Touch ID or fingerprint).</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Language</h3>
        <p>In the <strong>Language</strong> section tap <strong>Italiano</strong> or <strong>English</strong> to switch the app language instantly. It is a <em>personal</em> preference (it applies only to your account) and is remembered on the next launch; the emails and push notifications you receive follow the same choice. On the Web you change it from <strong>Settings &rarr; Interface language</strong>.</p>
      </div>

      <div class="feature">
        <h3>Managing push notifications</h3>
        <p>If push is <strong>active</strong> on the device, you see the toggles:</p>
        <ul class="tidy">
          <li><strong>Holiday and leave outcomes</strong> — when they are approved or rejected.</li>
          <li><strong>Correction outcomes</strong> — decisions on your corrections.</li>
          <li><strong>24h reminder</strong> — notice the evening before one of your absences (e.g. "holiday tomorrow").</li>
        </ul>
        <p>If push is <strong>not active</strong>: you must enable it in the phone settings.</p>
      </div>

      <div class="feature">
        <h3>Security · Biometric access</h3>
        <p>In the <strong>Security</strong> section you can enable <strong>biometric access</strong> (Face ID, Touch ID or fingerprint, depending on the device). When it is active, the app asks to be unlocked with biometrics on launch — and when you reopen it after leaving it in the background for a few minutes — before showing your data.</p>
        <ul class="tidy">
          <li>The toggle is available only if biometrics are already set up on the phone; otherwise it appears disabled with the relevant indication.</li>
          <li>Quick reopenings (within a few minutes) do not require unlocking again, so stamping stays fast.</li>
          <li>If unlocking fails you can always tap <strong>Log out and use the password</strong> to get back in with email and password.</li>
        </ul>
        <div class="callout callout-info">
          The session stays protected in the phone's secure keychain: biometrics add a lock when opening the app. The unlock is only local, no fingerprint or face image is sent to sonoQui.
        </div>
      </div>

      <div class="feature">
        <h3>Logout</h3>
        <p>At the bottom of the screen tap <strong>Log out</strong> (red). You will be asked to confirm.</p>
      </div>
    </section>

    <hr class="section-divider">

    <div class="platform-header mobile">
      <div class="icon">👔</div>
      <div>
        <h2>Mobile App · Administrator</h2>
        <div class="sub">The admin on the mobile app has all the employee's functions plus the approval ones.</div>
      </div>
    </div>

    <section class="chapter" id="mob-admin">
      <h2><span class="chapter-num">26</span>Mobile Admin Overview</h2>
      <p class="lead">If you are an administrator, on the mobile app you open directly on the <strong>Dashboard</strong>: a dedicated tab with the summary of the day. In addition you have an approvals tab and receive push notifications for new requests. You can still stamp for yourself from the Stamps tab.</p>

      <div class="callout callout-info">
        On the mobile app the admin does <strong>not</strong> manage users, branches, shifts, exports or settings: for these functions you need the Web.
      </div>

      <div class="feature" id="mob-admin-dashboard">
        <h3>Dashboard — the summary of the day</h3>
        <p>On launch the administrator sees the <strong>Dashboard</strong> (first tab of the bottom bar), designed to understand at a glance who is working and who is absent. It shows:</p>
        <ul class="tidy">
          <li><strong>Summary cards</strong> — Present now (out of total employees), On break and Absent today.</li>
          <li><strong>Absent</strong> — who is on holiday, leave or sick leave, with the type and the dates. A <strong>Today · 7 days · 14 days</strong> selector widens the list to those who will be absent in the next 7 or 14 days.</li>
          <li><strong>Current status</strong> — the list of employees with their status (<span class="pill pill-ok">At work</span>, <span class="pill pill-warn">On break</span> or <span class="pill">Off duty</span>) and the branch; those who are working appear at the top. With the <strong>List · By branch</strong> selector you can group those present by branch, as on the Web.</li>
        </ul>
        <p>Pull down to refresh the data. The Dashboard is visible only to administrators; employees open as always on the Stamps tab.</p>
      </div>
    </section>

    <section class="chapter" id="mob-admin-correzioni">
      <h2><span class="chapter-num">27</span>Approving corrections <span class="badge badge-admin">admin</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">From the <strong>Stamps</strong> screen, in the <strong>Corrections</strong> tab, you also see the requests to decide.</p>

      <div class="feature">
        <h3>"Corrections" tab</h3>
        <p>Shows a single list of all correction requests: the <strong>pending</strong> ones that fall to you (based on the approver configuration) are on top, the already-decided ones follow as history.</p>
        <p>Each card shows the employee, the before/after difference and the reason, with the buttons:</p>
        <ul class="tidy">
          <li><span class="pill pill-ok">Approve</span> — asks for confirmation and applies the correction.</li>
          <li><span class="pill pill-err">Reject</span> — asks for the reason for the rejection and records it.</li>
        </ul>
      </div>

      <div class="feature">
        <h3>Sending your own request</h3>
        <p>The administrator can also tap the <strong>+</strong> button (at the bottom right) to submit a correction on their <em>own</em> stamps, with the same three-step flow as the employee — useful to keep a request→approval trace instead of editing the stamp directly from the Web.</p>
      </div>
    </section>

    <section class="chapter" id="mob-admin-richieste">
      <h2><span class="chapter-num">28</span>Approving holiday and leave <span class="badge badge-admin">admin</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">In the <strong>Requests</strong> tab the "To approve" tab appears.</p>

      <div class="feature">
        <h3>"To approve" tab</h3>
        <p>You see all the pending requests. Tap the tab or <strong>swipe right/left</strong> to move between "Mine" and "To approve". For each one:</p>
        <ul class="tidy">
          <li><span class="pill pill-ok">Approve</span> — confirm with a summary dialog.</li>
          <li><span class="pill pill-err">Reject</span> — mandatory prompt for the reason.</li>
        </ul>
        <p>If the request is in the "Cancellation requested" status:</p>
        <ul class="tidy">
          <li><strong>Accept cancellation</strong> — grants the cancellation and frees up the balance.</li>
          <li><strong>Reject</strong> — keeps the holiday approved.</li>
        </ul>
      </div>
    </section>

    <section class="chapter" id="mob-admin-notifiche">
      <h2><span class="chapter-num">29</span>Admin notifications <span class="badge badge-admin">admin</span> <span class="badge badge-mobile">mobile</span></h2>
      <p class="lead">Only for those who are administrators: additional toggles in the profile.</p>

      <div class="feature">
        <h3>Additional toggles in the profile</h3>
        <ul class="tidy">
          <li><strong>New holiday and leave requests</strong> — push when an employee submits or requests a cancellation.</li>
          <li><strong>New corrections to approve</strong> — push when an employee submits a correction.</li>
        </ul>
      </div>

      <div class="callout callout-tip">
        The badge on the app icon (at the operating system level) reflects the number of unread notifications in the bell — primarily the requests and corrections awaiting your decision: you understand at a glance if there is something to do even without opening the app.
      </div>
    </section>

    <hr class="section-divider">

    <section class="chapter" id="geofence">
      <h2><span class="chapter-num">30</span>Geolocation</h2>
      <p class="lead">How the position check works during stamping.</p>

      <div class="feature">
        <h3>Stamping methods per user</h3>
        <p>For each user the admin chooses (in <strong>Users → Stamping column</strong>) which methods they can stamp with:</p>
        <ul class="tidy">
          <li><strong>GPS</strong> — stamping from the mobile app, with position verification (geofence) as described below.</li>
          <li><strong>Remote</strong> — stamping from the web without position verification. Useful for those who work remotely.</li>
          <li><strong>No method</strong> — the user cannot stamp: in the mobile app the <em>Stamps</em> item is not even shown.</li>
        </ul>
        <p>The methods combine (e.g. GPS + Remote). The geofence check described below applies only to the GPS method.</p>
      </div>

      <div class="feature">
        <h3>Geofence</h3>
        <p>For each branch the admin defines GPS coordinates and — optionally — a <strong>radius</strong> in metres. When the radius is active, the stamp is valid only if you are within this circular area.</p>
        <p>If you are outside you see the message <em>"You are outside the allowed area"</em>: the <strong>clock-in</strong> stamp is rejected, while the <strong>clock-out</strong> is always accepted but flagged as an anomaly.</p>
      </div>

      <div class="feature">
        <h3>Branch without a radius</h3>
        <p>If the admin disables the radius for a branch, the stamp is accepted wherever you are: the GPS position is still recorded on the stamp for auditing, but without comparison to an area. The branch does not appear in auto-detection: to use it you must select it manually in the app before stamping.</p>
      </div>

      <div class="feature">
        <h3>Off-site</h3>
        <p>Branches marked as "off-site" do not require GPS. Typical use case: remote work, business trip or building site.</p>
      </div>

      <div class="feature">
        <h3>Mock location</h3>
        <p>If the device detects a GPS simulation app, the stamp is flagged as <em>suspicious</em> and handled according to the company setting:</p>
        <ul class="tidy">
          <li><strong>Allow</strong> — the stamp goes through.</li>
          <li><strong>Flag</strong> — the stamp goes through with a marking visible to the admin.</li>
          <li><strong>Block</strong> — the stamp is rejected.</li>
        </ul>
      </div>
    </section>

    <section class="chapter" id="notifiche">
      <h2><span class="chapter-num">31</span>Notifications</h2>
      <p class="lead">Email and push notifications: the types available and where to configure them.</p>

      <div class="feature">
        <h3>Which notifications you can receive</h3>
        <table>
          <thead><tr><th>Type</th><th>When</th><th>For whom</th></tr></thead>
          <tbody>
            <tr><td>Holiday/leave decision</td><td>When the admin decides</td><td>Employee</td></tr>
            <tr><td>Correction decision</td><td>When the admin decides</td><td>Employee</td></tr>
            <tr><td>New holiday request</td><td>On submission by an employee</td><td>Admin / approver</td></tr>
            <tr><td>New correction</td><td>On submission by an employee</td><td>Admin / approver</td></tr>
            <tr><td>24h reminder</td><td>The evening before one of your approved absences (e.g. "holiday tomorrow")</td><td>Employee</td></tr>
            <tr><td>Company event</td><td>When the admin inserts an event on your calendar</td><td>Employee</td></tr>
          </tbody>
        </table>
        <div class="callout callout-info">
          The <strong>24h reminder</strong> goes out every evening for the absences that start the following day (sick leave excluded). Sick leave, being recorded after the fact, does not generate a reminder.
        </div>
      </div>

      <div class="feature">
        <h3>Configuring notifications</h3>
        <ul class="tidy">
          <li><strong>Email</strong>: in the Settings (web) you can enable/disable email <em>by category</em>, exactly like push: request outcomes, new requests to approve, correction outcomes, new corrections and the <strong>24h reminder</strong>. Disabled by default.</li>
          <li><strong>Push</strong>: granular toggles for each type in the Profile of the mobile app, including the <strong>24h reminder</strong>. Push requires the operating system's permission.</li>
        </ul>
      </div>
    </section>

    <section class="chapter" id="offline">
      <h2><span class="chapter-num">32</span>Offline mode</h2>
      <p class="lead">What happens when the phone has no connection.</p>

      <div class="feature">
        <h3>Offline queue</h3>
        <p>If you try to stamp without a connection, the app does not lose the data: it queues it and will send it as soon as you are back online. The notice appears:</p>
        <p style="font-style: italic; padding: 12px; background: var(--color-surface-variant); border-radius: 6px;">"Stamp queued. It will be sent when you are back online."</p>
        <p>The queue is persistent: even if you close the app, on reopening — as soon as there is a connection — the data is sent.</p>
      </div>

      <div class="feature">
        <h3>Duplicate protection</h3>
        <p>Each stamp has an idempotency key: if by mistake the app tries to send the same one twice, the server accepts only one.</p>
      </div>
    </section>

    <section class="chapter" id="glossario">
      <h2><span class="chapter-num">33</span>Glossary</h2>
      <p class="lead">All the terms in alphabetical order.</p>

      <div class="feature">
        <table>
          <tbody>
            <tr><td><strong>Accrual</strong></td><td>The automatic crediting of holiday/leave hours on a monthly or yearly basis.</td></tr>
            <tr><td><strong>Anomaly</strong></td><td>Deviation between stamps and the expected shift.</td></tr>
            <tr><td><strong>Approver</strong></td><td>Admin designated to decide on a type of request for a specific employee.</td></tr>
            <tr><td><strong>Absence</strong></td><td>Generic request with a category (personal reasons, bereavement, leave of absence, etc.) and a paid/unpaid flag. Reason optional.</td></tr>
            <tr><td><strong>Audit log</strong></td><td>Register of manual changes to stamps (who, when, why).</td></tr>
            <tr><td><strong>Badge</strong></td><td>Coloured pill that indicates a status or type (holiday, sick leave, etc.).</td></tr>
            <tr><td><strong>Company closure</strong></td><td>Event that the admin assigns to several employees together; type <em>closure</em> (does not deduct holiday) or counted as holiday.</td></tr>
            <tr><td><strong>Correction</strong></td><td>Employee request to change or add a stamp.</td></tr>
            <tr><td><strong>Export</strong></td><td>Job that produces an XLSX or JSON file with the data of a period.</td></tr>
            <tr><td><strong>Holiday</strong></td><td>Paid absence in days, consumes the holiday balance.</td></tr>
            <tr><td><strong>Public holiday</strong></td><td>Italian national public holidays, highlighted on the calendar (movable holidays like Easter included).</td></tr>
            <tr><td><strong>Off-site</strong></td><td>Branch without GPS: the employee can stamp anywhere (remote work, business trip, building site).</td></tr>
            <tr><td><strong>Geofence</strong></td><td>Circular area around a branch, defined by a GPS centre and a radius in metres.</td></tr>
            <tr><td><strong>Sick leave</strong></td><td>Absence for health reasons, auto-approved, requires the INPS protocol.</td></tr>
            <tr><td><strong>Mock location</strong></td><td>Fake GPS position generated by external apps.</td></tr>
            <tr><td><strong>Leave</strong></td><td>Paid absence by the hour, 15-minute granularity.</td></tr>
            <tr><td><strong>24h reminder</strong></td><td>Notification (push/email) sent the evening before an approved absence begins.</td></tr>
            <tr><td><strong>Balance</strong></td><td>Balance of hours available for holiday or leave.</td></tr>
            <tr><td><strong>Revocation</strong></td><td>Cancellation of an already-approved holiday, on the admin's initiative.</td></tr>
            <tr><td><strong>Branch</strong></td><td>Place of work, with or without geofencing. The radius can be disabled: in that case the GPS is recorded but not compared to an area.</td></tr>
            <tr><td><strong>Superseded</strong></td><td>Status of a correction that is obsolete because the stamp has changed elsewhere.</td></tr>
            <tr><td><strong>Shift template</strong></td><td>Weekly model of working slots.</td></tr>
            <tr><td><strong>Balance template</strong></td><td>Model for calculating holiday/leave accrual.</td></tr>
            <tr><td><strong>Stamp</strong></td><td>Event of clock-in, clock-out, break start/end or lunch start/end.</td></tr>
            <tr><td><strong>Tolerance</strong></td><td>Minutes of deviation allowed between a stamp and the expected shift.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="chapter" id="faq">
      <h2><span class="chapter-num">34</span>FAQ</h2>
      <p class="lead">The most common situations and how to handle them.</p>

      <div class="feature">
        <h3>I forgot to clock in. What do I do?</h3>
        <p>Open the mobile app, go to the <strong>Corrections</strong> tab, press <strong>+</strong>, select the day and choose <em>"Add a missing stamp"</em>. Enter the type, correct time and reason. The admin will receive the request.</p>
      </div>

      <div class="feature">
        <h3>I stamped ten seconds ago by mistake. Can I undo it?</h3>
        <p>Yes, you have 60 seconds. On the Stamps screen, below the main card, the <strong>Undo last stamp</strong> link appears.</p>
      </div>

      <div class="feature">
        <h3>The app says I am "outside the allowed area" but I am in the office.</h3>
        <p>Check that the GPS is on, step outside for a few seconds to improve accuracy, then try again. If the problem persists contact the admin to check the branch radius.</p>
      </div>

      <div class="feature">
        <h3>Can I stamp from the browser on the PC?</h3>
        <p>Only if the administrator has enabled the <strong>Remote</strong> method for your profile (in Users → <em>Stamping</em> column). By default only <strong>GPS</strong> from the mobile app is active, to avoid stamps that are not geolocated.</p>
      </div>

      <div class="feature">
        <h3>How many holiday hours do I have?</h3>
        <p>Open the mobile app and go to the <strong>Requests</strong> tab. At the top you see your Holiday and Leave balances, also with the indication of what would happen if the pending requests were approved.</p>
      </div>

      <div class="feature">
        <h3>What happens if I request more holiday than I have?</h3>
        <p>The request is not blocked: the counter can go negative. It is up to the admin to decide whether to approve it. You can always check the balance before submitting.</p>
      </div>

      <div class="feature">
        <h3>I am on sick leave, what do I do?</h3>
        <p>From the mobile app → <strong>Requests</strong> tab → <strong>+</strong> → select <strong>Sick leave</strong>. Enter the INPS protocol and the dates. The request is auto-approved and covers any overlapping holiday.</p>
      </div>

      <div class="feature">
        <h3>The admin rejected my request. Can I see why?</h3>
        <p>Yes. The request card on the screen shows the reason for the rejection in a red banner.</p>
      </div>

      <div class="feature">
        <h3>I want to cancel an already-approved holiday.</h3>
        <p>On the card of the approved request you find the <strong>Request cancellation</strong> button. Provide the reason: the admin will receive your cancellation request and can accept or reject it.</p>
      </div>

      <div class="feature">
        <h3>How do I change my password?</h3>
        <p>Go to the login page (both Web and Mobile), press <strong>Forgot password?</strong>, enter your email and follow the link you receive by email.</p>
      </div>

      <div class="feature">
        <h3>I am not receiving push notifications.</h3>
        <p>Check in the mobile app: <strong>Profile → Notifications</strong>. If the section says "Not active on this device", open the phone settings and grant notifications to the sonoQui app. Then go back to the profile and enable the individual toggles.</p>
      </div>

      <div class="feature">
        <h3>I am an admin: where do I manage users?</h3>
        <p>On the Web → <strong>Users</strong>. The mobile app does not have this function: to change roles, branches, shifts or invite new employees use the browser.</p>
      </div>

      <div class="feature">
        <h3>Is there an absence calendar?</h3>
        <p>Yes. On the Web in <strong>Holiday &amp; Leave → Calendar</strong> (also for employees at <em>/me/leaves</em>) and in the mobile app in the <strong>Requests → Calendar</strong> tab. You can choose the Day, Week, Month or Year view. The employee sees their own absences, the administrator sees everyone's (with a filter by employee). The national public holidays are highlighted automatically.</p>
      </div>

      <div class="feature">
        <h3>Do I get a notice before my holiday starts?</h3>
        <p>Yes: the evening before you receive a <strong>24h reminder</strong> ("starting tomorrow…"). You can enable/disable it as push from the mobile app (<strong>Profile → Notifications → 24h reminder</strong>) and as email from the Web (<strong>Settings → Email notifications</strong>). Sick leave, recorded after the fact, does not generate a reminder.</p>
      </div>

      <div class="feature">
        <h3>I am an admin: how do I set a company closure for everyone?</h3>
        <p>On the Web → <strong>Holiday &amp; Leave → Calendar → + Insert event</strong>. Provide a title (e.g. "August company closure") and the period, choose whether to <strong>count it as holiday</strong> or not, and select all the employees or a subset. Each one receives a notification and the event appears on their calendar. You can revoke the whole block at a later time.</p>
      </div>
    </section>

    <footer>
      <p><strong>sonoQui · User Manual</strong></p>
    </footer>
`;
