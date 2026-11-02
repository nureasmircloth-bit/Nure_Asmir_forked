"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useModalFocus } from "@/lib/use-modal-focus";
import { useSlideDrag } from "@/lib/use-slide-drag";
import type { CatalogImage } from "@/lib/commerce";
import { Portal } from "../../_components/portal";
import { cdnSrcForWidth, isCdnUrl } from "@/lib/media-url";
import { track as trackEvent } from "@/lib/analytics";
import { saveDataMode, waitUntil } from "@/lib/wait-until";

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

/** A photo of the product, tagged with the colour it shows (so swiping into another colour's photos can switch the colour). */
export type GallerySlide = CatalogImage & { color: string };

/**
 * Product photos. The photos of every colour sit in one row that loops (after the last photo it goes round to the first, and back): swiping from one
 * colour's photos into the next changes the chosen colour, and so the price, the size choices and the cart line, as on Daraz. The photos sit in a row that slides: drag it with a finger (it follows and snaps), use the arrows, or tap a thumbnail.
 * On a computer, resting the mouse on the main photo magnifies the spot under it. Tapping the photo – or the magnifier button, which also
 * works from the keyboard – opens it full size, where the arrows, swiping or the keyboard step through the other photos.
 */
export function ProductGallery({ name, slides, fallback, activeColor, onColorChange }: { name: string; slides: GallerySlide[]; fallback: string; activeColor: string; onColorChange: (color: string) => void }) {
  const gallery: GallerySlide[] = slides.length ? slides : [{ id: "fallback", url: fallback, altText: name, sortOrder: 0, isPrimary: true, color: activeColor }];
  const total = gallery.length;
  const looped = total > 1;
  const firstOfColor = gallery.findIndex((slide) => slide.color === activeColor);
  const [active, setActive] = useState(Math.max(0, firstOfColor));
  // where the row is: with a copy of the last photo in front and of the first behind, so going round looks seamless
  const [pos, setPos] = useState(looped ? Math.max(0, firstOfColor) + 1 : 0);
  const [lens, setLens] = useState<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [direction, setDirection] = useState<1 | -1>(1); // which way the last change went (for the viewer's slide-in)

  const index = Math.min(active, total - 1);
  const current = gallery[index];
  const last = total - 1;

  // Only the photo on show and its neighbours are loaded, so a phone does not download the whole set up front.
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set([0, 1, Math.max(0, firstOfColor)]));
  const [jumping, setJumping] = useState(false); // the row is being moved from a copy onto the real photo: no animation for that
  const loaded = useRef<Set<number>>(new Set([0])); // which photos have really arrived (the first is already on the page)
  const [waiting, setWaiting] = useState(false); // an arrow or thumbnail was tapped and its photo is still arriving: the arrows pulse
  const currentRequest = useRef(0);
  // Slides to a photo once it has arrived (at most ~1 s of waiting): sliding to a photo that is still downloading shows an empty frame.
  // `silent` means the colour already says so (a colour was chosen by hand), so the colour is not announced again.
  const show = useCallback(async (to: number, moveDirection?: 1 | -1, silent = false) => {
    // (a colour chosen by hand moves the photo at once, like the price and sizes, instead of waiting for the picture)
    const id = ++currentRequest.current;
    setSeen((before) => {
      const next = new Set(before);
      next.add(to);
      if (!saveDataMode()) {
        next.add((to + 1) % total);
        next.add((to - 1 + total) % total);
      }
      return next;
    });
    const needsWait = !silent && !loaded.current.has(to);
    setWaiting(needsWait);
    if (needsWait) {
      await waitUntil(() => loaded.current.has(to), 2500);
      if (currentRequest.current !== id) return;
      setWaiting(false);
    }
    if (currentRequest.current !== id) return;
    const wrapForward = looped && moveDirection === 1 && to === 0 && index === last;
    const wrapBack = looped && moveDirection === -1 && to === last && index === 0;
    const quick = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setDirection(moveDirection ?? (to >= index ? 1 : -1));
    setActive(to);
    // going round slides onto the copy first and is moved onto the real photo, unseen, when the slide ends
    setPos(wrapForward && !quick ? total + 1 : wrapBack && !quick ? 0 : to + 1);
    if ((wrapForward || wrapBack) && !quick) window.setTimeout(() => settle(), 700);
    trackEvent("gallery_photo_changed", { to: to + 1 });
    if (!silent && gallery[to].color !== activeColor) onColorChange(gallery[to].color);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, total, looped, activeColor, onColorChange]);
  /** Moves the row from a copy to the real photo without any animation. */
  function settle() {
    if (pos !== total + 1 && pos !== 0) return;
    setJumping(true);
    setPos(pos === 0 ? total : 1);
  }
  // the "no animation" flag is lifted two frames after the jump has really been drawn
  useEffect(() => {
    if (!jumping) return;
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => setJumping(false));
    });
    return () => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
    };
  }, [jumping]);
  // the last photo is the copy in front of the first one: load it early too, unless the shopper is saving data
  useEffect(() => {
    if (saveDataMode()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeen((before) => (before.has(total - 1) ? before : new Set(before).add(total - 1)));
  }, [total]);
  const go = useCallback((next: number, delta?: 1 | -1) => show(((next % total) + total) % total, delta), [show, total]);
  /** Used by the arrows and the full-size viewer: photos wrap round. */
  const stepLoop = useCallback((delta: number) => {
    show((index + delta + total) % total, delta > 0 ? 1 : -1);
  }, [show, index, total]);

  // A colour chosen by hand (the swatches) jumps to that colour's first photo.
  useEffect(() => {
    const target = gallery.findIndex((slide) => slide.color === activeColor);
    if (target >= 0 && gallery[index]?.color !== activeColor) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void show(target, target > index ? 1 : -1, true);
    } else {
      currentRequest.current++; // nothing to move to: a move that was still on its way must not happen
      setWaiting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeColor]);

  const drag = useSlideDrag(track, total, index, go, true, looped);

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
      {looped && (
        <div className="product-thumbnails">
          {gallery.map((image, position) => ({ image, position })).filter(({ image }) => image.color === current.color).map(({ image, position }, shownAt) => (
            <button key={image.id} type="button" className={position === index ? "active" : ""} onClick={() => go(position)} aria-label={`View image ${shownAt + 1}`}>
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
        <div className={`slide-track${jumping ? " is-jumping" : ""}`} ref={track} style={{ "--i": looped ? pos : index } as CSSProperties} onTransitionEnd={(event) => { if (event.target === track.current && event.propertyName === "transform") settle(); }}>
          {(looped ? [{ image: gallery[last], position: last, copy: "before" }, ...gallery.map((image, position) => ({ image, position, copy: "" })), { image: gallery[0], position: 0, copy: "after" }] : gallery.map((image, position) => ({ image, position, copy: "" }))).map(({ image, position, copy }) => (
            <div className="slide" key={`${image.id}${copy}`} aria-hidden={position !== index || Boolean(copy)}>
              {(position === 0 || seen.has(position) || position === index) && (
                <Image
                  src={image.url}
                  alt={image.altText}
                  fill
                  priority={position === 0 && !copy}
                  loading={position === 0 && !copy ? undefined : "eager"}
                  className={position === 0 ? undefined : "slide-late"}
                  ref={(element) => {
                    if (position > 0 && element?.complete && element.naturalWidth) {
                      element.dataset.ready = "1";
                      loaded.current.add(position);
                    }
                  }}
                  onLoad={(event) => {
                    event.currentTarget.dataset.ready = "1";
                    loaded.current.add(position);
                  }}
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
              {String(gallery.filter((slide, at) => slide.color === current.color && at <= index).length).padStart(2, "0")} / {String(gallery.filter((slide) => slide.color === current.color).length).padStart(2, "0")}
            </span>
            <button type="button" className="slide-arrow prev" aria-label="Previous photo" data-busy={waiting || undefined} onClick={(event) => { event.stopPropagation(); stepLoop(-1); }}>
              <Chevron left />
            </button>
            <button type="button" className="slide-arrow next" aria-label="Next photo" data-busy={waiting || undefined} onClick={(event) => { event.stopPropagation(); stepLoop(1); }}>
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
