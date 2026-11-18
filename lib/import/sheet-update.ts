// Uploading a sheet that mentions products which ALREADY exist: the new sizes are added to those products (the product is not created again), and, only when the owner asks,
// the price / stock / old price of sizes that exist are brought in line with the sheet. The work is done by the same planner the AI connection uses (lib/mcp/manage-tools.ts),
// so the checks (no duplicate codes, old price above price, never hiding a last size…) are the same everywhere.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { chunked } from "@/db/sql-compat";
import { products, productVariants } from "@/db/schema";

export type SheetColour = { name: string; colour: string; variants: Array<{ size: string; price: number; oldPrice: number | null; stock: number }> };

export type SheetUpdatePlan = {
  /** Names (as in the sheet) of products that already exist: they are updated, not created. */
  existing: string[];
  /** The changes in the planner's own format. */
  changes: Array<Record<string, unknown>>;
  /** Things the owner should know (a colour that is new for an existing product, sizes that are already there…). */
  notes: string[];
};

/** Works out what the sheet would do to the products that already exist. Nothing is written. */
export async function planSheetUpdate(sheet: SheetColour[], options: { updateExisting: boolean }): Promise<SheetUpdatePlan> {
  const names = [...new Set(sheet.map((entry) => entry.name.trim().toLowerCase()))];
  const found: Array<typeof products.$inferSelect> = [];
  for (const part of chunked(names)) found.push(...(await db.select().from(products).where(inArray(sql`lower(${products.name})`, part))));
  const byName = new Map<string, Array<typeof products.$inferSelect>>();
  for (const row of found) byName.set(row.name.toLowerCase(), [...(byName.get(row.name.toLowerCase()) ?? []), row]);

  const variantsOf = new Map<string, Array<typeof productVariants.$inferSelect>>();
  for (const part of chunked(found.map((row) => row.id))) {
    for (const row of await db.select().from(productVariants).where(and(inArray(productVariants.productId, part), eq(productVariants.status, "active")))) variantsOf.set(row.productId, [...(variantsOf.get(row.productId) ?? []), row]);
  }

  const existing: string[] = [];
  const notes: string[] = [];
  const changes: Array<Record<string, unknown>> = [];
  const adds = new Map<string, { product: string; colour: string; sizes: string[]; price: number; stock: number; oldPrice: number | null }>();

  for (const entry of sheet) {
    const hits = byName.get(entry.name.trim().toLowerCase()) ?? [];
    if (hits.length === 0) continue;
    if (hits.length > 1) { notes.push(`“${entry.name}” is the name of ${hits.length} products, so nothing was changed for it. Give them different names first.`); existing.push(entry.name); continue; }
    const product = hits[0];
    if (!existing.includes(entry.name)) existing.push(entry.name);
    const own = variantsOf.get(product.id) ?? [];
    if (!own.some((variant) => variant.color.toLowerCase() === entry.colour.toLowerCase())) {
      notes.push(`“${entry.name}” has no colour ${entry.colour} yet. Add a new colour from the product's own page; the other colours were handled.`);
      continue;
    }
    for (const sheetSize of entry.variants) {
      const match = own.find((variant) => variant.color.toLowerCase() === entry.colour.toLowerCase() && (variant.size ?? "").toLowerCase() === sheetSize.size.toLowerCase());
      if (!match) {
        const key = `${product.id}|${entry.colour.toLowerCase()}|${sheetSize.price}|${sheetSize.stock}|${sheetSize.oldPrice ?? ""}`;
        const group = adds.get(key) ?? { product: product.slug, colour: own.find((variant) => variant.color.toLowerCase() === entry.colour.toLowerCase())!.color, sizes: [], price: sheetSize.price, stock: sheetSize.stock, oldPrice: sheetSize.oldPrice };
        group.sizes.push(sheetSize.size || "One size");
        adds.set(key, group);
        continue;
      }
      if (!options.updateExisting) continue;
      const row: Record<string, unknown> = { sku: match.sku };
      // A price of 0 in the sheet means “price on request”: the price of an existing size is left alone.
      if (sheetSize.price > 0 && sheetSize.price !== match.price) row.price = sheetSize.price;
      if (sheetSize.stock !== match.stockQuantity) row.stock = sheetSize.stock;
      if ((sheetSize.oldPrice ?? null) !== (match.compareAtPrice ?? null) && sheetSize.price > 0) row.oldPrice = sheetSize.oldPrice;
      if (Object.keys(row).length > 1) changes.push(row);
    }
  }
  for (const group of adds.values()) {
    changes.push({ product: group.product, colour: group.colour, addSizes: group.sizes.join(", "), ...(group.price > 0 ? { price: group.price } : {}), stock: group.stock, ...(group.oldPrice ? { oldPrice: group.oldPrice } : {}) });
  }
  return { existing, changes, notes };
}
