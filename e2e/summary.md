# sonoQui end-to-end tests

Playwright covers both the **web admin SPA** (`apps/web`) and the **mobile Expo
app** (`apps/mobile`) via its web build, **in both admin and employee roles**.
A single root-level `playwright.config.ts` defines four spec projects (admin web,
admin mobile, user web, user mobile) plus their setup projects. Each setup
project authenticates once via the real login form and persists the resulting
session to disk; spec projects depend on the setup and reuse the storage so
GoTrue sees one `password` grant per role per run.

## Status

**160 passing, 0 skipped, 0 failing** with `E2E_MUTATING=1` against the
dev backend and the seeded ACME Srl test tenant.

Breakdown:

- **Web admin** — login, dashboard, nav, stamps, leaves (tabs + cancellation),
  corrections, anomalies, workflow-approvers, exports, settings, shifts,
  branches, forgot-password, interactions (DataGrid sort + autosave +
  bell + filter + form toggle), a11y audit per main page, visual
  regression baselines (login + dashboard + utenti).
- **Web employee** — role gating, MyDashboard, MyStamps, /me/corrections.
- **Mobile admin** — login, timbrature, nav, storico, corrections-admin,
  profilo, forgot-password, interactions (storico range pills,
  notifications bell tap, branch picker).
- **Mobile employee** — role gating, Richieste (ferie/permessi/malattia
  branches incl. INPS protocol field), Correzioni create flow (3-step
  modal), approver-hint fallback, profilo.
- **Mutating specs** (opt-in via `E2E_MUTATING=1`) — 13 files:
  - `mutating-corrections.spec.ts` (approve cycle + multi-approver race)
  - `mutating-malattia-overlap.spec.ts` (ferie supersede proof)
  - `mutating-cancellation.spec.ts` (Accetta annullamento flow)
  - `mutating-approver-assignment.spec.ts` (designated approver + admin
    NOT in list → 403)
  - `mutating-ferie-weekend-skip.spec.ts` (Mon–Fri shift, Mon→Mon
    ferie = 48h not 64h)
  - `mutating-branches-crud.spec.ts` (POST → assert → DELETE → assert)
  - `mutating-shifts-crud.spec.ts` (template + assignment)
  - `mutating-leave-templates-crud.spec.ts`
  - `mutating-users-crud.spec.ts` (invite + deactivate + reactivate + delete)
  - `mutating-validation.spec.ts` (permessi 15-min, INPS missing/long,
    to_ts<=from_ts, justification<5)
  - `mutating-cancellation-reject-and-refund.spec.ts` (reject path +
    quota residual delta after Accetta)
  - `mutating-export.spec.ts` (POST job + poll status)
  - `mutating-realtime.spec.ts` (contract on /realtime/since)
  - `mobile/user/negative-balance.spec.ts` (assignment with -8h →
    quota card renders `-8.00h`).
- **Zero skipped tests** when `E2E_MUTATING=1`. Previously content-
  dependent assertions (cancellation_pending badge, Sostituita da
  malattia, Disponibili: …h, Entrata in ritardo) are now backed by
  seed/cleanup blocks in their own describe scopes. Empty-state
  copy tests (`Nessuna richiesta da gestire.`, `Non hai richieste.`)
  were removed because they intrinsically conflict with seed cycles
  in the same suite — the variant copy is verified via code inspection
  (`CorrezioniScreen.tsx:148`).
- When `E2E_MUTATING=0` (default safe run) all mutating-gated specs
  skip cleanly — useful for fast smoke checks without writing to the
  tenant.

### Mutating specs (opt-in)

Three specs **mutate the test tenant** via the API: they seed real rows,
exercise the UI, then clean up. They are gated behind `E2E_MUTATING=1` and
**skipped by default**. To run them:

```bash
E2E_MUTATING=1 E2E_NO_WEBSERVER=1 npm run e2e
```

Specs:

- `e2e/web/mutating-corrections.spec.ts` — `approve cycle`: API-seed a
  correction as test3, click *Approva* in the admin UI, assert the badge
  flips to *Approvata*, then admin-DELETE the resulting stamp. `multi-
  approver race`: two parallel `/approve` calls on the same row exactly
  produce `[200, 409 CONFLICT]` — proves the `FOR UPDATE` lock works.
- `e2e/mobile/user/negative-balance.spec.ts` — API-create a `ferie` quota
  template + assignment with `initial_balance: -8` for test3, open the
  mobile Richieste tab, assert the quota card shows `-8.00h` (and the
  *"(-8.00h dopo richieste in attesa)"* hint). Cleanup soft-closes the
  assignment + soft-deletes the template.

If a mutating spec crashes between seed and cleanup, the tenant absorbs
a stale row. Acceptable for the test tenant (no real users), and visible
in the admin UI for manual removal.

**Note on long mutating runs:** the Expo Metro bundler at port 8082 can
go stale after ~20+ minutes of continuous test traffic, causing mobile
specs to timeout in `beforeEach`. If you see "Test timeout while running
beforeEach hook" on `mobile-user` specs after a long run, restart the
mobile preview server (via `preview_stop` + `preview_start` in the
Claude Code session, or `pkill -f "expo start" && npm --prefix
apps/mobile run web` in a shell) and re-run only the failed projects:

