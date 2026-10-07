import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StoreFooter } from "../../_components/store-footer";
import { ProductListJsonLd } from "../../_components/product-list-jsonld";
import { ShopGrid } from "../../shop/shop-grid";
import { CATALOG_PAGE_SIZE, countCatalogProducts, getActiveCategories, getCatalogProducts, getCollectionBySlug, toCard } from "@/lib/commerce";
import { BRAND, siteOrigin } from "@/lib/brand";
import { getNonce } from "@/lib/nonce";

// Short ISR window: a flash sale that goes live (or ends) shows up within about a minute. Orders are
// always priced on the server regardless of what a cached page displays.
export const revalidate = 60;

/** A slug resolves to a category first (the main storefront navigation) and otherwise to a custom,
 * admin-curated collection. */
async function resolve(slug: string) {
  const categories = await getActiveCategories();
  const category = categories.find((entry) => entry.slug === slug);
  if (category) return { kind: "category" as const, title: category.name, description: category.description ?? "", category };
  const collection = await getCollectionBySlug(slug);
  if (collection) return { kind: "collection" as const, title: collection.name, description: collection.description, collection };
  return null;
}

/** The owner's own words when they are a full sentence; otherwise they are completed with what the shopper gets (Google cuts descriptions at about 155 characters). */
function collectionDescription(title: string, own: string): string {
  const text = own.trim();
  if (text.length >= 70) return text.slice(0, 160);
  return `${text ? `${text.replace(/\.$/, "")}. ` : ""}Shop ${title} for men at ${BRAND.name}, delivered all over Pakistan with cash on delivery.`.slice(0, 160);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const found = await resolve(slug);
  if (!found) return {};
  return {
    title: found.title,
    // never a bare name: say what is here and what the shopper gets (stays under about 155 characters, where Google cuts it)
    description: collectionDescription(found.title, found.description),
    alternates: { canonical: `/collections/${slug}` },
  };
}

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await resolve(slug);
  if (!found) notFound();
  const nonce = getNonce();

  // A category is read one page at a time (the rest comes from the cached /api/catalog/page); a hand-made collection is small and shown whole.
  const [products, total] = found.kind === "collection" ? [found.collection.products, found.collection.products.length] : await Promise.all([getCatalogProducts({ categorySlug: slug, limit: CATALOG_PAGE_SIZE }), countCatalogProducts({ categorySlug: slug })]);
  const origin = siteOrigin();
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: origin },
      { "@type": "ListItem", position: 2, name: found.title, item: `${origin}/collections/${slug}` },
    ],
  };

  return (
    <main className="page-fade-in">
      <script type="application/ld+json" nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <ProductListJsonLd name={found.title} path={`/collections/${slug}`} products={products} />
      <header className="listing-head">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          <span aria-hidden="true">/</span>
          <span>{found.title}</span>
        </nav>
        <h1 className="page-title">{found.title}</h1>
        {found.description && <p>{found.description}</p>}
      </header>
      <ShopGrid products={products.map(toCard)} total={total} scopeCategory={found.kind === "category" ? slug : undefined} />
      <StoreFooter />
    </main>
  );
}
