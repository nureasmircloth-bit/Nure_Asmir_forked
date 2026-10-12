"use client";

import { useEffect, useState } from "react";
import "./announcement-bar.css";

import type { AnnouncementStyle } from "@/lib/shop-rules";

/**
 * The thin strip at the top of every page. Used by the shop and, for the "Preview" in the admin, by the settings page, so what the owner
 * sees there is exactly what shoppers get.
 *  - "rotate": one line at a time, sliding in after a few seconds
 *  - "scroll-left" / "scroll-right": every line in one endless loop, like a news ticker (pauses while a finger or mouse is on it)
 */
export function AnnouncementBar({ messages, style = "rotate" }: { messages: string[]; style?: AnnouncementStyle }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (messages.length < 2) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % messages.length), 4500);
    return () => window.clearInterval(timer);
  }, [messages.length]);

  if (!messages.length) return null;
  // the list can get shorter while the bar is on screen: never point past its end
  const current = index % messages.length;

  return (
    <div className="announcement" role="status" data-style={style}>
      <div className="announcement-ticker">
        {messages.map((message, position) => {
          const previous = (current - 1 + messages.length) % messages.length;
          const state = position === current ? "ticker-current" : position === previous ? "ticker-prev" : "ticker-hidden";
          return (
            <span key={message} className={state}>
              {message}
            </span>
          );
        })}
      </div>
    </div>
  );
}
