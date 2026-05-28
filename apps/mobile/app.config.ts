import type { ExpoConfig } from 'expo/config';
import appJson from './app.json' with { type: 'json' };

const base = (appJson as { expo: ExpoConfig }).expo;

export default (): ExpoConfig => ({
  ...base,
  extra: {
    ...(base.extra ?? {}),
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? base.extra?.apiBaseUrl,
    authBaseUrl: process.env.EXPO_PUBLIC_AUTH_BASE_URL ?? base.extra?.authBaseUrl,
  },
});