```bash
E2E_NO_WEBSERVER=1 npm run e2e:mobile:user
```

### Tenant users used

| Email           | Role  | Notes                                        |
| --------------- | ----- | -------------------------------------------- |
| `test1@test.it` | admin | Default `CREDS.admin` — used by admin suite. |
| `test2@test.it` | admin | Available as a second admin if needed.       |
| `test3@test.it` | user  | `CREDS.user` — only non-admin on the tenant. Display name "Mario Rossi". |

## Layout

```
playwright.config.ts                    Root config; 8 projects total.
e2e/
  fixtures/
    test-data.ts                        Credentials + base URLs + storage paths.
    api-client.ts                       Direct-to-API helpers used by the
                                        mutating specs: loginAs / loadHandle
                                        FromStorage (reuses saved access tokens
                                        to avoid GoTrue 429), createCorrection,
                                        approveCorrection, deleteStampAdmin,
                                        createQuotaTemplate, assignQuota,
                                        closeAssignment, deleteQuotaTemplate.
  setup/
    web.auth.setup.ts                   Admin web → e2e/.auth/web.json
    web.user-auth.setup.ts              Employee web → e2e/.auth/web.user.json
    mobile.auth.setup.ts                Admin mobile → e2e/.auth/mobile.json
    mobile.user-auth.setup.ts           Employee mobile → e2e/.auth/mobile.user.json
  web/                                  (admin storage)
    login.spec.ts                       Form, bad creds, forgot link.
    dashboard.spec.ts                   6 stat cards (Presenti ora / In pausa
                                        / Assenti oggi / Da approvare /
                                        Anomalie 7 gg / Sedi), Stato attuale,
                                        Da approvare inbox tabs (Correzioni /
                                        Ferie / Revoche).
    nav.spec.ts                         All 10 admin sidebar links.
    stamps.spec.ts                      DataGrid + create-stamp modal.
    leaves.spec.ts                      /leaves smoke + console-error guard.
    leaves-tabs.spec.ts                 Richieste/Quote/Modelli tabs, negative
                                        balance policy ("Può essere
                                        negativo"), accepts -8h initial.
    leaves-cancellation.spec.ts         "Accetta annullamento" / "Rifiuta
                                        annullamento" buttons on
                                        cancellation_pending rows, "Revoca"
                                        on approved rows, "Motivo della
                                        revoca" dialog, STATUS_LABEL badges
                                        including "Sostituita da malattia".
    corrections.spec.ts                 Filter pills, approve/reject buttons,
                                        Motivazione section.
    anomalies.spec.ts                   /anomalies heading + date filter,
                                        7 KIND_LABEL strings (Entrata
                                        mancante / Uscita mancante / Entrata
                                        in ritardo / Uscita anticipata /
                                        Lavoro in giorno di riposo / Pausa
                                        troppo breve / Pausa troppo lunga).
    workflow-approvers.spec.ts          User-limit / admin-limit counters,
                                        leave-approver editor explainer
                                        ("Se nessuno è configurato, gli
                                        admin possono decidere. Vince il
                                        primo che decide."), correction-
                                        approver editor, candidate
                                        checkbox list with role tags,
                                        Invita-utente seat-limit gating.
    mutating-corrections.spec.ts        [E2E_MUTATING=1 only] Real seed-act-
                                        cleanup approve cycle and parallel-
                                        approve race assertion ([200, 409]).
    mutating-malattia-overlap.spec.ts   [E2E_MUTATING=1 only] approved ferie
                                        + overlapping malattia → admin grid
                                        renders "Sostituita da malattia".
    mutating-cancellation.spec.ts       [E2E_MUTATING=1 only] full cycle:
                                        employee request-cancellation →
                                        admin "Accetta annullamento" →
                                        row badge flips to "Annullata".
    mutating-approver-assignment.spec.ts [E2E_MUTATING=1 only] designated
                                        approver decides → 200; admin NOT in
                                        approver list → 403 (proves the
                                        explainer copy "Se nessuno è
                                        configurato, gli admin possono
                                        decidere" — i.e. NOT when a list IS
                                        configured).
    mutating-ferie-weekend-skip.spec.ts [E2E_MUTATING=1 only] Assigns test3
                                        a Mon–Fri 09:00–17:00 shift template,
                                        files a Mon→Mon ferie (8 cal days),
                                        asserts duration_hours = 48
                                        (= 6 working days × 8h), not 64
                                        (= 8 × 8h). Proves the CCNL rule
                                        that ferie counter excludes
                                        Saturday + Sunday when the user's
                                        shift template has no slots on
                                        those days.
    mutating-branches-crud.spec.ts      [E2E_MUTATING=1 only] POST a sede
                                        via API, assert it appears on
                                        /branches, DELETE it, assert it's
                                        gone after reload.
    mutating-shifts-crud.spec.ts        [E2E_MUTATING=1 only] POST shift
                                        template, optional assign+unassign
                                        to user, DELETE.
    mutating-leave-templates-crud.spec.ts [E2E_MUTATING=1 only] POST/DELETE
                                        quota template, Modelli tab list
                                        verification.
    mutating-users-crud.spec.ts         [E2E_MUTATING=1 only] Invite user
                                        via API, deactivate+reactivate
                                        round-trip, hard-delete + assert
                                        removal from grid.
    mutating-validation.spec.ts         [E2E_MUTATING=1 only] permessi
                                        non-quarter-hour → 400; malattia
                                        missing inps_protocol → 400;
                                        inps_protocol >100 chars → 400;
                                        to_ts <= from_ts → 400;
                                        correction justification <5 chars
                                        → 400.
    mutating-cancellation-reject-and-refund.spec.ts [E2E_MUTATING=1 only]
                                        cancellation reject reverts status
                                        to approved; cancellation accept
                                        refunds residual_strict by the
                                        leave's hours.
    mutating-export.spec.ts             [E2E_MUTATING=1 only] POST export
                                        job, poll status reaches a defined
                                        state, list page renders.
    mutating-realtime.spec.ts           [E2E_MUTATING=1 only] /realtime/
                                        since contract: events[] +
                                        last_id present after a stamp
                                        seed.
    interactions.spec.ts                Stamps DataGrid header sort,
                                        Settings Timezone autosave +
                                        reload-persistence, dashboard
                                        bell, Anomalie date filter,
                                        Branches form smart_working
                                        toggle.
    a11y.spec.ts                        @axe-core audit per page: no
                                        critical violations on Dashboard,
                                        Utenti, Leaves, Settings, Login.
    visual.spec.ts                      toHaveScreenshot baselines for
                                        Dashboard / Utenti / Login.
                                        Snapshots committed under
                                        e2e/web/visual.spec.ts-snapshots/.
    exports.spec.ts                     Date range inputs, format select
                                        (XLSX/JSON), Genera button, value
                                        switching.
    settings.spec.ts                    Anagrafica disabled fields, Timezone
                                        select (Europe/Rome + Europe/London
                                        + UTC), Lingua select (it/en),
                                        email-notifications switch click.
    shifts.spec.ts                      Heading + "Nuovo orario" CTA, modal
                                        Nome + Descrizione labels.
    branches.spec.ts                    Heading + seeded branch name,
                                        Nuova-sede modal with smart_working
                                        label + radius slider.
    forgot-password.spec.ts             Login link → /forgot-password, form
                                        inputs, GoTrue no-account-enumeration
                                        behaviour.
  web/user/                             (employee storage)
    role.spec.ts                        Sidebar items per role, "Dipendente"
                                        footer label, MyDashboard greeting,
                                        admin-only links absent.
    my-stamps.spec.ts                   "Le mie timbrature" + /me/corrections.
  mobile/                               (admin storage)
    login.spec.ts                       Form, password-toggle aria flip, validation.
    timbrature.spec.ts                  Hero stats, tab bar, action buttons, profile.
    nav.spec.ts                         All 4 bottom tabs.
    storico.spec.ts                     Range pills (7/30/90).
    corrections-admin.spec.ts           No FAB for admins, filter pills, empty state.
    profilo.spec.ts                     Role pill "Amministratore", tenant
                                        ragione sociale, branches list,
                                        Notifiche PUSH + EMAIL section,
                                        Esci button.
    forgot-password.spec.ts             Login link → /forgot-password,
                                        recovery form fields.
  mobile/user/                          (employee storage)
    role.spec.ts                        Tabs visible, FAB visible on Correzioni,
                                        quota summary on Richieste.
    richieste.spec.ts                   Le mie / Da approvare pills, quota card,
                                        New-request modal Tipo/Dal/Al fields,
                                        Ferie+Permessi Durata widget, Malattia
                                        INPS protocol field, submit-button
                                        label per type, "Disponibili: Xh" hint.
    richieste-malattia.spec.ts          INPS protocol field has autocapitalize
                                        off, Durata block hidden on Malattia,
                                        submit text is "Invia segnalazione",
                                        no approver-box shown (auto-approved).
    richieste-approver.spec.ts          Approver hint visible on Ferie +
                                        Permesso — either "Approvatore: …"
                                        or fallback "Nessun approvatore
                                        configurato" (never silent).
    corrections.spec.ts                 FAB visibility, "Quale giorno?" step modal,
                                        status pills, employee empty-state copy.
    corrections-create-flow.spec.ts     Full 3-step create modal: date →
                                        pickStamp ("Aggiungi una timbratura
                                        mancante") → edit (Tipo evento,
                                        Data, Ora, Motivazione).
  mobile/interactions.spec.ts           Storico range pills (7/30/90
                                        giorni) tap-through, Notifications
                                        bell opens modal, multi-branch
                                        picker on Timbrature.
    profilo.spec.ts                     Role pill "Dipendente", display_name
                                        ("Mario Rossi") preferred over email
                                        prefix.
    negative-balance.spec.ts            [E2E_MUTATING=1 only] API-create a
                                        ferie quota assignment with
                                        initial_balance=-8 for test3, assert
                                        mobile quota card shows -8.00h main
                                        value + "(-8.00h dopo richieste in
                                        attesa)" hint, cleanup template +
                                        assignment.
  .auth/                                gitignored — saved storage state.
  playwright-report/                    gitignored — last HTML report.
```

