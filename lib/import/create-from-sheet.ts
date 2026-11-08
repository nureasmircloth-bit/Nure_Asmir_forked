// Adding products from sheet-style rows, for the AI connection: check the rows against the shop, then save each product as a hidden DRAFT and remember which pictures it is
// still waiting for (the owner drops them in the admin, see app/admin/(protected)/products/new-pictures). The reading of the rows is lib/import/sheet-rows.ts (pure);
// the saving of one product is lib/import/import-product.ts (the same code as the admin's bulk upload).

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { chunked } from "@/db/sql-compat";
import { aiProducts, categories, pendingPictures, productVariants, products } from "@/db/schema";
import { auditLogEntry } from "@/lib/admin/audit";
import { CategoryInputError } from "@/lib/categories";
import { splitCategoryPath } from "@/lib/category-tree";
import { importOne } from "@/lib/import/import-product";
import { groupColours, importPayload, splitByBudget } from "@/lib/import/sheet-rows";
import { categoryPathOf, type ParsedProduct } from "@/lib/product-sheet";
import { slugify } from "@/lib/slug";

const norm = (name: string) => splitCategoryPath(name).join(" > ").toLowerCase();

/**
 * What the shop itself would object to: a product whose name (page address) is already taken, a product code that already belongs to a size, two products that would get the same
 * address, and the categories that do not exist yet (those are made when the products are created, which the preview tells).
 */
export async function shopProblems(parsed: ParsedProduct[]): Promise<{ problems: string[]; newCategories: string[] }> {
  const groups = groupColours(parsed);
  const problems: string[] = [];

  const slugs = groups.map((group) => slugify(group.first.name));
  const seen = new Set<string>();
  groups.forEach((group, i) => {
    if (seen.has(slugs[i])) problems.push(`“${group.first.name}” would get the same page address as another product in these rows. Give one of them a different name.`);
    seen.add(slugs[i]);
  });
  for (const part of chunked(slugs)) {
    const taken = await db.select({ slug: products.slug, name: products.name }).from(products).where(inArray(products.slug, part));
    for (const row of taken) problems.push(`A product called “${row.name}” already exists in the shop. Products that exist cannot be changed this way (do that in the admin).`);
  }

  const skus = [...new Set(parsed.flatMap((product) => product.variants.map((variant) => variant.sku)))];
  for (const part of chunked(skus)) {
    const taken = await db.select({ sku: productVariants.sku }).from(productVariants).where(inArray(productVariants.sku, part));
    for (const row of taken) problems.push(`The product code ${row.sku} already belongs to a size in the shop. Use another code, or leave the code empty.`);
  }

  const all = await db.select({ id: categories.id, name: categories.name, parentId: categories.parentId }).from(categories);
  const byId = new Map(all.map((row) => [row.id, row]));
  const known = new Set<string>();
  for (const row of all) {
    const names: string[] = [];
    for (let cursor: typeof row | undefined = row, guard = 0; cursor && guard < 8; cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined, guard++) names.unshift(cursor.name);
    known.add(norm(names.join(" > ")));
    known.add(norm(row.name)); // a plain name finds the category with that name wherever it sits
  }
  const newCategories = [...new Set(parsed.map((product) => categoryPathOf(product)).filter((path) => !known.has(norm(path))))];
  return { problems: [...new Set(problems)], newCategories };
}

/** `deferred`: not tried in this call because the call was already big enough (see splitByBudget); nothing of it was saved, and it can be sent again. */
export type CreatedProduct = { name: string; ok: boolean; productId?: string; sizes: number; picturesWaiting: number; message?: string; deferred?: boolean };

/**
 * Saves each product as a hidden draft and notes the pictures it waits for. One product failing does not stop the others (it is reported). The rows have been checked before this is called.
 * A product is all or nothing as far as the result goes: if any of its sizes could not be saved, or the notes about its pictures could not be, the product is removed again
 * (its sizes and notes go with it), so no half-made draft is left behind and none is reported as added.
 */
export async function createDrafts(parsed: ParsedProduct[], tokenLabel: string): Promise<CreatedProduct[]> {
  const results: CreatedProduct[] = [];
  const { now: groups, later } = splitByBudget(groupColours(parsed));
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const sizes = group.colours.reduce((sum, colour) => sum + colour.variants.length, 0);
    let productId: string | undefined;
    try {
      const saved = await importOne(importPayload(group), index);
      productId = saved.productId;
      if (!saved.success || !saved.productId) {
        results.push({ name: group.first.name, ok: false, sizes, picturesWaiting: 0, message: saved.error ?? "Could not be added." });
        continue;
      }
      if (saved.variantErrors?.length) throw new Error(`not every size could be saved: ${saved.variantErrors.join(" ")}`);
      const stored = await db.select({ id: productVariants.id, color: productVariants.color }).from(productVariants).where(eq(productVariants.productId, saved.productId));
      if (stored.length !== sizes) throw new Error(`${stored.length} of ${sizes} sizes were saved`);
      const colourOf = new Map(stored.map((row) => [row.id, row.color]));
      await db.insert(aiProducts).values({ productId: saved.productId, tokenLabel, wantsPublished: group.first.visible });
      const jobs = saved.images ?? [];
      for (const part of chunked(jobs, 12)) {
        await db.insert(pendingPictures).values(part.map((job) => ({ productId: saved.productId as string, color: job.variantId ? (colourOf.get(job.variantId) ?? null) : null, fileName: job.file, altText: job.alt, isPrimary: job.isPrimary, sortOrder: job.order })));
      }
      results.push({ name: group.first.name, ok: true, productId: saved.productId, sizes, picturesWaiting: jobs.length });
    } catch (error) {
      // Take back what was saved of this product (its sizes and picture notes are removed with it), so nothing half-made stays.
      if (productId) await db.delete(products).where(eq(products.id, productId)).catch((cleanup) => console.error("mcp product cleanup failed", cleanup));
      if (error instanceof CategoryInputError) results.push({ name: group.first.name, ok: false, sizes, picturesWaiting: 0, message: error.message });
      else {
        console.error("mcp product create failed", error);
        results.push({ name: group.first.name, ok: false, sizes, picturesWaiting: 0, message: "Could not be added just now, and nothing of it was kept." });
      }
    }
  }
  for (const group of later) {
    results.push({ name: group.first.name, ok: false, deferred: true, sizes: group.colours.reduce((sum, colour) => sum + colour.variants.length, 0), picturesWaiting: 0, message: "Not tried in this call because it was already big. Nothing of it was saved: send it again." });
  }
  const made = results.filter((result) => result.ok);
  if (made.length) {
    await auditLogEntry({
      actorEmail: `AI assistant: ${tokenLabel}`,
      action: "mcp.products.create",
      entityType: "product",
      entityId: made.map((result) => result.productId).join(","),
      detail: { added: made.length, failed: results.length - made.length, token: tokenLabel },
    });
  }
  return results;
}
