import { runInBackground } from "@/lib/background";
import { reindexAll } from "@/lib/search/algolia";
import { db } from "@/db";
import { products, productVariants } from "@/db/schema";
import { addSubcategory, ensureCategory } from "@/lib/categories";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { slugify } from "@/lib/slug";
import { auditLogEntry } from "@/lib/admin/audit";
import { generateSeoFields } from "@/lib/ai/seo";
import { isUniqueViolation } from "@/lib/db/errors";
import {
  formatDimensions,
  joinCareInstructions,
  joinListField,
  normalizeGender,
  productImportBatchSchema,
  type ProductImport,
} from "@/lib/import/product-import-schema";

export const dynamic = "force-dynamic";

type ImageJob = { file: string; isPrimary: boolean; order: number; alt: string; variantId?: string };

type ImportResult = {
  index: number;
  name: string;
  success: boolean;
  productId?: string;
  images?: ImageJob[];
  variantErrors?: string[];
  error?: string;
};

async function importOne(item: ProductImport, index: number): Promise<ImportResult> {
  // A category name that does not exist yet is created on the spot (the owner types a new one in the sheet and it simply appears).
  const category = await ensureCategory(item.category);

  const slug = slugify(item.slug || item.name);
  const subcategory = item.subcategory?.trim().replace(/\s+/g, " ") || null;
  const dimensions = formatDimensions(item.dimensions);
  const careInstructions = joinCareInstructions(item.careInstructions);
  const pattern = item.attributes?.pattern;
  const style = joinListField(item.attributes?.style);
  const occasion = joinListField(item.attributes?.occasion);
  const gender = normalizeGender(item.attributes?.gender);
  const countryOfOrigin = item.attributes?.countryOfOrigin;
  const googleProductCategory = item.attributes?.googleProductCategory;

  // Honor explicitly-authored SEO copy when provided — the admin form never exposes these fields
  // (drafted automatically instead, see lib/ai/seo.ts), but a prepared JSON import is a deliberate
  // power-user path where hand-written SEO copy should win over an AI guess.
  const seoTitle = item.seo?.title;
  const seoDescription = item.seo?.description;
  const seo =
    seoTitle || seoDescription
      ? null
      : await generateSeoFields({
          name: item.name,
          typeLabel: item.typeLabel,
          categoryName: category.name,
          color: item.primaryColour,
          material: item.material,
          shortDescription: item.shortDescription,
          description: item.description,
        });

  let productRow;
  try {
    [productRow] = await db
      .insert(products)
      .values({
        categoryId: category.id,
        name: item.name,
        slug,
        typeLabel: item.typeLabel,
        subcategory,
        comingSoon: item.comingSoon ?? false,
        shortDescription: item.shortDescription || null,
        description: item.description || null,
        material: item.material || null,
        dimensions: dimensions || null,
        careInstructions: careInstructions || null,
        status: item.visibility ?? "draft",
        featured: item.featured ?? false,
        badge: item.badge || null,
        seoTitle: seoTitle || seo?.seoTitle || null,
        seoDescription: seoDescription || seo?.seoDescription || null,
        pattern: pattern || null,
        primaryColour: item.primaryColour || null,
        occasion: occasion || null,
        style: style || null,
        countryOfOrigin: countryOfOrigin || null,
        gender,
        googleProductCategory: googleProductCategory || null,
        publishedAt: item.visibility === "published" ? new Date() : null,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { index, name: item.name, success: false, error: `A product with a matching URL slug ("${slug}") already exists.` };
    }
    throw error;
  }
  const variantErrors: string[] = [];
  if (subcategory) {
    // The product is already saved: a failure here must not fail the row, only be reported.
    const listed = await addSubcategory(category.id, subcategory).catch((error) => {
      console.error("product.import: subcategory list not updated", error);
      return false;
    });
    if (!listed) variantErrors.push(`Subcategory "${subcategory}" was saved on the product but could not be added to the category's list; add it under Collections.`);
  }
  const images: ImageJob[] = [];
  // A product sold in several colours keeps each colour's photos with that colour (the shop shows them when the colour is picked).
  const multiColour = new Set(item.variants.map((variant) => variant.color.trim().toLowerCase())).size > 1;
  for (let variantIndex = 0; variantIndex < item.variants.length; variantIndex++) {
    const variant = item.variants[variantIndex];
    let variantId: string | undefined;
    try {
      const [inserted] = await db.insert(productVariants).values({
        productId: productRow.id,
        name: variant.name || item.name,
        sku: variant.sku,
        color: variant.color,
        size: variant.size || null,
        fabric: variant.fabric || null,
        gtin: variant.gtin || null,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice ?? null,
        stockQuantity: variant.stockQuantity ?? 0,
        lowStockThreshold: variant.lowStockThreshold ?? 3,
        isDefault: variant.isDefault ?? variantIndex === 0,
        status: "active",
      }).returning({ id: productVariants.id });
      variantId = inserted?.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        variantErrors.push(`SKU "${variant.sku}" is already in use.`);
      } else {
        throw error;
      }
    }

    // Images are only ever stored at the product level today (no per-variant gallery yet), so
    // every variant's images are flattened into one shared gallery here. `order` is offset by
    // variant index so two variants both listing order:0 don't collide in the flattened sequence.
    // `isPrimary` is deliberately NOT copied through yet — see below, exactly one image across the
    // whole flattened set gets marked primary, not one per variant.
    for (const image of variant.images ?? []) {
      images.push({
        file: image.file,
        isPrimary: Boolean(image.isPrimary),
        order: variantIndex * 100 + (image.order ?? 0),
        alt: image.alt || `${item.name} — ${variant.color}`,
        variantId: multiColour ? variantId : undefined,
      });
    }
  }

  // Exactly one image should end up primary for the product overall: the images route unsets any
  // existing primary flag every time a new one is uploaded as primary, so naively forwarding each
  // variant's own isPrimary:true would just leave whichever image uploads *last* as the winner.
  // Prefer whichever image the JSON explicitly marked primary (in flattened order); otherwise fall
  // back to the very first image.
  images.sort((a, b) => a.order - b.order);
  const explicitPrimaryIndex = images.findIndex((image) => image.isPrimary);
  const primaryIndex = explicitPrimaryIndex === -1 ? 0 : explicitPrimaryIndex;
  images.forEach((image, i) => {
    image.isPrimary = i === primaryIndex;
  });

  return {
    index,
    name: item.name,
    success: true,
    productId: productRow.id,
    images: images.length ? images : undefined,
    variantErrors: variantErrors.length ? variantErrors : undefined,
  };
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = productImportBatchSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid import payload.", details: parsed.error.issues }, { status: 400 });
  }
  const items = "products" in parsed.data ? parsed.data.products : [parsed.data];

  const results: ImportResult[] = [];
  for (let index = 0; index < items.length; index++) {
    try {
      results.push(await importOne(items[index], index));
    } catch (error) {
      console.error("product.import failed", error);
      results.push({ index, name: items[index].name, success: false, error: "Unexpected server error — see logs." });
    }
  }

  const succeeded = results.filter((r) => r.success);
  if (succeeded.length) {
    await auditLogEntry({
      actorEmail: admin.email,
      action: "product.import",
      entityType: "product",
      entityId: succeeded.map((r) => r.productId).join(","),
      detail: { imported: succeeded.length, failed: results.length - succeeded.length },
    });
  }

  // Bulk import touched many products — rebuild the search index once rather than per product.
  // The bulk-upload screen sends small batches and asks for one rebuild at the very end (?reindex=0).
  if (succeeded.length && new URL(request.url).searchParams.get("reindex") !== "0") runInBackground(reindexAll(), "reindexAll");

  return Response.json({ results });
}
