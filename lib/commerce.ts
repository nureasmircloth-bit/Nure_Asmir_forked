import { hasFilters, type CatalogFilters } from "@/lib/catalog-filters";
import { cache } from "react";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { chunked, likeEsc } from "@/db/sql-compat";
import { BRAND } from "@/lib/brand";
import { mediaUrl } from "@/lib/media-url";
import { applySales, getActiveSales, getActiveSalesChecked } from "@/lib/sales";
import { campaignSlides, categories, collections, productCollections, productImages, products, productVariants, siteSettings } from "@/db/schema";
import { refreshStorefront } from "@/lib/storefront-cache";

export type CatalogVariant = {
  id: string;
  name: string;
  sku: string;
  color: string;
  size?: string;
  fabric?: string;
  price: number;
  compareAtPrice?: number | null;
  /** ISO time the flash sale pricing on this variant ends (undefined = not on sale). */
  saleEndsAt?: string;
  stock: number;
  reserved: number;
  available: number;
  isDefault: boolean;
};

/** The slim shape product cards need. Client components serialise their props into the page's RSC
 * payload, so listings pass this (see `toCard`) instead of the full catalogue entry – descriptions,
 * variants and gallery images stay on the server. */
export type CardProduct = Pick<
  CatalogProduct,
  "id" | "slug" | "name" | "price" | "priceOnRequest" | "comingSoon" | "compareAtPrice" | "imageUrl" | "altImageUrl" | "moreImageUrls" | "blurDataUrl" | "badge" | "stock" | "saleEndsAt" | "category" | "type" | "shortDescription"
>;

export function toCard(product: CatalogProduct): CardProduct {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: product.price,
    priceOnRequest: product.priceOnRequest,
    comingSoon: product.comingSoon,
    compareAtPrice: product.compareAtPrice ?? undefined,
    imageUrl: product.imageUrl,
    altImageUrl: product.altImageUrl,
    moreImageUrls: product.moreImageUrls,
    blurDataUrl: product.blurDataUrl,
    badge: product.badge,
    stock: product.stock,
    saleEndsAt: product.saleEndsAt,
    category: product.category,
    type: product.type,
    shortDescription: product.shortDescription,
  };
}

export type CatalogImage = {
  id: string;
  url: string;
  altText: string;
  sortOrder: number;
  isPrimary: boolean;
  blurDataUrl?: string;
  /** Which variant this photo belongs to — undefined for a shared, product-level photo (visible
   * regardless of which color/variant the shopper has selected). */
  variantId?: string;
};

export type CatalogProduct = {
  id: string;
  slug: string;
  name: string;
  category: string;
  categoryId: string;
  type: string;
  price: number;
  compareAtPrice?: number | null;
  color: string;
  badge: string;
  sku: string;
  imageUrl?: string;
  stock: number;
  description?: string;
  shortDescription?: string;
  material?: string;
  dimensions?: string;
  careInstructions?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  blurDataUrl?: string;
  /** Admin-set "Featured on homepage" flag — see getCatalogProducts()'s use on the homepage. */
  featured: boolean;
  /** No price shown and nothing goes in the bag: the shopper asks for the price on WhatsApp. */
  priceOnRequest: boolean;
  /** Shown with its name, picture and a "Coming soon" badge; cannot be bought yet. */
  comingSoon: boolean;
  /** "ready" (ready to wear) or "bespoke" (made to order): decides the delivery time shown. */
  fulfilment: "ready" | "bespoke";
  variants: CatalogVariant[];
  images: CatalogImage[];
  /** Second photo, shown on hover in product cards. */
  altImageUrl?: string;
  /** Up to four more photos after the main one (same colour first), so a product card can be swiped through without opening the product. */
  moreImageUrls?: string[];
  /** ISO time the current flash sale on this product ends (undefined = not on sale). */
  saleEndsAt?: string;
  saleName?: string;
};

function imageUrlFor(key: string, variantWidths?: number[] | null) {
  return mediaUrl(key, variantWidths);
}

type ListingExtras = { available: number; altImageUrl?: string; moreImageUrls?: string[] };

/** How many photos after the main one a product card can show. */
const CARD_EXTRA_PHOTOS = 4;

/** Per-product data a listing card needs beyond the default-variant join: stock summed across every
 * size (so a product isn't "sold out" just because its default size is), and the second photo for
 * the hover swap. Two small queries for the whole page rather than one per product. */
async function getListingExtras(productIds: string[]): Promise<Map<string, ListingExtras>> {
  const extras = new Map<string, ListingExtras>();
  // A long list is looked up in pieces (the database takes at most 100 values in one statement).
  for (const part of chunked(productIds)) for (const [id, value] of await listingExtrasPart(part)) extras.set(id, value);
  return extras;
}

