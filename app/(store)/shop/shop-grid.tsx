"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Price } from "../_components/currency";
import { ProductCard } from "../_components/store-components";
import { ThemedSelect } from "../_components/themed-select";
import { countFilters, EMPTY_FILTERS, filtersToParams, hasFilters, parseFilters, type CatalogFilters } from "@/lib/catalog-filters";
import type { CardProduct } from "@/lib/commerce";
import { FilterPanel, type Facets } from "./filter-panel";

type Sort = "newest" | "low" | "high";
type Loaded = { products: CardProduct[]; total: number };

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "low", label: "Price, low to high" },
  { value: "high", label: "Price, high to low" },
];

/**
 * `products` is the first page, rendered on the server (so the page is instant and cacheable).
 * `categories` drives the tabs on /shop; a collection page for one category passes `scopeCategory` instead (no tabs).
 * Everything past the first page – other tabs, sorting, filters, "Show more" – comes from `/api/catalog/page`, 24 products at a
 * time and cached at the edge, so a big catalogue never loads all at once. An owner-curated collection is small and shown whole.
 * The chosen category, sort and filters live in the web address, so a filtered shop can be shared or bookmarked.
 */
export function ShopGrid({
  products,
  total,
  categories,
  scopeCategory,
}: {
  products: CardProduct[];
  total?: number;
  categories?: Array<{ slug: string; name: string }>;
  scopeCategory?: string;
}) {
  const showTabs = !!categories?.length;
  const paged = showTabs || !!scopeCategory;
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);
  const [searchQuery, setSearchQuery] = useState("");
  const [items, setItems] = useState(products);
  const [count, setCount] = useState(total ?? products.length);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [panel, setPanel] = useState(false);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [facetsLoading, setFacetsLoading] = useState(false);
  const firstPages = useRef(new Map<string, Loaded>([["all|newest||", { products, total: total ?? products.length }]]));
  const facetCache = useRef(new Map<string, Facets>());
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scope = scopeCategory ?? category;
  const keyOf = (cat: string, order: Sort, f: CatalogFilters, q: string) => `${scopeCategory ? "all" : cat}|${order}|${q.trim()}|${filtersToParams(f).toString()}`;

  async function fetchPage(cat: string, order: Sort, f: CatalogFilters, pageNumber: number, q: string): Promise<Loaded> {
    const params = filtersToParams(f);
    params.set("cat", scopeCategory ?? cat);
    params.set("sort", order);
    params.set("page", String(pageNumber));
    if (q.trim()) params.set("q", q.trim());
    const response = await fetch(`/api/catalog/page?${params.toString()}`);
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as Loaded;
  }

  const syncAddress = useCallback((cat: string, order: Sort, f: CatalogFilters, q: string) => {
    try {
      const params = filtersToParams(f);
      if (cat !== "all" && !scopeCategory) params.set("cat", cat);
      if (order !== "newest") params.set("sort", order);
      if (q.trim()) params.set("q", q.trim());
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    } catch {
      // the address is a nicety; the shop works without it
    }
  }, [scopeCategory]);

  async function show(cat: string, order: Sort, f: CatalogFilters, q: string = searchQuery) {
    // Whatever was waiting to run (a slider drag's pause timer) is older than this choice and must never overwrite it.
    if (timer.current) clearTimeout(timer.current);
    setCategory(cat);
    setSort(order);
    setFilters(f);
    setSearchQuery(q);
    setFailed(false);
    syncAddress(cat, order, f, q);
    if (!paged) return;
    const id = ++request.current;
    const key = keyOf(cat, order, f, q);
    const cached = firstPages.current.get(key);
    if (cached) {
      setItems(cached.products);
      setCount(cached.total);
      setPage(1);
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const loaded = await fetchPage(cat, order, f, 1, q);
      if (id !== request.current) return;
      firstPages.current.set(key, loaded);
      setItems(loaded.products);
      setCount(loaded.total);
      setPage(1);
    } catch {
      if (id === request.current) setFailed(true);
    } finally {
      if (id === request.current) setBusy(false);
    }
  }

  // Filters change quickly (a slider drag fires many times): wait for a short pause before asking the server.
  function changeFilters(next: CatalogFilters) {
    setFilters(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void show(category, sort, next, searchQuery), 350);
  }

  async function more() {
    if (busy) return;
    const id = ++request.current;
    setBusy(true);
    setFailed(false);
    try {
      const loaded = await fetchPage(category, sort, filters, page + 1, searchQuery);
      if (id !== request.current) return;
      setItems((current) => {
        const seen = new Set(current.map((product) => product.id));
        return [...current, ...loaded.products.filter((product) => !seen.has(product.id))];
      });
      setCount(loaded.total);
      setPage(page + 1);
    } catch {
      if (id === request.current) setFailed(true);
    } finally {
      if (id === request.current) setBusy(false);
    }
  }

  // Open from a shared address (?min=…&sizes=…): apply it once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = parseFilters(params);
    const cat = params.get("cat") ?? "all";
    const q = params.get("q") ?? "";
    const order = (["low", "high"].includes(params.get("sort") ?? "") ? params.get("sort") : "newest") as Sort;
    const validCat = showTabs && categories?.some((item) => item.slug === cat) ? cat : "all";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasFilters(wanted) || validCat !== "all" || order !== "newest" || q) void show(validCat, order, wanted, q);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // run once on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The filter panel's choices (price range, sizes, colours) depend on the category being looked at.
  useEffect(() => {
    if (!panel) return;
    const cached = facetCache.current.get(scope);
    if (cached) {
      setFacets(cached);
      return;
    }
    let live = true;
    setFacets(null); // never show the previous category's choices while this one loads (or if it fails)
    setFacetsLoading(true);
    fetch(`/api/catalog/facets?cat=${encodeURIComponent(scope)}`)
      .then((response) => (response.ok ? (response.json() as Promise<Facets>) : null))
      .then((data) => {
        if (!live || !data) return;
        facetCache.current.set(scope, data);
        setFacets(data);
      })
      .catch(() => undefined)
      .finally(() => live && setFacetsLoading(false));
    return () => {
      live = false;
    };
  }, [panel, scope]);

  // A small collection that is not paged is filtered and sorted here.
  const visible = useMemo(() => {
    if (paged) return items;
    let result = items;
    if (searchQuery.trim()) {
      const lower = searchQuery.trim().toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(lower) ||
          p.slug.toLowerCase().includes(lower) ||
          (p.type && p.type.toLowerCase().includes(lower)) ||
          (p.shortDescription && p.shortDescription.toLowerCase().includes(lower)) ||
          (p.category && p.category.toLowerCase().includes(lower))
      );
    }
    const sorted = [...result];
    if (sort === "low") sorted.sort((a, b) => a.price - b.price);
    if (sort === "high") sorted.sort((a, b) => b.price - a.price);
    return sorted;
  }, [items, paged, sort, searchQuery]);

  const active = countFilters(filters);
  const removeChip = (next: CatalogFilters) => void show(category, sort, next, searchQuery);

  return (
    <section className="shop-shell">
      <div className="shop-toolbar">
        {showTabs ? (
          <div className="filter-tabs" role="tablist" aria-label="Filter products by category">
            {[{ slug: "all", name: "All" }, ...(categories ?? [])].map((item) => (
              <button key={item.slug} type="button" role="tab" aria-selected={category === item.slug} className={category === item.slug ? "active" : ""} onClick={() => void show(item.slug, sort, filters, searchQuery)}>
                {item.name}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="shop-controls">
          {paged && (
            <button type="button" className="filter-btn" onClick={() => setPanel(true)} aria-haspopup="dialog">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 6h18M6 12h12M10 18h4" /></svg>
              Filters{active ? ` (${active})` : ""}
            </button>
          )}
          <label className="sort-label">
            <span>Sort</span>
            <ThemedSelect
              label="Sort products"
              value={sort}
              align="right"
              onChange={(next) => void show(category, next as Sort, filters, searchQuery)}
              options={SORTS.map((item) => ({ value: item.value, label: item.label }))}
            />
          </label>
        </div>
      </div>

      <div className="in-cat-search-row">
        <div className="in-cat-search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => {
              const val = event.target.value;
              setSearchQuery(val);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => void show(category, sort, filters, val), 350);
            }}
            placeholder={scopeCategory ? "Search in this collection (e.g. embroidered, black, linen)…" : "Search products…"}
            aria-label="Search within this collection"
          />
          {searchQuery && (
            <button
              type="button"
              className="in-cat-search-clear"
              onClick={() => {
                setSearchQuery("");
                void show(category, sort, filters, "");
              }}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
        <div className="in-cat-price-pills">
          <span className="price-pill-label">Price:</span>
          <button
            type="button"
            className={`price-pill ${filters.min == null && filters.max == null ? "is-active" : ""}`}
            onClick={() => changeFilters({ ...filters, min: undefined, max: undefined })}
          >
            All
          </button>
          <button
            type="button"
            className={`price-pill ${filters.max === 5000 && filters.min == null ? "is-active" : ""}`}
            onClick={() => changeFilters({ ...filters, min: undefined, max: filters.max === 5000 ? undefined : 5000 })}
          >
            Under 5k
          </button>
          <button
            type="button"
            className={`price-pill ${filters.min === 5000 && filters.max === 10000 ? "is-active" : ""}`}
            onClick={() => changeFilters({ ...filters, min: filters.min === 5000 && filters.max === 10000 ? undefined : 5000, max: filters.min === 5000 && filters.max === 10000 ? undefined : 10000 })}
          >
            5k–10k
          </button>
          <button
            type="button"
            className={`price-pill ${filters.min === 10000 && filters.max == null ? "is-active" : ""}`}
            onClick={() => changeFilters({ ...filters, min: filters.min === 10000 ? undefined : 10000, max: undefined })}
          >
            10k+
          </button>
        </div>
      </div>

      {hasFilters(filters) && (
        <div className="active-filters" aria-label="Active filters">
          {(filters.min != null || filters.max != null) && (
            <button type="button" onClick={() => removeChip({ ...filters, min: undefined, max: undefined })}>
              {filters.min != null && filters.max != null ? (
                <>
                  <Price amount={filters.min} /> – <Price amount={filters.max} />
                </>
              ) : filters.min != null ? (
                <>
                  From <Price amount={filters.min} />
                </>
              ) : (
                <>
                  Up to <Price amount={filters.max as number} />
                </>
              )}{" "}
              ✕
            </button>
          )}
          {filters.sizes.map((size) => (
            <button key={`s-${size}`} type="button" onClick={() => removeChip({ ...filters, sizes: filters.sizes.filter((item) => item !== size) })}>
              Size {size} ✕
            </button>
          ))}
          {filters.colors.map((color) => (
            <button key={`c-${color}`} type="button" onClick={() => removeChip({ ...filters, colors: filters.colors.filter((item) => item !== color) })}>
              {color} ✕
            </button>
          ))}
          {filters.inStock && (
            <button type="button" onClick={() => removeChip({ ...filters, inStock: false })}>
              In stock ✕
            </button>
          )}
          <button type="button" className="clear-all" onClick={() => removeChip(EMPTY_FILTERS)}>
            Clear all
          </button>
        </div>
      )}

      <p className="result-count" aria-live="polite">
        {paged
          ? count > visible.length
            ? `Showing ${visible.length} of ${count} products`
            : `${count} ${count === 1 ? "product" : "products"}`
          : `${visible.length} ${visible.length === 1 ? "product" : "products"}`}
      </p>
      <div className="product-grid shop-grid" style={busy ? { opacity: 0.6, transition: "opacity .15s" } : undefined} aria-busy={busy}>
        {visible.map((product, index) => (
          <ProductCard key={product.slug} product={product} priority={index < 4} sizes="(max-width: 700px) 46vw, (max-width: 1100px) 33vw, 25vw" />
        ))}
      </div>
      {!visible.length && !busy && (
        <div className="shop-empty">
          <p>{hasFilters(filters) || searchQuery.trim() ? "Nothing matches your search or filters." : "Nothing here yet — check back soon."}</p>
          {(hasFilters(filters) || searchQuery.trim()) && (
            <button
              type="button"
              className="filter-btn"
              onClick={() => {
                setSearchQuery("");
                removeChip(EMPTY_FILTERS);
              }}
            >
              Clear filters and search
            </button>
          )}
        </div>
      )}
      {failed && (
        <p className="result-count" role="alert">
          Could not load products. Please check your internet and try again.
        </p>
      )}
      {paged && count > visible.length && (
        <div style={{ display: "flex", justifyContent: "center", padding: "28px 0 8px" }}>
          <button type="button" className="button button-dark" onClick={() => void more()} disabled={busy} aria-busy={busy}>
            {busy ? "Loading…" : "Show more"}
          </button>
        </div>
      )}

      <FilterPanel open={panel} onClose={() => setPanel(false)} facets={facets} loading={facetsLoading} filters={filters} onChange={changeFilters} resultCount={count} busy={busy} />
    </section>
  );
}
