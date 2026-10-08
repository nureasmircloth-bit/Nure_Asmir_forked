import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, products } from "@/db/schema";
import { siteOrigin } from "@/lib/brand";
import { cacheKeyFor } from "@/lib/edge-page-cache";

export const dynamic = "force-dynamic";

const PUBLIC_PAGES = ["/", "/shop", "/about", "/contact", "/faq", "/policies/shipping", "/policies/returns", "/policies/privacy", "/policies/terms"];

/**
 * Throws away the page copies (lib/edge-page-cache.ts) that the shop saved in THIS Cloudflare data centre, so a change made in the admin
 * shows on the very next visit here. Each data centre keeps its own copies and none can reach another's: copies elsewhere still expire by
 * themselves within a few minutes (the admin tells the owner so). The admin's request lands in a data centre near the owner, which is
 * normally also near the customers.
 */
async function purgeEdgeCopies(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  const [categoryRows, productRows] = await Promise.all([
    db.select({ slug: categories.slug }).from(categories),
    db.select({ slug: products.slug }).from(products).where(eq(products.status, "published")).limit(500),
  ]);
  const paths = [...PUBLIC_PAGES, ...categoryRows.map((row) => `/collections/${row.slug}`), ...productRows.map((row) => `/products/${row.slug}`)];
  const cache = (caches as unknown as { default: Cache }).default;
  const build = String(process.env.BUILD_ID ?? "dev");
  const origin = siteOrigin();
  const results = await Promise.all(paths.map((path) => cache.delete(cacheKeyFor(new Request(`${origin}${path}`), build)).catch(() => false)));
  return results.filter(Boolean).length;
}

/**
 * Called by the admin panel (a separate Worker) right after the owner changes something the shop shows – a
 * price, a photo, a banner – so customers see it within seconds instead of waiting for the page cache to
 * expire. Protected by the same shared secret as the scheduled jobs.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized." }, { status: 401 });
  revalidatePath("/", "layout");
  const purged = await purgeEdgeCopies().catch((error) => {
    console.error("could not purge the saved page copies", error);
    return 0;
  });
  return Response.json({ ok: true, purged });
}