async function listingExtrasPart(productIds: string[]): Promise<Map<string, ListingExtras>> {
  const extras = new Map<string, ListingExtras>();
  if (!productIds.length) return extras;

  const [stockRows, imageRows] = await Promise.all([
    db
      .select({
        productId: productVariants.productId,
        available: sql<number>`coalesce(sum(max(${productVariants.stockQuantity} - ${productVariants.reservedQuantity}, 0)), 0)`,
      })
      .from(productVariants)
      .where(and(inArray(productVariants.productId, productIds), eq(productVariants.status, "active")))
      .groupBy(productVariants.productId),
    db
      .select({
        productId: productImages.productId,
        key: productImages.r2Key,
        widths: productImages.variantWidths,
        isPrimary: productImages.isPrimary,
        variantId: productImages.variantId,
      })
      .from(productImages)
      .where(and(inArray(productImages.productId, productIds), eq(productImages.status, "active")))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder), asc(productImages.createdAt)),
  ]);

  for (const row of stockRows) extras.set(row.productId, { available: row.available });
  // Rows arrive main-photo first. The hover photo is the next one of the same colour as the main photo, so hovering
  // never flashes a different colour; a product whose main colour has only one photo falls back to its next photo.
  const rowsByProduct = new Map<string, typeof imageRows>();
  for (const row of imageRows) rowsByProduct.set(row.productId, [...(rowsByProduct.get(row.productId) ?? []), row]);
  for (const [productId, list] of rowsByProduct) {
    const [first, ...rest] = list;
    if (!rest.length) continue;
    // Same colour as the main photo first, then the others, so swiping a card does not jump between colours before it has to.
    const ordered = [...rest.filter((row) => row.variantId === first.variantId), ...rest.filter((row) => row.variantId !== first.variantId)].slice(0, CARD_EXTRA_PHOTOS);
    const entry = extras.get(productId) ?? { available: 0 };
    entry.moreImageUrls = ordered.map((row) => imageUrlFor(row.key, row.widths));
    entry.altImageUrl = entry.moreImageUrls[0];
    extras.set(productId, entry);
  }
  return extras;
}

/** Published products for storefront listing (shop grid, homepage "New arrivals", etc). Each product
 * carries its default variant's price/stock/primary image — enough for a product card without a
 * second query per product. */
/** Products per page / per "Show more" – small enough to load fast on a phone, big enough that few requests are needed. */
export const CATALOG_PAGE_SIZE = 24;

export type CatalogQuery = {
  /** Only this category (its slug). */
  categorySlug?: string;
  /** Only these products (wishlist). */
  ids?: string[];
  /** Only products the owner ticked "Show on the home page". */
  featuredOnly?: boolean;
  /** Words to look for in the name, type or short description (the search page's fallback when the search engine knows nothing). */
  search?: string;
  /** Price range / sizes / colours / in-stock-only: a product matches when ONE of its sizes-and-colours satisfies all of them together. */
  filters?: CatalogFilters;
  sort?: "newest" | "low" | "high";
  /** Pagination: without a limit the whole live catalogue is returned (sitemap, search fallback). */
  limit?: number;
  offset?: number;
};

/** A product passes the shop filters when one of its (active) variants fits every chosen price, size, colour and stock condition. */
function variantFilter(filters: CatalogFilters | undefined) {
  if (!filters || !hasFilters(filters)) return undefined;
  const list = (values: string[]) => sql.join(values.map((value) => sql`${value.toLowerCase()}`), sql`, `);
  const parts = [sql`v.product_id = ${products.id}`, sql`v.status = 'active'`];
  if (filters.min != null) parts.push(sql`v.price >= ${filters.min}`);
  if (filters.max != null) parts.push(sql`v.price <= ${filters.max}`);
  if (filters.sizes.length) parts.push(sql`lower(v.size) in (${list(filters.sizes)})`);
  if (filters.colors.length) parts.push(sql`lower(v.color) in (${list(filters.colors)})`);
  if (filters.inStock) parts.push(sql`v.stock_quantity - v.reserved_quantity > 0`);
  return sql`exists (select 1 from product_variants v where ${sql.join(parts, sql` and `)})`;
}

function catalogWhere(query: CatalogQuery) {
  const priced = query.filters && (query.filters.min != null || query.filters.max != null);
  return and(
    variantFilter(query.filters),
    priced ? and(eq(products.priceOnRequest, false), eq(products.comingSoon, false)) : undefined, // a price range never lists products that have no price to compare
    eq(products.status, "published"),
    // a category page lists its own products and those of every category inside it (Shirts shows the formal shirts too)
    query.categorySlug
      ? sql`${products.categoryId} in (with recursive tree(id) as (select id from categories where slug = ${query.categorySlug} union select c.id from categories c join tree on c.parent_id = tree.id) select id from tree)`
      : undefined,
    query.ids ? (query.ids.length ? inArray(products.id, query.ids) : sql`false`) : undefined,
    query.featuredOnly ? eq(products.featured, true) : undefined,
    query.search ? searchWhere(query.search) : undefined,
  );
}

