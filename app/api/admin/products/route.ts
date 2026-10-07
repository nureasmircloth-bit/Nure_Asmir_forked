import { z } from "zod";
import { runInBackground } from "@/lib/background";
import { syncProductSearch } from "@/lib/search/algolia";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { categories, productImages, products, productVariants } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { slugify } from "@/lib/slug";
import { auditLogEntry } from "@/lib/admin/audit";
import { generateSeoFields } from "@/lib/ai/seo";
import { isUniqueViolation } from "@/lib/db/errors";

export const dynamic = "force-dynamic";

const genderEnum = z.enum(["female", "male", "unisex"]);
const statusEnum = z.enum(["draft", "published", "archived"]);

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  categoryId: z.string().uuid(),
  typeLabel: z.string().min(1),
  shortDescription: z.string().optional(),
  description: z.string().optional(),
  material: z.string().optional(),
  dimensions: z.string().optional(),
  careInstructions: z.string().optional(),
  status: statusEnum.optional(),
  featured: z.boolean().optional(),
  badge: z.string().optional(),
  seoTitle: z.string().max(120).optional(),
  seoDescription: z.string().max(320).optional(),
  seoKeywords: z.string().max(500).optional(),
  seoLocked: z.boolean().optional(),
  pattern: z.string().optional(),
  primaryColour: z.string().optional(),
  occasion: z.string().optional(),
  style: z.string().optional(),
  countryOfOrigin: z.string().optional(),
  gender: genderEnum.optional(),
  googleProductCategory: z.string().optional(),
});

export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const status = url.searchParams.get("status") ?? "";

  const conditions = [];
  if (status && ["draft", "published", "archived"].includes(status)) {
    conditions.push(eq(products.status, status));
  }
  if (search) {
    conditions.push(or(ilike(products.name, `%${search}%`), ilike(products.typeLabel, `%${search}%`)));
  }

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      typeLabel: products.typeLabel,
      status: products.status,
      featured: products.featured,
      badge: products.badge,
      categoryId: products.categoryId,
      categoryName: categories.name,
      createdAt: products.createdAt,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(products.createdAt));

  const productIds = rows.map((row) => row.id);
  const [variantRows, imageRows] = productIds.length
    ? await Promise.all([
        db
          .select({
            productId: productVariants.productId,
            sku: productVariants.sku,
            price: productVariants.price,
            stockQuantity: productVariants.stockQuantity,
            reservedQuantity: productVariants.reservedQuantity,
            lowStockThreshold: productVariants.lowStockThreshold,
            isDefault: productVariants.isDefault,
          })
          .from(productVariants)
          .where(eq(productVariants.status, "active")),
        db
          .select({ productId: productImages.productId, id: productImages.id, isPrimary: productImages.isPrimary })
          .from(productImages)
          .where(eq(productImages.status, "active")),
      ])
    : [[], []];

  const products_ = rows.map((row) => {
    const variants = variantRows.filter((v) => v.productId === row.id);
    const defaultVariant = variants.find((v) => v.isDefault) ?? variants[0];
    const primaryImage = imageRows.find((img) => img.productId === row.id && img.isPrimary) ?? imageRows.find((img) => img.productId === row.id);
    const lowStock = variants.some((v) => v.stockQuantity - v.reservedQuantity <= v.lowStockThreshold);
    return {
      ...row,
      sku: defaultVariant?.sku ?? null,
      price: defaultVariant?.price ?? null,
      available: defaultVariant ? defaultVariant.stockQuantity - defaultVariant.reservedQuantity : null,
      variantCount: variants.length,
      lowStock,
      imageId: primaryImage?.id ?? null,
    };
  });

  return Response.json({ products: products_ });
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid product payload." }, { status: 400 });
  const data = parsed.data;
  const slug = slugify(data.slug || data.name);

  // The admin never fills these in directly through the manual form (see products-manager.tsx —
  // the SEO fields were deliberately removed from the create/edit form to keep adding a product
  // simple); drafted here from whatever else was provided. The JSON-import pre-fill flow is the
  // one path that CAN supply seoTitle/seoDescription explicitly (hand-authored seo.title/
  // seo.description) — when present, that always wins over an AI guess, so AI generation is
  // skipped entirely rather than risking it silently overwriting deliberate copy.
  const [category] = data.categoryId ? await db.select({ name: categories.name }).from(categories).where(eq(categories.id, data.categoryId)).limit(1) : [];
  const seo =
    data.seoTitle || data.seoDescription
      ? null
      : await generateSeoFields({
          name: data.name,
          typeLabel: data.typeLabel,
          categoryName: category?.name,
          color: data.primaryColour,
          material: data.material,
          shortDescription: data.shortDescription,
          description: data.description,
        });

  let row;
  try {
    [row] = await db
      .insert(products)
      .values({
        categoryId: data.categoryId,
        name: data.name,
        slug,
        typeLabel: data.typeLabel,
        shortDescription: data.shortDescription || null,
        description: data.description || null,
        material: data.material || null,
        dimensions: data.dimensions || null,
        careInstructions: data.careInstructions || null,
        status: data.status ?? "draft",
        featured: data.featured ?? false,
        badge: data.badge || null,
        seoTitle: seo?.seoTitle || data.seoTitle || null,
        seoDescription: seo?.seoDescription || data.seoDescription || null,
        seoKeywords: data.seoKeywords?.trim() || null,
        seoLocked: Boolean(data.seoLocked && (data.seoTitle || data.seoDescription)),
        pattern: data.pattern || null,
        primaryColour: data.primaryColour || null,
        occasion: data.occasion || null,
        style: data.style || null,
        countryOfOrigin: data.countryOfOrigin || null,
        gender: data.gender ?? "male",
        googleProductCategory: data.googleProductCategory || null,
        publishedAt: data.status === "published" ? new Date() : null,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Response.json(
        { error: `A product with a matching URL slug ("${slug}") already exists — try a slightly different name.` },
        { status: 409 },
      );
    }
    throw error;
  }

  await auditLogEntry({ actorEmail: admin.email, action: "product.create", entityType: "product", entityId: row.id, detail: { name: data.name, slug } });

  runInBackground(syncProductSearch(row.id), "syncProductSearch");

  return Response.json({ product: row }, { status: 201 });
}
