"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CatalogProduct, CatalogVariant } from "@/lib/commerce";
import { Price } from "../../_components/currency";
import { discountLabel, SaleCountdown } from "../../_components/sale";
import { WishlistButton } from "../../_components/wishlist-button";
import { ProductGallery } from "./product-gallery";
import { ProductPurchase } from "./product-purchase";
import { BackButton } from "./back-button";

/** Renders the gallery and the buy column together so the chosen colour swaps the gallery to that
 * variant's own photos. Variants model a colour + size grid: shoppers pick a colour (when there is
 * more than one) and then a size; the matching variant drives price, stock and the cart line.
 * Returns a Fragment so the two-column `.product-page` grid applies directly to its children. */
export function ProductView({
  product,
  fallback,
  codReservationHours,
  freeDeliveryThreshold,
  refundWindowDays,
}: {
  product: CatalogProduct;
  fallback: string;
  codReservationHours: number;
  freeDeliveryThreshold: number;
  refundWindowDays: number;
}) {
  const variants = useMemo<CatalogVariant[]>(
    () =>
      product.variants.length
        ? product.variants
        : [
        {
          id: product.sku,
          name: product.color,
          sku: product.sku,
          color: product.color,
          price: product.price,
          compareAtPrice: product.compareAtPrice,
          stock: product.stock,
          reserved: 0,
          available: product.stock,
          isDefault: true,
        },
      ],
    [product],
  );

  const colors = useMemo(() => [...new Set(variants.map((variant) => variant.color))], [variants]);
  const defaultVariant = variants.find((variant) => variant.isDefault) ?? variants[0];
  const [color, setColor] = useState(defaultVariant.color);
  const [sizeId, setSizeId] = useState<string | null>(null);

  const colorVariants = variants.filter((variant) => variant.color === color);
  const sizeOptions = colorVariants.filter((variant) => variant.size);
  // A shopper is only asked for a size when there is a real choice. One size (or none) is implied: colour is a choice, a single size is not.
  const choosesSize = sizeOptions.length > 1;
  const selected: CatalogVariant | null = choosesSize ? (colorVariants.find((variant) => variant.id === sizeId) ?? null) : (colorVariants[0] ?? null);
  const shown = selected ?? colorVariants.find((variant) => variant.isDefault) ?? colorVariants[0] ?? defaultVariant;

  const gallery = useMemo(() => {
    const colorVariantIds = new Set(variants.filter((variant) => variant.color === color).map((variant) => variant.id));
    const own = product.images.filter((image) => image.variantId && colorVariantIds.has(image.variantId));
    if (own.length) return own;
    const shared = product.images.filter((image) => !image.variantId);
    return shared.length ? shared : product.images;
  }, [product.images, variants, color]);

  return (
    <>
      {/* Keyed by the image set so switching colour restarts on the first photo. */}
      <ProductGallery key={gallery.map((image) => image.id).join("|")} name={product.name} images={gallery} fallback={fallback} />
      <div className="product-buy">
        <nav aria-label="Breadcrumb">
          <BackButton />
          <Link href="/">Home</Link>
          <span>/</span>
          <Link href={`/collections/${product.category}`}>{product.type}</Link>
        </nav>
        <h1>{product.name}</h1>
        <p className="product-price">
          {shown.compareAtPrice && shown.compareAtPrice > shown.price && (
            <span className="product-price-compare">
              <Price amount={shown.compareAtPrice} />
            </span>
          )}
          <Price amount={shown.price} />
        </p>
        {shown.saleEndsAt && (
          <div className="sale-banner">
            <span className="sale-tag">{discountLabel(shown.price, shown.compareAtPrice) ?? "Sale"}</span>
            <SaleCountdown endsAt={shown.saleEndsAt} />
          </div>
        )}
        {product.shortDescription && <p className="product-intro">{product.shortDescription}</p>}
        <ProductPurchase
          product={product}
          colors={colors}
          color={color}
          onColor={(next) => {
            setColor(next);
            setSizeId(null);
          }}
          colorVariants={colorVariants}
          choosesSize={choosesSize}
          fixedSize={!choosesSize ? sizeOptions[0]?.size : undefined}
          selected={selected}
          onSize={setSizeId}
        />
        <WishlistButton productId={product.id} name={product.name} variant="inline" />
        <div className="product-accordions">
          <details open>
            <summary>
              Details <span>+</span>
            </summary>
            <p>{product.description || "Tailored with attention to fit and finish."}</p>
          </details>
          {(product.material || product.dimensions || product.careInstructions) && (
            <details>
              <summary>
                Material &amp; care <span>+</span>
              </summary>
              <p>
                {product.material ? `${product.material}. ` : ""}
                {product.dimensions ? `${product.dimensions}. ` : ""}
                {product.careInstructions}
              </p>
            </details>
          )}
          <details>
            <summary>
              Delivery &amp; returns <span>+</span>
            </summary>
            <ul className="product-facts">
              <li>
                <strong>Delivery all over Pakistan</strong> with TCS, usually in a few working days. The exact charge and timing for your city are shown at checkout.
              </li>
              <li>
                <strong>{freeDeliveryThreshold > 0 ? `Free delivery on orders above Rs. ${freeDeliveryThreshold.toLocaleString("en-PK")}.` : "Delivery charged by your area."}</strong> Cash on delivery: pay the rider when your parcel arrives.
              </li>
              <li>
                <strong>Easy exchange within {refundWindowDays} days</strong> of delivery if the piece is unworn, unwashed and has its tags. <Link href="/policies/returns">Read the full policy</Link>.
              </li>
              <li>
                <strong>Your order is held for you</strong> for {codReservationHours} hours while we confirm it by phone or WhatsApp.
              </li>
            </ul>
          </details>
        </div>
        <Link className="whatsapp-help" href="/contact">
          Need help? Talk to us on WhatsApp <span>↗︎</span>
        </Link>
      </div>
    </>
  );
}