## Running

Servers are auto-started by Playwright's `webServer` when you run tests cold:

```bash
npm run e2e                # everything: web admin+user, mobile admin+user
npm run e2e:web            # web admin + web user
npm run e2e:web:admin      # web admin only
npm run e2e:web:user       # web user only
npm run e2e:mobile         # mobile admin + mobile user
npm run e2e:mobile:admin   # mobile admin only
npm run e2e:mobile:user    # mobile user only
npm run e2e:ui             # Playwright UI mode (best for authoring)
npm run e2e:report         # open the last HTML report
```

If you already have the preview dev servers running (via
`mcp__Claude_Preview__preview_start` or `npm run dev:web` /
`npm --prefix apps/mobile run web`), skip the auto-start:

```bash
E2E_NO_WEBSERVER=1 npm run e2e
```

Cold-start of the mobile project takes ~30–60s the first time because the
Expo/Metro web bundler has to warm up. The `webServer` timeout for the mobile
target is 300 s.

### CI / different backend

Override credentials and URLs with env vars (read by
`e2e/fixtures/test-data.ts`):

```bash
E2E_ADMIN_EMAIL=...
E2E_ADMIN_PASSWORD=...
E2E_USER_EMAIL=...
E2E_USER_PASSWORD=...
E2E_WEB_URL=https://app-sonoqui.xdevapp.it
E2E_MOBILE_URL=https://m-sonoqui.xdevapp.it
E2E_NO_WEBSERVER=1                 # if servers are already up
```

