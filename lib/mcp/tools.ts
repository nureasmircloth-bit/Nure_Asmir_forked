// The tools an AI assistant can call. All of them only READ (the first version of the connection cannot change anything in the shop).
// Answers hold shop data only: no customer names, phones, e-mails or addresses.

import { and, count, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, orders, productImages, productVariants, products } from "@/db/schema";
import { daysAgoMs } from "@/db/sql-compat";
import { ToolInputError, type ToolDef } from "./protocol";

// ---- reading the arguments --------------------------------------------------------------------------------------------------------------------

/** A text argument, trimmed. A search word is cut at `max` characters; with `exact` (a slug or a product code) a longer value is refused instead, so it is never matched in a shortened form. */
function text(args: Record<string, unknown>, name: string, max = 80, exact = false): string {
  const value = args[name];
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new ToolInputError(`“${name}” must be text.`);
  const trimmed = value.trim();
  if (exact && trimmed.length > max) throw new ToolInputError(`“${name}” is too long (at most ${max} characters).`);
  return trimmed.slice(0, max);
}

/** A whole-number argument inside a range, or the fallback when it is not given. */
function whole(args: Record<string, unknown>, name: string, min: number, max: number, fallback: number): number {
  const value = args[name];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new ToolInputError(`“${name}” must be a whole number from ${min} to ${max}.`);
  return value;
}

