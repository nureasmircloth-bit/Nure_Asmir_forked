import type { Metadata } from "next";
import { countCatalogProducts, getCatalogProducts, toCard, type CatalogProduct } from "@/lib/commerce";
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
  if (ids.length) {
    const live = await getCatalogProducts({ ids });
    const byId = new Map(live.map((product) => [product.id, product]));
    const ordered = ids.map((id) => byId.get(id)).filter((product): product is CatalogProduct => !!product);
    if (ordered.length) return { results: ordered, total: ordered.length };
  }
  const [results, total] = await Promise.all([getCatalogProducts({ search: query, limit: SEARCH_LIMIT }), countCatalogProducts({ search: query })]);
  return { results, total };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = String((await searchParams).q ?? "").trim().slice(0, 100);
  // Never paint hundreds of cards at once: the first 48 best matches, and a hint to narrow the search.
  const { results, total } = query ? await searchProducts(query) : { results: [] as CatalogProduct[], total: 0 };

  return (
    <main className="page-fade-in">
      <section className="search-page">
        <header>
          <h1 className="page-title">{query ? `Results for “${query}”` : "Search"}</h1>
          <p className="result-count">{query ? (total > results.length ? `Showing the first ${results.length} of ${total} products – try a more specific word` : `${total} ${total === 1 ? "product" : "products"}`) : "Use the search icon above to find a product."}</p>
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
