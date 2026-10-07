import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCatalogProducts, getProductBySlug, getPublicSettings, toCard } from "@/lib/commerce";
import { BRAND, siteOrigin } from "@/lib/brand";
import { getNonce } from "@/lib/nonce";
import { ProductRail } from "../../_components/store-components";
import { StoreFooter } from "../../_components/store-footer";
import { ProductView } from "./product-view";

// Short ISR window: a flash sale that goes live (or ends) shows up within about a minute. Orders are
// always priced on the server regardless of what a cached page displays.
export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return {};
  const title = product.seoTitle || product.name;
  // the owner's own words first; otherwise a full sentence that says what it is and what the shopper gets (about 155 characters is where Google cuts it)
  const fallback = `${product.name}${product.color ? ` in ${product.color}` : ""} from ${BRAND.name}. Delivered all over Pakistan with cash on delivery and easy exchanges.`;
  const description = (product.seoDescription || (product.shortDescription && product.shortDescription.length >= 60 ? product.shortDescription : `${product.shortDescription ? product.shortDescription.replace(/\.$/, "") + ". " : ""}${fallback}`)).slice(0, 160);
  return {
    title,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: { title, description, type: "website", images: product.imageUrl ? [{ url: absolute(product.imageUrl) }] : undefined },
  };
}

function absolute(url: string): string {
  return url.startsWith("http") ? url : `${siteOrigin()}${url}`;
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [product, settings] = await Promise.all([getProductBySlug(slug), getPublicSettings()]);
  const nonce = getNonce();
  if (!product) notFound();

  const origin = siteOrigin();
  const fallbackImage = "/placeholder.webp";
  const primaryImage = absolute(product.imageUrl ?? fallbackImage);
  const canonicalUrl = `${origin}/products/${product.slug}`;
  const related = (await getCatalogProducts({ categorySlug: product.category, limit: 11 })).filter((entry) => entry.slug !== product.slug).slice(0, 10).map(toCard);

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: origin },
      { "@type": "ListItem", position: 2, name: product.type, item: `${origin}/collections/${product.category}` },
      { "@type": "ListItem", position: 3, name: product.name, item: canonicalUrl },
    ],
  };

  const offer = (price: number, available: number) => ({
    "@type": "Offer",
    priceCurrency: "PKR",
    price,
    availability: available > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    url: canonicalUrl,
  });
  const description = product.seoDescription || product.shortDescription || product.description;
  const sizeVaries = product.variants.some((variant) => variant.size);
  // Each colour is described with its own photo (photos are linked to a colour through one of its sizes).
  const photoFor = (color: string): string => {
    const sameColour = new Set(product.variants.filter((variant) => variant.color === color).map((variant) => variant.id));
    const own = product.images.find((image) => image.variantId && sameColour.has(image.variantId));
    return own ? absolute(own.url) : primaryImage;
  };
  const keywordList = product.seoKeywords?.split(",").map((word) => word.trim()).filter(Boolean).slice(0, 15).join(", ");
  const jsonLd =
    product.variants.length >= 2
      ? {
          "@context": "https://schema.org",
          "@type": "ProductGroup",
          name: product.name,
          description,
          ...(keywordList ? { keywords: keywordList } : {}),
          brand: { "@type": "Brand", name: BRAND.name },
          productGroupID: product.id,
          variesBy: [...(sizeVaries ? ["https://schema.org/size"] : []), "https://schema.org/color"],
          hasVariant: product.variants.map((variant) => ({
            "@type": "Product",
            name: `${product.name} — ${variant.name}`,
            sku: variant.sku,
            color: variant.color,
            ...(variant.size ? { size: variant.size } : {}),
            image: [photoFor(variant.color)],
            offers: offer(variant.price, variant.available),
          })),
        }
      : {
          "@context": "https://schema.org",
          "@type": "Product",
          name: product.name,
          image: [primaryImage],
          description,
          ...(keywordList ? { keywords: keywordList } : {}),
          sku: product.sku,
          brand: { "@type": "Brand", name: BRAND.name },
          offers: offer(product.price, product.stock),
        };

  return (
    <main className="page-fade-in">
      <script type="application/ld+json" nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <section className="product-page">
        <ProductView
          product={product}
          fallback={fallbackImage}
          codReservationHours={settings.codReservationHours}
          bankReservationHours={settings.bankReservationHours}
        />
      </section>
      {related.length > 0 && (
        <section className="rail-section" aria-labelledby="related-title">
          <h2 className="section-title" id="related-title">You may also like</h2>
          <ProductRail products={related} />
        </section>
      )}
      <div style={{ height: 64 }} />
      <StoreFooter />
    </main>
  );
}
