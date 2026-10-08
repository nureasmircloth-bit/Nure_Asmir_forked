"use client";

import { useEffect, useRef, useState } from "react";
import { Portal } from "./portal";

type Toast = { id: number; text: string; tone: "good" | "bad" };

/** Shows a short message to the shopper from anywhere: `showToast("Order number copied")`. */
export function showToast(text: string, tone: Toast["tone"] = "good"): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("na-toast", { detail: { text, tone } }));
}

/** Draws the messages sent with showToast(); lives once in the storefront layout. */
export function ShopToaster() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef(0);

  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string; tone?: Toast["tone"] }>).detail;
      if (!detail?.text) return;
      setToast({ id: Date.now(), text: detail.text, tone: detail.tone ?? "good" });
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setToast(null), 3200);
    };
    window.addEventListener("na-toast", onToast);
    return () => {
      window.removeEventListener("na-toast", onToast);
      window.clearTimeout(timer.current);
    };
  }, []);

  if (!toast) return null;
  return (
    <Portal>
      <div key={toast.id} className={`shop-toast shop-toast-${toast.tone}`} role="status" aria-live="polite">
        {toast.tone === "good" ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        ) : null}
        <span>{toast.text}</span>
      </div>
    </Portal>
  );
}
