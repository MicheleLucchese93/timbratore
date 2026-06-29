import type { ExpoConfig } from 'expo/config';
import appJson from './app.json' with { type: 'json' };

const base = (appJson as { expo: ExpoConfig }).expo;

// OTA channel baked into the binary at build time. The OTA server (expo-open-ota)
// reads the `expo-channel-name` request header to decide which branch to serve a
// given binary from. Resolution order:
//   1. OTA_CHANNEL (explicit) — set by eas.json build profiles, or exported
//      manually before a local `expo prebuild` / native build.
//   2. Otherwise 'production'. Xcode / Android Studio archives done by hand pass
//      no env var, so they MUST default to the production audience — never to an
//      internal-tester channel.
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
  extra: {
    ...(base.extra ?? {}),
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? base.extra?.apiBaseUrl,
    authBaseUrl: process.env.EXPO_PUBLIC_AUTH_BASE_URL ?? base.extra?.authBaseUrl,
  },
});
