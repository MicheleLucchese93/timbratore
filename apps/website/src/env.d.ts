/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** PostHog project API key. Absent → analytics stays a no-op (see src/lib/analytics.ts). */
  readonly PUBLIC_POSTHOG_KEY?: string;
  /** PostHog ingestion host. Defaults to the EU cloud; override only to point at a proxy. */
  readonly PUBLIC_POSTHOG_HOST?: string;
  /**
   * Turnstile site key for the registration form. Absent → the production key.
   * Local dev can set Cloudflare's always-pass test key 1x00000000000000000000AA
   * (the production key only renders on the hostnames it is registered for).
   */
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /**
   * Published by src/lib/analytics.ts once PostHog is initialised and opted in,
   * and removed again when consent is withdrawn.
   *
   * It exists so components can send an event WITHOUT importing the analytics
   * module: a static import of that module would pull the ~254K posthog-js
   * bundle into the importing chunk and ship it to visitors who never accepted
   * analytics, which is exactly what the consent gate is there to prevent.
   * Call it optionally (`window.__sqTrack?.(…)`) — when there is no consent
   * there is no global, and the call is a no-op.
   */
  __sqTrack?: (event: string, properties?: Record<string, unknown>) => void;
}
