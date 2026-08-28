// Deliberately free of any posthog-js import: the cookie banner loads this
// eagerly, and pulling the SDK in here would defeat the whole point of gating
// it behind consent.

/**
 * Remove every trace PostHog left in browser storage.
 *
 * `__ph_opt_in_out_*` is left alone on purpose — that key is the record of the
 * refusal itself, not tracking data.
 */
export function erasePosthogStorage(): void {
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
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("ph_")) localStorage.removeItem(key);
    }
  } catch {
    // Storage can throw outright when the browser blocks site data.
  }
}
