/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** PostHog project API key. Absent → analytics stays a no-op (see src/lib/analytics.ts). */
  readonly PUBLIC_POSTHOG_KEY?: string;
  /** PostHog ingestion host. Defaults to the EU cloud; override only to point at a proxy. */
  readonly PUBLIC_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
