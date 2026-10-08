"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { hasCustomerPushToken, pushSupport, registerCustomerPush } from "@/lib/customer-push";
import { useWishlist } from "@/lib/wishlist";
import { useLockedAction } from "@/lib/use-locked-action";
import { Portal } from "./portal";
import { showToast } from "./shop-toast";

const SNOOZE_KEY = "na-alerts-snooze-until";
const VISITS_KEY = "na-visits";
const COUNTED_KEY = "na-visit-counted";
const SHOW_ON = /^\/($|shop|collections\/|products\/)/;

/**
 * A polite, one-time question for returning shoppers: "want a notification when there is a sale or your parcel ships?".
 * Never on the first visit, never while buying, and "Not now" is remembered for two weeks. Asking for the browser's permission
 * happens only after the shopper taps "Turn on" (browsers ignore, and users distrust, permission pop-ups nobody asked for).
 */
export function AlertsPrompt() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const action = useLockedAction();
  const wishlist = useWishlist();

  useEffect(() => {
    // Moving to a page where the question does not belong (for example checkout) closes it; the pending timer is cancelled below.
    if (!SHOW_ON.test(pathname)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      return;
    }
    let timer = 0;
    try {
      if (pushSupport() !== "available" || hasCustomerPushToken()) return;
      if (Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now()) return;
      // One visit = one browser session: opening several pages in a row counts once, so "returning shopper" really means returning.
      let visits = Number(localStorage.getItem(VISITS_KEY) ?? 0);
      if (!sessionStorage.getItem(COUNTED_KEY)) {
        visits += 1;
        localStorage.setItem(VISITS_KEY, String(visits));
        sessionStorage.setItem(COUNTED_KEY, "1");
      }
      if (visits < 3) return;
    } catch {
      return;
    }
    timer = window.setTimeout(() => setOpen(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  function snooze(days: number) {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * 86_400_000));
    } catch {
      // not remembered – it will simply ask again later
    }
    setOpen(false);
  }

  async function turnOn() {
    await action.run(async () => {
      const result = await registerCustomerPush({ salesOptIn: true, wishlist });
      if (result.ok) {
        showToast("Alerts are on. We'll tell you about sales.");
        setOpen(false);
      } else {
        // A failure (a dropped connection, the service being down) is not a "no": keep the question so the shopper can try again.
        showToast(result.error, "bad");
      }
    });
  }

  if (!open) return null;
  return (
    <Portal>
      <aside className="alerts-prompt" role="dialog" aria-label="Sale alerts">
        <div className="alerts-prompt-icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M6 9a6 6 0 0112 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" />
            <path d="M10 20a2 2 0 004 0" />
          </svg>
        </div>
        <div className="alerts-prompt-text">
          <strong>Never miss a sale</strong>
          <p>Get a notification when prices drop, and when your parcel is booked, on its way or delivered.</p>
        </div>
        <div className="alerts-prompt-actions">
          <button type="button" className="alerts-prompt-yes" onClick={turnOn} disabled={action.pending} aria-busy={action.pending}>
            {action.pending ? <span className="spinner spinner-light" aria-label="Turning on" /> : "Turn on"}
          </button>
          <button type="button" className="alerts-prompt-no" onClick={() => snooze(14)}>
            Not now
          </button>
        </div>
      </aside>
    </Portal>
  );
}
