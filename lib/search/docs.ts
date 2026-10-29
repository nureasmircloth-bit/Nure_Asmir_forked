import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { categories, productImages, products, productVariants } from "@/db/schema";
import { mediaUrl } from "@/lib/media-url";
import type { SearchDoc } from "./types";

/** Every published product (or just one) as a searchable record – the source for both the Algolia index and the built-in fallback. */
export async function buildSearchDocs(productId?: string): Promise<SearchDoc[]> {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      type: products.typeLabel,
      badge: products.badge,
      description: products.shortDescription,
      featured: products.featured,
      priceOnRequest: products.priceOnRequest,
      comingSoon: products.comingSoon,
      publishedAt: products.publishedAt,
      createdAt: products.createdAt,
      categoryName: categories.name,
      categorySlug: categories.slug,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(productId ? and(eq(products.id, productId), eq(products.status, "published")) : eq(products.status, "published"));
  if (!rows.length) return [];

  const ids = rows.map((row) => row.id);
  const [variantRows, imageRows] = await Promise.all([
    db
      .select()
      .from(productVariants)
      .where(and(inArray(productVariants.productId, ids), eq(productVariants.status, "active")))
      .orderBy(asc(productVariants.createdAt)),
    db
      .select({
        productId: productImages.productId,
        key: productImages.r2Key,
        widths: productImages.variantWidths,
        blur: productImages.blurDataUrl,
        isPrimary: productImages.isPrimary,
        sortOrder: productImages.sortOrder,
      })
      .from(productImages)
      .where(and(inArray(productImages.productId, ids), eq(productImages.status, "active")))
      .orderBy(asc(productImages.sortOrder)),
  ]);

  return rows.map((row) => {
    const variants = variantRows.filter((v) => v.productId === row.id);
    const primary = imageRows.filter((i) => i.productId === row.id).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))[0];
    const lead = variants.find((v) => v.isDefault) ?? variants[0];
    return {
      objectID: row.id,
      name: row.name,
      slug: row.slug,
      category: row.categoryName,
      categorySlug: row.categorySlug,
      type: row.type,
      color: [...new Set(variants.map((v) => v.color.trim()).filter(Boolean))].join(", "), // every colour, so "navy" finds a product whose default colour is olive
      sizes: [...new Set(variants.map((v) => v.size).filter((s): s is string => !!s))],
      price: lead?.price ?? 0,
      priceOnRequest: row.priceOnRequest,
      comingSoon: row.comingSoon,
      inStock: variants.some((v) => v.stockQuantity - v.reservedQuantity > 0),
      badge: row.badge ?? "",
      description: row.description ?? "",
      imageUrl: primary ? mediaUrl(primary.key, primary.widths) : null,
      blurDataUrl: primary?.blur ?? null,
      featured: row.featured,
      publishedAt: (row.publishedAt ?? row.createdAt).getTime(),
    };
  });
}

