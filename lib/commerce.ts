import { hasFilters, type CatalogFilters } from "@/lib/catalog-filters";
import { cache } from "react";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { BRAND } from "@/lib/brand";
import { mediaUrl } from "@/lib/media-url";
import { applySales, getActiveSales } from "@/lib/sales";
import { campaignSlides, categories, collections, productCollections, productImages, products, productVariants, siteSettings } from "@/db/schema";

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
  "id" | "slug" | "name" | "price" | "compareAtPrice" | "imageUrl" | "altImageUrl" | "blurDataUrl" | "badge" | "stock" | "saleEndsAt" | "category"
>;

export function toCard(product: CatalogProduct): CardProduct {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: product.price,
    compareAtPrice: product.compareAtPrice ?? undefined,
    imageUrl: product.imageUrl,
    altImageUrl: product.altImageUrl,
    blurDataUrl: product.blurDataUrl,
    badge: product.badge,
    stock: product.stock,
    saleEndsAt: product.saleEndsAt,
    category: product.category,
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
  variants: CatalogVariant[];
  images: CatalogImage[];
  /** Second photo, shown on hover in product cards. */
  altImageUrl?: string;
  /** ISO time the current flash sale on this product ends (undefined = not on sale). */
  saleEndsAt?: string;
  saleName?: string;
};

function imageUrlFor(key: string, variantWidths?: number[] | null) {
  return mediaUrl(key, variantWidths);
}

type ListingExtras = { available: number; altImageUrl?: string };

/** Per-product data a listing card needs beyond the default-variant join: stock summed across every
 * size (so a product isn't "sold out" just because its default size is), and the second photo for
 * the hover swap. Two small queries for the whole page rather than one per product. */
async function getListingExtras(productIds: string[]): Promise<Map<string, ListingExtras>> {
  const extras = new Map<string, ListingExtras>();
  if (!productIds.length) return extras;

  const [stockRows, imageRows] = await Promise.all([
    db
      .select({
        productId: productVariants.productId,
        available: sql<number>`coalesce(sum(greatest(${productVariants.stockQuantity} - ${productVariants.reservedQuantity}, 0)), 0)::int`,
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
    const alt = rest.find((row) => row.variantId === first.variantId) ?? rest[0];
    if (!alt) continue;
    const entry = extras.get(productId) ?? { available: 0 };
    entry.altImageUrl = imageUrlFor(alt.key, alt.widths);
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
  return and(
    variantFilter(query.filters),
    eq(products.status, "published"),
    query.categorySlug ? eq(categories.slug, query.categorySlug) : undefined,
    query.ids ? (query.ids.length ? inArray(products.id, query.ids) : sql`false`) : undefined,
    query.featuredOnly ? eq(products.featured, true) : undefined,
  );
}

/** How many live products match – for the Show more button. */
export async function countCatalogProducts(query: CatalogQuery = {}): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(catalogWhere(query));
  return row?.n ?? 0;
}

export async function getCatalogProducts(query: CatalogQuery = {}): Promise<CatalogProduct[]> {
  const order =
    query.sort === "low"
      ? [asc(productVariants.price), desc(products.publishedAt), desc(products.id)]
      : query.sort === "high"
        ? [desc(productVariants.price), desc(products.publishedAt), desc(products.id)]
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
    variants: [],
    images: [],
    altImageUrl: extras.get(row.id)?.altImageUrl,
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
      categoryId: products.categoryId,
      categorySlug: categories.slug,
      variantId: productVariants.id,
      sku: productVariants.sku,
      color: productVariants.color,
      price: productVariants.price,
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
      price: collectionSales ? (applySales(row.price, row.id, collectionSales)?.price ?? row.price) : row.price,
      compareAtPrice: collectionSales ? applySales(row.price, row.id, collectionSales)?.originalPrice : undefined,
      saleEndsAt: collectionSales ? applySales(row.price, row.id, collectionSales)?.sale.endsAt.toISOString() : undefined,
      color: row.color,
      badge: row.badge ?? "",
      sku: row.sku,
      imageUrl: row.imageKey ? imageUrlFor(row.imageKey, row.imageWidths) : undefined,
      blurDataUrl: row.blurDataUrl ?? undefined,
      stock: extras.get(row.id)?.available ?? Math.max(0, row.stock - row.reserved),
      featured: row.featured,
      variants: [],
      images: [],
      altImageUrl: extras.get(row.id)?.altImageUrl,
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
  imageUrl?: string;
  blurDataUrl?: string;
  // The wide /collections/[slug] hero crop — undefined whenever no separate hero photo was ever
  // uploaded, so callers should fall back to `imageUrl` (the tall homepage-card crop) in that case
  // rather than treat a category as having no image at all.
  heroImageUrl?: string;
  heroBlurDataUrl?: string;
};

/** Active categories with their (optional) admin-uploaded cover photos — drives the homepage
 * "Objects of everyday elegance" cards (in sortOrder, via imageUrl) and each /collections/[slug]
 * hero banner (via heroImageUrl, falling back to imageUrl). Categories without an uploaded image
 * simply omit imageUrl/heroImageUrl; callers fall back to a static placeholder. */
export async function getActiveCategories(): Promise<CategoryWithImage[]> {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      sortOrder: categories.sortOrder,
      description: categories.description,
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
    imageUrl: row.imageR2Key ? mediaUrl(row.imageR2Key, row.imageWidths) : undefined,
    blurDataUrl: row.blurDataUrl ?? undefined,
    heroImageUrl: row.heroR2Key ? mediaUrl(row.heroR2Key, row.heroWidths) : undefined,
    heroBlurDataUrl: row.heroBlurDataUrl ?? undefined,
  }));
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
    .where(eq(products.status, "published"))
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

export type PublicSettings = {
  googleSiteVerification: string;
  bingSiteVerification: string;
  announcementMode: string;
  announcementLines: string;
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
};

export const getPublicSettings = cache(async (): Promise<PublicSettings> => {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.id, "store")).limit(1);
  return {
    whatsappNumber: row?.whatsappNumber || process.env.WHATSAPP_DEFAULT_NUMBER || BRAND.contact.phone,
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
    googleSiteVerification: row?.googleSiteVerification ?? "",
    bingSiteVerification: row?.bingSiteVerification ?? "",
    announcementMode: row?.announcementMode ?? "auto",
    announcementLines: row?.announcementLines ?? "",
    bankDepositEnabled: row?.bankDepositEnabled ?? false,
    deliveryMode: row?.deliveryMode ?? "zones",
    flatDeliveryCharge: row?.flatDeliveryCharge ?? 250,
  };
});
