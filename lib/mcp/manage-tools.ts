// The tools that CHANGE products that already exist (permission “products:manage”), and the ones that delete them (“products:delete”).
// Every change goes in two steps, like adding products: prepare_changes shows exactly what would change (before and after) and hands out a one-use confirmation tied to those exact rows;
// apply_changes does it only with that confirmation. Hiding or archiving is the gentle way to take a product off the shop (it can be shown again); only products that are not on the
// website (drafts and archived ones) can be deleted for good, and never without their own preview and confirmation.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db, runAtomically } from "@/db";
import { chunked } from "@/db/sql-compat";
import { categories, orderItems, productImages, products, productVariants } from "@/db/schema";
import { auditLogEntry } from "@/lib/admin/audit";
import { productSnapshot, variantSnapshot } from "@/lib/admin/snapshots";
import { generateSeoFields } from "@/lib/ai/seo";
import { runInBackground } from "@/lib/background";
import { addSubcategory, CategoryInputError, ensureCategory } from "@/lib/categories";
import { isUniqueViolation } from "@/lib/db/errors";
import { variantKeyFor } from "@/lib/image-variants";
import { removeProductFromSearch, reindexAll, syncProductSearch } from "@/lib/search/algolia";
import { suggestSku } from "@/lib/sku";
import { checkStockAlerts } from "@/lib/stock-alerts";
import { deleteObject } from "@/lib/storage";
import { refreshStorefront } from "@/lib/storefront-cache";
import { confirmationProblem, issueConfirmation, redeemConfirmation } from "./guards";
import { ToolInputError, type ToolDef } from "./protocol";

const PRODUCT_FIELDS = ["product", "status", "category", "subcategory", "badge", "featured", "priceOnRequest", "comingSoon", "seoTitle", "seoDescription", "seoKeywords", "regenerateSeo"];
const SIZE_FIELDS = ["sku", "price", "oldPrice", "stock", "remove"];
const ADD_FIELDS = ["product", "colour", "addSizes", "price", "oldPrice", "stock"];

import { APPLY_INPUT, CHANGES_INPUT, DELETE_INPUT, DELETE_PREPARE_INPUT, REFRESH_INPUT, SEO_REPORT_INPUT } from "./manage-schemas";

