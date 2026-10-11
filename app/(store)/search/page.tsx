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
const SEARCH_LIMIT = 48;

/** Only the products that match are read from the database (never the whole catalogue): the engine's best ids first, otherwise a word match in the database. */
async function searchProducts(query: string): Promise<{ results: CatalogProduct[]; total: number }> {
  const { ids } = await searchProductIds(query, SEARCH_LIMIT).catch(() => ({ ids: [] as string[] }));
  let ordered: CatalogProduct[] = [];
  if (ids.length) {
    const live = await getCatalogProducts({ ids });
    const byId = new Map(live.map((product) => [product.id, product]));
    ordered = ids.map((id) => byId.get(id)).filter((product): product is CatalogProduct => !!product);
    if (ordered.length === ids.length) return { results: ordered, total: ordered.length }; // every product the engine named is still live
  }
  // The engine knew nothing, or some of what it named has been hidden since (its list can lag behind): fill up from the database.
  const [more, total] = await Promise.all([getCatalogProducts({ search: query, limit: SEARCH_LIMIT }), countCatalogProducts({ search: query })]);
  const seen = new Set(ordered.map((product) => product.id));
  const results = [...ordered, ...more.filter((product) => !seen.has(product.id))].slice(0, SEARCH_LIMIT);
  return { results, total: Math.max(total, results.length) };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const typed = String((await searchParams).q ?? "").trim().slice(0, 100);
  // Only the first ten words are used; the page says so instead of quietly ignoring the rest.
  const words = typed.split(/\s+/).filter(Boolean);
  const query = words.slice(0, SEARCH_MAX_WORDS).join(" ");
  const cut = words.length > SEARCH_MAX_WORDS;
  // Never paint hundreds of cards at once: the first 48 best matches, and a hint to narrow the search.
  const { results, total } = query ? await searchProducts(query) : { results: [] as CatalogProduct[], total: 0 };

  return (
    <main className="page-fade-in">
      <section className="search-page">
        <header>
          <h1 className="page-title">{query ? `Results for “${query}”` : "Search"}</h1>
          <p className="result-count">{query ? (total > results.length ? `Showing the first ${results.length} of ${total} products – try a more specific word` : `${total} ${total === 1 ? "product" : "products"}`) : "Use the search icon above to find a product."}</p>
          {cut && <p className="result-count">Only the first {SEARCH_MAX_WORDS} words of your search were used.</p>}
        </header>
        {results.length > 0 && (
          <div className="product-grid">
            {results.map((product) => (
              <ProductCard key={product.slug} product={toCard(product)} />
            ))}
          </div>
        )}
        {query && !results.length && (
          <div className="cart-empty">
            <h2>No exact match.</h2>
            <p>Try a category, colour or product name.</p>
          </div>
        )}
      </section>
      <StoreFooter />
    </main>
  );
}
