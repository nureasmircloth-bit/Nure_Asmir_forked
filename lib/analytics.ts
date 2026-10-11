/**
 * A very small PostHog sender (EU region) for the storefront: no library, no script tag, nothing downloaded. It sends a short list of
 * events (page views, add to bag, order placed …) so the owner can see how shoppers use the shop, and it does so ONLY after the
 * visitor pressed "Allow analytics" in the cookie banner. It never sends names, phone numbers, addresses or anything typed by the
 * shopper, only things like the page (never its ?query or #fragment), the product and the order value. The public project key (NEXT_PUBLIC_POSTHOG_KEY) is not a secret.
 */
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
const HOST = (process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com").replace(/\/+$/, "");
const ID_KEY = "na-ph-id";

let allowed = false;
let memoryId = "";

/** Is a PostHog project configured at all? (Without a key the banner and every call below do nothing.) */
export const analyticsConfigured = (): boolean => Boolean(KEY);

/** Called with the visitor's cookie choice. Saying no also forgets the random id this browser was given. */
export function setAnalyticsConsent(yes: boolean): void {
  allowed = yes && Boolean(KEY);
  if (!yes) {
    memoryId = "";
    try {
      window.localStorage.removeItem(ID_KEY);
    } catch {
      // storage blocked: nothing was kept
    }
  }
}

/** A random id for this browser (not tied to a name or a phone number). Kept in storage when allowed, in memory otherwise. */
function distinctId(): string {
  try {
    const saved = window.localStorage.getItem(ID_KEY);
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(ID_KEY, fresh);
    return fresh;
  } catch {
    return (memoryId ||= crypto.randomUUID());
  }
}

/** Sends one event. Silent when analytics is not allowed or not set up, and never throws: tracking must never break the shop. */
export function track(event: string, properties: Record<string, string | number | boolean | null | undefined> = {}): void {
  if (!allowed || typeof window === "undefined") return;
  try {
    const body = JSON.stringify({
      api_key: KEY,
      event,
      distinct_id: distinctId(),
      timestamp: new Date().toISOString(),
      properties: {
        // page address without ?query or #fragment: those can carry order numbers or tokens
        $current_url: `${window.location.origin ?? ""}${window.location.pathname}`,
        $pathname: window.location.pathname,
        $host: window.location.host,
        $screen_width: window.screen.width,
        $screen_height: window.screen.height,
        $lib: "nure-asmir-lite",
        ...properties,
      },
    });
    // text/plain keeps this a "simple" request (no pre-flight round trip); keepalive lets it finish while the page closes.
    void fetch(`${HOST}/i/v0/e/`, { method: "POST", body, keepalive: true, mode: "no-cors", headers: { "Content-Type": "text/plain" } }).catch(() => undefined);
  } catch {
    // never let tracking break a page
  }
}
