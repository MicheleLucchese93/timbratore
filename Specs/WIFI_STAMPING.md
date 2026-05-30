# WiFi-based stamping — feature proposal

**Status:** 📋 PROPOSAL — not approved, not scheduled. Author: product dev, 2026-05-30.
**Decision owner:** to decide later whether to implement.
**Depends on:** the per-user `stamp_modes` feature (GPS / remote / none) — built separately. WiFi is the third mode added to that same enum.

---

## 1. Use case

A company associates its branch WiFi access point(s) with a branch. An employee can clock in/out **only while connected to that WiFi** — proving they are physically inside the branch. Offered as an **alternative to GPS geofencing**, chosen per user (a user's `stamp_modes` would include `wifi`).

This is attractive for indoor sites where GPS is unreliable (warehouses, basements, dense buildings).

## 2. How it fits the existing model

The per-user stamping feature stores `memberships.stamp_modes text[]` over `{gps, remote}`. WiFi adds a third value:

- `stamp_modes` allowed set becomes `{gps, remote, wifi}`.
- A user with `wifi` in their modes may stamp when connected to an enrolled branch AP.
- OR semantics: a user with `{gps, wifi}` passes if **either** the geofence OR the WiFi check passes.

WiFi is **mobile-only** — browsers cannot read a BSSID (see §6), so it never applies to web/remote stamping.

## 3. Data model

New table, BSSIDs scoped **per branch** (a WiFi is a property of a place, not a person):

```sql
CREATE TABLE branch_wifi_aps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  branch_id   uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  bssid       text NOT NULL,              -- access-point MAC, normalised lowercase aa:bb:cc:dd:ee:ff
  ssid        text,                       -- human label only, NOT the match key
  label       text,                       -- optional admin note ("Sede Milano - piano 1")
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, bssid)
);
-- RLS: tenant-scoped, same dual-guard pattern as other tenant tables
--   (auth.uid() membership + app.current_tenant_id). See project RLS notes.
```

Stamp payload gains `wifi_bssid` (+ optional `wifi_ssid`), read at the stamp moment only (same Art. 4 discipline as GPS — never in background).

## 4. Match on BSSID, never SSID

- **SSID** = the network *name* (`ACME-WiFi`). Trivially spoofable — an employee names a phone hotspot the same and stamps from home. **Never use as the match key.**
- **BSSID** = the access point's hardware MAC (`70:8c:f2:c9:eb:4e`). Hard to fake. **This is the match key.** Store SSID as a display label only.
- Multi-AP offices: enroll every AP's BSSID per branch (one row each). Match = reported BSSID ∈ branch's enrolled set.

## 5. Capture flow (admin)

The web app **cannot read a BSSID** (no browser WiFi API — confirmed: even macOS Terminal redacts it without Location permission). So:

- **Primary — mobile capture.** Admin opens the mobile app at the branch → Settings → "Registra WiFi" → app reads the current BSSID+SSID → binds it to a chosen branch → POSTs. Admin types nothing. Walk the floor, tap once per AP.
- **Fallback — manual web entry.** A text field for the BSSID (read off the router sticker). Error-prone; backup only.

## 6. Enforcement (server-side)

In `apps/backend/src/services/stamp-service.ts` `evaluateStamp`, when the user's modes include `wifi`:

- skip the geofence branch;
- require `body.wifi_bssid` to be present and ∈ the enrolled BSSIDs of the user's assigned branch(es);
- on miss → `ConflictError('WRONG_WIFI', ...)` (new error code).

Client reports the BSSID, so this is **client-trust** — a rooted/jailbroken device or patched build can lie. Same assurance level as the existing `is_mock_location` flag: a deterrent, not cryptographic proof. Optional future hardening: server-side public-egress-IP check (unspoofable from the device, but needs a static branch IP, breaks on CGNAT/mobile-data/VPN).

## 7. Native module spike result — 🟢 GO (pending on-device confirm)

Researched against live Expo SDK 56 docs (2026-05-30).

- **Module:** `@react-native-community/netinfo` v12 (Expo-supported). NOT `react-native-wifi-reborn`. v12.0.0 (Feb 2026) reads iOS WiFi via `NEHotspotNetwork`, requires RN 0.76+ (app is on 0.85.3, New-Architecture ✓).
- **API:** `NetInfo.configure({ shouldFetchWiFiSSID: true })` once, then `await NetInfo.fetch('wifi')` → `state.details.bssid` / `state.details.ssid`.
- **Only new config needed:**
  - iOS: add `"com.apple.developer.networking.wifi-info": true` to `app.json` → `ios.entitlements`, AND enable the **"Access WiFi Information"** capability on App ID `app.cisono.cisono` in the Apple Developer portal.
  - Android: nothing — `ACCESS_FINE_LOCATION` is already declared.
  - Location permission is already requested at runtime (`apps/mobile/src/lib/acquire-location.ts`) and `NSLocationWhenInUseUsageDescription` is already set.
  - `app.config.ts` only overrides API URLs (`...base`), so editing `app.json` is effective.
- **⚠️ GOTCHA:** `bssid` returns `null` or the sentinel `02:00:00:00:00:00` if entitlement / location permission / `shouldFetchWiFiSSID` are not ALL satisfied. Must verify a **real** BSSID on a **physical device** (simulator/emulator have no real WiFi).
- **Fallback:** if NetInfo misbehaves on iOS, a custom Expo config plugin wrapping `NEHotspotNetwork.fetchCurrent` (the project already ships a config plugin: `apps/mobile/plugins/withInstallGroupFix`).

## 8. Compliance (Italy / GDPR / Art. 4)

- BSSID/SSID read only at the stamp moment, never in background — consistent with the existing GPS policy.
- Arguably a **better** privacy posture than GPS: no coordinates are computed or stored, only "which AP am I attached to."
- Still presence-verification data → must be covered in the DPIA and the Art. 4 documentation.
- Retention: mirror the GPS policy (keep `branch_id`, redact raw BSSID after the GPS-redaction window).

## 9. Effort & touch points (if approved)

- **DB:** migration for `branch_wifi_aps` + RLS; add `wifi` to the `stamp_modes` CHECK constraint.
- **shared:** add `'wifi'` to `StampMode`; add `WRONG_WIFI` error code.
- **backend:** `evaluateStamp` wifi branch; `wifi_bssid`/`wifi_ssid` on `StampBody`; branch AP CRUD endpoints; `me.ts` returns each branch's enrolled BSSIDs.
- **web:** branch AP list/delete UI in Branches page; "wifi" checkbox in the user modes editor; admin hint pointing to the mobile capture flow.
- **mobile:** install `@react-native-community/netinfo`; `acquire-wifi.ts`; read BSSID at stamp when `wifi` mode; new admin Settings → "Registra WiFi" screen.
- **tests/docs:** e2e (web AP CRUD, mobile wifi gate) + update the in-app manual `apps/web/src/pages/Manual.tsx`.
- **device prerequisite:** Apple "Access WiFi Information" capability + an on-device test before shipping.

## 10. Open questions for the decision

1. Worth the added iOS entitlement + native dependency + on-device QA burden for the target SME segment?
2. Single-AP assumption OK for most branches, or must multi-AP enrollment be first-class from day one?
3. Pair with the server-side public-IP check for stronger proof, or accept client-trust parity with GPS+mock?
