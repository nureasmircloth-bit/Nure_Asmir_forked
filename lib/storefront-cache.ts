import { runInBackground } from "@/lib/background";
import { isPracticeRequest } from "@/lib/practice-context";
import { siteOrigin } from "@/lib/brand";

let lastAt = 0;
let trailing = false;

/**
 * Tells the public shop to throw away its cached pages (price, photo and banner changes show up right away).
 * Best-effort and rate-limited: a bulk upload that saves 50 products asks once, not 50 times.
 */
export function refreshStorefront(force = false): void {
  if (isPracticeRequest()) return; // practice changes never reach the real website
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const send = () =>
    fetch(`${siteOrigin()}/api/revalidate`, { method: "POST", headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000) }).then(() => undefined);
  const wait = 4000 - (Date.now() - lastAt);
  if (force || wait <= 0) {
    lastAt = Date.now();
    runInBackground(send(), "refreshStorefront");
    return;
  }
  // Inside the 4-second window (a bulk upload saving many products): one refresh is queued for the end of the window instead of being
  // dropped, so the last change is never left behind for the whole page-cache period.
  if (trailing) return;
  trailing = true;
  runInBackground(
    new Promise((resolve) => setTimeout(resolve, wait)).then(() => {
      trailing = false;
      lastAt = Date.now();
      return send();
    }),
    "refreshStorefront (queued)",
  );
}

/** Admin actions that change what shoppers see. */
export const STOREFRONT_ACTIONS = /^(campaign|category|collection|delivery-zone|faq|flash-sale|image|location|product|settings|stock|variant|siteimage)\./;
