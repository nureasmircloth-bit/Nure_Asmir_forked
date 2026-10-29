/**
 * Removes ALL products (with their colours/sizes, picture records and collection / flash-sale links) so real data can be added. Dry run unless --confirm.
 *
 *   node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs scripts/wipe-products.ts            # shows what would go
 *   node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs scripts/wipe-products.ts --confirm  # does it
 *
 * Which database: LOCAL_DB_PATH (a local test file) or, for the real shop, D1_HTTP_DATABASE_ID + CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN.
 * Kept: categories (and their subcategory lists), settings, orders (their lines keep the product name, price and size; only the link to the removed
 * product is cleared), customers, coupons. The picture files are deleted from storage too (AWS_* needed for Neon Storage; pictures kept in R2 are
 * listed and must be removed from the admin's Pictures screen, a script has no access to that bucket).
 * With SITE_URL and CRON_SECRET set, the shop's pages are refreshed afterwards so the old products disappear at once.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { productImages } from "../db/schema";
import { variantKeyFor } from "../lib/image-variants";
import { backendOf, deleteObject } from "../lib/storage";

const confirm = process.argv.includes("--confirm");

async function count(table: string): Promise<number> {
  const result = await db.execute<{ n: number }>(sql.raw(`select count(*) as n from "${table}"`));
  return Number(result.rows[0]?.n ?? 0);
}

async function main() {
  const target = process.env.LOCAL_DB_PATH ? `local file ${process.env.LOCAL_DB_PATH}` : process.env.D1_HTTP_DATABASE_ID ? `D1 database ${process.env.D1_HTTP_DATABASE_ID}` : "";
  if (!target) throw new Error("Set LOCAL_DB_PATH, or D1_HTTP_DATABASE_ID with CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.");
  const before = { products: await count("products"), variants: await count("product_variants"), pictures: await count("product_images"), orders: await count("orders") };
  console.log(`Target: ${target}`);
  console.log(`Products ${before.products}, sizes/colours ${before.variants}, picture records ${before.pictures} (orders ${before.orders} stay).`);
  if (!confirm) {
    console.log("Dry run: nothing was changed. Add --confirm to delete the products.");
    return;
  }

  const images = await db.select({ key: productImages.r2Key, widths: productImages.variantWidths }).from(productImages);
  await db.execute(sql`delete from products`); // variants, pictures, collection and flash-sale links go with them (cascade); order lines keep their text, their product link is cleared

  let removed = 0;
  const kept: string[] = [];
  for (const image of images) {
    const keys = [image.key, ...((image.widths ?? []) as number[]).map((width) => variantKeyFor(image.key, width))];
    for (const key of keys) {
      if (backendOf(key) === "r2") {
        kept.push(key);
        continue;
      }
      try {
        await deleteObject(key);
        removed++;
      } catch (error) {
        console.warn(`could not delete ${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  console.log(`Deleted ${before.products} products, ${before.variants} sizes/colours, ${before.pictures} picture records, ${removed} picture files.`);
  if (kept.length) console.log(`${kept.length} picture file(s) live in R2 and were left in the bucket (harmless, a few KB each).`);

  const site = process.env.SITE_URL;
  const secret = process.env.CRON_SECRET;
  if (site && secret) {
    const response = await fetch(`${site.replace(/\/$/, "")}/api/revalidate`, { method: "POST", headers: { authorization: `Bearer ${secret}` } }).catch(() => null);
    console.log(response?.ok ? "The shop's pages were refreshed." : "Could not refresh the shop's pages: they update within 10 minutes by themselves.");
  } else {
    console.log("Tip: set SITE_URL and CRON_SECRET to refresh the shop's pages at once.");
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