/** A short code of exactly what was previewed (any change to the changes gives another). */
async function digestOfValue(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Row = Record<string, unknown>;
type ProductRow = typeof products.$inferSelect;
type VariantRow = typeof productVariants.$inferSelect;
type Plan = { label: string; what: string[]; productId: string; apply: () => Promise<void>; variantId?: string; skus?: string[]; bind?: unknown; entity: { type: "product" | "variant"; id: string }; before?: Row; after?: Row };

const text = (value: unknown) => String(value ?? "").trim();
const isWhole = (value: unknown, min = 0) => typeof value === "number" && Number.isInteger(value) && value >= min;
const listOf = (value: unknown): string[] => (Array.isArray(value) ? value.map(text) : text(value).split(/[,;]/).map((part) => part.trim())).filter(Boolean);

/** Finds products by slug or exact name (capitals do not matter). A name that belongs to more than one product is reported, never guessed. */
async function findProducts(keys: string[]): Promise<Map<string, ProductRow[]>> {
  const lowered = [...new Set(keys.map((key) => key.toLowerCase()))];
  const found: ProductRow[] = [];
  for (const part of chunked(lowered)) {
    found.push(...(await db.select().from(products).where(inArray(sql`lower(${products.slug})`, part))));
    found.push(...(await db.select().from(products).where(inArray(sql`lower(${products.name})`, part))));
  }
  const byKey = new Map<string, ProductRow[]>();
  for (const key of lowered) {
    const hits = new Map<string, ProductRow>();
    for (const row of found) if (row.slug.toLowerCase() === key || row.name.toLowerCase() === key) hits.set(row.id, row);
    byKey.set(key, [...hits.values()]);
  }
  return byKey;
}

/** Looks at the rows and works out what each would do. Problems come back as plain sentences with the number of the row. */
async function plan(rows: unknown[]): Promise<{ plans: Plan[]; problems: string[]; touched: Set<string>; digest: string }> {
  const problems: string[] = [];
  const plans: Plan[] = [];
  const touched = new Set<string>();
  const objects = rows.map((row, index) => (row && typeof row === "object" && !Array.isArray(row) ? (row as Row) : (problems.push(`Change ${index + 1} must be an object.`), {} as Row)));

  const productKeys = objects.map((row) => text(row.product)).filter(Boolean);
  const skus = objects.map((row) => text(row.sku).toUpperCase()).filter(Boolean);
  const byProduct = productKeys.length ? await findProducts(productKeys) : new Map<string, ProductRow[]>();
  const variantsBySku = new Map<string, VariantRow>();
  for (const part of chunked([...new Set(skus)])) for (const row of await db.select().from(productVariants).where(inArray(sql`upper(${productVariants.sku})`, part))) variantsBySku.set(row.sku.toUpperCase(), row);

  // Everything about the products involved: their sizes (to count what stays) and whether they have pictures (a product without pictures cannot be shown).
  const involvedIds = new Set<string>([...byProduct.values()].flat().map((row) => row.id));
  for (const variant of variantsBySku.values()) involvedIds.add(variant.productId);
  const variantsOf = new Map<string, VariantRow[]>();
  const pictureCount = new Map<string, number>();
  const productById = new Map<string, ProductRow>([...byProduct.values()].flat().map((row) => [row.id, row]));
  for (const part of chunked([...involvedIds])) {
    for (const row of await db.select().from(productVariants).where(inArray(productVariants.productId, part))) variantsOf.set(row.productId, [...(variantsOf.get(row.productId) ?? []), row]);
    for (const row of await db.select({ productId: productImages.productId, n: sql<number>`count(*)` }).from(productImages).where(inArray(productImages.productId, part)).groupBy(productImages.productId)) pictureCount.set(row.productId, Number(row.n));
    for (const row of await db.select().from(products).where(inArray(products.id, part))) productById.set(row.id, row);
  }
  const removing = new Map<string, number>(); // sizes taken off in this call, for each product
  const removingIds = new Set<string>(); // the sizes taken off in this call: none of them may become the main size of a product
  const newSkus = new Set<string>();

  objects.forEach((row, index) => {
    const at = `Change ${index + 1}`;
    const keys = Object.keys(row);
    const kind = row.sku !== undefined ? "size" : row.addSizes !== undefined ? "add" : row.product !== undefined ? "product" : null;
    if (!kind) return void problems.push(`${at}: say which product (“product”) or which size (“sku”).`);
    const allowed = kind === "size" ? SIZE_FIELDS : kind === "add" ? ADD_FIELDS : PRODUCT_FIELDS;
    const unknown = keys.filter((key) => !allowed.includes(key));
    if (unknown.length) return void problems.push(`${at}: ${unknown.map((key) => `“${key}”`).join(", ")} does not belong in a change like this. Allowed: ${allowed.join(", ")}.`);
    if (keys.length <= 1) return void problems.push(`${at}: it says which ${kind === "size" ? "size" : "product"} but not what to change.`);

    // --- one size ---
    if (kind === "size") {
      const variant = variantsBySku.get(text(row.sku).toUpperCase());
      if (!variant) return void problems.push(`${at}: no size has the code “${text(row.sku)}”.`);
      const owner = productById.get(variant.productId);
      const set: Partial<typeof productVariants.$inferInsert> = {};
      const what: string[] = [];
      if (row.price !== undefined) {
        if (!isWhole(row.price)) return void problems.push(`${at}: price must be a whole number of rupees.`);
        set.price = row.price as number;
        what.push(`price ${variant.price} → ${row.price}`);
      }
      if (row.oldPrice !== undefined) {
        if (row.oldPrice !== null && !isWhole(row.oldPrice, 1)) return void problems.push(`${at}: oldPrice must be a whole number, or null to remove it.`);
        const price = (set.price as number | undefined) ?? variant.price;
        if (row.oldPrice !== null && (row.oldPrice as number) <= price) return void problems.push(`${at}: the old price must be higher than the price.`);
        set.compareAtPrice = row.oldPrice as number | null;
        what.push(`old price ${variant.compareAtPrice ?? "none"} → ${row.oldPrice ?? "none"}`);
      } else if (set.price !== undefined && variant.compareAtPrice !== null && variant.compareAtPrice <= set.price) {
        return void problems.push(`${at}: the new price ${set.price} is not below the old price ${variant.compareAtPrice}. Change oldPrice too (null removes it).`);
      }
      if (row.stock !== undefined) {
        if (!isWhole(row.stock)) return void problems.push(`${at}: stock must be a whole number.`);
        set.stockQuantity = row.stock as number;
        what.push(`stock ${variant.stockQuantity} → ${row.stock}`);
      }
      if (row.remove !== undefined) {
        if (row.remove !== true) return void problems.push(`${at}: remove can only be true.`);
        const active = (variantsOf.get(variant.productId) ?? []).filter((item) => item.status === "active").length;
        const gone = (removing.get(variant.productId) ?? 0) + 1;
        if (active - gone < 1) return void problems.push(`${at}: that would remove the last size of “${owner?.name}”. Archive the product instead.`);
        removing.set(variant.productId, gone);
        set.status = "archived";
        removingIds.add(variant.id);
        what.push("size hidden (archived)");
      }
      plans.push({
        label: `${owner?.name ?? "?"} · ${variant.color}${variant.size ? ` · ${variant.size}` : ""} (${variant.sku})`,
        what,
        productId: variant.productId,
        variantId: variant.id,
        entity: { type: "variant", id: variant.id },
        before: variantSnapshot(variant),
        after: { ...variantSnapshot(variant), ...Object.fromEntries(Object.entries({ price: set.price, compareAtPrice: set.compareAtPrice, stockQuantity: set.stockQuantity, status: set.status }).filter(([, value]) => value !== undefined)) },
        apply: async () => {
          if (set.status !== "archived") {
            await db.update(productVariants).set({ ...set, updatedAt: new Date() }).where(eq(productVariants.id, variant.id));
            return;
          }
          // The size is hidden only if the product still has another active size at this very moment (checked and written in one statement).
          const archived = await db
            .update(productVariants)
            .set({ ...set, isDefault: false, updatedAt: new Date() })
            .where(and(eq(productVariants.id, variant.id), sql`(select count(*) from product_variants pv where pv.product_id = ${variant.productId} and pv.status = 'active' and pv.id <> ${variant.id}) >= 1`))
            .returning({ id: productVariants.id });
          if (archived.length === 0) throw new Error("This is now the last active size of the product, so it was not hidden.");
          if (variant.isDefault) {
            // The main size goes to a size that stays: never one that this same call is hiding.
            const survivor = (variantsOf.get(variant.productId) ?? []).find((item) => item.id !== variant.id && item.status === "active" && !removingIds.has(item.id));
            if (survivor) await db.update(productVariants).set({ isDefault: true }).where(eq(productVariants.id, survivor.id));
          }
        },
      });
      touched.add(variant.productId);
      return;
    }

    // --- the product the row is about ---
    const hits = byProduct.get(text(row.product).toLowerCase()) ?? [];
    if (hits.length === 0) return void problems.push(`${at}: no product has the slug or name “${text(row.product)}”.`);
    if (hits.length > 1) return void problems.push(`${at}: “${text(row.product)}” is the name of ${hits.length} products (${hits.map((hit) => hit.slug).join(", ")}). Use the slug.`);
    const product = hits[0];

    // --- new sizes ---
    if (kind === "add") {
      const listed = listOf(row.addSizes);
      const sizes = [...new Map(listed.map((size) => [size.toLowerCase(), size])).values()];
      if (!sizes.length) return void problems.push(`${at}: addSizes is empty.`);
      if (sizes.length !== listed.length) return void problems.push(`${at}: a size is listed twice in addSizes.`);
      if (row.oldPrice !== undefined && row.oldPrice !== null && !isWhole(row.oldPrice, 1)) return void problems.push(`${at}: oldPrice must be a whole number, or null for none.`);
      if (!isWhole(row.price, 1) && row.price !== undefined) return void problems.push(`${at}: price must be a whole number of rupees.`);
      if (row.stock !== undefined && !isWhole(row.stock)) return void problems.push(`${at}: stock must be a whole number.`);
      const own = (variantsOf.get(product.id) ?? []).filter((item) => item.status === "active");
      const colours = text(row.colour) ? [text(row.colour)] : [...new Set(own.map((item) => item.color))];
      for (const colour of colours) if (!own.some((item) => item.color.toLowerCase() === colour.toLowerCase())) return void problems.push(`${at}: “${product.name}” has no colour “${colour}”.`);
      const what: string[] = [];
      const inserts: Array<typeof productVariants.$inferInsert> = [];
      for (const colour of colours) {
        const sameColour = own.filter((item) => item.color.toLowerCase() === colour.toLowerCase());
        const model = sameColour[0];
        const price = row.price !== undefined ? (row.price as number) : model.price;
        const oldPrice = row.oldPrice !== undefined ? (row.oldPrice as number | null) : null;
        if (oldPrice !== null && oldPrice <= price) return void problems.push(`${at}: the old price must be higher than the price.`);
        for (const size of sizes) {
          if (sameColour.some((item) => (item.size ?? "").toLowerCase() === size.toLowerCase())) { what.push(`${model.color} ${size}: already exists, skipped`); continue; }
          const code = suggestSku(product.name, product.typeLabel, size, colours.length > 1 || new Set(own.map((item) => item.color)).size > 1 ? model.color : undefined);
          if (newSkus.has(code.toUpperCase())) return void problems.push(`${at}: the size ${size} would get the code ${code}, which another size in this call gets too.`);
          newSkus.add(code.toUpperCase());
          inserts.push({ productId: product.id, name: `${model.color} / ${size}`, sku: code, color: model.color, size, price, compareAtPrice: oldPrice, stockQuantity: (row.stock as number | undefined) ?? 0, lowStockThreshold: 3, isDefault: false, status: "active" });
          what.push(`${model.color} ${size}: new size, price ${price}, stock ${(row.stock as number | undefined) ?? 0}`);
        }
      }
      if (!inserts.length) return void problems.push(`${at}: every one of those sizes already exists on “${product.name}”.`);
      plans.push({
        label: product.name,
        what,
        productId: product.id,
        entity: { type: "product", id: product.id },
        skus: inserts.map((insert) => insert.sku as string),
        bind: inserts.map((insert) => [insert.sku, insert.size, insert.price, insert.compareAtPrice, insert.stockQuantity]),
        // All the new sizes of the row are saved together or not at all.
        apply: async () => {
          try {
            await runAtomically(inserts.map((insert) => sql`insert into product_variants (product_id, name, sku, color, size, price, compare_at_price, stock_quantity, low_stock_threshold, is_default, status) values (${insert.productId}, ${insert.name}, ${insert.sku}, ${insert.color}, ${insert.size ?? null}, ${insert.price}, ${insert.compareAtPrice ?? null}, ${insert.stockQuantity ?? 0}, ${insert.lowStockThreshold ?? 3}, 0, 'active')`));
          } catch (error) {
            if (isUniqueViolation(error)) throw new Error("One of the new product codes is already used by another size. Nothing of this change was saved.");
            throw error;
          }
        },
      });
      touched.add(product.id);
      return;
    }

    // --- the product page itself ---
    const set: Partial<typeof products.$inferInsert> = {};
    const what: string[] = [];
    let newCategoryName: string | undefined;
    if (row.status !== undefined) {
      const status = text(row.status).toLowerCase();
      if (!["published", "draft", "archived"].includes(status)) return void problems.push(`${at}: status must be published, draft or archived.`);
      if (status === "published" && product.status !== "published") {
        if ((pictureCount.get(product.id) ?? 0) === 0) return void problems.push(`${at}: “${product.name}” has no pictures, so it cannot be shown on the website yet.`);
        set.publishedAt = new Date();
      }
      set.status = status as "published" | "draft" | "archived";
      what.push(`status ${product.status} → ${status}${status === "published" ? " (goes on the website)" : ""}`);
    }
    if (row.category !== undefined) {
      if (!text(row.category)) return void problems.push(`${at}: category is empty.`);
      newCategoryName = text(row.category);
      what.push(`category → ${newCategoryName}`);
    }
    if (row.subcategory !== undefined) { set.subcategory = text(row.subcategory).replace(/\s+/g, " ").slice(0, 60) || null; what.push(`subcategory ${product.subcategory ?? "none"} → ${set.subcategory ?? "none"}`); }
    if (row.badge !== undefined) {
      const badge = text(row.badge);
      if (badge && !["new", "sale", "bestseller", "limited"].includes(badge.toLowerCase())) return void problems.push(`${at}: badge must be New, Sale, Bestseller, Limited or empty.`);
      set.badge = badge ? badge.charAt(0).toUpperCase() + badge.slice(1).toLowerCase() : null;
      what.push(`label ${product.badge ?? "none"} → ${set.badge ?? "none"}`);
    }
    for (const flag of ["featured", "priceOnRequest", "comingSoon"] as const) {
      if (row[flag] === undefined) continue;
      if (typeof row[flag] !== "boolean") return void problems.push(`${at}: ${flag} must be true or false.`);
      set[flag] = row[flag] as boolean;
      what.push(`${flag} ${product[flag]} → ${row[flag]}`);
    }
    if (row.seoTitle !== undefined || row.seoDescription !== undefined || row.seoKeywords !== undefined) {
      if (row.regenerateSeo === true) return void problems.push(`${at}: use either your own SEO text or regenerateSeo, not both.`);
      if (row.seoTitle !== undefined) { if (text(row.seoTitle).length > 70) return void problems.push(`${at}: seoTitle is longer than 70 characters.`); set.seoTitle = text(row.seoTitle) || null; what.push(`search title → ${set.seoTitle ?? "(empty)"}`); }
      if (row.seoDescription !== undefined) { if (text(row.seoDescription).length > 170) return void problems.push(`${at}: seoDescription is longer than 170 characters.`); set.seoDescription = text(row.seoDescription) || null; what.push(`search description → ${set.seoDescription ?? "(empty)"}`); }
      if (row.seoKeywords !== undefined) { set.seoKeywords = text(row.seoKeywords) || null; what.push(`search keywords → ${set.seoKeywords ?? "(empty)"}`); }
      set.seoLocked = true; // hand-written text is kept: it is not rewritten when the product is edited later
    }
    if (row.regenerateSeo !== undefined) {
      if (row.regenerateSeo !== true) return void problems.push(`${at}: regenerateSeo can only be true.`);
      what.push("search title and description written again by the helper");
    }
    plans.push({
      label: product.name,
      what,
      productId: product.id,
      entity: { type: "product", id: product.id },
      before: productSnapshot(product),
      after: { ...productSnapshot(product), ...productSnapshot(set as Row) },
      apply: async () => {
        if (newCategoryName) {
          try { set.categoryId = (await ensureCategory(newCategoryName)).id; } catch (error) { if (error instanceof CategoryInputError) throw new Error(error.message); throw error; }
        }
        if (row.regenerateSeo === true) {
          const categoryId = set.categoryId ?? product.categoryId;
          const [category] = categoryId ? await db.select({ name: categories.name }).from(categories).where(eq(categories.id, categoryId)).limit(1) : [];
          const seo = await generateSeoFields({ name: product.name, typeLabel: product.typeLabel, categoryName: category?.name, color: product.primaryColour ?? undefined, material: product.material ?? undefined, shortDescription: product.shortDescription ?? undefined, description: product.description ?? undefined, keywords: product.seoKeywords ?? undefined });
          if (!seo) throw new Error("The helper could not write the search text just now; try again later.");
          set.seoTitle = seo.seoTitle;
          set.seoDescription = seo.seoDescription;
          set.seoLocked = false;
        }
        await db.update(products).set({ ...set, updatedAt: new Date() }).where(eq(products.id, product.id));
        const subcategory = set.subcategory !== undefined ? set.subcategory : product.subcategory;
        if (subcategory) await addSubcategory((set.categoryId ?? product.categoryId) as string, subcategory).catch(() => false);
      },
    });
    touched.add(product.id);
  });
  // The new codes must not belong to any size yet.
  const wanted = [...newSkus];
  for (const part of chunked(wanted)) {
    for (const row of await db.select({ sku: productVariants.sku }).from(productVariants).where(inArray(sql`upper(${productVariants.sku})`, part))) problems.push(`The code ${row.sku} is already used by another size, so the size that would get it cannot be added.`);
  }
  // The confirmation is tied to what was RESOLVED and shown (the products and sizes found, what each would change from what it is now), not just to the words that were sent:
  // if anything changed in the shop between the preview and the apply, the digest differs and a new preview is needed.
  const digest = await digestOfValue({ rows, resolved: plans.map((item) => [item.productId, item.variantId ?? null, item.what, item.bind ?? null]) });
  return { plans, problems, touched, digest };
}

const changesOf = (args: Record<string, unknown>): unknown[] => {
  const changes = args.changes;
  if (!Array.isArray(changes) || changes.length === 0) throw new ToolInputError("“changes” must be a list with at least one change.");
  return changes;
};

/** Search entries and shop pages are refreshed once after a batch: the products' own entries for a small batch, the whole search for a big one. */
async function refreshAfter(ids: string[], removed: string[] = []): Promise<string> {
  if (ids.length > 25) runInBackground(reindexAll(), "reindexAll");
  else for (const id of ids) runInBackground(syncProductSearch(id), "syncProductSearch");
  for (const id of removed) runInBackground(removeProductFromSearch(id), "removeProductFromSearch");
  refreshStorefront(true);
  return ids.length > 25 ? "The whole search is being rebuilt and the shop pages refreshed." : "Their search entries are updated and the shop pages refreshed.";
}

const prepareChanges: ToolDef = {
  name: "prepare_changes",
  title: "Preview changes to existing products",
  description:
    "Checks changes to products that already exist (show/hide, category, labels, SEO text, prices, stock, hiding sizes, adding sizes) and shows exactly what each would change, before and after. NOTHING is changed. " +
    "If it says ready, show the preview to the owner and ask; only if they agree, call apply_changes with the same changes and the confirmation.",
  scope: "products:manage",
  inputSchema: CHANGES_INPUT as unknown as Record<string, unknown>,
  async run(args, ctx) {
    const rows = changesOf(args);
    const { plans, problems, digest } = await plan(rows);
    const ready = problems.length === 0 && plans.length > 0;
    return {
      ready,
      problems,
      ...(ready ? { confirm: await issueConfirmation(ctx.tokenId, digest) } : {}),
      preview: plans.map((item) => ({ item: item.label, changes: item.what })),
      totals: { changes: plans.length, products: new Set(plans.map((item) => item.productId)).size },
      next: ready ? "Show this to the owner and ask whether to do it. If they agree, call apply_changes with exactly the same changes and the confirm value (it works once, for these changes, for 30 minutes)." : "Fix the problems and call prepare_changes again. Nothing was changed.",
    };
  },
};

const applyChanges: ToolDef = {
  name: "apply_changes",
  title: "Apply the previewed changes",
  description: "Does the changes you just previewed with prepare_changes. Needs the same changes and the one-use confirmation, and only after the owner agreed. Each change is reported as done or failed; one failing does not stop the others.",
  scope: "products:manage",
  readOnly: false,
  inputSchema: APPLY_INPUT as unknown as Record<string, unknown>,
  async run(args, ctx) {
    const rows = changesOf(args);
    const { plans, problems, touched, digest } = await plan(rows);
    if (problems.length) throw new ToolInputError(`These changes cannot be made, nothing was changed: ${problems.slice(0, 12).join(" | ")}`);
    if (!(await redeemConfirmation(ctx.tokenId, text(args.confirm), digest))) {
      throw new ToolInputError(`${await confirmationProblem(ctx.tokenId, text(args.confirm), digest)} Call prepare_changes again, show the owner the preview and use the new confirm value. Nothing was changed.`);
    }
    const results: Array<{ item: string; ok: boolean; changes?: string[]; message?: string }> = [];
    const done = new Set<string>();
    for (const item of plans) {
      try {
        await item.apply();
        results.push({ item: item.label, ok: true, changes: item.what });
        done.add(item.productId);
        if (item.variantId) runInBackground(checkStockAlerts([item.variantId]), "checkStockAlerts");
      } catch (error) {
        console.error("mcp change failed", error);
        results.push({ item: item.label, ok: false, message: error instanceof Error ? error.message : "Could not be changed." });
      }
    }
    const okCount = results.filter((result) => result.ok).length;
    // One history entry for each change (with the thing before and after), so every product's page of history shows what the assistant did.
    for (const item of plans) {
      if (!results.some((result) => result.item === item.label && result.ok)) continue;
      await auditLogEntry({ actorEmail: `AI assistant: ${ctx.label}`, action: item.entity.type === "variant" ? "variant.update" : "product.update", entityType: item.entity.type, entityId: item.entity.id, detail: item.what, before: item.before, after: item.after, source: `ai: ${ctx.label}` }).catch((error) => console.error("mcp history entry failed", error));
    }
    const refreshed = done.size ? await refreshAfter([...done]) : "";
    void touched;
    return { done: okCount, failed: results.length - okCount, results, next: `${okCount} change${okCount === 1 ? "" : "s"} made. ${refreshed}`.trim() };
  },
};

/** What a permanent delete would remove, per product, and why a product cannot be deleted. */
async function planDelete(names: unknown[]) {
  const problems: string[] = [];
  const keys = names.map(text).filter(Boolean);
  if (!keys.length || keys.length !== names.length) throw new ToolInputError("“products” must be a list of slugs or names.");
  const found = await findProducts(keys);
  const rows: ProductRow[] = [];
  for (const key of keys) {
    const hits = found.get(key.toLowerCase()) ?? [];
    if (hits.length === 0) problems.push(`No product has the slug or name “${key}”.`);
    else if (hits.length > 1) problems.push(`“${key}” is the name of ${hits.length} products (${hits.map((hit) => hit.slug).join(", ")}). Use the slug.`);
    else if (hits[0].status === "published") problems.push(`“${hits[0].name}” is on the website. Archive it first (apply_changes with status archived), then delete it.`);
    else if (!rows.some((row) => row.id === hits[0].id)) rows.push(hits[0]);
  }
  const ids = rows.map((row) => row.id);
  const orders = new Map<string, number>();
  const pictures = new Map<string, number>();
  for (const part of chunked(ids)) {
    for (const row of await db.select({ productId: orderItems.productId, n: sql<number>`count(*)` }).from(orderItems).where(inArray(orderItems.productId, part)).groupBy(orderItems.productId)) if (row.productId) orders.set(row.productId, Number(row.n));
    for (const row of await db.select({ productId: productImages.productId, n: sql<number>`count(*)` }).from(productImages).where(inArray(productImages.productId, part)).groupBy(productImages.productId)) pictures.set(row.productId, Number(row.n));
  }
  return { problems, rows, orders, pictures, digest: await digestOfValue(rows.map((row) => row.id).sort()) };
}

const prepareDelete: ToolDef = {
  name: "prepare_delete",
  title: "Preview deleting products for good",
  description:
    "Shows which products would be DELETED FOR GOOD (with their sizes and pictures): only products that are not on the website (draft or archived). Past orders keep their own copy of what was bought. NOTHING is deleted. " +
    "Hiding is gentler: apply_changes with status archived keeps the product. Show the owner the list and ask; only if they clearly agree, call delete_products with the confirmation.",
  scope: "products:delete",
  inputSchema: DELETE_PREPARE_INPUT as unknown as Record<string, unknown>,
  async run(args, ctx) {
    const { problems, rows, orders, pictures, digest } = await planDelete(Array.isArray(args.products) ? args.products : []);
    const ready = problems.length === 0 && rows.length > 0;
    return {
      ready,
      problems,
      ...(ready ? { confirm: await issueConfirmation(ctx.tokenId, digest) } : {}),
      willBeDeleted: rows.map((row) => ({ product: row.name, slug: row.slug, status: row.status, pictures: pictures.get(row.id) ?? 0, ordersThatIncludedIt: orders.get(row.id) ?? 0 })),
      next: ready ? "This cannot be undone. Read the list to the owner and ask clearly whether to delete these products for good. If they agree, call delete_products with the same products and the confirm value." : "Fix the problems and call prepare_delete again. Nothing was deleted.",
    };
  },
};

const deleteProducts: ToolDef = {
  name: "delete_products",
  title: "Delete the previewed products for good",
  description: "Deletes for good the products you just previewed with prepare_delete (their sizes and pictures too). This cannot be undone. Only after the owner clearly agreed, with the one-use confirmation.",
  scope: "products:delete",
  readOnly: false,
  destructive: true,
  inputSchema: DELETE_INPUT as unknown as Record<string, unknown>,
  async run(args, ctx) {
    const { problems, rows, digest } = await planDelete(Array.isArray(args.products) ? args.products : []);
    if (problems.length) throw new ToolInputError(`These products cannot be deleted, nothing was deleted: ${problems.slice(0, 12).join(" | ")}`);
    if (!rows.length) throw new ToolInputError("Nothing to delete.");
    if (!(await redeemConfirmation(ctx.tokenId, text(args.confirm), digest))) throw new ToolInputError(`${await confirmationProblem(ctx.tokenId, text(args.confirm), digest)} Call prepare_delete again and use the new confirm value. Nothing was deleted.`);
    const results: Array<{ product: string; ok: boolean; pictures?: number; message?: string }> = [];
    const removed: string[] = [];
    for (const row of rows) {
      try {
        // Re-checked at the last moment: the product must still be off the website.
        const [now] = await db.select({ status: products.status }).from(products).where(eq(products.id, row.id)).limit(1);
        if (!now) { results.push({ product: row.name, ok: false, message: "Already gone." }); continue; }
        if (now.status === "published") { results.push({ product: row.name, ok: false, message: "It was put on the website meanwhile, so it was not deleted." }); continue; }
        const images = await db.select({ r2Key: productImages.r2Key, variantWidths: productImages.variantWidths }).from(productImages).where(eq(productImages.productId, row.id));
        const gone = await db.delete(products).where(and(eq(products.id, row.id), eq(products.status, now.status))).returning({ id: products.id });
        if (gone.length === 0) { results.push({ product: row.name, ok: false, message: "It changed meanwhile, so it was not deleted." }); continue; }
        // From here the product IS deleted: what is left to tidy up can fail without changing that.
        removed.push(row.id);
        const followUp: string[] = [];
        await Promise.all(images.flatMap((image) => [deleteObject(image.r2Key), ...(image.variantWidths ?? []).map((width) => deleteObject(variantKeyFor(image.r2Key, width)))])).catch((error) => { console.error("mcp delete: pictures not removed", error); followUp.push("some picture files could not be removed from storage"); });
        await auditLogEntry({ actorEmail: `AI assistant: ${ctx.label}`, action: "product.delete_permanent", entityType: "product", entityId: row.id, detail: { name: row.name, imagesDeleted: images.length, token: ctx.label } }).catch((error) => { console.error("mcp delete: history entry failed", error); followUp.push("the history entry could not be written"); });
        results.push({ product: row.name, ok: true, pictures: images.length, ...(followUp.length ? { message: `Deleted, but ${followUp.join(" and ")}.` } : {}) });
      } catch (error) {
        console.error("mcp product delete failed", error);
        results.push({ product: row.name, ok: false, message: "Could not be deleted (it may still be in use). Nothing of it was removed." });
      }
    }
    if (removed.length) await refreshAfter([], removed);
    return { deleted: removed.length, failed: results.length - removed.length, results };
  },
};

const refreshWebsite: ToolDef = {
  name: "refresh_website",
  title: "Refresh the search and the shop pages",
  description: "Asks the website to show the latest data right away: rebuilds the search entries (of the given products, or of everything when none are given) and refreshes the shop's cached pages. Changes made with apply_changes already do this; use it after a doubt, or after the owner edited things by hand.",
  scope: "products:manage",
  readOnly: false,
  inputSchema: REFRESH_INPUT as unknown as Record<string, unknown>,
  async run(args) {
    const names = Array.isArray(args.products) ? args.products.map(text).filter(Boolean) : [];
    if (!names.length) {
      runInBackground(reindexAll(), "reindexAll");
      refreshStorefront(true);
      return { ok: true, next: "The whole search is being rebuilt (it takes a short while) and the shop pages are refreshed." };
    }
    const found = await findProducts(names);
    const ids = [...new Set([...found.values()].flat().map((row) => row.id))];
    const missing = names.filter((name) => !(found.get(name.toLowerCase())?.length));
    if (!ids.length) throw new ToolInputError(`No product has the slug or name ${missing.map((name) => `“${name}”`).join(", ")}.`);
    const note = await refreshAfter(ids);
    return { ok: true, refreshed: ids.length, notFound: missing, next: note };
  },
};

const seoReport: ToolDef = {
  name: "seo_report",
  title: "Products with missing search-engine text",
  description: "Lists the products on the website that have no search title or no search description (50 a page), and says whether each has hand-written text. Fix them with prepare_changes (seoTitle, seoDescription, or regenerateSeo: true).",
  scope: "catalog:read",
  inputSchema: SEO_REPORT_INPUT as unknown as Record<string, unknown>,
  async run(args) {
    const page = typeof args.page === "number" ? args.page : 1;
    const where = and(eq(products.status, "published"), sql`(${products.seoTitle} is null or ${products.seoTitle} = '' or ${products.seoDescription} is null or ${products.seoDescription} = '')`);
    const rows = await db.select({ name: products.name, slug: products.slug, seoTitle: products.seoTitle, seoDescription: products.seoDescription, seoLocked: products.seoLocked }).from(products).where(where).orderBy(products.name).limit(51).offset((page - 1) * 50);
    return { page, hasMore: rows.length > 50, products: rows.slice(0, 50).map((row) => ({ product: row.name, slug: row.slug, hasSearchTitle: Boolean(row.seoTitle), hasSearchDescription: Boolean(row.seoDescription), handWritten: row.seoLocked })) };
  },
};

/** The tools that change or delete existing products. */
export const manageTools: ToolDef[] = [prepareChanges, applyChanges, prepareDelete, deleteProducts, refreshWebsite, seoReport];