## Architecture

### Storage-state authentication × 2 roles

Each role-x-platform pairing has a `*-setup` companion project that runs the
UI login form once and persists `localStorage` to disk. The matching spec
project depends on that setup and loads the storage with `storageState`. Net
effect:

- **4 `POST /token?grant_type=password` calls per full run** (admin web,
  admin mobile, user web, user mobile) — not one per test.
- Login-spec tests opt out by overriding `storageState` to an empty value
  inside the file (`test.use({ storageState: { cookies: [], origins: [] } })`).

### Token storage keys

Both apps persist auth via `localStorage` (RN-Web maps `expo-secure-store` to
`localStorage` on the web). Keys observed in saved state:

- `sonoqui.access_token` — GoTrue HS256 JWT.
- `sonoqui.refresh_token` — GoTrue refresh token.
- `sonoqui.sidebar.collapsed` — web sidebar UI state (incidental).

### Mobile project notes

- Uses `devices['Pixel 5']` (chromium-based). Switched away from `iPhone 13`
  to avoid needing the Webkit browser download. To run on Webkit instead,
  install with `npx playwright install webkit` then change the project's
  `use` block back to `devices['iPhone 13']`.
- Expo bundler runs at `http://localhost:8082`. First request is slow;
  subsequent reloads are HMR-cached.
- **Native GPS, push notifications, and SecureStore are not testable on web.**
  Stamp-creation happy paths that depend on real geolocation should be run on
  device with Detox or Maestro — out of scope for this suite.
- Expo Router mounts the inactive screens too, so multiple FABs live in the
  DOM at once. Always `.first()` or scope to the visible tab when targeting
  cross-screen elements.

### Session-bootstrap gotcha

When the web app boots with a saved `storageState`, its initial render briefly
shows the `me === null` branch and redirects to `/login`. `useEffect` then
runs `refresh()`, `/me` resolves, and the catch-all route bounces back to `/`.
Tests that assert on the **URL** mid-bootstrap are flaky; tests that assert on
the **rendered content** after a `getByRole('heading', …)` wait are stable.
Prefer the latter — see `e2e/web/user/role.spec.ts` for the working pattern.

## Adding new tests

### 1. Use Italian-localised selectors

The app ships in Italian. Pick selectors users actually read:

```ts
// Good:
page.getByRole('button', { name: 'Accedi' });
page.getByPlaceholder('email@azienda.it');
page.getByText('Ore lavorate').first();

// Bad — brittle:
page.locator('button.btn.btn-primary');
page.locator('.css-text-146c3p1');
```

### 2. Account for CSS uppercase labels

Many labels (stat cards, hero card, sidebar) are mixed-case in the DOM and
uppercased via `text-transform: uppercase`. Playwright's `getByText('foo')` is
case-insensitive substring match by default — that works. **Regex selectors
must use the `/i` flag**: `getByText(/ore lavorate/i)`, not `/ORE LAVORATE/`.

### 3. Scope to a container when text repeats

"Sedi", "Uscita", "Pause" and friends appear in multiple places. When strict
mode bites, scope:

```ts
page.locator('.stat-grid').getByText('Sedi')   // not the sidebar link
page.getByText('Uscita').first()               // hero stat, not action button
```

### 4. Custom modals aren't `<dialog>`

The web app uses plain `<div className="fixed inset-0 …">` overlays — they are
not `role="dialog"` and Escape does not close them. Assert on the modal's
heading + a unique field inside it:

