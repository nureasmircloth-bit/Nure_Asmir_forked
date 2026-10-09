"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useModalFocus } from "@/lib/use-modal-focus";
import type { CatalogImage } from "@/lib/commerce";
import { Portal } from "../../_components/portal";
import { cdnSrcForWidth, isCdnUrl } from "@/lib/media-url";

/** The sharpest version of a photo (for zooming); an address that is not one of ours is used as it is. */
const sharpest = (url: string) => (isCdnUrl(url) ? cdnSrcForWidth(url, 1600) : url);

/**
 * Finger swipe: a mostly-sideways drag of 40px or more steps to the next (swipe left) or previous (swipe right) photo.
 * `swiped()` tells the click handler that the finger just moved, so the lift of a swipe does not count as a tap.
 */
function useSwipe(step: (delta: number) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  return {
    swiped: () => {
      const was = moved.current;
      moved.current = false;
      return was;
    },
    handlers: {
      onTouchStart: (event: React.TouchEvent) => {
        const touch = event.touches[0];
        start.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null; // two fingers = pinch, not a swipe
        moved.current = false;
      },
      onTouchEnd: (event: React.TouchEvent) => {
        const from = start.current;
        start.current = null;
        if (!from) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - from.x;
        const dy = touch.clientY - from.y;
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        moved.current = true;
        step(dx < 0 ? 1 : -1);
      },
    },
  };
}

/**
 * Product photos. On a computer, resting the mouse on the main photo magnifies the spot under it (and follows the mouse). On any device,
 * tapping the photo – or the magnifier button, which also works from the keyboard – opens it full size, where the shopper can step
 * through the other photos with the arrows or by swiping – and the photo on the page itself can be swiped too.
 */
export function ProductGallery({ name, images, fallback }: { name: string; images: CatalogImage[]; fallback: string }) {
  const gallery = images.length ? images : [{ id: "fallback", url: fallback, altText: name, sortOrder: 0, isPrimary: true }];
  const [active, setActive] = useState(0);
  const [lens, setLens] = useState<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  const index = Math.min(active, gallery.length - 1);
  const current = gallery[index];
  const step = useCallback((delta: number) => setActive((value) => (value + delta + gallery.length) % gallery.length), [gallery.length]);

  const stageSwipe = useSwipe(step);
  const boxSwipe = useSwipe(step);

  function track(event: React.PointerEvent) {
    if (event.pointerType !== "mouse" || !stage.current) return;
    const rect = stage.current.getBoundingClientRect();
    setLens({ x: Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100)) });
  }

  const lightbox = useRef<HTMLDivElement>(null);
  useModalFocus(box, lightbox, () => setBox(false)); // focus moves into the viewer, stays there, and returns to the photo that opened it

  useEffect(() => {
    if (!box) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [box, step]);

  return (
    <div className="product-gallery">
      {gallery.length > 1 && (
        <div className="product-thumbnails">
          {gallery.map((image, position) => (
            <button key={image.id} type="button" className={position === index ? "active" : ""} onClick={() => setActive(position)} aria-label={`View image ${position + 1}`}>
              <Image src={image.url} alt="" fill sizes="76px" />
            </button>
          ))}
        </div>
      )}
      <div className="product-stage zoomable" ref={stage} onPointerMove={track} onPointerEnter={track} onPointerLeave={() => setLens(null)} {...stageSwipe.handlers} onClick={() => { if (!stageSwipe.swiped()) setBox(true); }}>
        <Image
          key={current.id}
          src={current.url}
          alt={current.altText}
          fill
          priority
          sizes="(max-width: 900px) 100vw, 52vw"
          {...(current.blurDataUrl ? { placeholder: "blur" as const, blurDataURL: current.blurDataUrl } : {})}
        />
        {lens && <div className="zoom-lens" aria-hidden="true" style={{ backgroundImage: `url("${sharpest(current.url)}")`, backgroundPosition: `${lens.x}% ${lens.y}%` }} />}
        {gallery.length > 1 && (
          <span>
            {String(index + 1).padStart(2, "0")} / {String(gallery.length).padStart(2, "0")}
          </span>
        )}
        <button type="button" className="zoom-btn" aria-label="View this photo full size" onClick={(event) => { event.stopPropagation(); setBox(true); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5M11 8v6M8 11h6" /></svg>
        </button>
      </div>

      {box && (
        <Portal>
        <div className="lightbox" ref={lightbox} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${name} – photo ${index + 1} of ${gallery.length}`} {...boxSwipe.handlers} onClick={() => { if (!boxSwipe.swiped()) setBox(false); }}>
          <button type="button" className="lightbox-close" aria-label="Close" onClick={() => setBox(false)}>✕</button>
          {gallery.length > 1 && (
            <button type="button" className="lightbox-nav prev" aria-label="Previous photo" onClick={(event) => { event.stopPropagation(); step(-1); }}>‹</button>
          )}
          <div className="lightbox-frame" onClick={(event) => event.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sharpest(current.url)} alt={current.altText} />
          </div>
          {gallery.length > 1 && (
            <button type="button" className="lightbox-nav next" aria-label="Next photo" onClick={(event) => { event.stopPropagation(); step(1); }}>›</button>
          )}
          <p className="lightbox-count">{index + 1} / {gallery.length}</p>
        </div>
        </Portal>
      )}
    </div>
  );
}
