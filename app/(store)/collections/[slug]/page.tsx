import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StoreFooter } from "../../_components/store-footer";
import { ProductListJsonLd } from "../../_components/product-list-jsonld";
import { ShopGrid } from "../../shop/shop-grid";
import { CATALOG_PAGE_SIZE, countCatalogProducts, getActiveCategories, getCatalogProducts, getCategoryDiscounts, getCollectionBySlug, toCard } from "@/lib/commerce";
import { BRAND, siteOrigin } from "@/lib/brand";
import { getNonce } from "@/lib/nonce";
import { ancestry, type TreeNode } from "@/lib/category-tree";

// Short ISR window: a flash sale that goes live (or ends) shows up within about a minute. Orders are
// always priced on the server regardless of what a cached page displays.
// Pages are kept for 10 minutes. Anything the owner changes in the admin refreshes them at once (lib/storefront-cache.ts →
// /api/revalidate); only a flash sale that starts or ends on its own schedule can take up to 10 minutes to show. Orders are always priced
// on the server. A longer life also means far fewer database wake-ups from visitors and search-engine crawlers.
export const revalidate = 600;

const treeNode = (entry: { id: string; name: string; slug: string; parentId?: string; sortOrder: number }): TreeNode => ({ id: entry.id, name: entry.name, slug: entry.slug, parentId: entry.parentId ?? null, sortOrder: entry.sortOrder });

/** A slug resolves to a category first (the main storefront navigation) and otherwise to a custom,
 * admin-curated collection. */
async function resolve(slug: string) {
  const categories = await getActiveCategories();
  const category = categories.find((entry) => entry.slug === slug);
  if (category) {
    const trail = ancestry(categories.map(treeNode), category.id);
    const children = categories.filter((entry) => entry.parentId === category.id);
    return { kind: "category" as const, title: category.name, description: category.description ?? "", category, trail, children };
  }
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
  const trail: TreeNode[] = found.kind === "category" ? found.trail : [{ id: slug, name: found.title, slug, parentId: null, sortOrder: 0 }];

  // A category is read one page at a time (the rest comes from the cached /api/catalog/page); a hand-made collection is small and shown whole.
  const [products, total] = found.kind === "collection" ? [found.collection.products, found.collection.products.length] : await Promise.all([getCatalogProducts({ categorySlug: slug, limit: CATALOG_PAGE_SIZE }), countCatalogProducts({ categorySlug: slug })]);
  const origin = siteOrigin();
  const categoryDiscount = found.kind === "category" ? ((await getCategoryDiscounts().catch(() => new Map<string, number>())).get(found.category.id) ?? 0) : 0;
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: origin },
      ...trail.map((node, index) => ({ "@type": "ListItem", position: index + 2, name: node.name, item: `${origin}/collections/${node.slug}` })),
    ],
  };

  return (
    <main className="page-fade-in">
      <script type="application/ld+json" nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <ProductListJsonLd name={found.title} path={`/collections/${slug}`} products={products} />
      <header className="listing-head">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          {trail.map((node, index) => (
            <Fragment key={node.id}>
              <span aria-hidden="true">/</span>
              {index === trail.length - 1 ? <span>{node.name}</span> : <Link href={`/collections/${node.slug}`}>{node.name}</Link>}
            </Fragment>
          ))}
        </nav>
        <h1 className="page-title">{found.title}</h1>
        {categoryDiscount > 0 && <p className="listing-sale">Sale on now — up to −{categoryDiscount}% off</p>}
        {found.description && <p>{found.description}</p>}
        {found.kind === "category" && found.children.length > 0 && (
          // Categories inside this one (Shirts -> Formal Shirts): each is its own page, and this page already lists all of their products.
          <nav className="sub-chips" aria-label={`${found.title} categories`}>
            {found.children.map((child) => (<Link key={child.id} href={`/collections/${child.slug}`}>{child.name}</Link>))}
          </nav>
        )}
        {found.kind === "category" && found.children.length === 0 && found.category.subcategories && found.category.subcategories.length > 0 && (
          // The owner writes these in Admin -> Collections -> Categories (comma separated). Each one narrows this page to matching pieces (a full page load, so the grid starts with that filter).
          <nav className="sub-chips" aria-label={`${found.title} types`}>
            <a href={`/collections/${slug}`}>All</a>
            {found.category.subcategories.map((sub) => (<a key={sub} href={`/collections/${slug}?q=${encodeURIComponent(sub)}`}>{sub}</a>))}
          </nav>
        )}
      </header>
      <ShopGrid products={products.map(toCard)} total={total} scopeCategory={found.kind === "category" ? slug : undefined} />
      <StoreFooter />
    </main>
  );
}