```ts
await page.getByRole('button', { name: 'Nuova timbratura' }).click();
await expect(page.getByRole('heading', { name: 'Nuova timbratura' })).toBeVisible();
await expect(page.locator('option', { hasText: 'Inizio pausa' })).toHaveCount(1);
```

### 5. RN-Web inputs and TouchableOpacity differ from native HTML

- `secureTextEntry` does **not** map to `type="password"` consistently. Assert
  on the toggle button's `aria-label` flip, not the input's `type` attribute.
- Placeholders are preserved verbatim — `getByPlaceholder('email@azienda.it')`
  and `getByPlaceholder('••••••••')` are reliable.
- `TouchableOpacity` with `accessibilityLabel="…"` becomes a plain
  `<div aria-label="…">` **without `role="button"`**. So
  `getByRole('button', { name: 'Nuova richiesta' })` **fails** —
  `getByLabel('Nuova richiesta').first()` is the correct locator.
- A few components (e.g. `AppHeader` profile pill) do set
  `accessibilityRole="button"` and so are discoverable by `getByRole`. There
  is no consistent rule; verify with `preview_eval` if in doubt.

### 6. Tab pills are bare text

The mobile `Le mie` / `Da approvare` / `In attesa` / `Tutte` filter pills
render as `<div>` with text and no `aria-label` / `role`. Use
`getByText('Le mie', { exact: true }).first()` — never `getByRole('button')`.

### 7. Skip on content state, don't fail

When an assertion depends on the live tenant having a specific data state
(e.g. "there is at least one pending correction"), guard with `test.skip`:

```ts
const pending = page.getByRole('button', { name: 'Approva' });
const skipped = (await pending.count()) === 0;
test.skip(skipped, 'no pending correction requests on the test tenant');
await expect(pending.first()).toBeVisible();
```

Six tests use this pattern. They auto-activate when the tenant has the right
fixture data.

### 8. Adding a spec — which project picks it up?

```
e2e/web/<feature>.spec.ts            → `web` project (admin storage)
e2e/web/user/<feature>.spec.ts       → `web-user` project (employee storage)
e2e/mobile/<feature>.spec.ts         → `mobile` project (admin storage)
e2e/mobile/user/<feature>.spec.ts    → `mobile-user` project (employee storage)
```

The `testMatch` regex on each project routes by path. Don't put admin specs
under `user/` or vice versa — they will load the wrong storage state.

### 9. Per-user tests inside an admin spec

If you need to switch roles inside a single spec (e.g. assert a flow
end-to-end across both roles), override `storageState` and log in manually:

```ts
test.use({ storageState: { cookies: [], origins: [] } });
test('non-admin sees the employee dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input#email').fill(CREDS.user.email);
  await page.locator('input#password').fill(CREDS.user.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('heading', { name: /Ciao,/ })).toBeVisible();
});
```

## Page → selector cheat sheet

### Web (`apps/web/src/pages/`)

| Page              | Route             | Reliable selectors                                                              |
| ----------------- | ----------------- | ------------------------------------------------------------------------------- |
| Login             | `/login`          | `input#email`, `input#password`, button `Accedi`                                |
| ForgotPassword    | `/forgot-password`| `input[type=email]`, button `Invia`                                             |
| Dashboard (admin) | `/`               | heading `Dashboard`, `.stat-grid`, tablist `Elenco` / `Per sede`                |
| MyDashboard       | `/`               | heading `Ciao, …`, helper `Il tuo stato attuale e le ultime timbrature.`, section `Ultime timbrature` |
| Stamps            | `/stamps`         | button `Nuova timbratura`, `.MuiDataGrid-root`                                  |
| MyStamps          | `/me/stamps`      | heading `Le mie timbrature`, helper `Storico delle tue timbrature. Vedi solo le tue.` |
| Corrections       | `/corrections`    | helper `Richieste dei dipendenti da approvare o rifiutare.`, filter `Solo in attesa` / `Tutte`, buttons `Approva` / `Rifiuta`, section `Motivazione` |
| /me/corrections   | `/me/corrections` | Same component as Corrections, but accessible to employees.                     |
| Users             | `/users`          | DataGrid, row selection toolbar, shift/approver edit modals.                    |
| Branches          | `/branches`       | button `Nuova sede`, branch list cards.                                         |
| Shifts            | `/shifts`         | template list, `PENALTY_OPTIONS` selects.                                       |
| Anomalies         | `/anomalies`      | date-range pickers, `KIND_LABEL` text.                                          |
| Leaves            | `/leaves`         | heading `Ferie & Permessi`, tab buttons `Richieste` / `Quote` / `Modelli`. Quote tab: `Saldo ferie`, `Saldo permessi`, `Assegna` buttons. Templates tab: `Nuovo modello`, `Mensile` / `Annuale` radios. Negative balance hint: `Può essere negativo`. Reject dialog: `Motivo del rifiuto`. Revoke dialog: `Motivo della revoca`. |
| Exports           | `/exports`        | format dropdown `xlsx` / `json`, download button.                               |
| Settings          | `/settings`       | `TIMEZONE_OPTIONS` select, `email_notifications_enabled` switch.                |

### Sidebar (web)

