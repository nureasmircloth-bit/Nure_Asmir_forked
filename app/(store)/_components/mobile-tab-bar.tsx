"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cartCount, readCart } from "@/lib/cart";
import { useWishlist } from "@/lib/wishlist";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const Icons = {
  home: (
    <svg width="25" height="25" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M3.5 11.2 12 4l8.5 7.2M5.8 9.8V20h12.4V9.8M10 20v-5.5h4V20" />
    </svg>
  ),
  shop: (
    <svg width="25" height="25" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z" />
    </svg>
  ),
  search: (
    <svg width="25" height="25" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  ),
  heart: (
    <svg width="25" height="25" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M12 21s-7.5-4.6-10.2-9.1C.2 8.9 1.4 5 5 4c2.4-.7 4.6.4 7 3 2.4-2.6 4.6-3.7 7-3 3.6 1 4.8 4.9 3.2 7.9C19.5 16.4 12 21 12 21z" />
    </svg>
  ),
  bag: (
    <svg width="25" height="25" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M5 8h14l-1 12H6L5 8z" />
      <path d="M9 8V6a3 3 0 016 0v2" />
    </svg>
  ),
};

/**
 * The row of five big buttons along the bottom of a phone screen (Home, Shop, Search, Saved, Bag) – the way the large fashion shops
 * do it, so the thumb never has to reach to the top corner. Only drawn on phones (see storefront.css) and never while checking out.
 */
export function MobileTabBar() {
  const pathname = usePathname() || "/";
  const wishlist = useWishlist().length;
  const [bag, setBag] = useState(0);

  useEffect(() => {
    const update = () => setBag(cartCount(readCart()));
    update();
    window.addEventListener("na-cart-change", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("na-cart-change", update);
      window.removeEventListener("storage", update);
    };
  }, []);

  if (pathname.startsWith("/checkout")) return null;
  const on = (test: boolean) => (test ? { "aria-current": "page" as const } : {});
  const count = (n: number) => (n > 0 ? <span className="tab-count">{n > 99 ? "99+" : n}</span> : null);

  return (
    <nav className="tab-bar" aria-label="Quick links">
      <Link href="/" {...on(pathname === "/")}>
        {Icons.home}
        <span>Home</span>
      </Link>
      <Link href="/shop" {...on(pathname === "/shop" || pathname.startsWith("/collections") || pathname.startsWith("/products"))}>
        {Icons.shop}
        <span>Shop</span>
      </Link>
      <button type="button" onClick={() => window.dispatchEvent(new Event("na-open-search"))}>
        {Icons.search}
        <span>Search</span>
      </button>
      <Link href="/wishlist" {...on(pathname.startsWith("/wishlist"))} aria-label={`Saved, ${wishlist} items`}>
        {Icons.heart}
        <span>Saved</span>
        {count(wishlist)}
      </Link>
      <Link href="/cart" {...on(pathname.startsWith("/cart"))} aria-label={`Bag, ${bag} items`}>
        {Icons.bag}
        <span>Bag</span>
        {count(bag)}
      </Link>
    </nav>
  );
}
