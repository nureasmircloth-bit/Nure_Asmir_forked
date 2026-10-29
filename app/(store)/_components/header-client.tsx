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

export type NavNode = {
  name: string;
  slug: string;
  subcategories?: string[];
  /** Biggest percentage off in this category right now (0/undefined = none). */
  discount?: number;
  /** The categories inside this one (Shirts -> Formal Shirts -> ...), each with its own. */
  kids?: NavNode[];
};
type NavCategory = NavNode;

type Hit = SearchHit;

const Icon = {
  menu: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h18" /></svg>,
  search: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>,
  bag: <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8z" /><path d="M9 8V6a3 3 0 016 0v2" /></svg>,
  heart: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M12 21s-7.5-4.6-10.2-9.1C.2 8.9 1.4 5 5 4c2.4-.7 4.6.4 7 3 2.4-2.6 4.6-3.7 7-3 3.6 1 4.8 4.9 3.2 7.9C19.5 16.4 12 21 12 21z" strokeLinejoin="round" /></svg>,
  close: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>,
  chevronDown: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>,
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
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const wishlistCount = useWishlist().length;

  const toggleCategory = (slug: string) => {
    setExpandedCategories((prev) => ({ ...prev, [slug]: !prev[slug] }));
  };

  /** One category in the menu drawer, with the categories inside it (and theirs) shown when it is opened. A category with none keeps the old
   * comma-separated subcategory links, if the owner wrote any. */
  const renderNode = (category: NavNode, depth: number): React.ReactNode => {
    const kids = category.kids ?? [];
    const legacy = kids.length === 0 ? (category.subcategories ?? []) : [];
    const hasSubs = kids.length > 0 || legacy.length > 0;
    const isOpen = Boolean(expandedCategories[category.slug]);
    return (
      <div key={category.slug} className={`drawer-group ${isOpen ? "is-expanded" : ""}${depth ? " is-nested" : ""}`}>
        <div className="drawer-cat-row">
          <Link href={`/collections/${category.slug}`} onClick={closeAll} className="drawer-cat-link">
            <span>{category.name}</span>
            {category.discount ? <em className="nav-sale">Up to −{category.discount}%</em> : null}
          </Link>
          {hasSubs && (
            <button
              type="button"
              className="drawer-expand-btn"
              onClick={() => toggleCategory(category.slug)}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? "Collapse" : "Expand"} ${category.name} subcategories`}
            >
              {Icon.chevronDown}
            </button>
          )}
        </div>
        {hasSubs && isOpen && (
          <div className="drawer-sub-list">
            {kids.map((kid) => renderNode(kid, depth + 1))}
            {legacy.length > 0 && (
              <>
                <Link href={`/collections/${category.slug}`} onClick={closeAll} className="drawer-sub-link is-all">All {category.name}</Link>
                {legacy.map((sub) => (
                  <Link key={sub} href={`/collections/${category.slug}?q=${encodeURIComponent(sub)}`} onClick={closeAll} className="drawer-sub-link">{sub}</Link>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

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
  const searchTrigger = useRef<HTMLElement | null>(null); // the control that had focus before search took it
  const rememberTrigger = () => {
    const active = document.activeElement;
    searchTrigger.current = active instanceof HTMLElement && active !== document.body ? active : null;
  };
  const openSearch = () => {
    rememberTrigger();
    setSearchOpen(true);
    document.getElementById("site-search-input")?.focus();
  };
  // The bottom bar's Search button (phones) asks the header to open the search panel.
  useEffect(() => {
    const open = () => {
      rememberTrigger();
      setSearchOpen(true);
      document.getElementById("site-search-input")?.focus();
    };
    window.addEventListener("na-open-search", open);
    return () => window.removeEventListener("na-open-search", open);
  }, []);
  // Focus goes back to the button that opened a panel however it was closed (Escape, scrim or a close button); once the panel is inert,
  // focus left inside it would fall to <body> and a keyboard user would lose their place.
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef({ menu: false, search: false });
  const openers = useRef<{ menu: HTMLElement | null; search: HTMLElement | null }>({ menu: null, search: null });
  useEffect(() => {
    const active = document.activeElement;
    const lost = !active || active === document.body || (active instanceof HTMLElement && !!active.closest(".drawer, .search-overlay"));
    // a panel that has just opened: remember the control that opened it (focus is still on it at this point)
    if (!wasOpen.current.menu && menuOpen && active instanceof HTMLElement && active !== document.body) openers.current.menu = active;
    if (!wasOpen.current.search && searchOpen) openers.current.search = searchTrigger.current; // recorded before focus moved into the search box
    const back = (opener: HTMLElement | null, fallback: HTMLElement | null) => (opener?.isConnected && opener.getClientRects().length > 0 ? opener : fallback)?.focus();
    if (wasOpen.current.menu && !menuOpen && lost) back(openers.current.menu, menuButtonRef.current);
    if (wasOpen.current.search && !searchOpen && lost) back(openers.current.search, searchButtonRef.current);
    wasOpen.current = { menu: menuOpen, search: searchOpen };
  }, [menuOpen, searchOpen]);
  const closeAll = () => {
    setMenuOpen(false);
    setSearchOpen(false);
  };

  return (
    <>
      <AnnouncementBar messages={messages} style={announcementStyle} />

      <header className="site-header">
        <div className="hdr-side">
          <button
            ref={menuButtonRef}
            type="button"
            className="icon-btn"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            {menuOpen ? Icon.close : Icon.menu}
          </button>
          <button ref={searchButtonRef} type="button" className="icon-btn hdr-search-btn" aria-label="Search" onClick={openSearch}>
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
          <Link href="/wishlist" className="icon-btn" aria-label={`Wishlist, ${wishlistCount} saved`} suppressHydrationWarning>
            {Icon.heart}
            <span className="cart-count" data-empty={wishlistCount === 0} suppressHydrationWarning>
              {wishlistCount}
            </span>
          </Link>
          <Link href="/cart" className={`icon-btn${bump ? " is-bumped" : ""}`} aria-label={`Bag, ${bagCount} items`} suppressHydrationWarning>
            {Icon.bag}
            <span className="cart-count" data-empty={bagCount === 0} suppressHydrationWarning>
              {bagCount}
            </span>
          </Link>
        </div>
      </header>

      {(menuOpen || searchOpen) && <button type="button" className="scrim" aria-label="Close panel" onClick={closeAll} />}

      <aside className={`drawer ${menuOpen ? "is-open" : ""}`} inert={!menuOpen ? true : undefined} role="dialog" aria-modal="true" aria-label="Menu">
        <div className="drawer-top">
          <span className="drawer-title">Explore</span>
          <button
            type="button"
            className="icon-btn drawer-close-btn"
            aria-label="Close menu"
            onClick={() => {
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              setMenuOpen(false);
            }}
          >
            {Icon.close}
          </button>
        </div>
        <nav className="drawer-nav">
          <Link href="/" onClick={closeAll} className="drawer-nav-item">Home</Link>
          <Link href="/shop" onClick={closeAll} className="drawer-nav-item">
            <span>New arrivals</span>
            <span className="drawer-new-pill">New</span>
          </Link>
          {categories.map((category) => renderNode(category, 0))}
          <Link href="/about" onClick={closeAll} className="drawer-nav-item">Our story</Link>
          <Link href="/track-order" onClick={closeAll} className="drawer-nav-item">Track order</Link>
          <Link href="/contact" onClick={closeAll} className="drawer-nav-item">Contact</Link>
        </nav>
        <div className="drawer-foot">
          <a href={waLink} target="_blank" rel="noreferrer" className="drawer-foot-wa">
            <span className="drawer-wa-dot" /> WhatsApp us
          </a>
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

/** Shows live product search results and refreshes their sale prices as the query changes. */
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
    // New results never inherit the previous results' discounts (a failed lookup or an empty list leaves no stale sale price behind).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeals({});
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
  const handleClose = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    onClose();
  };

  return (
    <div
      className={`search-overlay ${open ? "is-open" : ""}`}
      inert={!open ? true : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
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
          name="q"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search kameez shalwar, shirts, pants…"
          aria-label="Search products"
          autoComplete="off"
        />
        <button type="button" className="icon-btn" aria-label="Close search" onClick={handleClose}>
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
                  {hit.comingSoon ? <span className="price-request">Coming soon</span> : hit.priceOnRequest ? <span className="price-request">Price on request</span> : <Price amount={deals[hit.objectID]?.price ?? hit.price} />}
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
