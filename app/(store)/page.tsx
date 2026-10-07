import Image from "next/image";
import Link from "next/link";
import { ProductCard, ProductRail } from "./_components/store-components";
import { StoreFooter } from "./_components/store-footer";
import { CampaignCarousel } from "./_components/campaign-carousel";
import { getActiveCategories, getCampaignSlides, getCatalogProducts, toCard } from "@/lib/commerce";
import { StoreJsonLd } from "./_components/store-jsonld";
import { BRAND } from "@/lib/brand";

// Short ISR window: a flash sale that goes live (or ends) shows up within about a minute. Orders are
// always priced on the server regardless of what a cached page displays.
export const revalidate = 60;

// One address per page, so Google never treats "/?utm=…" or "/?ref=…" as separate pages.
export const metadata = { alternates: { canonical: "/" } };

export default async function Home() {
  // Only what this page shows is read: the newest dozen and the owner's featured picks, never the whole catalogue.
  const [products, featuredProducts, campaignSlides, categories] = await Promise.all([
    getCatalogProducts({ limit: 12 }),
    getCatalogProducts({ featuredOnly: true, limit: 8 }),
    getCampaignSlides(),
    getActiveCategories(),
  ]);

  // `products` arrives newest-first. "New arrivals" is the newest dozen; "Featured" is whatever the
  // owner has ticked "Featured on homepage" in the admin panel (hidden if nothing is featured, so
  // the page never repeats the same products twice in a row).
  const newArrivals = products.slice(0, 12).map(toCard);
  const featured = featuredProducts.map(toCard);
  const showFeatured = featured.length >= 4 && featured.some((product) => !newArrivals.slice(0, 5).some((entry) => entry.id === product.id));

  return (
    <main className="page-fade-in">
      <h1 className="sr-only">{BRAND.name} — {BRAND.descriptor}. {BRAND.tagline}.</h1>
      <StoreJsonLd />
      <CampaignCarousel slides={campaignSlides} />

      <section className="service-strip" aria-label="Store benefits">
        <p>Nationwide delivery</p>
        <p>Cash on delivery</p>
        <p>Easy exchanges</p>
        <p>WhatsApp assistance</p>
      </section>

      {categories.length > 0 && (
        <section className="cat-section" aria-label="Shop by category">
          <div className="cat-grid">
            {categories.map((category, index) => (
              <Link href={`/collections/${category.slug}`} className="cat-tile" key={category.id}>
                <div className="cat-tile-media">
                  <Image
                    src={category.imageUrl ?? "/placeholder.webp"}
                    alt="" /* the name is written right under the picture, so screen readers do not need it twice */
                    fill
                    sizes="(max-width: 700px) 46vw, 25vw"
                    priority={index < 4}
                    {...(category.blurDataUrl ? { placeholder: "blur" as const, blurDataURL: category.blurDataUrl } : {})}
                  />
                </div>
                <h3>{category.name}</h3>
              </Link>
            ))}
          </div>
        </section>
      )}

      {newArrivals.length > 0 && (
        <section className="rail-section" aria-labelledby="new-title">
          <h2 className="section-title" id="new-title">New arrivals</h2>
          <ProductRail products={newArrivals} />
          <div className="rail-foot">
            <Link href="/shop" className="text-link">
              View all <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
      )}

      {showFeatured && (
        <section className="section" aria-labelledby="featured-title">
          <h2 className="section-title" id="featured-title">Featured</h2>
          <div className="product-grid">
            {featured.slice(0, 4).map((product) => (
              <ProductCard key={product.slug} product={product} sizes="(max-width: 700px) 46vw, 25vw" />
            ))}
          </div>
        </section>
      )}

      <StoreFooter />
    </main>
  );
}