/** Matches a product when every typed word appears in its name, type or short description. Typed % and _ are taken literally. */
/** Most words of a search that are used; the search page tells the shopper when it cut the rest. */
export const SEARCH_MAX_WORDS = 10;

function searchWhere(text: string) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, SEARCH_MAX_WORDS);
  return and(
    ...words.map((word) => {
      const like = `%${word.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
      return or(likeEsc(products.name, like), likeEsc(products.typeLabel, like), likeEsc(products.shortDescription, like), likeEsc(products.subcategory, like));
    }),
  );
}

/** How many live products match – for the Show more button. */
export async function countCatalogProducts(query: CatalogQuery = {}): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(catalogWhere(query));
  return row?.n ?? 0;
}

export async function getCatalogProducts(query: CatalogQuery = {}): Promise<CatalogProduct[]> {
  const order =
    query.sort === "low"
      ? [asc(products.priceOnRequest), asc(products.comingSoon), asc(productVariants.price), desc(products.publishedAt), desc(products.id)]
      : query.sort === "high"
        ? [asc(products.priceOnRequest), asc(products.comingSoon), desc(productVariants.price), desc(products.publishedAt), desc(products.id)]
        : [desc(products.publishedAt), desc(products.createdAt), desc(products.id)];
  let builder = db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      type: products.typeLabel,
      badge: products.badge,
      description: products.description,
      shortDescription: products.shortDescription,
      material: products.material,
      dimensions: products.dimensions,
      featured: products.featured,
      priceOnRequest: products.priceOnRequest,
      comingSoon: products.comingSoon,
      fulfilment: products.fulfilment,
      categoryId: products.categoryId,
      categorySlug: categories.slug,
      variantId: productVariants.id,
      variantName: productVariants.name,
      sku: productVariants.sku,
      color: productVariants.color,
      price: productVariants.price,
      compareAtPrice: productVariants.compareAtPrice,
      stock: productVariants.stockQuantity,
      reserved: productVariants.reservedQuantity,
      imageKey: productImages.r2Key,
      imageWidths: productImages.variantWidths,
      altText: productImages.altText,
      blurDataUrl: productImages.blurDataUrl,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.isDefault, true)))
    .leftJoin(productImages, and(eq(productImages.productId, products.id), eq(productImages.isPrimary, true), eq(productImages.status, "active")))
    .where(catalogWhere(query))
    .orderBy(...order)
    .$dynamic();
  if (query.limit) builder = builder.limit(query.limit).offset(query.offset ?? 0);
  const rows = await builder;

  const [extras, sales] = await Promise.all([getListingExtras(rows.map((row) => row.id)), getActiveSales()]);

  return rows.map((row) => {
    const sale = applySales(row.price, row.id, sales);
    return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.categorySlug,
    categoryId: row.categoryId,
    type: row.type,
    price: sale?.price ?? row.price,
    compareAtPrice: sale ? sale.originalPrice : row.compareAtPrice,
    saleEndsAt: sale?.sale.endsAt.toISOString(),
    saleName: sale?.sale.name,
    color: row.color,
    badge: row.badge ?? "",
    sku: row.sku,
    imageUrl: row.imageKey ? imageUrlFor(row.imageKey, row.imageWidths) : undefined,
    blurDataUrl: row.blurDataUrl ?? undefined,
    stock: extras.get(row.id)?.available ?? Math.max(0, row.stock - row.reserved),
    description: row.description ?? "",
    shortDescription: row.shortDescription ?? "",
    material: row.material ?? "",
    dimensions: row.dimensions ?? "",
    featured: row.featured,
    priceOnRequest: row.priceOnRequest,
    comingSoon: row.comingSoon,
    fulfilment: row.fulfilment === "bespoke" ? "bespoke" : "ready",
    variants: [],
    images: [],
    altImageUrl: extras.get(row.id)?.altImageUrl,
      moreImageUrls: extras.get(row.id)?.moreImageUrls,
    };
  });
}

export async function getProductBySlug(slug: string): Promise<CatalogProduct | null> {
  const [row] = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      type: products.typeLabel,
      badge: products.badge,
      description: products.description,
      shortDescription: products.shortDescription,
      material: products.material,
      dimensions: products.dimensions,
      careInstructions: products.careInstructions,
      seoTitle: products.seoTitle,
      seoDescription: products.seoDescription,
      seoKeywords: products.seoKeywords,
      featured: products.featured,
      priceOnRequest: products.priceOnRequest,
      comingSoon: products.comingSoon,
      fulfilment: products.fulfilment,
      categoryId: products.categoryId,
      categorySlug: categories.slug,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.slug, slug), eq(products.status, "published")))
    .limit(1);
  if (!row) return null;

  const [variantRows, imageRows] = await Promise.all([
    db
      .select({
        id: productVariants.id,
        name: productVariants.name,
        sku: productVariants.sku,
        color: productVariants.color,
        size: productVariants.size,
        fabric: productVariants.fabric,
        price: productVariants.price,
        compareAtPrice: productVariants.compareAtPrice,
        stock: productVariants.stockQuantity,
        reserved: productVariants.reservedQuantity,
        isDefault: productVariants.isDefault,
      })
      .from(productVariants)
      .where(and(eq(productVariants.productId, row.id), eq(productVariants.status, "active")))
      .orderBy(desc(productVariants.isDefault), asc(productVariants.createdAt)),
    db
      .select({
        id: productImages.id,
        key: productImages.r2Key,
        widths: productImages.variantWidths,
        variantId: productImages.variantId,
        altText: productImages.altText,
        sortOrder: productImages.sortOrder,
        isPrimary: productImages.isPrimary,
        blurDataUrl: productImages.blurDataUrl,
      })
      .from(productImages)
      .where(and(eq(productImages.productId, row.id), eq(productImages.status, "active")))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder), asc(productImages.createdAt)),
  ]);

  const sales = await getActiveSales();
  const variants: CatalogVariant[] = variantRows.map((v) => {
    const sale = applySales(v.price, row.id, sales);
    return {
      id: v.id,
      name: v.name,
      sku: v.sku,
      color: v.color,
      size: v.size ?? undefined,
      fabric: v.fabric ?? undefined,
      price: sale?.price ?? v.price,
      compareAtPrice: sale ? sale.originalPrice : v.compareAtPrice,
      saleEndsAt: sale?.sale.endsAt.toISOString(),
      stock: v.stock,
      reserved: v.reserved,
      available: Math.max(0, v.stock - v.reserved),
      isDefault: v.isDefault,
    };
  });
  const images: CatalogImage[] = imageRows.map((img) => ({
    id: img.id,
    url: imageUrlFor(img.key, img.widths),
    altText: img.altText,
    sortOrder: img.sortOrder,
    isPrimary: img.isPrimary,
    blurDataUrl: img.blurDataUrl ?? undefined,
    variantId: img.variantId ?? undefined,
  }));
  const defaultVariant = variants.find((v) => v.isDefault) ?? variants[0];

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.categorySlug,
    categoryId: row.categoryId,
    type: row.type,
    price: defaultVariant?.price ?? 0,
    compareAtPrice: defaultVariant?.compareAtPrice,
    saleEndsAt: defaultVariant?.saleEndsAt,
    color: defaultVariant?.color ?? "",
    badge: row.badge ?? "",
    sku: defaultVariant?.sku ?? "",
    imageUrl: images[0]?.url,
    blurDataUrl: images[0]?.blurDataUrl,
    stock: defaultVariant?.available ?? 0,
    description: row.description ?? "",
    shortDescription: row.shortDescription ?? "",
    material: row.material ?? "",
    dimensions: row.dimensions ?? "",
    careInstructions: row.careInstructions ?? "",
    seoTitle: row.seoTitle ?? undefined,
    seoDescription: row.seoDescription ?? undefined,
    seoKeywords: row.seoKeywords ?? undefined,
    featured: row.featured,
    priceOnRequest: row.priceOnRequest,
    comingSoon: row.comingSoon,
    fulfilment: row.fulfilment === "bespoke" ? "bespoke" : "ready",
    variants,
    images,
  };
}

export type CampaignSlide = {
  id: string;
  imageUrl: string;
  mobileImageUrl: string | null;
  altText: string;
  eyebrow: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  sortOrder: number;
  blurDataUrl?: string;
};

/** Homepage hero slides — CampaignCarousel auto-rotates through these every 5s. Falls back to a
 * single hardcoded slide (in the component) when none exist yet in the DB. */
export async function getCampaignSlides(includeInactive = false): Promise<CampaignSlide[]> {
  const rows = await db
    .select({
      id: campaignSlides.id,
      altText: campaignSlides.altText,
      eyebrow: campaignSlides.eyebrow,
      headline: campaignSlides.headline,
      body: campaignSlides.body,
      ctaLabel: campaignSlides.ctaLabel,
      ctaHref: campaignSlides.ctaHref,
      sortOrder: campaignSlides.sortOrder,
      active: campaignSlides.active,
      blurDataUrl: campaignSlides.blurDataUrl,
      r2Key: campaignSlides.r2Key,
      variantWidths: campaignSlides.variantWidths,
      mobileR2Key: campaignSlides.mobileR2Key,
      mobileVariantWidths: campaignSlides.mobileVariantWidths,
      updatedAt: campaignSlides.updatedAt,
    })
    .from(campaignSlides)
    .where(includeInactive ? undefined : eq(campaignSlides.active, true))
    .orderBy(asc(campaignSlides.sortOrder), asc(campaignSlides.createdAt));

  return rows.map((row) => ({
    id: row.id,
    imageUrl: mediaUrl(row.r2Key, row.variantWidths),
    mobileImageUrl: row.mobileR2Key ? mediaUrl(row.mobileR2Key, row.mobileVariantWidths) : null,
    altText: row.altText,
    eyebrow: row.eyebrow,
    headline: row.headline,
    body: row.body,
    ctaLabel: row.ctaLabel,
    ctaHref: row.ctaHref,
    sortOrder: row.sortOrder,
    blurDataUrl: row.blurDataUrl ?? undefined,
  }));
}

/** Returns an active collection with its catalog products, or null when the slug has no active collection. */
export async function getCollectionBySlug(
  slug: string,
): Promise<{ name: string; description: string; products: CatalogProduct[] } | null> {
  const [collection] = await db
    .select({ id: collections.id, name: collections.name, description: collections.description })
    .from(collections)
    .where(and(eq(collections.slug, slug), eq(collections.status, "active")))
    .limit(1);
  if (!collection) return null;

  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      type: products.typeLabel,
      badge: products.badge,
      featured: products.featured,
      priceOnRequest: products.priceOnRequest,
      comingSoon: products.comingSoon,
      fulfilment: products.fulfilment,
      categoryId: products.categoryId,
      categorySlug: categories.slug,
      variantId: productVariants.id,
      sku: productVariants.sku,
      color: productVariants.color,
      price: productVariants.price,
      compareAtPrice: productVariants.compareAtPrice,
      stock: productVariants.stockQuantity,
      reserved: productVariants.reservedQuantity,
      imageKey: productImages.r2Key,
      imageWidths: productImages.variantWidths,
      blurDataUrl: productImages.blurDataUrl,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(productCollections, eq(productCollections.productId, products.id))
    .innerJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.isDefault, true)))
    .leftJoin(productImages, and(eq(productImages.productId, products.id), eq(productImages.isPrimary, true), eq(productImages.status, "active")))
    .where(and(eq(productCollections.collectionId, collection.id), eq(products.status, "published")))
    .orderBy(desc(products.publishedAt));

  const [extras, collectionSales] = await Promise.all([getListingExtras(rows.map((row) => row.id)), getActiveSales()]);
  const sales = new Map(rows.map((row) => [row.id, applySales(row.price, row.id, collectionSales)]));

  return {
    name: collection.name,
    description: collection.description ?? "",
    products: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.categorySlug,
      categoryId: row.categoryId,
      type: row.type,
      price: sales.get(row.id)?.price ?? row.price,
      compareAtPrice: sales.get(row.id)?.originalPrice ?? row.compareAtPrice ?? undefined,
      saleEndsAt: sales.get(row.id)?.sale.endsAt.toISOString(),
      color: row.color,
      badge: row.badge ?? "",
      sku: row.sku,
      imageUrl: row.imageKey ? imageUrlFor(row.imageKey, row.imageWidths) : undefined,
      blurDataUrl: row.blurDataUrl ?? undefined,
      stock: extras.get(row.id)?.available ?? Math.max(0, row.stock - row.reserved),
      featured: row.featured,
    priceOnRequest: row.priceOnRequest,
    comingSoon: row.comingSoon,
    fulfilment: row.fulfilment === "bespoke" ? "bespoke" : "ready",
      variants: [],
      images: [],
      altImageUrl: extras.get(row.id)?.altImageUrl,
      moreImageUrls: extras.get(row.id)?.moreImageUrls,
    })),
  };
}

/** Minimal listing of active collections (id/slug/name) for sitemap generation. */
export async function getActiveCollections(): Promise<{ id: string; slug: string; name: string }[]> {
  return db
    .select({ id: collections.id, slug: collections.slug, name: collections.name })
    .from(collections)
    .where(eq(collections.status, "active"))
    .orderBy(asc(collections.sortOrder));
}

export type CategoryWithImage = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  description?: string;
  subcategories?: string[];
  /** The category this one sits inside; undefined for a top-level category. */
  parentId?: string;
  imageUrl?: string;
  blurDataUrl?: string;
  // The wide /collections/[slug] hero crop — undefined whenever no separate hero photo was ever
  // uploaded, so callers should fall back to `imageUrl` (the tall homepage-card crop) in that case
  // rather than treat a category as having no image at all.
  heroImageUrl?: string;
  heroBlurDataUrl?: string;
};

// Remembered for a few seconds across requests (like the list of active sales), so a busy shop does not read its products on every page view.
let discountMemo: { at: number; value: Map<string, number> } | null = null;
const DISCOUNT_MEMO_MS = Number(process.env.SALES_MEMO_MS ?? 15_000); // (the test suite sets 0 so a sale it just made shows at once)

/** The biggest percentage off any product in each category right now (categoryId → whole percent), so category tiles can say
 * "Up to −30%". Empty when no sale is running, in which case no extra database work is done. A sale on chosen products only reads
 * those products; only a sale on everything reads the whole catalogue. */
export const getCategoryDiscounts = cache(async (): Promise<Map<string, number>> => {
  if (discountMemo && Date.now() - discountMemo.at < DISCOUNT_MEMO_MS) return discountMemo.value;
  const result = new Map<string, number>();
  const { sales, ok } = await getActiveSalesChecked();
  if (sales.length) {
    const everything = sales.some((sale) => sale.appliesToAll);
    const saleProductIds = [...new Set(sales.flatMap((sale) => [...sale.productIds]))];
    if (everything || saleProductIds.length) {
      const published = eq(products.status, "published");
      const parentOf = new Map((await db.select({ id: categories.id, parentId: categories.parentId }).from(categories)).map((row) => [row.id, row.parentId]));
      const parents = new Map<string, string[]>(); // category -> every category above it
      for (const id of parentOf.keys()) {
        const above: string[] = [];
        for (let up = parentOf.get(id); up && !above.includes(up) && above.length < 10; up = parentOf.get(up)) above.push(up);
        parents.set(id, above);
      }
      const rows = await db
        .select({ id: products.id, categoryId: products.categoryId, price: productVariants.price })
        .from(products)
        .innerJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.isDefault, true)))
        .where(everything ? published : and(published, inArray(products.id, saleProductIds)));
      for (const row of rows) {
        const sale = applySales(row.price, row.id, sales);
        if (!sale) continue;
        const percent = Math.round(((sale.originalPrice - sale.price) / sale.originalPrice) * 100);
        // the badge of a category covers the sales inside the categories under it too
        for (const id of [row.categoryId, ...(parents.get(row.categoryId) ?? [])]) if (percent > (result.get(id) ?? 0)) result.set(id, percent);
      }
    }
  }
  // A failed sales load gave an empty list that is not the truth: it is shown this once, but not remembered.
  if (ok) discountMemo = { at: Date.now(), value: result };
  return result;
});

/** Current price and strike-through price for some products (by id), used to show a search result's discount. */
export async function getSalePricesByIds(ids: string[]): Promise<Record<string, { price: number; compareAtPrice: number }>> {
  const out: Record<string, { price: number; compareAtPrice: number }> = {};
  if (!ids.length) return out;
  const [rows, sales] = await Promise.all([
    db
      .select({ id: products.id, price: productVariants.price, compareAtPrice: productVariants.compareAtPrice })
      .from(products)
      .innerJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.isDefault, true)))
      .where(inArray(products.id, ids.slice(0, 40))),
    getActiveSales(),
  ]);
  for (const row of rows) {
    const sale = applySales(row.price, row.id, sales);
    const compareAt = sale ? sale.originalPrice : row.compareAtPrice;
    if (compareAt && compareAt > (sale?.price ?? row.price)) out[row.id] = { price: sale?.price ?? row.price, compareAtPrice: compareAt };
  }
  return out;
}

/** Active categories with their (optional) admin-uploaded cover photos — drives the homepage
 * "Objects of everyday elegance" cards (in sortOrder, via imageUrl) and each /collections/[slug]
 * hero banner (via heroImageUrl, falling back to imageUrl). Categories without an uploaded image
 * simply omit imageUrl/heroImageUrl; callers fall back to a static placeholder. */
export async function getActiveCategories(): Promise<CategoryWithImage[]> {
  try {
    const rows = await db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        sortOrder: categories.sortOrder,
        description: categories.description,
        subcategories: categories.subcategories,
        parentId: categories.parentId,
        imageR2Key: categories.imageR2Key,
        imageWidths: categories.imageVariantWidths,
        blurDataUrl: categories.imageBlurDataUrl,
        heroR2Key: categories.heroR2Key,
        heroWidths: categories.heroVariantWidths,
        heroBlurDataUrl: categories.heroBlurDataUrl,
        updatedAt: categories.updatedAt,
      })
      .from(categories)
      .where(eq(categories.status, "active"))
      .orderBy(asc(categories.sortOrder), asc(categories.name));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      sortOrder: row.sortOrder,
      description: row.description ?? undefined,
      subcategories: row.subcategories
        ? row.subcategories.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
      parentId: row.parentId ?? undefined,
      imageUrl: row.imageR2Key ? mediaUrl(row.imageR2Key, row.imageWidths) : undefined,
      blurDataUrl: row.blurDataUrl ?? undefined,
      heroImageUrl: row.heroR2Key ? mediaUrl(row.heroR2Key, row.heroWidths) : undefined,
      heroBlurDataUrl: row.heroBlurDataUrl ?? undefined,
    }));
  } catch (err) {
    console.warn("Failed to load active categories, using empty list:", err);
    return [];
  }
}

export type FeedVariant = {
  variantId: string;
  sku: string;
  color: string;
  price: number;
  available: number;
  gtin?: string;
};

export type FeedProduct = {
  id: string;
  slug: string;
  name: string;
  description: string;
  googleProductCategory?: string;
  imageId?: string;
  variants: FeedVariant[];
};

/** Published products with all active variants + primary image, shaped for the Google Merchant
 * Center and Meta catalogue feed routes (app/api/feeds/google, app/api/feeds/meta). */
export async function getFeedProducts(): Promise<FeedProduct[]> {
  const rows = await db
    .select({
      productId: products.id,
      slug: products.slug,
      name: products.name,
      description: products.shortDescription,
      longDescription: products.description,
      googleProductCategory: products.googleProductCategory,
      variantId: productVariants.id,
      sku: productVariants.sku,
      color: productVariants.color,
      price: productVariants.price,
      stock: productVariants.stockQuantity,
      reserved: productVariants.reservedQuantity,
      gtin: productVariants.gtin,
      imageId: productImages.id,
    })
    .from(products)
    .innerJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.status, "active")))
    .leftJoin(productImages, and(eq(productImages.productId, products.id), eq(productImages.isPrimary, true), eq(productImages.status, "active")))
    .where(and(eq(products.status, "published"), eq(products.priceOnRequest, false), eq(products.comingSoon, false)))
    .orderBy(asc(products.createdAt));

  const byProduct = new Map<string, FeedProduct>();
  for (const row of rows) {
    let entry = byProduct.get(row.productId);
    if (!entry) {
      entry = {
        id: row.productId,
        slug: row.slug,
        name: row.name,
        description: row.description || row.longDescription || "",
        googleProductCategory: row.googleProductCategory ?? undefined,
        imageId: row.imageId ?? undefined,
        variants: [],
      };
      byProduct.set(row.productId, entry);
    }
    entry.variants.push({
      variantId: row.variantId,
      sku: row.sku,
      color: row.color,
      price: row.price,
      available: Math.max(0, row.stock - row.reserved),
      gtin: row.gtin ?? undefined,
    });
  }

  return Array.from(byProduct.values());
}

/** Built-in delivery times shown on product pages until the owner writes their own (Admin → Settings → Delivery, payment and refunds). */
export const DEFAULT_READY_DELIVERY = "3–5 working days";
export const DEFAULT_BESPOKE_DELIVERY = "12–14 working days";

export type PublicSettings = {
  googleSiteVerification: string;
  bingSiteVerification: string;
  announcementMode: string;
  announcementLines: string;
  announcementStyle: string;
  aboutHeading: string;
  aboutBody: string;
  bankDepositEnabled: boolean;
  deliveryMode: string;
  flatDeliveryCharge: number;
  whatsappNumber: string;
  supportPhone: string;
  supportEmail: string;
  instagramUrl: string;
  facebookUrl: string;
  tiktokUrl: string;
  /** wa.me link that opens a chat with the business (falls back to wa.me/<number>). */
  whatsappChatUrl: string;
  freeDeliveryThreshold: number;
  metaPixelId: string;
  gaMeasurementId: string;
  brandName: string;
  codReservationHours: number;
  bankReservationHours: number;
  refundWindowDays: number;
  themeAccentColor: string;
  themePreset: string;
  themeBackgroundColor: string;
  themeTextColor: string;
  themeSurfaceColor: string;
  themeRadius: string;
  fontFamily: string;
  bodyFontFamily: string;
  contactFontFamily: string;
  shopDescription: string;
  readyDeliveryText: string;
  bespokeDeliveryText: string;
  themeBottomBarColor: string;
  themeBottomBarTextColor: string;
  themeHeaderColor: string;
  themeHeaderTextColor: string;
  themeSidebarColor: string;
  themeSidebarTextColor: string;
  themeFooterColor: string;
  themeFooterTextColor: string;
  themeCurrencyColor: string;
  themeCurrencyTextColor: string;
  newsletterTitle: string;
  newsletterText: string;
};

/** Applies buffered settings when their 5-minute safety delay has passed, revalidating cache on change. */
export async function applyDuePendingSettings(row?: typeof siteSettings.$inferSelect | null): Promise<typeof siteSettings.$inferSelect | null> {
  let target = row;
  if (!target) {
    const [fetched] = await db.select().from(siteSettings).where(eq(siteSettings.id, "store")).limit(1);
    target = fetched ?? null;
  }
  if (!target?.pendingApplyAt || !target.pendingChanges) {
    return target ?? null;
  }
  const applyAtTime = new Date(target.pendingApplyAt).getTime();
  if (applyAtTime > Date.now()) {
    return target;
  }
  try {
    const changes = JSON.parse(target.pendingChanges);
    const [updated] = await db
      .update(siteSettings)
      .set({
        ...changes,
        pendingChanges: null,
        pendingApplyAt: null,
        previousSettings: null,
        updatedAt: new Date(),
      })
      .where(and(eq(siteSettings.id, "store"), eq(siteSettings.pendingApplyAt, target.pendingApplyAt)))
      .returning();
    if (updated) {
      refreshStorefront(true);
      return updated;
    }
  } catch (err) {
    console.error("Failed to apply due pending settings:", err);
  }
  return target;
}

export const getPublicSettings = cache(async (): Promise<PublicSettings> => {
  let row: typeof siteSettings.$inferSelect | undefined;
  try {
    const rows = await db.select().from(siteSettings).where(eq(siteSettings.id, "store")).limit(1);
    row = rows[0];
    const updated = await applyDuePendingSettings(row);
    if (updated) row = updated;
  } catch (err) {
    console.warn("Failed to fetch public settings from database, using defaults:", err);
  }
  return {
    whatsappNumber: row?.whatsappNumber || process.env.WHATSAPP_DEFAULT_NUMBER || BRAND.contact.whatsappPhone,
    supportPhone: row?.supportPhone || BRAND.contact.phone,
    supportEmail: row?.supportEmail ?? "",
    instagramUrl: row?.instagramUrl || BRAND.contact.instagramUrl,
    facebookUrl: row?.facebookUrl || BRAND.contact.facebookUrl,
    tiktokUrl: row?.tiktokUrl || BRAND.contact.tiktokUrl,
    whatsappChatUrl: row?.whatsappChatUrl || BRAND.contact.whatsappChatUrl,
    freeDeliveryThreshold: row?.freeDeliveryThreshold ?? 4000,
    metaPixelId: row?.metaPixelId ?? "",
    gaMeasurementId: row?.gaMeasurementId ?? "",
    brandName: row?.brandName ?? "Nure Asmir",
    codReservationHours: row?.codReservationHours ?? 6,
    bankReservationHours: row?.bankReservationHours ?? 6,
    refundWindowDays: row?.refundWindowDays ?? 7,
    googleSiteVerification: row?.googleSiteVerification ?? "",
    bingSiteVerification: row?.bingSiteVerification ?? "",
    announcementMode: row?.announcementMode ?? "auto",
    announcementLines: row?.announcementLines ?? "",
    announcementStyle: row?.announcementStyle ?? "rotate",
    aboutHeading: row?.aboutHeading ?? "",
    aboutBody: row?.aboutBody ?? "",
    bankDepositEnabled: row?.bankDepositEnabled ?? false,
    deliveryMode: row?.deliveryMode ?? "zones",
    flatDeliveryCharge: row?.flatDeliveryCharge ?? 250,
    themeAccentColor: row?.themeAccentColor || "#c5a059",
    themePreset: row?.themePreset || "signature",
    themeBackgroundColor: row?.themeBackgroundColor || "#ffffff",
    themeTextColor: row?.themeTextColor || "#111111",
    themeSurfaceColor: row?.themeSurfaceColor || "#faf9f6",
    themeRadius: row?.themeRadius || "subtle",
    fontFamily: row?.fontFamily || "Cormorant Garamond",
    bodyFontFamily: row?.bodyFontFamily || "Figtree",
    contactFontFamily: row?.contactFontFamily || "Inter",
    shopDescription: row?.shopDescription ?? "",
    readyDeliveryText: row?.readyDeliveryText?.trim() || DEFAULT_READY_DELIVERY,
    bespokeDeliveryText: row?.bespokeDeliveryText?.trim() || DEFAULT_BESPOKE_DELIVERY,
    themeBottomBarColor: row?.themeBottomBarColor ?? "",
    themeBottomBarTextColor: row?.themeBottomBarTextColor ?? "",
    themeHeaderColor: row?.themeHeaderColor ?? "",
    themeHeaderTextColor: row?.themeHeaderTextColor ?? "",
    themeSidebarColor: row?.themeSidebarColor ?? "",
    themeSidebarTextColor: row?.themeSidebarTextColor ?? "",
    themeFooterColor: row?.themeFooterColor ?? "",
    themeFooterTextColor: row?.themeFooterTextColor ?? "",
    themeCurrencyColor: row?.themeCurrencyColor ?? "",
    themeCurrencyTextColor: row?.themeCurrencyTextColor ?? "",
    newsletterTitle: row?.newsletterTitle ?? "",
    newsletterText: row?.newsletterText ?? "",
  };
});
