"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { CardProduct } from "@/lib/commerce";
import { useLockedAction } from "@/lib/use-locked-action";
import { useSlideDrag } from "@/lib/use-slide-drag";
import { Price } from "./currency";
import { discountLabel } from "./sale";
import { WishlistButton } from "./wishlist-button";

const CardChevron = ({ left }: { left?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={left ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
  </svg>
);

/**
 * A product card. When the product has more photos, the picture can be changed right on the card – swipe it (in grids, where the page
 * scrolls up and down), tap the small arrows, or rest the mouse on it – without opening the product. `swipe` is off in the sideways
 * "New arrivals" row, where a swipe on a card must keep scrolling the row; its arrows and dots still work there.
 */
export function ProductCard({ product, priority = false, sizes, swipe = true }: { product: CardProduct; priority?: boolean; sizes?: string; swipe?: boolean }) {
  const soldOut = product.stock < 1;
  const saleLabel = discountLabel(product.price, product.compareAtPrice);
  const cardSizes = sizes ?? "(max-width: 700px) 46vw, (max-width: 1100px) 25vw, 20vw";
  const photos = [product.imageUrl ?? "/placeholder.webp", ...(product.moreImageUrls ?? (product.altImageUrl ? [product.altImageUrl] : []))];
  const many = photos.length > 1;
  const last = photos.length - 1;
  const [index, setIndex] = useState(0);
  const [seen, setSeen] = useState<ReadonlySet<number>>(new Set([0]));
  const track = useRef<HTMLDivElement>(null);
  const go = (next: number) => {
    const to = Math.max(0, Math.min(last, next));
    setIndex(to);
    setSeen((before) => new Set([...before, to, to + 1]));
  };
  const drag = useSlideDrag(track, photos.length, index, go, swipe);
  // Other photos are only downloaded once the shopper reaches for the card (touch, mouse or keyboard), not for every card on the page.
  const prime = () => setSeen((before) => (before.has(1) ? before : new Set([...before, 1])));
  return (
    <article className="pcard">
      <div
        className={`pcard-media${many ? " has-many" : ""}${many && swipe ? " can-swipe" : ""}`}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse" && many) {
            prime();
            setIndex(1); // a mouse resting on the card previews the second photo, as before
          }
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse" && many) setIndex(0);
        }}
        onFocus={prime}
        {...(many ? { ...drag.handlers, onTouchStart: (event: React.TouchEvent) => { prime(); drag.handlers.onTouchStart(event); } } : {})}
        onClickCapture={(event) => {
          if (!drag.clickable()) {
            event.preventDefault(); // lifting a finger after a swipe is not a tap on the product
            event.stopPropagation();
          }
        }}
      >
        <Link href={`/products/${product.slug}`} className="pcard-link" aria-label={product.name}>
          <div className="slide-track" ref={track} style={{ "--i": index } as React.CSSProperties}>
            {photos.map((url, position) => (
              <div className="slide" key={url}>
                {(position === 0 || seen.has(position)) && (
                  <Image
                    src={url}
                    alt={position === 0 ? product.name : ""}
                    fill
                    sizes={cardSizes}
                    priority={priority && position === 0}
                    loading={position === 0 ? undefined : "lazy"}
                    {...(position === 0 && product.blurDataUrl ? { placeholder: "blur" as const, blurDataURL: product.blurDataUrl } : {})}
                  />
                )}
              </div>
            ))}
          </div>
          {soldOut ? (
            <span className="pcard-badge soldout">Sold out</span>
          ) : saleLabel ? (
            <span className="pcard-badge sale">{saleLabel}</span>
          ) : product.badge ? (
            <span className="pcard-badge">{product.badge}</span>
          ) : null}
        </Link>
        {many && (
          <>
            <button type="button" className="slide-arrow prev" aria-label={`Previous photo of ${product.name}`} disabled={index === 0} onClick={() => { prime(); go(index - 1); }}>
              <CardChevron left />
            </button>
            <button type="button" className="slide-arrow next" aria-label={`Next photo of ${product.name}`} disabled={index === last} onClick={() => { prime(); go(index + 1); }}>
              <CardChevron />
            </button>
            <div className="slide-dots" aria-hidden="true">
              {photos.map((url, position) => (
                <i key={url} className={position === index ? "on" : ""} />
              ))}
            </div>
          </>
        )}
      </div>
      <WishlistButton productId={product.id} name={product.name} />
      <div className="pcard-info">
        <Link href={`/products/${product.slug}`} className="pcard-title">
          {product.name}
        </Link>
        <p className={`pcard-price${saleLabel ? " is-sale" : ""}`}>
          {product.compareAtPrice && product.compareAtPrice > product.price && (
            <s>
              <Price amount={product.compareAtPrice} />
            </s>
          )}
          <Price amount={product.price} />
        </p>
      </div>
    </article>
  );
}

/** Horizontal, snap-scrolling product row (the "New arrivals" carousel). */
export function ProductRail({ products }: { products: CardProduct[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<"none" | "start" | "middle" | "end">("start");

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // Everything fits: there is nothing to scroll to, so both arrows stay disabled.
    setEdge(max <= 4 ? "none" : el.scrollLeft <= 4 ? "start" : el.scrollLeft >= max - 4 ? "end" : "middle");
  }

  useEffect(() => {
    onScroll();
    window.addEventListener("resize", onScroll);
    return () => window.removeEventListener("resize", onScroll);
  }, [products.length]);
  function scrollBy(direction: 1 | -1) {
    const el = ref.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  }

  return (
    <div className="rail-wrap">
      <button type="button" className="rail-arrow rail-prev" aria-label="Previous products" disabled={edge === "start"} onClick={() => scrollBy(-1)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <div className="rail" ref={ref} onScroll={onScroll}>
        {products.map((product, index) => (
          <ProductCard key={product.slug} product={product} priority={index < 3} swipe={false} />
        ))}
      </div>
      <button type="button" className="rail-arrow rail-next" aria-label="Next products" disabled={edge === "end" || edge === "none"} onClick={() => scrollBy(1)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
  );
}

export function NewsletterForm() {
  const [message, setMessage] = useState("");
  const action = useLockedAction();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "");
    await action.run(async () => {
      try {
        const response = await fetch("/api/newsletter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        setMessage(response.ok ? "Thank you — you're on the list." : result.error ?? "Please try again.");
        if (response.ok) form.reset();
      } catch {
        setMessage("Could not reach the server. Please try again.");
      }
    });
  }
  return (
    <>
      <form className="newsletter-form" onSubmit={submit}>
        <label>
          <span className="sr-only">Email address</span>
          <input name="email" type="email" required placeholder="Email address" autoComplete="email" />
        </label>
        <button type="submit" disabled={action.pending} aria-busy={action.pending}>
          {action.pending ? <span className="spinner spinner-light" aria-label="Subscribing" /> : "Subscribe"}
        </button>
      </form>
      <p className="form-message" aria-live="polite">
        {message}
      </p>
    </>
  );
}
