import { runInBackground } from "@/lib/background";
import { isPracticeRequest } from "@/lib/practice-context";
import { siteOrigin } from "@/lib/brand";

let lastAt = 0;

/**
 * Tells the public shop to throw away its cached pages (price, photo and banner changes show up right away).
 * Best-effort and rate-limited: a bulk upload that saves 50 products asks once, not 50 times.
 */
export function refreshStorefront(force = false): void {
  if (isPracticeRequest()) return; // practice changes never reach the real website
  const secret = process.env.CRON_SECRET;
  if (!secret || (!force && Date.now() - lastAt < 4000)) return;
  lastAt = Date.now();
  runInBackground(
    fetch(`${siteOrigin()}/api/revalidate`, { method: "POST", headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000) }).then(() => undefined),
    "refreshStorefront",
  );
}

/** Admin actions that change what shoppers see. */
export const STOREFRONT_ACTIONS = /^(campaign|category|collection|delivery-zone|faq|flash-sale|image|location|product|settings|stock|variant|siteimage)\./;
