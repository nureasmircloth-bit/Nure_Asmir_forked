import { siteOrigin } from "@/lib/brand";
import { getFeedProducts } from "@/lib/commerce";
import { buildProductFeedXml } from "@/lib/feed";

// Built on request (not at build time, so a build never depends on the live database already having the newest columns) and kept
// for an hour at Vercel's edge, so the feed fetchers cost one database read an hour.
export const dynamic = "force-dynamic";

const SITE_ORIGIN = siteOrigin();

/** Meta (Facebook/Instagram) Commerce Manager product catalogue feed. Meta's Catalog ingestion
 * accepts the same Google Shopping RSS format (including the `g:` namespace), so this reuses the
 * shared feed builder in lib/feed.ts. Register this URL as a scheduled data feed in Commerce
 * Manager: /api/feeds/meta */
export async function GET() {
  const feedProducts = await getFeedProducts();
  const xml = buildProductFeedXml(feedProducts, SITE_ORIGIN, "Nure Asmir — Meta Catalogue Feed", "Nure Asmir men's wear, for Meta Commerce Manager.");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
