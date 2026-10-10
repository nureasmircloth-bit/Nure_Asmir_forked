"use client";

import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";

/** Storage names are the old "hide" names on purpose: a shopper who hid a button before this update finds it tucked at the edge, not lost. */
export const TUCK_KEYS = { currency: "na-hide-currency", whatsapp: "na-hide-whatsapp" } as const;

function isTucked(key: string): boolean {
  try {
    return Boolean(window.localStorage.getItem(key));
  } catch {
    return false;
  }
}

function setTucked(key: string, tucked: boolean) {
  try {
    if (tucked) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // private mode: the choice just is not remembered
  }
  window.dispatchEvent(new Event("na-widgets"));
}

/**
 * A floating button that can be tucked against the screen edge (the way most shops do it) instead of closed for good:
 * it slides to the edge leaving a small tab, and a tap on the tab – or a swipe away from the edge – brings it back.
 * `ready` is false until the saved choice has been read, so the button never flashes in the wrong place.
 */
export function useEdgeWidget(key: string, side: "left" | "right") {
  const [state, setState] = useState({ ready: false, tucked: false });
  useEffect(() => {
    const read = () => setState({ ready: true, tucked: isTucked(key) });
    read();
    window.addEventListener("na-widgets", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("na-widgets", read);
      window.removeEventListener("storage", read);
    };
  }, [key]);

  // A swipe toward the edge tucks the button, a swipe away from it brings it back.
  const startX = useRef(0);
  const toward = side === "left" ? -1 : 1;
  return {
    ...state,
    tuck: () => setTucked(key, true),
    untuck: () => setTucked(key, false),
    swipe: {
      onTouchStart: (event: TouchEvent) => {
        startX.current = event.touches[0].clientX;
      },
      onTouchEnd: (event: TouchEvent) => {
        const dx = event.changedTouches[0].clientX - startX.current;
        if (Math.abs(dx) < 24) return;
        setTucked(key, Math.sign(dx) === toward);
      },
    },
  };
}

/** The little tab: a chevron chip while the button is out, a full-size tap target over the visible sliver while it is tucked. */
function EdgeHandle({ tucked, name, side, onToggle }: { tucked: boolean; name: string; side: "left" | "right"; onToggle: () => void }) {
  // The chevron points toward the edge to tuck, and away from it to bring the button back.
  const pointsLeft = (side === "left") !== tucked;
  return (
    <button
      type="button"
      className="edge-handle"
      aria-label={tucked ? `Bring back the ${name}` : `Tuck the ${name} to the edge of the screen`}
      aria-expanded={!tucked}
      onClick={onToggle}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={pointsLeft ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
      </svg>
    </button>
  );
}

/** Wrapper that gives a floating button the tuck behaviour (slide to the edge, entrance animation, swipe). */
export function EdgeWidget({ storageKey, side, name, className, children, onTuck }: { storageKey: string; side: "left" | "right"; name: string; className: string; children: ReactNode; onTuck?: () => void }) {
  const widget = useEdgeWidget(storageKey, side);
  return (
    <div className={`edge-widget edge-${side} ${className}${widget.tucked ? " is-tucked" : ""}${widget.ready ? " is-ready" : ""}`} {...widget.swipe}>
      <div className="edge-body" inert={widget.tucked}>
        {children}
      </div>
      <EdgeHandle
        tucked={widget.tucked}
        name={name}
        side={side}
        onToggle={() => {
          if (widget.tucked) widget.untuck();
          else {
            onTuck?.();
            widget.tuck();
          }
        }}
      />
    </div>
  );
}

/** The round WhatsApp button, tucked to the left edge with its tab. */
export function WhatsAppFloat({ href, external, children }: { href: string; external: boolean; children: ReactNode }) {
  return (
    <EdgeWidget storageKey={TUCK_KEYS.whatsapp} side="left" name="WhatsApp button" className="float-whatsapp-wrap">
      <a className="float-whatsapp" href={href} target={external ? "_blank" : undefined} rel="noreferrer" aria-label="Chat with us on WhatsApp">
        {children}
      </a>
    </EdgeWidget>
  );
}
