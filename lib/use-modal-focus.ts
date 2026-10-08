"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * What a pop-up window (a dialog that covers the page) must do for keyboard and screen-reader users:
 *  - when it opens, move focus inside it;
 *  - while it is open, keep Tab and Shift+Tab inside it (so focus never wanders to the page behind);
 *  - Escape closes it;
 *  - when it closes, put focus back on whatever opened it.
 * `container` is the dialog's own element (it may be absent while closed).
 */
export function useModalFocus(open: boolean, container: RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = container.current;
    const first = box?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close.current();
        return;
      }
      if (event.key !== "Tab" || !box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null || item === document.activeElement);
      if (!items.length) {
        event.preventDefault();
        box.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const inside = box.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === firstItem || !inside)) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && (document.activeElement === lastItem || !inside)) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [open, container]);
}
