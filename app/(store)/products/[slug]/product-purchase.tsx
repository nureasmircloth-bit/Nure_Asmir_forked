"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CatalogProduct, CatalogVariant } from "@/lib/commerce";
import { addCartItem, readCart, updateCartItemQuantity } from "@/lib/cart";
import { Price } from "../../_components/currency";
import { Portal } from "../../_components/portal";
import { SizeGuideLink } from "./size-guide";

type Added = { variantId: string; variantName: string; price: number; inBag: number };

export function ProductPurchase({
  product,
  colors,
  color,
  onColor,
  colorVariants,
  choosesSize,
  fixedSize,
  selected,
  onSize,
}: {
  product: CatalogProduct;
  colors: string[];
  color: string;
  onColor: (color: string) => void;
  colorVariants: CatalogVariant[];
  /** True when there is a real choice of sizes. A product with one size (or none) never asks. */
  choosesSize: boolean;
  /** The only size, shown as plain text ("One size"), when there is nothing to choose. */
  fixedSize?: string;
  /** The chosen variant, or null while a size still has to be picked. */
  selected: CatalogVariant | null;
  onSize: (variantId: string) => void;
}) {
  const router = useRouter();
  const sizeRow = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  const [needSize, setNeedSize] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  // idle → adding (a short spinner, so a tap is never ignored) → done (tick) → idle. While not idle, taps are ignored: no accidental 100.
  const [phase, setPhase] = useState<"idle" | "adding" | "done" | "buying">("idle");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(null), 8000);
    return () => window.clearTimeout(timer);
  }, [added]);

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  function askForSize() {
    setNeedSize(true);
    setMessage("");
    const row = sizeRow.current;
    if (!row) return;
    const box = row.getBoundingClientRect();
    // Only move the page when the sizes are not already on screen (and below the sticky header).
    if (box.top < 80 || box.bottom > window.innerHeight - 40) row.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function add(buyNow = false) {
    if (phase !== "idle") return;
    if (!selected) {
      askForSize();
      return;
    }
    if (selected.available < 1) {
      setMessage("This option is currently sold out.");
      return;
    }
    const quantityBefore = readCart().find((item) => item.variantId === selected.id)?.quantity ?? 0;
    addCartItem({
      variantId: selected.id,
      productId: product.id,
      slug: product.slug,
      name: product.name,
      variantName: selected.name,
      sku: selected.sku,
      price: selected.price,
      quantity: 1,
      imageUrl: product.imageUrl,
      available: selected.available,
    });
    const quantityAfter = readCart().find((item) => item.variantId === selected.id)?.quantity ?? 0;
    if (quantityAfter === quantityBefore) {
      setMessage(`You already have the maximum available (${selected.available}) in your bag.`);
      return;
    }
    setMessage("");
    if (buyNow) {
      setPhase("buying"); // stays locked until the cart page replaces this one
      router.push("/cart");
      return;
    }
    setPhase("adding");
    later(() => {
      setPhase("done");
      setAdded({ variantId: selected.id, variantName: selected.name, price: selected.price, inBag: quantityAfter });
      later(() => setPhase("idle"), 1400);
    }, 450);
  }

  function undo() {
    if (!added) return;
    updateCartItemQuantity(added.variantId, added.inBag - 1);
    setAdded(null);
    setPhase("idle");
  }

  const allSoldOut = colorVariants.every((variant) => variant.available < 1);
  const blocked = allSoldOut || phase !== "idle" || (selected !== null && selected.available < 1);

  return (
    <div className="purchase-block">
      {colors.length > 1 && (
        <>
          <div className="choice-row">
            <span>Colour</span>
            <strong>{color}</strong>
          </div>
          <div className="color-options">
            {colors.map((item) => (
              <button key={item} type="button" className={item === color ? "active" : ""} onClick={() => onColor(item)}>
                {item}
              </button>
            ))}
          </div>
        </>
      )}

      {choosesSize ? (
        <>
          <div className="choice-row">
            <span>Size</span>
            <span className="choice-row-end">
              {selected?.size && <strong>{selected.size}</strong>}
              <SizeGuideLink product={product} />
            </span>
          </div>
          <div ref={sizeRow} className={`size-options${needSize && !selected ? " needs-size" : ""}`} role="radiogroup" aria-label="Size">
            {colorVariants.map((variant) => (
              <button
                key={variant.id}
                type="button"
                role="radio"
                aria-checked={selected?.id === variant.id}
                className={selected?.id === variant.id ? "active" : ""}
                disabled={variant.available < 1}
                onClick={() => {
                  onSize(variant.id);
                  setMessage("");
                  setNeedSize(false);
                }}
                title={variant.available < 1 ? "Sold out" : undefined}
              >
                {variant.size}
              </button>
            ))}
          </div>
          {needSize && !selected && (
            <p className="size-hint" role="status">
              Choose a size and you&apos;re set.
            </p>
          )}
        </>
      ) : fixedSize ? (
        <div className="choice-row choice-row-plain">
          <span>Size</span>
          <strong>{fixedSize}</strong>
        </div>
      ) : null}

      {selected && selected.available < 1 ? (
        <p className="stock-badge stock-badge-out">Sold out</p>
      ) : selected && selected.available < 5 ? (
        <p className="stock-badge stock-badge-low">Only {selected.available} left in stock</p>
      ) : allSoldOut ? (
        <p className="stock-badge stock-badge-out">Sold out</p>
      ) : null}

      <button className={`add-button${phase === "done" ? " is-done" : ""}`} type="button" disabled={blocked} onClick={() => add()} aria-busy={phase === "adding"}>
        {allSoldOut ? (
          "Sold out"
        ) : phase === "adding" ? (
          <span className="busy-label">
            <i className="spinner spinner-light" aria-hidden="true" /> Adding…
          </span>
        ) : phase === "done" ? (
          <span className="busy-label">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            Added to bag
          </span>
        ) : (
          "Add to bag"
        )}
      </button>
      <button className="buy-button" type="button" disabled={blocked} onClick={() => add(true)} aria-busy={phase === "buying"}>
        {phase === "buying" ? (
          <span className="busy-label">
            <i className="spinner" aria-hidden="true" /> Opening your bag…
          </span>
        ) : (
          "Buy it now"
        )}
      </button>
      {message && (
        <p className="purchase-message" role="alert">
          {message}
        </p>
      )}
      <div className="purchase-benefits">
        <span>Cash on delivery</span>
        <span>Nationwide delivery</span>
        <Link href="/policies/returns">Easy exchanges</Link>
      </div>
      {added && (
        <Portal>
          <div className="cart-toast" role="status" aria-live="polite">
            <button type="button" className="cart-toast-close" onClick={() => setAdded(null)} aria-label="Dismiss">
              ×
            </button>
            <div className="cart-toast-thumb">
              <Image src={product.imageUrl ?? "/placeholder.webp"} alt="" fill sizes="56px" />
            </div>
            <div className="cart-toast-body">
              <strong>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>{" "}
                Added to your bag
              </strong>
              <p>
                {product.name} — {added.variantName}
                {" · "}
                <Price amount={added.price} />
              </p>
              <p className="cart-toast-count">
                {added.inBag === 1 ? "1 of this in your bag" : `${added.inBag} of this in your bag`}
                {" · "}
                <button type="button" className="cart-toast-undo" onClick={undo}>
                  Undo
                </button>
              </p>
            </div>
            <div className="cart-toast-actions">
              <Link href="/cart" className="cart-toast-primary">
                View bag
              </Link>
              <button type="button" onClick={() => setAdded(null)}>
                Keep shopping
              </button>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
