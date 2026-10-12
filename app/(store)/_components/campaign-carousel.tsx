"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CampaignSlide } from "@/lib/commerce";
import { buildSrcSet } from "@/lib/images";
import { cdnSrcForWidth, isCdnUrl } from "@/lib/media-url";

const fallback: CampaignSlide = {
  id: "campaign-default",
  imageUrl: "/placeholder.webp",
  mobileImageUrl: null,
  altText: "Nure Asmir — men's wear",
  eyebrow: "",
  headline: "",
  body: "",
  ctaLabel: "Shop now",
  ctaHref: "/shop",
  sortOrder: 0,
};

/** Full-width image banner. The campaign artwork carries its own typography (as on the benchmark
 * site), so slides are just art + a link; the whole banner is clickable. Desktop/mobile crops are
 * art-directed through <picture> when a slide has a separate mobile image. */
export function CampaignCarousel({ slides }: { slides: CampaignSlide[] }) {
  const items = slides.length ? slides : [fallback];
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const quietUntil = useRef(0);

  useEffect(() => {
    if (items.length < 2 || paused) return;
    const timer = window.setInterval(() => setActive((index) => (index + 1) % items.length), 6000);
    return () => window.clearInterval(timer);
  }, [items.length, paused]);

  const go = (delta: number) => setActive((index) => (index + delta + items.length) % items.length);

  const onTouchStart = (event: React.TouchEvent) => {
    if (items.length < 2) return;
    if (event.touches.length !== 1) {
      touchStart.current = null;
      return;
    }
    setPaused(true);
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, time: performance.now() };
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    setPaused(false);
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;

    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const dt = performance.now() - start.time;

    const isHorizontal = Math.abs(dx) > Math.abs(dy) * 1.25;
    const isFlick = dt < 350 && Math.abs(dx) > 30;
    const isDrag = Math.abs(dx) > 60;

    if (isHorizontal && (isFlick || isDrag)) {
      quietUntil.current = performance.now() + 350;
      go(dx < 0 ? 1 : -1);
    }
  };

  const onTouchCancel = () => {
    touchStart.current = null;
    setPaused(false);
  };

  return (
    <section
      className="banner"
      aria-roledescription="carousel"
      aria-label="Featured campaigns"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onClickCapture={(event) => {
        if (performance.now() < quietUntil.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <div className="banner-track">
        {items.map((item, index) => {
          const eager = index === 0;
          const desktopSrc = isCdnUrl(item.imageUrl) ? cdnSrcForWidth(item.imageUrl, 1600) : item.imageUrl;
          return (
            <div
              key={item.id}
              className={`banner-slide ${index === active ? "active" : ""}`}
              style={item.blurDataUrl ? { backgroundImage: `url(${item.blurDataUrl})` } : undefined}
              aria-hidden={index !== active}
            >
              <picture>
                {item.mobileImageUrl && <source media="(max-width: 700px)" srcSet={buildSrcSet(item.mobileImageUrl)} sizes="100vw" />}
                <img
                  src={desktopSrc}
                  srcSet={buildSrcSet(item.imageUrl) || undefined}
                  sizes="100vw"
                  alt={index === active ? item.altText : ""}
                  loading={eager ? "eager" : "lazy"}
                  fetchPriority={eager ? "high" : "auto"}
                  decoding={eager ? "sync" : "async"}
                />
              </picture>
              <Link href={item.ctaHref} className="banner-link" tabIndex={index === active ? 0 : -1} aria-label={item.ctaLabel || "Shop now"} />
            </div>
          );
        })}
      </div>
      {items.length > 1 && (
        <>
          <button type="button" className="banner-arrow banner-prev" aria-label="Previous slide" onClick={() => go(-1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <button type="button" className="banner-arrow banner-next" aria-label="Next slide" onClick={() => go(1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
          <div className="banner-dots">
            {items.map((item, index) => (
              <button key={item.id} type="button" aria-label={`Show slide ${index + 1}`} className={index === active ? "active" : ""} onClick={() => setActive(index)}>
                <i />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
