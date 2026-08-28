import posthog from "posthog-js";

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
    // Re-consent after a withdrawal — the SDK is already in memory.
    posthog.opt_in_capturing();
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
    session_recording: {
      // posthog masks inputs by default; stated explicitly because the contact
      // form on this site takes a name and an email address.
      maskAllInputs: true,
    },
  });
}

export function stopAnalytics(): void {
  if (!initialised) return;
  // Order matters, and `reset()` must NOT appear here: it starts a new session,
  // which regenerates the distinct id and re-writes exactly the ph_* entries we
  // are trying to erase. (Verified: withdrawing consent left both cookies in
  // place until this call was removed.) Opt out first, then clear.
  posthog.opt_out_capturing();
  erasePosthogStorage();
}

// The banner declares an autoClear rule for ph_* too, but that fires on
// vanilla-cookieconsent's own schedule relative to this callback. Doing it here
// as well makes withdrawal deterministic instead of order-dependent.
function erasePosthogStorage(): void {
  const host = window.location.hostname;
  for (const entry of document.cookie.split("; ")) {
    const name = entry.split("=")[0];
    if (!name.startsWith("ph_")) continue;
    // Cleared against each domain scope the cookie could have been set on.
    for (const domain of ["", `; domain=${host}`, `; domain=.${host}`]) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain}`;
    }
  }
  // persistence defaults to 'localStorage+cookie', so the cookie is only half of it.
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("ph_")) localStorage.removeItem(key);
  }
}
