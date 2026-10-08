/**
 * How long until a change made in the admin shows on the public website. The website keeps saved copies of its pages so it opens fast
 * (see lib/edge-page-cache.ts and public/sw.js); after a change the copies are rebuilt, which takes a few minutes. Pure functions so the
 * promise the admin makes ("about 3 minutes") is written in one place and tested.
 */

/** Pages that hardly ever change (our story, FAQ, policies, contact) are kept a little longer than product pages. */
const SLOW_AREAS = /^\/api\/admin\/(settings|faqs|story)(\/|$)/;
const STOREFRONT_AREAS = /^\/api\/admin\/(products|categories|collections|campaign|delivery-zones|faqs|flash-sales|settings|locations|images|site-images|variants|stock)(\/|$)/;

export const FAST_MINUTES = 3;
export const SLOW_MINUTES = 5;

/** The minutes to wait after a successful change to this admin address, or null when the change does not touch the public website. */
export function storefrontDelayMinutes(path: string, method: string): number | null {
  if (method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD") return null;
  if (!STOREFRONT_AREAS.test(path)) return null;
  return SLOW_AREAS.test(path) ? SLOW_MINUTES : FAST_MINUTES;
}

/** "Your website will show this in about 3 minutes (around 3:45 pm). ..." in plain words. */
export function storefrontDelayMessage(minutes: number, now: Date = new Date()): string {
  const at = new Date(now.getTime() + minutes * 60_000).toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Karachi" });
  return `Your website will show this in about ${minutes} minutes (around ${at}). Shoppers who already have the page open need to refresh it.`;
}
