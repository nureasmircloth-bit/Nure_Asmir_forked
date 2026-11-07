// Adding products from sheet-style rows, for the AI connection: check the rows against the shop, then save each product as a hidden DRAFT and remember which pictures it is
// still waiting for (the owner drops them in the admin, see app/admin/(protected)/products/new-pictures). The reading of the rows is lib/import/sheet-rows.ts (pure);
// the saving of one product is lib/import/import-product.ts (the same code as the admin's bulk upload).

import { count, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { chunked } from "@/db/sql-compat";
import { aiProducts, categories, pendingPictures, productVariants, products } from "@/db/schema";
import { auditLogEntry } from "@/lib/admin/audit";
import { CategoryInputError } from "@/lib/categories";
import { splitCategoryPath } from "@/lib/category-tree";
import { importOne } from "@/lib/import/import-product";
import { groupColours, importPayload } from "@/lib/import/sheet-rows";
import { categoryPathOf, type ParsedProduct } from "@/lib/product-sheet";
import { slugify } from "@/lib/slug";

/** Most products an assistant may add in one day (all calls together). */
export const DAILY_LIMIT = 200;

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

export type CreatedProduct = { name: string; ok: boolean; productId?: string; sizes: number; picturesWaiting: number; message?: string };

/** How many products assistants added in the last 24 hours. */
export async function addedToday(): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(aiProducts).where(gte(aiProducts.createdAt, new Date(Date.now() - 86_400_000)));
  return n;
}

/**
 * Saves each product as a hidden draft and notes the pictures it waits for. One product failing does not stop the others (it is reported). The rows have been checked before this is called.
 */
export async function createDrafts(parsed: ParsedProduct[], tokenLabel: string): Promise<CreatedProduct[]> {
  const results: CreatedProduct[] = [];
  const groups = groupColours(parsed);
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const sizes = group.colours.reduce((sum, colour) => sum + colour.variants.length, 0);
    try {
      const saved = await importOne(importPayload(group), index);
      if (!saved.success || !saved.productId) {
        results.push({ name: group.first.name, ok: false, sizes, picturesWaiting: 0, message: saved.error ?? "Could not be added." });
        continue;
      }
      await db.insert(aiProducts).values({ productId: saved.productId, tokenLabel, wantsPublished: group.first.visible && !group.first.comingSoon });
      const jobs = saved.images ?? [];
      for (const part of chunked(jobs, 12)) {
        await db.insert(pendingPictures).values(part.map((job) => ({ productId: saved.productId as string, variantId: job.variantId ?? null, fileName: job.file, altText: job.alt, isPrimary: job.isPrimary, sortOrder: job.order })));
      }
      results.push({ name: group.first.name, ok: true, productId: saved.productId, sizes, picturesWaiting: jobs.length, message: saved.variantErrors?.join(" ") || undefined });
    } catch (error) {
      if (error instanceof CategoryInputError) results.push({ name: group.first.name, ok: false, sizes, picturesWaiting: 0, message: error.message });
      else {
        console.error("mcp product create failed", error);
        results.push({ name: group.first.name, ok: false, sizes, picturesWaiting: 0, message: "Could not be added just now." });
      }
    }
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
