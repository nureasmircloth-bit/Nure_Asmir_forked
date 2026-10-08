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
  const rotating = style === "rotate";

  useEffect(() => {
    if (!rotating || messages.length < 2) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % messages.length), 4500);
    return () => window.clearInterval(timer);
  }, [rotating, messages.length]);

  if (!messages.length) return null;

  if (!rotating) {
    // A whole loop takes longer the more text there is, so reading speed stays the same for one line or six.
    const seconds = Math.max(16, Math.round(messages.join("").length * 0.32));
    const line = (copy: number) => (
      <span className="announcement-run" key={copy} aria-hidden={copy === 1}>
        {messages.map((message) => (
          <span key={message} className="announcement-item">
            {message}
          </span>
        ))}
      </span>
    );
    return (
      <div className="announcement announcement-scroll" role="status" data-direction={style === "scroll-right" ? "right" : "left"}>
        <div className="announcement-belt" style={{ animationDuration: `${seconds}s` }}>
          {line(0)}
          {line(1)}
        </div>
      </div>
    );
  }

  return (
    <div className="announcement" role="status">
      <div className="announcement-ticker">
        {messages.map((message, position) => {
          const previous = (index - 1 + messages.length) % messages.length;
          const state = position === index ? "ticker-current" : position === previous ? "ticker-prev" : "ticker-hidden";
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