/** A search word for LIKE: the characters LIKE treats specially are taken literally. */
const likePattern = (word: string) => `%${word.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

// ---- shared lookups ---------------------------------------------------------------------------------------------------------------------------

type CategoryRow = { id: string; name: string; slug: string; parentId: string | null; status: string };

/** Every category, and a way to write the path of one as “Shirts > Formal Shirts”. */
async function allCategories(): Promise<{ rows: CategoryRow[]; path: (id: string) => string }> {
  const rows = await db.select({ id: categories.id, name: categories.name, slug: categories.slug, parentId: categories.parentId, status: categories.status }).from(categories);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const path = (id: string) => {
    const names: string[] = [];
    for (let cursor = byId.get(id), guard = 0; cursor && guard < 8; cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined, guard++) names.unshift(cursor.name);
    return names.join(" > ");
  };
  return { rows, path };
}

/** “The product sits in this category or anywhere inside it”: the database walks the whole tree itself (UNION ends a loop), so no depth or size is cut off and no list of ids is bound. */
const inCategoryTree = (id: string) =>
  sql`${products.categoryId} in (with recursive sub(id) as (select ${id} union select c.id from categories c join sub on c.parent_id = sub.id) select id from sub)`;

const available = sql<number>`(${productVariants.stockQuantity} - ${productVariants.reservedQuantity})`;

// ---- the tools --------------------------------------------------------------------------------------------------------------------------------

/** Tool: find products (by word, category and status) with a short card for each. */
const searchProducts: ToolDef = {
  name: "search_products",
  title: "Search products",
  description:
    "Find products by a word in the name, type, slug or product code (SKU), optionally inside one category (its subcategories are included) and by status. " +
    "Returns a short card for each product: colours, how many sizes, the price range and the total stock. Use get_product for the full detail.",
  scope: "catalog:read",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "A word or part of a name, slug or SKU, e.g. “tuxedo” or “FOR-132”. Empty = every product." },
      category: { type: "string", description: "A category name or slug, e.g. “Formal Shirts”." },
      status: { type: "string", enum: ["published", "draft", "all"], description: "Default “published” (what customers see)." },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "How many products to return (default 20)." },
    },
    additionalProperties: false,
  },
  async run(args) {
    const query = text(args, "query");
    const categoryText = text(args, "category");
    const status = text(args, "status") || "published";
    if (!["published", "draft", "all"].includes(status)) throw new ToolInputError("“status” must be published, draft or all.");
    const limit = whole(args, "limit", 1, 50, 20);

    const conditions = [];
    if (status !== "all") conditions.push(eq(products.status, status));
    if (query) {
      const pattern = likePattern(query);
      conditions.push(
        or(
          sql`${products.name} like ${pattern} escape '\\'`,
          sql`${products.slug} like ${pattern} escape '\\'`,
          sql`${products.typeLabel} like ${pattern} escape '\\'`,
          sql`exists (select 1 from product_variants v where v.product_id = ${products.id} and v.sku like ${pattern} escape '\\')`,
        ),
      );
    }
    const cats = await allCategories();
    if (categoryText) {
      const wanted = cats.rows.find((row) => row.slug === categoryText.toLowerCase() || row.name.toLowerCase() === categoryText.toLowerCase());
      if (!wanted) return { products: [], note: `No category called “${categoryText}”. Use list_categories to see the names.` };
      conditions.push(inCategoryTree(wanted.id));
    }
    const rows = await db
      .select({ id: products.id, name: products.name, slug: products.slug, status: products.status, typeLabel: products.typeLabel, categoryId: products.categoryId, comingSoon: products.comingSoon })
      .from(products)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(products.createdAt))
      .limit(limit);
    if (!rows.length) return { products: [], note: "Nothing matches." };

    const variants = await db
      .select({ productId: productVariants.productId, color: productVariants.color, size: productVariants.size, price: productVariants.price, stock: productVariants.stockQuantity, reserved: productVariants.reservedQuantity })
      .from(productVariants)
      .where(and(inArray(productVariants.productId, rows.map((row) => row.id)), eq(productVariants.status, "active")));
    const byProduct = new Map<string, typeof variants>();
    for (const variant of variants) byProduct.set(variant.productId, [...(byProduct.get(variant.productId) ?? []), variant]);

    return {
      count: rows.length,
      products: rows.map((row) => {
        const list = byProduct.get(row.id) ?? [];
        const prices = list.map((variant) => variant.price);
        return {
          name: row.name,
          slug: row.slug,
          status: row.status,
          type: row.typeLabel,
          category: cats.path(row.categoryId),
          comingSoon: row.comingSoon,
          colours: [...new Set(list.map((variant) => variant.color))],
          // different sizes, not colour-and-size pairs: a shirt in 2 colours and 8 sizes has 8
          sizeCount: new Set(list.map((variant) => variant.size ?? "")).size,
          priceFromTo: prices.length ? [Math.min(...prices), Math.max(...prices)] : null,
          piecesAvailable: list.reduce((sum, variant) => sum + Math.max(0, variant.stock - variant.reserved), 0),
        };
      }),
    };
  },
};

/** Tool: one product in full, with every colour and size. */
const getProduct: ToolDef = {
  name: "get_product",
  title: "Get one product",
  description: "The full detail of one product, found by its slug (from search_products) or by the product code (SKU) of any of its sizes: description, category, and every colour and size with price, stock and the codes.",
  scope: "catalog:read",
  inputSchema: {
    type: "object",
    properties: { slug: { type: "string" }, sku: { type: "string", description: "The product code of one size, e.g. FOR-132-15.5." } },
    additionalProperties: false,
  },
  async run(args) {
    const slug = text(args, "slug", 200, true);
    const sku = text(args, "sku", 200, true);
    if (!slug && !sku) throw new ToolInputError("Give a “slug” or a “sku”.");
    let where;
    if (slug) where = eq(products.slug, slug);
    else {
      const [hit] = await db.select({ productId: productVariants.productId }).from(productVariants).where(eq(productVariants.sku, sku)).limit(1);
      if (!hit) return { found: false, note: `No size has the product code “${sku}”.` };
      where = eq(products.id, hit.productId);
    }
    const [product] = await db.select().from(products).where(where).limit(1);
    if (!product) return { found: false, note: "No such product." };
    const cats = await allCategories();
    const variants = await db
      .select({
        sku: productVariants.sku,
        color: productVariants.color,
        size: productVariants.size,
        price: productVariants.price,
        compareAtPrice: productVariants.compareAtPrice,
        stock: productVariants.stockQuantity,
        reserved: productVariants.reservedQuantity,
        isDefault: productVariants.isDefault,
        status: productVariants.status,
      })
      .from(productVariants)
      .where(eq(productVariants.productId, product.id))
      .orderBy(productVariants.color, productVariants.size);
    const [{ pictures }] = await db.select({ pictures: count() }).from(productImages).where(eq(productImages.productId, product.id));
    return {
      found: true,
      name: product.name,
      slug: product.slug,
      status: product.status,
      type: product.typeLabel,
      category: cats.path(product.categoryId),
      subcategory: product.subcategory,
      comingSoon: product.comingSoon,
      priceOnRequest: product.priceOnRequest,
      featured: product.featured,
      material: product.material,
      shortDescription: product.shortDescription,
      description: product.description ? product.description.slice(0, 2000) : null,
      pictures,
      variants: variants.map((variant) => ({ sku: variant.sku, colour: variant.color, size: variant.size, price: variant.price, oldPrice: variant.compareAtPrice, stock: variant.stock, reserved: variant.reserved, available: Math.max(0, variant.stock - variant.reserved), isDefault: variant.isDefault, status: variant.status })),
    };
  },
};

/** Tool: the category tree with product counts. */
const listCategories: ToolDef = {
  name: "list_categories",
  title: "List categories",
  description: "Every category as a tree path (for example “Shirts > Formal Shirts”), with its status and how many products sit directly in it.",
  scope: "catalog:read",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run() {
    const cats = await allCategories();
    const counts = await db.select({ categoryId: products.categoryId, n: count() }).from(products).groupBy(products.categoryId);
    const perCategory = new Map(counts.map((row) => [row.categoryId, row.n]));
    return {
      categories: cats.rows
        .map((row) => ({ path: cats.path(row.id), slug: row.slug, status: row.status, products: perCategory.get(row.id) ?? 0 }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    };
  },
};

/** Tool: the sizes that are running out or sold out. */
const lowStock: ToolDef = {
  name: "low_stock",
  title: "Low or sold-out sizes",
  description: "Sizes of published products whose available stock (stock minus what is reserved by open orders) is at or below a number. Lowest first. Use it to answer “what is running out?”.",
  scope: "catalog:read",
  inputSchema: {
    type: "object",
    properties: {
      atOrBelow: { type: "integer", minimum: 0, maximum: 50, description: "Default 3." },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 40." },
    },
    additionalProperties: false,
  },
  async run(args) {
    const threshold = whole(args, "atOrBelow", 0, 50, 3);
    const limit = whole(args, "limit", 1, 100, 40);
    const rows = await db
      .select({ name: products.name, slug: products.slug, sku: productVariants.sku, color: productVariants.color, size: productVariants.size, stock: productVariants.stockQuantity, reserved: productVariants.reservedQuantity, available })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(products.status, "published"), eq(productVariants.status, "active"), sql`${available} <= ${threshold}`))
      .orderBy(available, products.name)
      .limit(limit);
    return { atOrBelow: threshold, count: rows.length, sizes: rows.map((row) => ({ product: row.name, slug: row.slug, sku: row.sku, colour: row.color, size: row.size, stock: row.stock, reserved: row.reserved, available: row.available })) };
  },
};

/** Tool: order counts and totals for the last days (no customer details). */
const salesSummary: ToolDef = {
  name: "sales_summary",
  title: "Sales summary",
  description: "How many orders came in over the last days and what they add up to (PKR), by order status and by day (Pakistan time). Cancelled and returned orders are not counted in the revenue. No customer details.",
  scope: "sales:read",
  inputSchema: {
    type: "object",
    properties: { days: { type: "integer", minimum: 1, maximum: 90, description: "Default 7." } },
    additionalProperties: false,
  },
  async run(args) {
    const days = whole(args, "days", 1, 90, 7);
    const since = new Date(daysAgoMs(days));
    const byStatus = await db
      .select({ status: orders.orderStatus, n: count(), total: sql<number>`coalesce(sum(${orders.total}), 0)` })
      .from(orders)
      .where(gte(orders.createdAt, since))
      .groupBy(orders.orderStatus);
    const day = sql<string>`strftime('%Y-%m-%d', ${orders.createdAt} / 1000 + 18000, 'unixepoch')`;
    const byDay = await db
      .select({ day, n: count(), total: sql<number>`coalesce(sum(${orders.total}), 0)` })
      .from(orders)
      .where(and(gte(orders.createdAt, since), ne(orders.orderStatus, "cancelled"), ne(orders.orderStatus, "returned")))
      .groupBy(day)
      .orderBy(day);
    const counted = byStatus.filter((row) => row.status !== "cancelled" && row.status !== "returned");
    return {
      currency: "PKR",
      lastDays: days,
      orders: counted.reduce((sum, row) => sum + row.n, 0),
      revenue: counted.reduce((sum, row) => sum + Number(row.total), 0),
      byStatus: byStatus.map((row) => ({ status: row.status, orders: row.n, total: Number(row.total) })),
      byDay: byDay.map((row) => ({ day: row.day, orders: row.n, total: Number(row.total) })),
    };
  },
};

/** Every tool the connection offers; a token only sees those whose scope it has. */
export const TOOLS: ToolDef[] = [searchProducts, getProduct, listCategories, lowStock, salesSummary];
