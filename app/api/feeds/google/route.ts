import { siteOrigin } from "@/lib/brand";
import { getFeedProducts } from "@/lib/commerce";
import { buildProductFeedXml } from "@/lib/feed";

// Built on request (not at build time, so a build never depends on the live database already having the newest columns) and kept
// for an hour at Vercel's edge, so the feed fetchers cost one database read an hour.
export const dynamic = "force-dynamic";

const SITE_ORIGIN = siteOrigin();

/** Google Merchant Center product feed (RSS 2.0 + `g:` Google Shopping namespace). Register this
 * URL as a scheduled fetch in Merchant Center: /api/feeds/google */
export async function GET() {
  const feedProducts = await getFeedProducts();
  const xml = buildProductFeedXml(feedProducts, SITE_ORIGIN, "Nure Asmir — Product Feed", "Nure Asmir men's wear, for Google Merchant Center.");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
