"use client";

import { useRef, type RefObject, type TouchEvent } from "react";

/**
 * Finger-follow swiping for a row of slides (`.slide-track`). While the finger moves, the row follows it (the CSS variable `--dx`);
 * on release it snaps to the next or previous slide when the drag was far enough or a quick flick, otherwise it springs back.
 * The row's position at rest comes from the slide number (`--i`) set by the caller, so a slide change animates with plain CSS.
 *
 * - At the first or last slide the row resists (rubber band) instead of moving freely.
 * - Mostly-vertical drags are ignored, so the page still scrolls.
 * - `clickable()` is false for a moment after a swipe, so lifting the finger never counts as a tap on a link underneath.
 */
export function useSlideDrag(track: RefObject<HTMLElement | null>, count: number, index: number, go: (next: number) => void, enabled = true) {
  const gesture = useRef<{ x: number; y: number; at: number; width: number; axis: "" | "x" | "y" } | null>(null);
  const quietUntil = useRef(0);

  const drag = (dx: number | null) => {
    const el = track.current;
    if (!el) return;
    if (dx === null) {
      el.style.removeProperty("--dx");
      el.classList.remove("is-dragging");
    } else {
      el.style.setProperty("--dx", `${dx}px`);
      el.classList.add("is-dragging");
    }
  };

  return {
    clickable: () => performance.now() > quietUntil.current,
    handlers: {
      onTouchStart: (event: TouchEvent) => {
        if (!enabled || count < 2 || event.touches.length !== 1) {
          gesture.current = null; // a second finger (pinch) or a single photo: nothing to swipe
          return;
        }
        const touch = event.touches[0];
        gesture.current = { x: touch.clientX, y: touch.clientY, at: performance.now(), width: event.currentTarget.clientWidth || 300, axis: "" };
      },
      onTouchMove: (event: TouchEvent) => {
        const g = gesture.current;
        if (!g) return;
        const touch = event.touches[0];
        const dx = touch.clientX - g.x;
        const dy = touch.clientY - g.y;
        if (!g.axis) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          g.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
        }
        if (g.axis !== "x") return;
        const atEdge = (index === 0 && dx > 0) || (index === count - 1 && dx < 0);
        drag(atEdge ? dx * 0.3 : dx);
      },
      onTouchEnd: (event: TouchEvent) => {
        const g = gesture.current;
        gesture.current = null;
        if (!g || g.axis !== "x") return drag(null);
        const dx = event.changedTouches[0].clientX - g.x;
        const flick = performance.now() - g.at < 300 && Math.abs(dx) > 25;
        const far = Math.abs(dx) > Math.min(70, g.width * 0.2);
        quietUntil.current = performance.now() + 350;
        drag(null);
        if (!(flick || far)) return;
        const next = Math.max(0, Math.min(count - 1, index + (dx < 0 ? 1 : -1)));
        if (next !== index) go(next);
      },
      onTouchCancel: () => {
        gesture.current = null;
        drag(null);
      },
    },
  };
}
