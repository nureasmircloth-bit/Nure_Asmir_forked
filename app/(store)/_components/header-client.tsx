"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { searchProducts } from "@/lib/search/client";
import type { SearchHit } from "@/lib/search/types";
import { cartCount, readCart } from "@/lib/cart";
import { AnnouncementBar } from "@/components/announcement-bar";
import type { AnnouncementStyle } from "@/lib/shop-rules";
import { useWishlist } from "@/lib/wishlist";
import { Price } from "./currency";
import { discountLabel } from "./sale";

type NavCategory = { name: string; slug: string; /** Biggest percentage off in this category right now (0/undefined = none). */ discount?: number };

type Hit = SearchHit;

const Icon = {
  menu: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h18" /></svg>,
  search: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>,
  bag: <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8z" /><path d="M9 8V6a3 3 0 016 0v2" /></svg>,
  heart: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M12 21s-7.5-4.6-10.2-9.1C.2 8.9 1.4 5 5 4c2.4-.7 4.6.4 7 3 2.4-2.6 4.6-3.7 7-3 3.6 1 4.8 4.9 3.2 7.9C19.5 16.4 12 21 12 21z" strokeLinejoin="round" /></svg>,
  close: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>,
};

export function HeaderClient({
  categories,
  messages,
  announcementStyle,
  whatsappNumber,
}: {
  categories: NavCategory[];
  /** The lines of the strip at the top of the page (built from the shop's rules in the admin); empty hides the strip. */
  messages: string[];
  announcementStyle: AnnouncementStyle;
  whatsappNumber: string;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [bagCount, setBagCount] = useState(0);
  const [bump, setBump] = useState(false);
  const wishlistCount = useWishlist().length;

  useEffect(() => {
    let before = cartCount(readCart());
    let timer = 0;
    const update = () => {
      const next = cartCount(readCart());
      setBagCount(next);
      // The bag icon gives a little hop when something is added, so the tap is always acknowledged.
      if (next > before) {
        setBump(true);
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setBump(false), 700);
      }
      before = next;
    };
    update();
    window.addEventListener("na-cart-change", update);
    window.addEventListener("storage", update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("na-cart-change", update);
      window.removeEventListener("storage", update);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen || searchOpen ? "hidden" : "";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, searchOpen]);

  const waLink = whatsappNumber ? `https://wa.me/${whatsappNumber.replace(/[^\d]/g, "")}` : "/contact";
  // Open and focus in the same tap: on iOS the keyboard only appears for a focus() made inside the gesture.
  const openSearch = () => {
    setSearchOpen(true);
    document.getElementById("site-search-input")?.focus();
  };
  // The bottom bar's Search button (phones) asks the header to open the search panel.
  useEffect(() => {
    const open = () => {
      setSearchOpen(true);
      document.getElementById("site-search-input")?.focus();
    };
    window.addEventListener("na-open-search", open);
    return () => window.removeEventListener("na-open-search", open);
  }, []);
  const closeAll = () => {
    setMenuOpen(false);
    setSearchOpen(false);
  };

  return (
    <>
      <AnnouncementBar messages={messages} style={announcementStyle} />

      <header className="site-header">
        <div className="hdr-side">
          <button type="button" className="icon-btn" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
            {Icon.menu}
          </button>
          <button type="button" className="icon-btn" aria-label="Search" onClick={openSearch}>
            {Icon.search}
          </button>
          <button type="button" className="hdr-search-hint" onClick={openSearch}>
            Search
          </button>
        </div>
        <Link href="/" className="logo" aria-label="Nure Asmir — home">
          <Image src="/brand/wordmark-v2.png" alt="Nure Asmir" width={969} height={155} priority unoptimized />
        </Link>
        <div className="hdr-side hdr-right">
          <Link href="/wishlist" className="icon-btn" aria-label={`Wishlist, ${wishlistCount} saved`}>
            {Icon.heart}
            <span className="cart-count" data-empty={wishlistCount === 0}>
              {wishlistCount}
            </span>
          </Link>
          <Link href="/cart" className={`icon-btn${bump ? " is-bumped" : ""}`} aria-label={`Bag, ${bagCount} items`}>
            {Icon.bag}
            <span className="cart-count" data-empty={bagCount === 0}>
              {bagCount}
            </span>
          </Link>
        </div>
      </header>

      {(menuOpen || searchOpen) && <button type="button" className="scrim" aria-label="Close panel" onClick={closeAll} />}

      <aside className={`drawer ${menuOpen ? "is-open" : ""}`} aria-hidden={!menuOpen} aria-label="Menu">
        <div className="drawer-top">
          <Link href="/" className="logo" onClick={closeAll} aria-label="Nure Asmir — home">
            <Image src="/brand/wordmark-v2.png" alt="Nure Asmir" width={969} height={155} unoptimized />
          </Link>
          <button type="button" className="icon-btn" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
            {Icon.close}
          </button>
        </div>
        <nav>
          <Link href="/" onClick={closeAll}>Home</Link>
          <Link href="/shop" onClick={closeAll}>New arrivals</Link>
          {categories.map((category) => (
            <Link key={category.slug} href={`/collections/${category.slug}`} onClick={closeAll}>
              {category.name}
              {category.discount ? <em className="nav-sale">Up to −{category.discount}%</em> : null}
            </Link>
          ))}
          <Link href="/about" onClick={closeAll}>Our story</Link>
          <Link href="/track-order" onClick={closeAll}>Track order</Link>
          <Link href="/contact" onClick={closeAll}>Contact</Link>
        </nav>
        <div className="drawer-foot">
          <a href={waLink} target="_blank" rel="noreferrer">WhatsApp us</a>
          <Link href="/faq" onClick={closeAll}>FAQ</Link>
          <Link href="/policies/shipping" onClick={closeAll}>Shipping &amp; returns</Link>
        </div>
      </aside>

      <SearchOverlay
        open={searchOpen}
        categories={categories}
        onClose={() => setSearchOpen(false)}
        onSubmit={(query) => {
          setSearchOpen(false);
          router.push(`/search?q=${encodeURIComponent(query)}`);
        }}
      />
    </>
  );
}

function SearchOverlay({
  open,
  categories,
  onClose,
  onSubmit,
}: {
  open: boolean;
  categories: NavCategory[];
  onClose: () => void;
  onSubmit: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [engine, setEngine] = useState<"algolia" | "local">("algolia");
  // Live discounts for the results on screen (the search index only knows the normal price).
  const [deals, setDeals] = useState<Record<string, { price: number; compareAtPrice: number }>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      // Clearing results when the query is emptied is derived state that must follow the input.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHits([]);
      setTotal(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchProducts(term, 8)
        .then((result) => {
          if (cancelled) return;
          setHits(result.hits);
          setTotal(result.total);
          setEngine(result.engine);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const ids = hits.map((hit) => hit.objectID).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (!ids.length) return;
    let cancelled = false;
    fetch(`/api/catalog/prices?ids=${ids.join(",")}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { prices?: Record<string, { price: number; compareAtPrice: number }> } | null) => {
        if (!cancelled && body?.prices) setDeals(body.prices);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hits]);

  const term = query.trim();
  return (
    <div className={`search-overlay ${open ? "is-open" : ""}`} aria-hidden={!open} role="dialog" aria-label="Search">
      <form
        className="search-bar"
        onSubmit={(event) => {
          event.preventDefault();
          if (term) onSubmit(term);
        }}
      >
        {Icon.search}
        <input
          id="site-search-input"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search kameez shalwar, shirts, pants…"
          aria-label="Search products"
          autoComplete="off"
        />
        <button type="button" className="icon-btn" aria-label="Close search" onClick={onClose}>
          {Icon.close}
        </button>
      </form>

      {!term && (
        <div className="search-suggest">
          {categories.map((category) => (
            <button key={category.slug} type="button" onClick={() => setQuery(category.name)}>
              {category.name}
            </button>
          ))}
        </div>
      )}

      {term && (
        <div className="search-results">
          <p className="search-meta" aria-live="polite">
            {loading ? "Searching…" : total ? `${total} result${total === 1 ? "" : "s"}` : "No matches — try another word"}
          </p>
          <div className="search-hits">
            {hits.map((hit) => (
              <Link key={hit.objectID} href={`/products/${hit.slug}`} className="search-hit" onClick={onClose}>
                <div className="search-hit-media">
                  <Image src={hit.imageUrl ?? "/placeholder.webp"} alt="" fill sizes="(max-width: 900px) 46vw, 240px" />
                  {deals[hit.objectID] && <span className="pcard-badge sale">{discountLabel(deals[hit.objectID].price, deals[hit.objectID].compareAtPrice)}</span>}
                </div>
                <p
                  className="search-hit-title"
                  dangerouslySetInnerHTML={{ __html: sanitizeHighlight(hit.highlight ?? hit.name) }}
                />
                <p className="search-hit-price">
                  {deals[hit.objectID] && (
                    <s>
                      <Price amount={deals[hit.objectID].compareAtPrice} />
                    </s>
                  )}
                  <Price amount={deals[hit.objectID]?.price ?? hit.price} />
                </p>
              </Link>
            ))}
          </div>
          {total > hits.length && (
            <div className="search-all">
              <button type="button" className="button button-dark" onClick={() => onSubmit(term)}>
                View all {total} results
              </button>
            </div>
          )}
          {engine === "algolia" && <p className="search-powered">Search by Algolia</p>}
        </div>
      )}
    </div>
  );
}

/** Algolia returns the product name with <mark> tags around matches — escape everything else so
 * a product name can never inject markup. */
function sanitizeHighlight(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}
