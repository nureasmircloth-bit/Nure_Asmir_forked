// Tries the management tools against a throw-away local database (LOCAL_DB_PATH): node ./node_modules/tsx/dist/cli.mjs scripts/check-manage-tools.ts
import { db } from "@/db";
import { productImages, products, productVariants } from "@/db/schema";
import { importOne } from "@/lib/import/import-product";
import { manageTools } from "@/lib/mcp/manage-tools";
import { eq } from "drizzle-orm";

const tool = (name: string) => manageTools.find((item) => item.name === name)!;
const ctx = { scopes: ["catalog:read", "products:manage", "products:delete"] as never, tokenId: "t-try", label: "try" };
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) { failures++; if (detail !== undefined) console.log(JSON.stringify(detail, null, 1)); } };

async function main() {
  const make = async (name: string, status: "draft" | "published") => {
    const result = await importOne({ name, category: "Shirts", typeLabel: "Shirt", visibility: status, variants: [
      { name: "White / M", color: "White", sku: `${name.slice(0, 3).toUpperCase()}-M`, size: "M", price: 5000, stockQuantity: 4 },
      { name: "White / L", color: "White", sku: `${name.slice(0, 3).toUpperCase()}-L`, size: "L", price: 5000, compareAtPrice: 6000, stockQuantity: 2 },
    ] } as never, 0);
    return result.productId!;
  };
  const a = await make("Alpha Shirt", "draft");
  const b = await make("Beta Shirt", "draft");
  void b;

  // 1. preview, wrong confirmation, then apply
  const changes = [
    { product: "alpha shirt", subcategory: "Formal Shirts", badge: "sale", seoTitle: "Alpha Shirt | Nure Asmir", seoDescription: "A fine alpha shirt." },
    { sku: "ALP-M", price: 5500, oldPrice: 7000, stock: 9 },
    { product: "Alpha Shirt", addSizes: "XL, XXL", price: 5600, stock: 3 },
  ];
  const prep = (await tool("prepare_changes").run({ changes }, ctx)) as { ready: boolean; confirm?: string; problems: string[]; preview: unknown };
  check("preview ready", prep.ready === true && Boolean(prep.confirm), prep);
  let refused = false;
  try { await tool("apply_changes").run({ changes, confirm: "prep_wrong" }, ctx); } catch { refused = true; }
  check("wrong confirmation refused", refused);
  let other = false;
  try { await tool("apply_changes").run({ changes: [{ sku: "ALP-M", stock: 1 }], confirm: prep.confirm }, ctx); } catch { other = true; }
  check("confirmation for other changes refused", other);
  const applied = (await tool("apply_changes").run({ changes, confirm: prep.confirm }, ctx)) as { done: number; failed: number; results: unknown[] };
  check("applied 3 of 3", applied.done === 3 && applied.failed === 0, applied);
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, a));
  const m = variants.find((v) => v.sku === "ALP-M")!;
  check("price/old/stock saved", m.price === 5500 && m.compareAtPrice === 7000 && m.stockQuantity === 9, m);
  check("sizes added (XL, XXL)", variants.some((v) => v.size === "XL" && v.price === 5600 && v.stockQuantity === 3) && variants.some((v) => v.size === "XXL"), variants.map((v) => [v.sku, v.size]));
  const [pa] = await db.select().from(products).where(eq(products.id, a));
  check("product fields saved + seo locked", pa.badge === "Sale" && pa.subcategory === "Formal Shirts" && pa.seoTitle === "Alpha Shirt | Nure Asmir" && pa.seoLocked === true, pa);
  let reused = false;
  try { await tool("apply_changes").run({ changes, confirm: prep.confirm }, ctx); } catch { reused = true; }
  check("confirmation cannot be reused", reused);

  // 2. refusals
  const bad = (await tool("prepare_changes").run({ changes: [{ product: "Nope" }, { sku: "ALP-M", price: -5 }, { product: "Alpha Shirt", status: "published" }, { product: "Alpha Shirt", colour: "Blue", addSizes: "S", price: 1 }, { sku: "ALP-M", price: 9000 }, { product: "Alpha Shirt", prise: 5 }] }, ctx)) as { ready: boolean; problems: string[] };
  check("bad changes refused with reasons", bad.ready === false && bad.problems.length >= 6, bad);
  console.log(bad.problems.join("\n"));

  // 3. publish needs a picture, then works
  await db.insert(productImages).values({ productId: a, r2Key: "try/a.webp", altText: "a", contentType: "image/webp", byteSize: 10 } as never);
  const pub = (await tool("prepare_changes").run({ changes: [{ product: "Alpha Shirt", status: "published" }] }, ctx)) as { ready: boolean; confirm: string };
  check("publish preview ready once it has a picture", pub.ready, pub);
  await tool("apply_changes").run({ changes: [{ product: "Alpha Shirt", status: "published" }], confirm: pub.confirm }, ctx);
  const [pa2] = await db.select().from(products).where(eq(products.id, a));
  check("published", pa2.status === "published" && pa2.publishedAt !== null);

  // 4. remove last size refused; delete rules
  const last = (await tool("prepare_changes").run({ changes: [{ sku: "BET-M", remove: true }, { sku: "BET-L", remove: true }] }, ctx)) as { ready: boolean; problems: string[] };
  check("removing every size is refused", last.ready === false && /last size/.test(last.problems.join()), last);
  const delPublished = (await tool("prepare_delete").run({ products: ["Alpha Shirt"] }, ctx)) as { ready: boolean; problems: string[] };
  check("published product cannot be deleted", delPublished.ready === false, delPublished);
  const del = (await tool("prepare_delete").run({ products: ["Beta Shirt"] }, ctx)) as { ready: boolean; confirm: string; willBeDeleted: unknown[] };
  check("draft delete preview", del.ready && del.willBeDeleted.length === 1, del);
  const gone = (await tool("delete_products").run({ products: ["Beta Shirt"], confirm: del.confirm }, ctx)) as { deleted: number };
  check("deleted for good", gone.deleted === 1 && (await db.select().from(products).where(eq(products.name, "Beta Shirt"))).length === 0 && (await db.select().from(productVariants).where(eq(productVariants.sku, "BET-M"))).length === 0, gone);

  // 5. seo report + refresh
  const report = (await tool("seo_report").run({}, ctx)) as { products: unknown[] };
  check("seo report runs", Array.isArray(report.products), report);
  const refreshed = (await tool("refresh_website").run({ products: ["Alpha Shirt"] }, ctx)) as { ok: boolean };
  check("refresh runs", refreshed.ok === true, refreshed);
  console.log(failures ? `${failures} FAILED` : "ALL OK");
  process.exit(failures ? 1 : 0);
}
main().catch((error) => { console.error(error); process.exit(2); });
