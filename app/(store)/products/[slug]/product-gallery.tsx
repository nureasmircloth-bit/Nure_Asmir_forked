"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useModalFocus } from "@/lib/use-modal-focus";
import { useSlideDrag } from "@/lib/use-slide-drag";
import type { CatalogImage } from "@/lib/commerce";
import { Portal } from "../../_components/portal";
import { cdnSrcForWidth, isCdnUrl } from "@/lib/media-url";

/** The sharpest version of a photo (for zooming); an address that is not one of ours is used as it is. */
const sharpest = (url: string) => (isCdnUrl(url) ? cdnSrcForWidth(url, 1600) : url);

/** A sideways swipe of 40px or more in the full-size viewer: swipe left = next photo, swipe right = previous. */
function useViewerSwipe(step: (delta: number) => void) {
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

const Chevron = ({ left }: { left?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={left ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
  </svg>
);

/**
 * Product photos. The photos sit in a row that slides: drag it with a finger (it follows and snaps), use the arrows, or tap a thumbnail.
 * On a computer, resting the mouse on the main photo magnifies the spot under it. Tapping the photo – or the magnifier button, which also
 * works from the keyboard – opens it full size, where the arrows, swiping or the keyboard step through the other photos.
 */
export function ProductGallery({ name, images, fallback }: { name: string; images: CatalogImage[]; fallback: string }) {
  const gallery = images.length ? images : [{ id: "fallback", url: fallback, altText: name, sortOrder: 0, isPrimary: true }];
  const [active, setActive] = useState(0);
  const [lens, setLens] = useState<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [direction, setDirection] = useState<1 | -1>(1); // which way the last change went (for the viewer's slide-in)

  const index = Math.min(active, gallery.length - 1);
  const current = gallery[index];
  const last = gallery.length - 1;

  // Only the photo on show and its neighbours are loaded, so a phone does not download the whole set up front.
  const [seen, setSeen] = useState<ReadonlySet<number>>(new Set([0, 1]));
  const show = useCallback((to: number) => {
    setDirection(to >= index ? 1 : -1);
    setActive(to);
    setSeen((before) => new Set([...before, to - 1, to, to + 1]));
  }, [index]);
  const go = useCallback((next: number) => show(Math.max(0, Math.min(last, next))), [show, last]);
  /** Used by the full-size viewer, where the photos wrap round. */
  const stepLoop = useCallback((delta: number) => {
    show((index + delta + gallery.length) % gallery.length);
    setDirection(delta > 0 ? 1 : -1);
  }, [show, index, gallery.length]);

  const drag = useSlideDrag(track, gallery.length, index, go);

  function follow(event: React.PointerEvent) {
    if (event.pointerType !== "mouse" || !stage.current) return;
    const rect = stage.current.getBoundingClientRect();
    setLens({ x: Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100)) });
  }

  const lightbox = useRef<HTMLDivElement>(null);
  useModalFocus(box, lightbox, () => setBox(false)); // focus moves into the viewer, stays there, and returns to the photo that opened it
  const viewerSwipe = useViewerSwipe(stepLoop);

  useEffect(() => {
    if (!box) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") stepLoop(1);
      else if (event.key === "ArrowLeft") stepLoop(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [box, stepLoop]);

  return (
    <div className="product-gallery">
      {gallery.length > 1 && (
        <div className="product-thumbnails">
          {gallery.map((image, position) => (
            <button key={image.id} type="button" className={position === index ? "active" : ""} onClick={() => go(position)} aria-label={`View image ${position + 1}`}>
              <Image src={image.url} alt="" fill sizes="76px" />
            </button>
          ))}
        </div>
      )}
      <div
        className="product-stage zoomable"
        ref={stage}
        onPointerMove={follow}
        onPointerEnter={follow}
        onPointerLeave={() => setLens(null)}
        {...drag.handlers}
        onClick={() => {
          if (drag.clickable()) setBox(true);
        }}
      >
        <div className="slide-track" ref={track} style={{ "--i": index } as CSSProperties}>
          {gallery.map((image, position) => (
            <div className="slide" key={image.id} aria-hidden={position !== index}>
              {(position === 0 || seen.has(position) || position === index) && (
                <Image
                  src={image.url}
                  alt={image.altText}
                  fill
                  priority={position === 0}
                  sizes="(max-width: 900px) 100vw, 52vw"
                  {...(image.blurDataUrl ? { placeholder: "blur" as const, blurDataURL: image.blurDataUrl } : {})}
                />
              )}
            </div>
          ))}
        </div>
        {lens && <div className="zoom-lens" aria-hidden="true" style={{ backgroundImage: `url("${sharpest(current.url)}")`, backgroundPosition: `${lens.x}% ${lens.y}%` }} />}
        {gallery.length > 1 && (
          <>
            <span>
              {String(index + 1).padStart(2, "0")} / {String(gallery.length).padStart(2, "0")}
            </span>
            <button type="button" className="slide-arrow prev" aria-label="Previous photo" disabled={index === 0} onClick={(event) => { event.stopPropagation(); go(index - 1); }}>
              <Chevron left />
            </button>
            <button type="button" className="slide-arrow next" aria-label="Next photo" disabled={index === last} onClick={(event) => { event.stopPropagation(); go(index + 1); }}>
              <Chevron />
            </button>
            <div className="slide-dots" aria-hidden="true">
              {gallery.map((image, position) => (
                <i key={image.id} className={position === index ? "on" : ""} />
              ))}
            </div>
          </>
        )}
        <button type="button" className="zoom-btn" aria-label="View this photo full size" onClick={(event) => { event.stopPropagation(); setBox(true); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5M11 8v6M8 11h6" /></svg>
        </button>
      </div>

      {box && (
        <Portal>
        <div className="lightbox" ref={lightbox} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${name} – photo ${index + 1} of ${gallery.length}`} {...viewerSwipe.handlers} onClick={() => { if (!viewerSwipe.swiped()) setBox(false); }}>
          <button type="button" className="lightbox-close" aria-label="Close" onClick={() => setBox(false)}>✕</button>
          {gallery.length > 1 && (
            <button type="button" className="lightbox-nav prev" aria-label="Previous photo" onClick={(event) => { event.stopPropagation(); stepLoop(-1); }}>‹</button>
          )}
          {/* keyed by the photo so each change plays the slide-in from the side it came from */}
          <div className="lightbox-frame" key={index} data-dir={direction} onClick={(event) => event.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sharpest(current.url)} alt={current.altText} />
          </div>
          {gallery.length > 1 && (
            <button type="button" className="lightbox-nav next" aria-label="Next photo" onClick={(event) => { event.stopPropagation(); stepLoop(1); }}>›</button>
          )}
          <p className="lightbox-count">{index + 1} / {gallery.length}</p>
        </div>
        </Portal>
      )}
    </div>
  );
}
