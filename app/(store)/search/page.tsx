import type { Metadata } from "next";
import { countCatalogProducts, getActiveCategories, getCatalogProducts, SEARCH_MAX_WORDS, toCard, type CatalogProduct } from "@/lib/commerce";
import { searchProductIds } from "@/lib/search/server";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { StoreFooter } from "../_components/store-footer";
import { ShopGrid } from "../shop/shop-grid";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Search", robots: { index: false, follow: true } };

const SEARCH_SCOPE_LIMIT = 200;

/** Only the products that match are read from the database: the engine's best ids first, otherwise a word match in the database. */
async function searchProducts(query: string): Promise<{ results: CatalogProduct[]; total: number }> {
  const { ids } = await searchProductIds(query, SEARCH_SCOPE_LIMIT).catch(() => ({ ids: [] as string[] }));
  let ordered: CatalogProduct[] = [];
  if (ids.length) {
    const live = await getCatalogProducts({ ids });
    const byId = new Map(live.map((product) => [product.id, product]));
    ordered = ids.map((id) => byId.get(id)).filter((product): product is CatalogProduct => !!product);
    if (ordered.length === ids.length) return { results: ordered, total: ordered.length };
  }
  const [more, total] = await Promise.all([
    getCatalogProducts({ search: query, limit: SEARCH_SCOPE_LIMIT }),
    countCatalogProducts({ search: query }),
  ]);
  const seen = new Set(ordered.map((product) => product.id));
  const results = [...ordered, ...more.filter((product) => !seen.has(product.id))];
  return { results, total: Math.max(total, results.length) };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const typed = String(sp.q ?? "").trim().slice(0, 100);
  const words = typed.split(/\s+/).filter(Boolean);
  const query = words.slice(0, SEARCH_MAX_WORDS).join(" ");
  const cut = words.length > SEARCH_MAX_WORDS;

  const [{ results, total }, categories] = await Promise.all([
    query ? searchProducts(query) : Promise.resolve({ results: [] as CatalogProduct[], total: 0 }),
    getActiveCategories().then((all) => all.filter((category) => !category.parentId)),
  ]);

  return (
    <main className="page-fade-in">
      <header className="listing-head">
        <Breadcrumbs trail={[{ name: "Search" }]} path="/search" />
        <h1 className="page-title">{query ? `Results for “${query}”` : "Search our collections"}</h1>
        {cut && <p className="result-count">Only the first {SEARCH_MAX_WORDS} words of your search were used.</p>}
      </header>

      <ShopGrid
        products={results.map(toCard)}
        total={total}
        categories={categories.map((c) => ({ slug: c.slug, name: c.name }))}
        initialQuery={query}
      />

      <StoreFooter />
    </main>
  );
}
