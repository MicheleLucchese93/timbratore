import posthog from "posthog-js";
import { erasePosthogStorage } from "./posthog-storage";

// PostHog is never loaded until the visitor accepts the `analytics` cookie
// category — CookieBanner.astro dynamic-imports this module from the consent
// callback, so a visitor who refuses never downloads the SDK at all.
//
// EU cloud (Frankfurt) is deliberate and load-bearing: eu.i.posthog.com keeps
// visitor data inside the EU, which is the whole reason we are not on GA4.

const projectKey = import.meta.env.PUBLIC_POSTHOG_KEY;
const apiHost = import.meta.env.PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";

let initialised = false;

export function startAnalytics(): void {
  // No key configured (local dev, or a build made without the secret): stay a
  // no-op instead of init-ing with undefined and erroring on every page view.
  if (!projectKey) return;

  if (initialised) {
    // Re-consent after a withdrawal — the SDK is already in memory. Put back the
    // persistence that stopAnalytics() dropped to 'memory', or the visitor stays
    // unrecognisable across page loads for the rest of the session.
    posthog.set_config({ persistence: "localStorage+cookie" });
    posthog.opt_in_capturing({ captureEventName: null });
    return;
  }

  initialised = true;
  posthog.init(projectKey, {
    api_host: apiHost,
    ui_host: "https://eu.posthog.com",
    // Pin the behaviour set rather than inheriting whatever a future SDK
    // version decides the defaults are.
    defaults: "2026-08-30",
    // Nobody logs in on the marketing site, so never build person profiles.
    // Events stay anonymous; autocapture, heatmaps and replay all still work.
    person_profiles: "never",
    // The point of the exercise: which elements people actually click.
    autocapture: true,
    capture_heatmaps: true,
    // Static MPA — every navigation is a real page load, so plain `true`
    // rather than the 'history_change' the pinned defaults would pick.
    capture_pageview: true,
    capture_pageleave: true,
    // The pinned defaults would set this to 250ms. A queued write that lands a
    // quarter-second late re-creates the ph_* entries that withdrawing consent
    // just erased, so persistence has to be synchronous here. Write pressure is
    // a non-issue at this site's event volume.
    persistence_save_debounce_ms: 0,
    session_recording: {
      // posthog masks inputs by default; stated explicitly because the contact
      // form on this site takes a name and an email address.
      maskAllInputs: true,
    },
  });

  // A visitor who withdrew consent earlier still carries PostHog's own
  // `__ph_opt_in_out_<token>` = "0" in localStorage — erasePosthogStorage()
  // keeps that key on purpose, since it records the refusal rather than
  // tracking anything. init() honours it as a stored DENIED, so without this
  // the SDK would load, write its cookies, fetch remote config and then stay
  // permanently silent for anyone who ever refused and later re-accepted.
  // (Verified on production: no `$sesid`, no session recorder, zero requests
  // to eu.i.posthog.com, while the banner said analytics were accepted.)
  //
  // Guarded rather than unconditional: a first-time accepter is already
  // capturing, and opt_in_capturing() re-fires $pageview, which would
  // double-count every first visit. `captureEventName: null` skips the
  // otherwise-automatic $opt_in event.
  if (posthog.has_opted_out_capturing()) {
    posthog.opt_in_capturing({ captureEventName: null });
  }
}

export function stopAnalytics(): void {
  if (!initialised) return;
  // Order matters, and `reset()` must NOT appear here: it starts a new session,
  // which regenerates the distinct id and re-writes exactly the ph_* entries we
  // are trying to erase. (Verified: withdrawing consent left both cookies in
  // place until this call was removed.) Opt out first, then clear.
  posthog.opt_out_capturing();
  // Belt and braces against the same race: once persistence is memory-only the
  // instance cannot write to cookies or localStorage again, whatever it still
  // has queued.
  posthog.set_config({ persistence: "memory" });
  erasePosthogStorage();
}
