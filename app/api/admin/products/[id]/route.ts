import { z } from "zod";
import { runInBackground } from "@/lib/background";
import { removeProductFromSearch, syncProductSearch } from "@/lib/search/algolia";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, productImages, products, productVariants } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { slugify } from "@/lib/slug";
import { auditLogEntry } from "@/lib/admin/audit";
import { deleteObject } from "@/lib/storage";
import { variantKeyFor } from "@/lib/image-variants";
import { generateSeoFields } from "@/lib/ai/seo";
import { isUniqueViolation } from "@/lib/db/errors";

export const dynamic = "force-dynamic";

const genderEnum = z.enum(["female", "male", "unisex"]);
const statusEnum = z.enum(["draft", "published", "archived"]);

// Every optional text field below is `.nullable()` as well as `.optional()` — the admin form's
// draft state mirrors what GET returned verbatim (see products-manager.tsx), and any field the
// admin never touches stays exactly `null` for a product that had no value for it, not "". A
// schema that only accepted `string | undefined` rejected the whole payload the moment a save
// included even one field that was already empty from a previous creation (e.g. dimensions on a
// product added via JSON import) — surfacing as a generic "Invalid product payload." on saves
// that hadn't touched that field at all.
const nullableString = z.string().nullable().optional();

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  typeLabel: z.string().min(1).optional(),
  shortDescription: nullableString,
  description: nullableString,
  material: nullableString,
  dimensions: nullableString,
  careInstructions: nullableString,
  status: statusEnum.optional(),
  featured: z.boolean().optional(),
  badge: nullableString,
  seoTitle: z.string().max(120).nullable().optional(),
  seoDescription: z.string().max(320).nullable().optional(),
  seoKeywords: z.string().max(500).nullable().optional(),
  seoLocked: z.boolean().optional(),
  pattern: nullableString,
  primaryColour: nullableString,
  occasion: nullableString,
  style: nullableString,
  countryOfOrigin: nullableString,
  gender: genderEnum.optional(),
  googleProductCategory: nullableString,
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;

  const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!product) return Response.json({ error: "Product not found." }, { status: 404 });

  const [variants, images] = await Promise.all([
    db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id))
      .orderBy(desc(productVariants.isDefault), asc(productVariants.createdAt)),
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder), asc(productImages.createdAt)),
  ]);

  return Response.json({ product, variants, images });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid product payload." }, { status: 400 });
  const data = parsed.data;

  const [existing] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Product not found." }, { status: 404 });

  const becomingPublished = data.status === "published" && existing.status !== "published";

  // Regenerate SEO metadata whenever anything it's drafted from actually changed — the admin form
  // no longer exposes these fields directly (see products-manager.tsx), so this is the only way
  // they ever stay in sync with the product's real name/description/etc.
  const seoRelevantFieldsChanged = [
    data.name,
    data.typeLabel,
    data.categoryId,
    data.primaryColour,
    data.material,
    data.shortDescription,
    data.description,
  ].some((value) => value !== undefined);
  let seo: { seoTitle: string; seoDescription: string } | null = null;
  if (seoRelevantFieldsChanged && !existing.seoLocked && data.seoLocked !== true && data.seoTitle === undefined && data.seoDescription === undefined) {
    const categoryId = data.categoryId ?? existing.categoryId;
    const [category] = categoryId ? await db.select({ name: categories.name }).from(categories).where(eq(categories.id, categoryId)).limit(1) : [];
    seo = await generateSeoFields({
      name: data.name ?? existing.name,
      typeLabel: data.typeLabel ?? existing.typeLabel,
      categoryName: category?.name,
      color: data.primaryColour ?? existing.primaryColour ?? undefined,
      material: data.material ?? existing.material ?? undefined,
      shortDescription: data.shortDescription ?? existing.shortDescription ?? undefined,
      description: data.description ?? existing.description ?? undefined,
    });
  }

  const nextSlug = data.slug !== undefined ? slugify(data.slug) : undefined;

  let row;
  try {
    [row] = await db
    .update(products)
    .set({
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(nextSlug !== undefined ? { slug: nextSlug } : {}),
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      ...(data.typeLabel !== undefined ? { typeLabel: data.typeLabel } : {}),
      ...(data.shortDescription !== undefined ? { shortDescription: data.shortDescription || null } : {}),
      ...(data.description !== undefined ? { description: data.description || null } : {}),
      ...(data.material !== undefined ? { material: data.material || null } : {}),
      ...(data.dimensions !== undefined ? { dimensions: data.dimensions || null } : {}),
      ...(data.careInstructions !== undefined ? { careInstructions: data.careInstructions || null } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.featured !== undefined ? { featured: data.featured } : {}),
      ...(data.badge !== undefined ? { badge: data.badge || null } : {}),
      ...(seo ? { seoTitle: seo.seoTitle, seoDescription: seo.seoDescription } : {}),
      ...(!seo && data.seoTitle !== undefined ? { seoTitle: data.seoTitle || null } : {}),
      ...(!seo && data.seoDescription !== undefined ? { seoDescription: data.seoDescription || null } : {}),
      ...(data.seoKeywords !== undefined ? { seoKeywords: data.seoKeywords?.trim() || null } : {}),
      ...(data.seoLocked !== undefined ? { seoLocked: data.seoLocked } : {}),
      ...(data.pattern !== undefined ? { pattern: data.pattern || null } : {}),
      ...(data.primaryColour !== undefined ? { primaryColour: data.primaryColour || null } : {}),
      ...(data.occasion !== undefined ? { occasion: data.occasion || null } : {}),
      ...(data.style !== undefined ? { style: data.style || null } : {}),
      ...(data.countryOfOrigin !== undefined ? { countryOfOrigin: data.countryOfOrigin || null } : {}),
      ...(data.gender !== undefined ? { gender: data.gender } : {}),
      ...(data.googleProductCategory !== undefined ? { googleProductCategory: data.googleProductCategory || null } : {}),
      ...(becomingPublished ? { publishedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(products.id, id))
    .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Response.json(
        { error: `A product with a matching URL slug ("${nextSlug}") already exists — try a slightly different name.` },
        { status: 409 },
      );
    }
    throw error;
  }

  await auditLogEntry({ actorEmail: admin.email, action: "product.update", entityType: "product", entityId: id, detail: data });

  runInBackground(syncProductSearch(id), "syncProductSearch");

  return Response.json({ product: row });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const permanent = new URL(request.url).searchParams.get("permanent") === "true";

  if (!permanent) {
    // Default, reversible action: hide from the storefront, keep everything (can be republished).
    const [row] = await db
      .update(products)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();
    if (!row) return Response.json({ error: "Product not found." }, { status: 404 });

    await auditLogEntry({ actorEmail: admin.email, action: "product.archive", entityType: "product", entityId: id });
    runInBackground(syncProductSearch(id), "syncProductSearch");
    return Response.json({ ok: true });
  }

  // Permanent delete: remove the product row first — productVariants and productImages cascade-
  // delete at the database level (see db/schema.ts's onDelete: "cascade" on both tables' productId
  // foreign key, and on inventory_movements' variantId key). Order history is unaffected: order_items
  // snapshot product/variant names, SKUs and prices at time of purchase and only set their
  // productId/variantId to null (onDelete: "set null"), never cascade-deleted.
  // Only once the DB delete has actually succeeded do we free the R2 objects — deleting storage
  // first would leave orphaned, image-less DB rows behind if the DB step then failed for any reason.
  const [existing] = await db.select({ id: products.id }).from(products).where(eq(products.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Product not found." }, { status: 404 });

  const images = await db
    .select({ r2Key: productImages.r2Key, variantWidths: productImages.variantWidths })
    .from(productImages)
    .where(eq(productImages.productId, id));

  try {
    await db.delete(products).where(eq(products.id, id));
  } catch (error) {
    console.error("product.delete_permanent failed", error);
    return Response.json({ error: "Could not delete product — it may still be referenced elsewhere." }, { status: 500 });
  }

  await Promise.all(
    images.flatMap((image) => [
      deleteObject(image.r2Key),
      ...(image.variantWidths ?? []).map((width) => deleteObject(variantKeyFor(image.r2Key, width))),
    ]),
  );

  await auditLogEntry({ actorEmail: admin.email, action: "product.delete_permanent", entityType: "product", entityId: id, detail: { imagesDeleted: images.length } });
  runInBackground(removeProductFromSearch(id), "removeProductFromSearch");

  return Response.json({ ok: true });
}
