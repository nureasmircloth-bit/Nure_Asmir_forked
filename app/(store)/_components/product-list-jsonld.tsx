import { siteOrigin } from "@/lib/brand";
import { getNonce } from "@/lib/nonce";

/** Tells search engines "this page is a list of these products" (CollectionPage + ItemList), in the order shoppers see them. */
export function ProductListJsonLd({ name, path, products }: { name: string; path: string; products: Array<{ slug: string; name: string }> }) {
  if (!products.length) return null;
  const origin = siteOrigin();
  const data = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    url: `${origin}${path}`,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: products.length,
      itemListElement: products.slice(0, 48).map((product, index) => ({ "@type": "ListItem", position: index + 1, url: `${origin}/products/${product.slug}`, name: product.name })),
    },
  };
  return <script type="application/ld+json" nonce={getNonce()} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
