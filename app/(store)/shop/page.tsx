import type { Metadata } from "next";
import { StoreFooter } from "../_components/store-footer";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { ProductListJsonLd } from "../_components/product-list-jsonld";
import { ShopGrid } from "./shop-grid";
import { CATALOG_PAGE_SIZE, countCatalogProducts, getActiveCategories, getCatalogProducts, toCard } from "@/lib/commerce";

// Short ISR window: a flash sale that goes live (or ends) shows up within about a minute. Orders are
// always priced on the server regardless of what a cached page displays.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Shop all — new arrivals",
  description: "Shop the full Nure Asmir range: shalwar kameez, shirts, pants and leather accessories.",
  alternates: { canonical: "/shop" },
};

export default async function ShopPage() {
  // Only the first page is read here; tabs, sorting and Show more come from the cached /api/catalog/page.
  const [products, total, categories] = await Promise.all([getCatalogProducts({ limit: CATALOG_PAGE_SIZE }), countCatalogProducts(), getActiveCategories()]);
  return (
    <main className="page-fade-in">
      <header className="listing-head">
        <Breadcrumbs trail={[{ name: "Shop" }]} path="/shop" />
        <ProductListJsonLd name="New arrivals" path="/shop" products={products} />
        <h1 className="page-title">New arrivals</h1>
      </header>
      <ShopGrid products={products.map(toCard)} total={total} categories={categories.map((category) => ({ slug: category.slug, name: category.name }))} />
      <StoreFooter />
    </main>
  );
}