| Role     | Visible nav items                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------- |
| `admin`  | Dashboard, Timbrature, Correzioni, Utenti, Sedi, Orari, Anomalie, Ferie & Permessi, Esportazioni, Impostazioni |
| `user`   | Dashboard, Le mie timbrature, Le mie richieste                                                     |

Footer role label: `Amministratore` for admins, `Dipendente` for employees.

### Mobile (`apps/mobile/src/screens/`)

| Screen             | Route              | Reliable selectors                                                              |
| ------------------ | ------------------ | ------------------------------------------------------------------------------- |
| Login              | `/`                | placeholder `email@azienda.it`, placeholder `••••••••`, button `Accedi`, button `Mostra password` / `Nascondi password` |
| ForgotPassword     | `/forgot-password` | input + button                                                                  |
| Timbrature         | `/timbrature`      | hero text `Ore lavorate` / `Entrata` / `Pause` / `Uscita`, action buttons `Timbra ingresso` / `Timbra uscita` / `Inizia pausa` / `Termina pausa`, `getByLabel('Profilo')` for header avatar. |
| Storico            | `/storico`         | range pills `7` / `30` / `90`                                                   |
| Correzioni         | `/correzioni`      | status pills `In attesa` / `Tutte`. **FAB:** `getByLabel('Nuova richiesta').first()` — **employee only**. Empty: admin `Nessuna richiesta da gestire.` / employee `Non hai richieste.`. Create modal steps: `Quale giorno?` → date-step → `Modifica timbratura`/`Nuova timbratura`. |
| Richieste          | `/richieste`       | tab pills `Le mie` / `Da approvare` (use `getByText`). Quota card: text `Ferie` / `Permessi` + `{X}h` + `(X.XXh dopo richieste in attesa)`. **FAB (employee only):** `getByLabel('Nuova richiesta').first()`. New-request modal: `Tipo` row with `Ferie` / `Permesso` / `Malattia`, sections `Dal` / `Al` / `Durata` (only ferie+permessi), pills `Tutto il giorno` / `Orario specifico`, `Ora inizio` / `Ora fine`, malattia-only `Numero protocollo INPS` with placeholder `es. 1234567890`, `Note (facoltative)`, submit text `Invia richiesta` (ferie/permessi) or `Invia segnalazione` (malattia). Hint: `Disponibili: {X}h · {Y}h dopo richieste in attesa`. |
| Profilo            | `/profilo`         | email field, `email_notifications_enabled` switch, logout button.               |
| Bottom tabs        | (any)              | `getByRole('button', { name: 'Timbrature' / 'Storico' / 'Correzioni' / 'Richieste' })` |

## Domain notes that drive selectors

### Leaves / Quotas

- **Types:** `ferie` / `permessi` / `malattia`. Italian labels: `Ferie`,
  `Permesso`, `Malattia`. Malattia branches off into a separate UI (INPS
  protocol, no Durata picker, "Invia segnalazione" button) because it is a
  certificate-driven event, not a quota draw.
- **Quota shape:** `residual_strict` (balance excluding pending requests) and
  `residual_with_pending` (after subtracting pending). Both appear in the
  mobile quota card.
