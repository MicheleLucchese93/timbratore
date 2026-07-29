# Self-hosted Expo OTA updates — implementation guide

A project-agnostic runbook for adding **self-hosted over-the-air JS updates** to an
Expo (React Native) app, using [`expo-open-ota`](https://github.com/axelmarciano/expo-open-ota)
as the update server instead of EAS Update.

Written from a production deployment that has been running this exact setup since
June 2026 (multiple apps, same VPS, iOS + Android). Every gotcha listed below was
paid for once already.

**Placeholders used throughout** — replace with your own values:

| Placeholder | Meaning | Example |
|---|---|---|
| `<APP>` | short app slug used for container/volume names | `myapp` |
| `<OTA_HOST>` | public hostname of the OTA server | `ota.example.com` |
| `<EAS_PROJECT_ID>` | EAS project UUID (`app.json > extra.eas.projectId`) | `729f39a2-…` |
| `<EAS_OWNER>` | Expo account that owns the project | `acme-dev` |
| `<STACK_DIR>` | directory of your docker compose stack on the server | `/opt/myapp` |

---

## 1. What this gives you, and what it does not

**Gives you:** push a JavaScript/TypeScript-only change to installed apps in
~60 seconds, no TestFlight/Play review, on infrastructure you own. Bundles are
RSA code-signed. Rollback is a click in a self-hosted dashboard.

**Does not give you:** anything that touches native code. New/removed/bumped
native dependency, new config plugin, permission change, SDK upgrade, icon or
splash change, direct `ios/`/`android/` edit → **new binary, store review**.
OTA cannot bridge that gap, and the guide below builds a *gate* that stops you
from trying.

**Why self-host instead of EAS Update:** no per-MAU pricing, bundles and update
history stay on your own box, and the update endpoint lives on your own domain
(useful when a customer's network policy allowlists hosts). Cost: you own the
uptime, backups and key management.

### Architecture

```
  dev machine                              your VPS
  ───────────                              ────────
  edit src/…
      │
      ├─► fingerprint gate  (is this really JS-only?)
      │
      └─► eoas publish ─────────────────►  expo-open-ota container
             (signs bundle with              ├─ /manifest  ── serves update metadata
              private-key.pem)               ├─ /assets    ── bundle + static assets
                                             └─ /dashboard ── rollback UI
                                                    │
                     reverse proxy (Caddy/nginx) at https://<OTA_HOST>
                                                    │
                                                    ▼
                                           installed app (expo-updates)
                                           cold launch / warm foreground:
                                           fetch → verify signature → launch
```

The server resolves *channel → branch* by calling **Expo's own API** with an
access token. So you still need an EAS project; you just don't use EAS Update's
hosting.

---

## 2. Prerequisites

- An Expo app on SDK 50+ with an **EAS project id** (`npx eas init` if absent).
- A Docker host with a reverse proxy already terminating TLS (examples for Caddy
  and nginx below) and a DNS record for `<OTA_HOST>`.
- An **Expo personal access token** (account settings → Access Tokens). One
  account-scoped token covers every project owned by that account.
- `expo-updates` installed in the app: `npx expo install expo-updates`.

---

## 3. Server: the OTA container

Add to your `docker-compose.yml`. This is the exact working config; the only
project-specific values are the four placeholders.

```yaml
  ota-<APP>:
    image: ghcr.io/axelmarciano/expo-open-ota:v2.3.19   # pin the tag
    container_name: ota-<APP>
    platform: linux/amd64          # no arm64 image published; drop on x86 hosts
    restart: unless-stopped
    environment:
      PORT: "3000"
      BASE_URL: "https://<OTA_HOST>"
      EXPO_APP_ID: "<EAS_PROJECT_ID>"
      EXPO_ACCESS_TOKEN: "${OTA_EXPO_ACCESS_TOKEN}"
      JWT_SECRET: "${OTA_JWT_SECRET}"                   # openssl rand -hex 64
      ADMIN_PASSWORD: "${OTA_ADMIN_PASSWORD}"           # openssl rand -base64 32
      USE_DASHBOARD: "true"
      STORAGE_MODE: "local"                             # S3 also supported upstream
      LOCAL_BUCKET_BASE_PATH: "/data/updates"
      CACHE_MODE: "local"
      KEYS_STORAGE_TYPE: "local"
      PUBLIC_LOCAL_EXPO_KEY_PATH: "/data/keys/public-key.pem"
      PRIVATE_LOCAL_EXPO_KEY_PATH: "/data/keys/private-key.pem"
    volumes:
      - <APP>_ota_data:/data/updates       # published bundles — BACK THIS UP
      - ./ota/keys:/data/keys:ro           # signing keys, NOT in git
    networks:
      - gateway
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: '0.25'
```

128 MB / 0.25 CPU is comfortable: the server is idle except during a publish or a
manifest burst after a release.

### Code-signing keys

Generate **on your dev machine**, from the app directory:

```bash
npx expo-updates codesigning:generate \
  --key-output-directory credentials \
  --certificate-output-directory credentials \
  --certificate-validity-duration-years 10 \
  --certificate-common-name "<APP> OTA Code Signing"
```

That writes `credentials/{certificate.pem,public-key.pem,private-key.pem}`.

| File | Where it lives | In git? |
|---|---|---|
| `certificate.pem` | app repo — baked into the binary, verifies signatures | **yes** (needed at build time) |
| `private-key.pem` | dev machine (publisher) **and** server `<STACK_DIR>/ota/keys/` (chmod 600) | no |
| `public-key.pem` | server `<STACK_DIR>/ota/keys/` | no |

`.gitignore` pattern that gets this right:

```gitignore
*.pem
!credentials/certificate.pem
```

**Who signs what:** Expo code signing signs the **manifest**, and
`expo-open-ota` does it server-side — that is why the private key is mounted into
the container. `expo-updates` in the app verifies that signature against the
`certificate.pem` compiled into the binary. So the protection you get is: nobody
who lacks the private key can serve an update your app will run — a hijacked DNS
record, a MITM proxy, or a substituted CDN cannot. It is **not** protection
against your own OTA host being compromised, since the key lives there. If you
need that separation, keep the private key off the server and sign at publish
time only (upstream supports other `KEYS_STORAGE_TYPE` modes) — verify the
behaviour of your `eoas` version before relying on it.

### Bring-up

```bash
cd <STACK_DIR>
docker compose up -d ota-<APP>
docker compose ps ota-<APP>
docker logs ota-<APP> --tail 40
```

---

## 4. Reverse proxy — and the one rewrite that everybody misses

**⚠️ Biggest single gotcha in the whole setup.** The container serves bare
`/manifest` and `/assets`. The Expo client, however, is built to talk to
`<url>/api/manifest` and `<url>/api/assets`. If you point `updates.url` at
`https://<OTA_HOST>/manifest` some SDK/`eoas` combinations still request
`/api/…` internally and you get silent 404s that look like "OTA just doesn't
work". Fix it once at the proxy: publish `/api/*` and rewrite to bare paths.

Second gotcha: binaries built **before** you wired a channel send no
`expo-channel-name` header, and the server then can't resolve a branch. Default
the header at the proxy so those clients land somewhere sane.

**Caddy** (production-tested):

```caddy
<OTA_HOST> {
	rewrite /api/manifest /manifest
	rewrite /api/assets   /assets

	# Default channel for binaries shipped without the header.
	@no_channel not header Expo-Channel-Name *
	request_header @no_channel Expo-Channel-Name production

	reverse_proxy ota-<APP>:3000
}
```

**nginx** equivalent:

```nginx
map $http_expo_channel_name $ota_channel {
    ""      production;      # binaries built before OTA existed
    default $http_expo_channel_name;
}

server {
    listen 443 ssl http2;
    server_name <OTA_HOST>;
    # ssl_certificate … ssl_certificate_key …

    proxy_set_header Host              $host;
    proxy_set_header Expo-Channel-Name $ota_channel;

    location = /api/manifest { proxy_pass http://ota-<APP>:3000/manifest; }
    location   /api/assets   { proxy_pass http://ota-<APP>:3000/assets;   }
    location   /              { proxy_pass http://ota-<APP>:3000;          }
}
```

**Behind Cloudflare or any WAF:** turn **Bot Fight Mode / JS challenges OFF for
this hostname**. Neither `expo-updates` on the device nor the `eoas` publisher can
solve a JS challenge — they just get a 403 that reads like a server outage.

---

## 5. EAS side: create the channels *before* the first publish

**⚠️ Gotcha with a misleading error.** If the channel does not exist on EAS, the
OTA server fails with:

```
Error fetching channel mapping: unexpected end of JSON input
```

…and returns 500 to every client. Create channels (and same-named branches) up
front:

```bash
npx eas-cli channel:create staging
npx eas-cli channel:create production
```

Convention used here — pick two and stick to them:

| Channel | Audience |
|---|---|
| `staging` | TestFlight / Play Internal testing |
| `production` | App Store / Play production |

(`development` builds run Metro and never pull OTA.)

---

## 6. Client config

### 6.1 `app.json`

```jsonc
{
  "expo": {
    "runtimeVersion": "1",              // see §6.2 — a STATIC string, on purpose
    "updates": {
      "enabled": true,
      "fallbackToCacheTimeout": 10000,  // see §7 — native cold-launch wait
      "url": "https://<OTA_HOST>/api/manifest",
      "codeSigningCertificate": "./credentials/certificate.pem",
      "codeSigningMetadata": { "keyid": "main", "alg": "rsa-v1_5-sha256" },
      "requestHeaders": { "expo-channel-name": "production" }
    }
  }
}
```

### 6.2 `runtimeVersion`: static string, not the fingerprint policy

`runtimeVersion` is the **compatibility contract**: the binary sends its value,
the server only serves bundles stamped with the same value. Expo's
`{"policy": "fingerprint"}` computes it by hashing the native project.

**Use a hand-pinned static string instead** (`"1"`, `"2"`, …) unless your native
directories are fully reproducible and committed. Reason: the fingerprint is
recomputed independently at publish time and at build time. Any divergence
between your machine and the build machine — different `@expo/fingerprint`
version, a regenerated `ios/`/`android/` tree, a stray local file — produces two
different runtimeVersions, and the client then 404s on every manifest request
with no error message anywhere. A static string makes publish-time and build-time
values *identical by construction*.

The cost of a static string: **you must bump it by hand on every native change**,
or an old binary will happily download a bundle it cannot run. §8 builds an
automated reminder for exactly that.

### 6.3 Channel baked at build time — `app.config.ts`

The channel is a request header compiled into the binary. Drive it from an env
var so the same tree can produce a staging or a production build:

```ts
import type { ExpoConfig } from 'expo/config';
import appJson from './app.json' with { type: 'json' };

const base = (appJson as { expo: ExpoConfig }).expo;

// 1. OTA_CHANNEL if set (eas.json build profiles, or exported before a local build)
// 2. otherwise 'production' — a hand-made Xcode/Android Studio archive passes no
//    env var, and must never silently land on an internal-tester channel.
const otaChannel = process.env.OTA_CHANNEL ?? 'production';

export default (): ExpoConfig => ({
  ...base,
  updates: {
    ...(base.updates ?? {}),
    requestHeaders: {
      ...(base.updates?.requestHeaders ?? {}),
      'expo-channel-name': otaChannel,
    },
  },
});
```

With **EAS Build**, set `channel` per profile in `eas.json` and skip `OTA_CHANNEL`:

```jsonc
{
  "build": {
    "preview":    { "distribution": "internal", "channel": "staging" },
    "production": { "channel": "production", "autoIncrement": true }
  }
}
```

With **local builds**, `expo prebuild` bakes the value into:

- `ios/<App>/Supporting/Expo.plist` → `EXUpdatesRequestHeaders` → `expo-channel-name`
- `android/app/src/main/AndroidManifest.xml` → `UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY`

You can flip those two strings by hand to re-target an already-prebuilt tree
without a full `prebuild` — cheaper and less drift (see §9.2).

---

## 7. Apply behaviour: let native handle cold launch, JS handle warm foreground

This is where most hand-rolled OTA integrations go wrong. Decide *when* an update
becomes visible, and implement each case exactly once.

| Situation | Mechanism | Result |
|---|---|---|
| **Cold launch** (app was killed) | **native**: `EXUpdatesLaunchWaitMs` = `fallbackToCacheTimeout` = `10000` | splash holds up to 10 s, downloads, launches **into the new bundle** — one launch, no JS involvement |
| **Warm foreground** (resumed after ≥5 min backgrounded) | JS `AppState` hook (§7.1) | silent check → if new, show gate → fetch → `reloadAsync()` |
| Mid-session, app already open | — | never; deliberately |

**Anti-pattern to avoid: a cold-start JS gate.** Writing a
`checkForUpdateAsync()` + `fetchUpdateAsync()` block that runs on mount *races the
native background download that is already in flight*. Symptom: updates always
apply "one launch late", plus intermittent double reloads. The native
`LaunchWaitMs` path already solves cold launch — don't reimplement it in JS.

Values live in three places once prebuilt (all set from `app.json`):
`app.json > updates.fallbackToCacheTimeout`, `Expo.plist > EXUpdatesLaunchWaitMs`,
`AndroidManifest > EXPO_UPDATES_LAUNCH_WAIT_MS`.

### 7.1 The warm-foreground hook

`expo-updates` has no built-in foreground check, so this one hook is worth
writing. Guards that matter, in order of how much pain they save:

1. **Threshold** — only re-check after ≥5 min in background. Otherwise a glance
   at a notification yanks the user back into a reloaded app mid-task.
2. **Abort on timeout** — cap check+fetch (5 s). On timeout, abandon the apply:
   the downloaded bundle is already cached and native will use it next cold
   launch. Never reload out from under someone.
3. **`reloadAsync()` after the await, never synchronously inside the AppState
   listener** (see `expo/expo#16264`).
4. **Short-circuit `__DEV__` and `!Updates.isEnabled`.**
5. Show the gate *before* `fetchUpdateAsync`, so the UI stays continuously
   covered through the reload rather than flashing.

```ts
import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';

const THRESHOLD_MS = 5 * 60 * 1000;  // min. time backgrounded before re-check
const TIMEOUT_MS = 5000;             // ceiling on check+fetch

export function useUpdateGate() {
  const [applying, setApplying] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  const inFlight = useRef(false);
  const reloading = useRef(false);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    const onChange = (next: AppStateStatus) => {
      if (next === 'background') {
        // Record only a real background transition; ignore iOS 'inactive'.
        if (backgroundedAt.current == null) backgroundedAt.current = Date.now();
        return;
      }
      if (next !== 'active') return;

      const since = backgroundedAt.current;
      backgroundedAt.current = null;
      if (since == null) return;                       // first activation
      if (Date.now() - since < THRESHOLD_MS) return;   // too short
      if (inFlight.current) return;

      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      void (async () => {
        inFlight.current = true;
        try {
          timer = setTimeout(() => {
            timedOut = true;
            if (!reloading.current) setApplying(false);
          }, TIMEOUT_MS);

          const check = await Updates.checkForUpdateAsync();
          if (!check.isAvailable || timedOut) return;

          setApplying(true);                            // gate up before fetch
          const fetched = await Updates.fetchUpdateAsync();
          if (!fetched.isNew || timedOut) { setApplying(false); return; }

          reloading.current = true;
          await Updates.reloadAsync();                  // after the await
        } catch {
          /* offline / server down — keep running the current bundle */
        } finally {
          inFlight.current = false;
          if (timer) clearTimeout(timer);
          if (!reloading.current) setApplying(false);
        }
      })();
    };

    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  return { shouldBlockUI: applying };
}
```

Mount it at the root layout and render a splash-styled full-screen view while
`shouldBlockUI` — same background colour as the launch splash, spinner, one line
of copy ("Updating…"). Users read it as a continuation of launch, not a modal.

```tsx
const { shouldBlockUI } = useUpdateGate();
if (shouldBlockUI) return <UpdateGateScreen />;
```

If the gate can paint before i18n hydrates, hard-code a fallback string rather
than showing a translation key.

---

## 8. Publishing: `eoas` + a fingerprint safety gate

Publishing is one command — `eoas publish` — but running it bare will eventually
push a bundle that a shipped binary cannot execute. Wrap it.

The gate: `@expo/fingerprint` hashes the native project. Store the hash of the
*last native build* in a committed baseline file; before publishing, recompute and
compare. Equal → JS-only, safe. Different → native changed, refuse.

Save as `scripts/publish-ota.sh`, `chmod +x`:

```bash
#!/usr/bin/env bash
# JS-only OTA publish, gated on the native fingerprint.
#   ./scripts/publish-ota.sh              → staging
#   ./scripts/publish-ota.sh --production → production
#   ./scripts/publish-ota.sh --seed       → re-baseline the gate
#   ./scripts/publish-ota.sh --force      → publish despite a gate trip
set -euo pipefail

# Pin BOTH tools: a different @expo/fingerprint version = a different hash = a
# false gate trip.
EOAS_VERSION="2.3.19"
FINGERPRINT_VERSION="0.19.3"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE="${DIR}/.native-fingerprint.json"
PRIVATE_KEY="${DIR}/credentials/private-key.pem"
BRANCH="staging"; FORCE=0; SEED=0

while [ $# -gt 0 ]; do
  case "$1" in
    --production|--prod) BRANCH="production" ;;
    --staging)           BRANCH="staging" ;;
    --branch)            shift; BRANCH="${1:?--branch needs a value}" ;;
    --force)             FORCE=1 ;;
    --seed)              SEED=1 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

cd "${DIR}"
HASH="$(npx -y "@expo/fingerprint@${FINGERPRINT_VERSION}" fingerprint:generate . \
  | node -e 'let i="";process.stdin.on("data",d=>i+=d).on("end",()=>console.log(JSON.parse(i).hash))')"
RTV="$(node -e "console.log(require('./app.json').expo.runtimeVersion)")"
echo "    fingerprint    : ${HASH}"
echo "    runtimeVersion : ${RTV}"

if [ "${SEED}" = "1" ]; then
  node -e "require('fs').writeFileSync('${BASELINE}', JSON.stringify({hash:'${HASH}',runtimeVersion:'${RTV}',updatedAt:new Date().toISOString()},null,2)+'\n')"
  echo "==> Re-seeded ${BASELINE}. Commit it."
  exit 0
fi

BASE_HASH="$(node -e "try{console.log(require('${BASELINE}').hash)}catch{console.log('')}")"
if [ -n "${BASE_HASH}" ] && [ "${HASH}" != "${BASE_HASH}" ]; then
  echo "❌ Native fingerprint changed since the last native build." >&2
  echo "     baseline: ${BASE_HASH}" >&2
  echo "     current : ${HASH}" >&2
  echo "   Bump runtimeVersion, rebuild + submit, then --seed. Override: --force" >&2
  [ "${FORCE}" = "1" ] || exit 1
fi

[ -f "${PRIVATE_KEY}" ] || { echo "❌ Missing ${PRIVATE_KEY} — bundles must be signed." >&2; exit 1; }

# Stamp the bundle with its source commit; EXPO_PUBLIC_* is inlined by Metro.
export EXPO_PUBLIC_COMMIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

npx -y "eoas@${EOAS_VERSION}" publish \
  --platform all --branch "${BRANCH}" --nonInteractive --disableRepositoryCheck
```

`package.json`:

```jsonc
"scripts": {
  "ota:publish": "./scripts/publish-ota.sh",
  "ota:publish:prod": "./scripts/publish-ota.sh --production",
  "ota:seed-fingerprint": "./scripts/publish-ota.sh --seed"
}
```

Baseline file (`.native-fingerprint.json`, **committed**):

```json
{
  "hash": "ab1c44de6ab1a905d3ab7b3904e0ca973dd09cd4",
  "runtimeVersion": "1",
  "updatedAt": "2026-07-13T15:16:22.389Z"
}
```

Publisher prerequisites: logged into Expo (`npx eas login` as `<EAS_OWNER>`) or
`EXPO_TOKEN` exported — the server resolves channel→branch against Expo's API, so
the publisher must be authorised on the same project — plus
`credentials/private-key.pem` present locally.

Ship staging first, promote after smoke-testing:

```bash
npm run ota:publish        # staging
npm run ota:publish:prod   # production
```

### ⚠️ The fingerprint gate is advisory and fragile — re-seed, don't `--force`

`@expo/fingerprint` hashes the raw `ios/` + `android/` directories, so
**version-only edits flip the hash even though they are perfectly OTA-safe**:
`app.json > version`, `CFBundleShortVersionString` / `CFBundleVersion`,
`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`, Android `versionCode`. A pure-JS
change will then trip a gate whose baseline went stale two releases ago.

Correct response when the delta is only version strings or already-shipped native
code — confirm there is no new `package.json` dependency and no `app.json` plugin
change since the live binary, then:

```bash
npm run ota:seed-fingerprint && git commit -am "chore: re-seed OTA fingerprint baseline"
```

Reaching for `--force` "works" but leaves the baseline stale, so the next publish
lies to you too. **Re-seed after every native build and after every version bump.**
`runtimeVersion` is the real compatibility contract; the fingerprint is only a
proxy that reminds you to think.

---

## 9. Native rebuilds

### 9.1 When OTA is not enough

Any dependency bump (including `expo-*`), SDK upgrade, config-plugin
add/remove/change, permission/entitlement change, icon/splash/scheme/bundle-id
change, or direct `ios/`/`android/` edit.

```bash
# 1. Bump the contract so old binaries don't pull an incompatible bundle:
#    app.json  →  "runtimeVersion": "1"  →  "2"

# 2. Regenerate native projects with the OTA config baked in:
OTA_CHANNEL=staging npx expo prebuild --clean      # or OTA_CHANNEL=production

# 3. Build + submit (Xcode archive / AAB / EAS Build).

# 4. Once the new binary is live and boots, re-baseline the gate:
npm run ota:seed-fingerprint
git add .native-fingerprint.json app.json && git commit -m "chore: bump runtimeVersion + re-seed OTA baseline"
```

**Always prebuild before a native build** if `app.json`/`app.config.ts` is your
source of truth — that step is what writes the updates URL, signing certificate,
channel header and launch-wait into the native trees. A binary built from a stale
native tree is simply not OTA-enabled, and looks identical from the outside.

### 9.2 ⚠️ `prebuild --clean` reverts hand-made native edits

If your project keeps `ios/`/`android/` in git but regenerates them, keep an
explicit table of every manual native edit no config plugin reproduces, and
re-apply after each prebuild. Real examples from the source project:

| File | Manual edit to re-apply | Cost of forgetting |
|---|---|---|
| `android/app/build.gradle` | release `signingConfig` from `keystore.properties` | **prebuild resets release signing to the DEBUG keystore → Play rejects the AAB** |
| `ios/*/​*.entitlements` | `aps-environment` → `production` | prebuild writes `development` → production push silently dead |
| `ios/Podfile` | `post_install` tweaks (e.g. clearing `INSTALL_OWNER`/`INSTALL_GROUP`) | `pod install` fails on some hosts |
| `android/.../values/colors.xml` | brand `colorPrimary` | wrong splash/accent colour |

Promote each of these to a **config plugin** when you can; until then, the table is
the only thing standing between you and a rejected build. `git checkout HEAD --
<file>` restores files whose only diff versus HEAD *is* the manual edit.

### 9.3 First OTA-enabled build

The baseline you seed *before* expo-updates is wired into the native trees will
flip on the first prebuild. Expected. Seed again after that first build is live,
and the gate settles.

---

## 10. Operations

### Rollback

Dashboard at `https://<OTA_HOST>/dashboard` (password = `ADMIN_PASSWORD`): find the
branch's latest release, mark it rolled back. Devices fall back to the previously
cached bundle on next launch — or the binary's embedded bundle on a fresh
install. Reversible from the same screen.

### Backups

Published bundles live in the named volume. Back it up with the rest of the stack:

```bash
docker run --rm -v <APP>_ota_data:/src -v /backups/ota:/dst alpine \
  tar czf /dst/ota-<APP>-$(date +%Y%m%d).tgz -C /src .
```

Also back up (or escrow) `ota/keys/private-key.pem`: **lose it and you cannot
publish to any already-installed binary ever again** — signature verification is
pinned to the certificate baked into those binaries. Only a new store release
fixes that.

### Key rotation

1. Regenerate the keypair (§3) into `credentials/`.
2. Copy the new `private-key.pem` + `public-key.pem` to `<STACK_DIR>/ota/keys/`
   (600 on the private one), restart the container.
3. `npx expo prebuild` to re-bake the new `certificate.pem`; commit it.
4. **Rebuild and resubmit natively.** Field binaries trust the old certificate
   and will reject updates signed by the new key. Rotation is a store release,
   not a server operation — plan it that way.

### Health check

```bash
curl -i "https://<OTA_HOST>/api/manifest" \
  -H "expo-channel-name: production" \
  -H "expo-runtime-version: 1" \
  -H "expo-platform: ios" \
  -H "expo-protocol-version: 1"
```

200 = a bundle exists for that (channel, runtimeVersion, platform) triple.
404 = nothing published for that runtime. 500 = channel missing on EAS (§5) or
the access token is dead.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| App never picks up updates | binary built before OTA existed → no channel header | rebuild + reinstall; the proxy default (§4) only helps if the branch exists |
| Manifest 404s for every client | `runtimeVersion` mismatch between published bundle and binary | log `Updates.runtimeVersion` + `Updates.channel` from a release build; compare to the publish output |
| 500 `unexpected end of JSON input` | EAS channel does not exist | `npx eas-cli channel:create <name>` |
| Manifest 404 only via the public host, fine on the container | missing `/api/manifest` → `/manifest` rewrite | §4 |
| `eoas publish` auth error | publisher not logged in / stale `EXPO_TOKEN`, or the server's `EXPO_ACCESS_TOKEN` is revoked | re-auth both sides on the same project |
| `eoas publish` hangs or 403s | Cloudflare/WAF bot challenge on `<OTA_HOST>` | disable the challenge for that host; short-term, pin the origin IP in `/etc/hosts` for the publish |
| Gate trips on a pure-JS change | stale fingerprint baseline (version bumps flip the hash) | verify no dep/plugin delta, then re-seed — not `--force` (§8) |
| Update applies "one launch late" | a cold-start JS gate racing the native download | delete the cold-start gate; rely on `LaunchWaitMs` (§7) |
| Signature verification failures | server key and the binary's certificate are out of sync | keys on the server must be the pair whose `certificate.pem` was baked into that binary (§10) |

Debug from a **release** build (not Expo Go, not dev): log `Updates.isEnabled`,
`Updates.channel`, `Updates.runtimeVersion`, `Updates.updateId`, and the result of
`Updates.checkForUpdateAsync()`. Those five values identify nearly every failure
above in one shot.

---

## 12. Adoption checklist

Server, once:

- [ ] DNS + TLS for `<OTA_HOST>`; WAF challenges off for that host
- [ ] `ota-<APP>` compose service, env vars, data volume
- [ ] `/api/manifest` + `/api/assets` rewrites, default channel header
- [ ] signing keypair generated, private key on server (600) and dev machine
- [ ] volume in the backup rotation; private key escrowed
- [ ] `staging` + `production` channels created on EAS
- [ ] `curl` health check returns 200/404 (not 500)

App repo, once:

- [ ] `npx expo install expo-updates`
- [ ] `app.json` updates block; `runtimeVersion` static string
- [ ] `certificate.pem` committed, `*.pem` otherwise gitignored
- [ ] `app.config.ts` channel from `OTA_CHANNEL`; `eas.json` profile channels
- [ ] `fallbackToCacheTimeout: 10000` for the native cold-launch apply
- [ ] warm-foreground `useUpdateGate` + gate screen mounted at the root layout
- [ ] `scripts/publish-ota.sh` + npm scripts + committed baseline
- [ ] native-drift table written down (§9.2)

Per release, forever:

- [ ] JS-only change → `ota:publish` (staging) → verify → `ota:publish:prod`
- [ ] native change → bump `runtimeVersion` → prebuild → re-apply drift edits →
      build/submit → `ota:seed-fingerprint` → commit
- [ ] version bump without native change → re-seed the baseline

---

## 13. Security notes

- In the default layout above the signing private key lives **on the OTA host**
  (that is how the server signs manifests). Root on that box therefore means the
  ability to sign updates. Harden the host accordingly, and see §3 if you want
  the key kept off it.
- `ADMIN_PASSWORD` is the only thing between the internet and your rollback
  dashboard. Generate it randomly; consider an IP allowlist or proxy auth in
  front of `/dashboard`.
- `EXPO_ACCESS_TOKEN` is account-scoped: it can read and modify **every** project
  under `<EAS_OWNER>`. Treat it like a deploy key, rotate on staff change.
- OTA is an arbitrary-code-execution channel into every installed app. Anyone who
  can publish owns your users' devices to the limit of the app's permissions.
  Keep the private key and the Expo token out of shared CI logs, and use the
  staging channel as a mandatory first stop.
