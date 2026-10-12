import type { Metadata } from "next";
import { countCatalogProducts, getCatalogProducts, SEARCH_MAX_WORDS, toCard, type CatalogProduct } from "@/lib/commerce";
import { searchProductIds } from "@/lib/search/server";
import { ProductCard } from "../_components/store-components";
import { StoreFooter } from "../_components/store-footer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Search", robots: { index: false, follow: true } };

/** Typo-tolerant search through Algolia, then mapped back onto the live catalogue so cards always show
 * current stock and prices. If Algolia's free allowance runs out (or it is unreachable) the built-in
 * MiniSearch engine answers instead – see lib/search/server.ts – so search never goes dark. */
const SEARCH_DISPLAY_LIMIT = 48;
const SEARCH_SCOPE_LIMIT = 200;

/** Only the products that match are read from the database: the engine's best ids first, otherwise a word match in the database. */
async function searchProducts(query: string): Promise<{ results: CatalogProduct[]; total: number }> {
  const { ids } = await searchProductIds(query, SEARCH_SCOPE_LIMIT).catch(() => ({ ids: [] as string[] }));
  let ordered: CatalogProduct[] = [];
  if (ids.length) {
    const live = await getCatalogProducts({ ids });
    const byId = new Map(live.map((product) => [product.id, product]));
    ordered = ids.map((id) => byId.get(id)).filter((product): product is CatalogProduct => !!product);
    if (ordered.length === ids.length) return { results: ordered, total: ordered.length }; // every product the engine named is still live
  }
  // The engine knew nothing, or some of what it named has been hidden since: fill up from the database.
  const [more, total] = await Promise.all([getCatalogProducts({ search: query, limit: SEARCH_SCOPE_LIMIT }), countCatalogProducts({ search: query })]);
  const seen = new Set(ordered.map((product) => product.id));
  const results = [...ordered, ...more.filter((product) => !seen.has(product.id))];
  return { results, total: Math.max(total, results.length) };
}

import Link from "next/link";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; min?: string; max?: string; sort?: string }> }) {
  const sp = await searchParams;
  const typed = String(sp.q ?? "").trim().slice(0, 100);
  const minPrice = sp.min ? Number(sp.min) : null;
  const maxPrice = sp.max ? Number(sp.max) : null;
  const sort = sp.sort === "low" || sp.sort === "high" ? sp.sort : "best";

  // Only the first ten words are used; the page says so instead of quietly ignoring the rest.
  const words = typed.split(/\s+/).filter(Boolean);
  const query = words.slice(0, SEARCH_MAX_WORDS).join(" ");
  const cut = words.length > SEARCH_MAX_WORDS;
  // Never paint hundreds of cards at once: the first 48 best matches, and a hint to narrow the search.
  const { results, total } = query ? await searchProducts(query) : { results: [] as CatalogProduct[], total: 0 };

  let filtered = results;
  if (minPrice != null && !Number.isNaN(minPrice)) filtered = filtered.filter((p) => p.price >= minPrice);
  if (maxPrice != null && !Number.isNaN(maxPrice)) filtered = filtered.filter((p) => p.price <= maxPrice);
  if (sort === "low") filtered = [...filtered].sort((a, b) => a.price - b.price);
  if (sort === "high") filtered = [...filtered].sort((a, b) => b.price - a.price);

  const filteredTotal = filtered.length;
  const displayed = filtered.slice(0, SEARCH_DISPLAY_LIMIT);

  return (
    <main className="page-fade-in">
      <section className="search-page">
        <header>
          <h1 className="page-title">{query ? `Results for “${query}”` : "Search"}</h1>
          <p className="result-count">
            {query
              ? filteredTotal !== total
                ? `Showing ${displayed.length} of ${filteredTotal} products (filtered from ${total})`
                : `${total} ${total === 1 ? "product" : "products"}`
              : "Use the search button to find a product."}
          </p>
          {cut && <p className="result-count">Only the first {SEARCH_MAX_WORDS} words of your search were used.</p>}
        </header>

        {query && results.length > 0 && (
          <div className="in-cat-search-row" style={{ maxWidth: 880, margin: "0 auto 28px" }}>
            <div className="in-cat-price-pills">
              <span className="price-pill-label">Price:</span>
              <Link
                href={`/search?q=${encodeURIComponent(query)}${sort !== "best" ? `&sort=${sort}` : ""}`}
                className={`price-pill ${minPrice == null && maxPrice == null ? "is-active" : ""}`}
              >
                All
              </Link>
              <Link
                href={`/search?q=${encodeURIComponent(query)}&max=5000${sort !== "best" ? `&sort=${sort}` : ""}`}
                className={`price-pill ${maxPrice === 5000 && minPrice == null ? "is-active" : ""}`}
              >
                Under 5k
              </Link>
              <Link
                href={`/search?q=${encodeURIComponent(query)}&min=5000&max=10000${sort !== "best" ? `&sort=${sort}` : ""}`}
                className={`price-pill ${minPrice === 5000 && maxPrice === 10000 ? "is-active" : ""}`}
              >
                5k–10k
              </Link>
              <Link
                href={`/search?q=${encodeURIComponent(query)}&min=10000${sort !== "best" ? `&sort=${sort}` : ""}`}
                className={`price-pill ${minPrice === 10000 && maxPrice == null ? "is-active" : ""}`}
              >
                10k+
              </Link>
            </div>
            <div className="in-cat-price-pills">
              <span className="price-pill-label">Sort:</span>
              <Link
                href={`/search?q=${encodeURIComponent(query)}${minPrice ? `&min=${minPrice}` : ""}${maxPrice ? `&max=${maxPrice}` : ""}`}
                className={`price-pill ${sort === "best" ? "is-active" : ""}`}
              >
                Best
              </Link>
              <Link
                href={`/search?q=${encodeURIComponent(query)}&sort=low${minPrice ? `&min=${minPrice}` : ""}${maxPrice ? `&max=${maxPrice}` : ""}`}
                className={`price-pill ${sort === "low" ? "is-active" : ""}`}
              >
                Low to high
              </Link>
              <Link
                href={`/search?q=${encodeURIComponent(query)}&sort=high${minPrice ? `&min=${minPrice}` : ""}${maxPrice ? `&max=${maxPrice}` : ""}`}
                className={`price-pill ${sort === "high" ? "is-active" : ""}`}
              >
                High to low
              </Link>
            </div>
          </div>
        )}

        {displayed.length > 0 && (
          <div className="product-grid">
            {displayed.map((product) => (
              <ProductCard key={product.slug} product={toCard(product)} />
            ))}
          </div>
        )}
        {query && !displayed.length && (
          <div className="cart-empty">
            <h2>No match found.</h2>
            <p>Try clearing price filters or search for another keyword.</p>
          </div>
        )}
      </section>
      <StoreFooter />
    </main>
  );
}