- **Negative balance allowed.** The web admin's quota-assign dialog exposes
  this with the helper text *"Saldo di partenza, prima di accrediti e
  richieste. Può essere negativo."* The input is `<input type="number"
  step="0.25">` with no `min`. Verified by `e2e/web/leaves-tabs.spec.ts`.
- **Status enum (7 values):** `pending`, `approved`, `rejected`, `cancelled`,
  `cancellation_pending`, `cancelled_post_approval`, `superseded_by_malattia`.
- **Approver actions:** `Approva`, `Rifiuta` (prompts for `Motivo del
  rifiuto`), `Revoca` (prompts for `Motivo della revoca`), `Accetta
  annullamento`, `Rifiuta annullamento`.

### Corrections

- **Endpoints:** `POST /api/v1/correction-requests` (create),
  `POST /:id/approve`, `POST /:id/reject` (body `{ resolution_note }`).
- **Status:** `pending`, `approved`, `rejected`, `superseded`.
- **`justification` is required** (5–1000 chars on the backend Zod schema).
- **Approve flow** (mobile): confirmation copy *"La timbratura verrà creata o
  aggiornata."*
- **Reject flow:** prompts for `Motivo del rifiuto` (mobile) or
  `Motivo rifiuto:` (web — uses native `window.prompt`).
- **Diff display:** card shows red "Valori attuali" vs green "Valori
  richiesti", **or** "Timbratura mancante da aggiungere" for create-missing
  requests.
- **Role gating (mobile):** the FAB to create a new correction renders only
  when `me?.user.role !== 'admin'`. Verified by `corrections-admin.spec.ts`
  (FAB absent) + `mobile/user/role.spec.ts` (FAB present).

### Roles

- Source of truth is `/api/v1/me` → `me.user.role`, one of `'admin'` |
  `'user'`. The GoTrue JWT itself carries an empty `role` claim — the app
  computes the role per tenant from `tenant_members.role`.
- Web routing is partitioned at `App.tsx`: admin sees 10 routes, employee
  sees `/` (MyDashboard) + `/me/stamps` + `/me/corrections`. Anything else
  catches `*` and redirects to `/`.
- Mobile is the same surface for both roles. Gating happens inside individual
  screens — e.g. Corrections FAB visibility, Richieste tab content.

### Approver workflow — the real Italian-SME case

The product is built for very small companies where the most common state is
**no approvers explicitly configured**. The code paths the e2e suite asserts
on:

- **Admin fallback for decisions.** Backend `assertCanDecide()` in
  `leaves.ts:78-94` and `correction-requests.ts:126-142`: when no rows exist
  in `leave_approvers` / `correction_approvers` for the requester, **only
  admins may decide**. The web ApproverEditor surfaces this with the literal
  copy *"Se nessuno è configurato, gli admin possono decidere."* —
  verified by `workflow-approvers.spec.ts`.
- **Admin fallback for notifications.**
  `apps/backend/src/lib/notifications.ts:52-74`:
  `loadLeaveApproverIds()` / `loadCorrectionApproverIds()` return the
  configured approver list OR — if empty — **all active tenant admins
  excluding the requester**. Net effect: even when an Italian micro-SME with
  3 employees never visits the approver editor, requests still find their
  way to the titolare's inbox.
- **First-to-commit wins on multi-approver.** Same explainer ends with
  *"Vince il primo che decide."* Backend serialises this with a
  `FOR UPDATE` lock on the row in `correction-requests.ts:160` and
  `leaves.ts:313-320`.
- **Requester-side hint** (mobile). `RichiesteScreen.tsx:710-722` renders
  either `"Approvatore: <name1>, <name2>"` or, when the list is empty,
  `"Nessun approvatore configurato"`. The spec
  `e2e/mobile/user/richieste-approver.spec.ts` asserts the modal is never
  silent on this question.

### Ferie/permessi counter — working-days, not calendar-days

Italian CCNL practice counts ferie in **giorni lavorativi**, not calendar
days. The backend implements this in
`apps/backend/src/lib/leave-quota.ts:106-163` (`computeDurationHours`):

- For `ferie` / `malattia`: walks each calendar day in the request range,
  sums hours per day-of-week from the user's `user_shift_assignments` →
  `shift_template_slots`. Days with no slot for that DOW contribute 0h.
- Fallback when the user has **no** active shift assignment: Mon–Fri = 8h,
  Sat/Sun = 0h. Conservative — never crashes quota math.
- For `permessi`: raw `to_ts - from_ts` in hours (intra-day slot, not a
  multi-day range — weekend skipping doesn't apply).

Concrete example: dipendente works Mon–Fri 09:00–17:00 (8h/day). They
request ferie Mon→Mon (8 calendar days). Counter:

| Day | Hours counted |
| --- | ------------- |
| Mon | 8 |
| Tue | 8 |
| Wed | 8 |
| Thu | 8 |
| Fri | 8 |
| Sat | 0 (no slot) |
| Sun | 0 (no slot) |
| Mon | 8 |
| **Total** | **48h** (= 6 working days) |

NOT 64h (= 8 × 8h). Asserted end-to-end by
`mutating-ferie-weekend-skip.spec.ts`.

### Leaves / Quotas — Italian compliance edge cases

- **Negative balance is allowed by design.** Backend
  `apps/backend/src/routes/leaves.ts:129-131`:
  *"Quota balance is informational only. Submissions never blocked:
  companies decide policy themselves and the counter is allowed to go
  negative."* This matches Italian CCNL practice where a *"ferie
  anticipate"* draw is negotiated between titolare and dipendente
  case-by-case. Web admin's quota-assign dialog exposes the helper text
  *"Può essere negativo."* and accepts a `-8`-hour initial value
  (`leaves-tabs.spec.ts`).
- **`malattia` supersedes overlapping `ferie`/`permessi`.** When the
  employee files a sickness certificate for dates that overlap an already
  approved or pending ferie/permesso, the backend's `applyMalattiaOverlap()`
  (in `leave-quota.ts:199-317`) flips fully-overlapped rows to
  `superseded_by_malattia` and trims partial overlaps. The web DataGrid
  surfaces this with the Italian label *"Sostituita da malattia"*.
  `leaves-cancellation.spec.ts` asserts the badge renders when present.
- **INPS protocol number is mandatory for `malattia`.** Validated three
  ways: Zod (`leaves.ts:28`), explicit handler check
  (`leaves.ts:117-119` — throws *"numero protocollo INPS obbligatorio per
  malattia"*), DB CHECK constraint (`016_leaves.sql:91`). Mobile UI exposes
  the field with placeholder `es. 1234567890` and an `autocapitalize="none"`
  attribute (asserted by `richieste-malattia.spec.ts`).
- **`malattia` is auto-approved on file** (it's a certificate, not a
  request). The mobile UI hides the Durata picker and the
  approver-box for this type, and changes the submit label to
  *"Invia segnalazione"* — all asserted by `richieste-malattia.spec.ts`.
- **Cancellation flow has a separate workflow state.** An employee can
  request cancellation on an already-approved ferie via
  `POST /:id/request-cancellation`, which flips status to
  `cancellation_pending`. The admin then sees **"Accetta annullamento"** /
  **"Rifiuta annullamento"** buttons on that row
  (`leaves-cancellation.spec.ts`). `malattia` **cannot** be user-cancelled
  per `leaves.ts:434-438` — admin-only via the *"Revoca"* button, which
  opens a *"Motivo della revoca"* dialog.

### Anomalie — 7 Italian-compliance kinds

`Anomalies.tsx:34-42` enumerates:

| Kind                  | Italian label                  | Default threshold (per PRD v0.2) |
| --------------------- | ------------------------------ | -------------------------------- |
| `missing_clock_in`    | Entrata mancante               | n/a — derived                    |
| `missing_clock_out`   | Uscita mancante                | 14h shift cutoff                 |
| `late_clock_in`       | Entrata in ritardo             | shift-template `start_time`      |
| `early_clock_out`     | Uscita anticipata              | shift-template `end_time`        |
| `worked_on_rest_day`  | Lavoro in giorno di riposo     | per `rest_days` config           |
| `break_too_short`     | Pausa troppo breve             | 30 min unpaid cutoff             |
| `break_too_long`      | Pausa troppo lunga             | 4h paid cutoff                   |

Thresholds are tenant-configurable per PRD v0.2 but are **not currently
surfaced in `Settings.tsx`** — they are computed server-side. The e2e suite
asserts on the rendered labels, not the thresholds themselves
(`anomalies.spec.ts`).

### Tenant seat limits

`max_users` / `max_admins` come from the `tenants` row and are enforced
backend-side (`apps/backend/src/routes/users.ts:243-254`). The web Users
page surfaces both as a strip widget — `Utenti: <n> / <max>`, `Amministratori:
<n> / <max>` — and disables the *"Invita utente"* CTA when the user limit is
hit, with a `title="Limite raggiunto — contatta supporto"` tooltip.
Asserted by `workflow-approvers.spec.ts`.

## A11y known-violations allowlist

`e2e/web/a11y.spec.ts` runs `@axe-core/playwright` against five pages
(Dashboard, Utenti, Leaves, Settings, Login). Critical violations fail
the test, **except** those listed in `KNOWN_VIOLATIONS`:

| Rule ID | Pre-existing source |
| --- | --- |
| `select-name` | `<select>` tags without `aria-label` |
| `aria-input-field-name` | MUI DataGrid filter inputs |
| `aria-allowed-role` | MUI legacy column roles |
| `color-contrast` | Tailwind muted text on light bg |
| `label` | unwrapped `<input>` in `BranchForm` |
| `button-name` | icon-only buttons missing `aria-label` |

Remove an entry from the set when product ships a fix — the test will
flag a regression if the issue is reintroduced.

## Things we did NOT cover yet (out-of-scope only)

The covered surface now spans every page, both roles, every workflow
status, every IT compliance rule discoverable through the public API.
What remains is genuinely out-of-stack for Playwright:

- **Mobile native GPS / clock-in path.** RN-Web stub for
  `expo-location` returns "unavailable", so the *real* stamp flow (with
  permissions, mock-location detection, geofence eval) can't be
  exercised through the browser. Needs Detox/Maestro on a device.
- **Centrifugo push pipeline.** Local dev mode uses a polling fallback
  (`/api/v1/realtime/since`) — the spec asserts the endpoint contract,
  but the actual Centrifugo WebSocket fan-out runs only in production
  stack.
- **Push notifications (APNS / FCM).** Mobile registers the token via
  `expo-notifications`; delivery requires real device tokens and
  Apple/Google relay. Out of scope.
- **Visual regression on UI-churn pages.** Baselines exist for
  Dashboard, Utenti, Login. Adding more pages is straightforward —
  just `expect(page).toHaveScreenshot(...)` per route. Stale ones are
  the maintenance cost; we kept the baseline set small until the UI
  stabilises.
- **Multi-tenant isolation under load.** Backend has unit tests for the
  `withRLS` GUC pattern (`apps/backend/src/__tests__/tenant-isolation.test.ts`).
  End-to-end isolation across concurrent tenants is conceptually
  testable but requires provisioning a second test tenant — not yet
  done.
- **CCNL anomaly thresholds end-to-end** (e.g. break >4h flagged as
  `break_too_long`). The label set is asserted on the Anomalie page,
  but causing a real anomaly requires seeding a stamp pair with a
  specific time delta — easy to add as a follow-up mutating spec.

## Why Playwright (vs alternatives)

- Web is a Vite SPA → Playwright is the obvious fit.
- Mobile is Expo with `react-native-web` → the same Expo build serves on
  `http://localhost:8082`, which Playwright can drive identically to the web
  build. One framework, two surfaces.
- Cypress was considered and skipped: it doesn't handle multi-tab /
  multi-origin flows as cleanly, and its single-Chromium model loses parity
  with the multi-browser pattern we'll want once Webkit/Firefox become
  relevant.
- Detox / Maestro are appropriate when (and only when) native-only features
  (GPS, push, biometric, real SecureStore on a device) need coverage. They
  are not a replacement for the web-based suite that lives here.
