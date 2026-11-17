import { z } from "zod";
import { checkStockAlerts } from "@/lib/stock-alerts";
import { runInBackground } from "@/lib/background";
import { syncProductSearch } from "@/lib/search/algolia";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { productVariants } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { auditLogEntry, requestIp } from "@/lib/admin/audit";
import { variantSnapshot } from "@/lib/admin/snapshots";
import { isUniqueViolation } from "@/lib/db/errors";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  size: z.string().optional(),
  fabric: z.string().optional(),
  gtin: z.string().optional(),
  price: z.coerce.number().int().min(0).optional(),
  compareAtPrice: z.coerce.number().int().min(0).nullable().optional(),
  stockQuantity: z.coerce.number().int().min(0).optional(),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
  isDefault: z.boolean().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid variant payload." }, { status: 400 });
  const data = parsed.data;

  const [existing] = await db.select().from(productVariants).where(eq(productVariants.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Variant not found." }, { status: 404 });

  // Enforce exactly one default variant per product: making this one default demotes the others.
  if (data.isDefault === true) {
    await db
      .update(productVariants)
      .set({ isDefault: false })
      .where(eq(productVariants.productId, existing.productId));
  }

  let row;
  try {
    [row] = await db
      .update(productVariants)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.sku !== undefined ? { sku: data.sku } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.size !== undefined ? { size: data.size || null } : {}),
        ...(data.fabric !== undefined ? { fabric: data.fabric || null } : {}),
        ...(data.gtin !== undefined ? { gtin: data.gtin || null } : {}),
        ...(data.price !== undefined ? { price: data.price } : {}),
        ...(data.compareAtPrice !== undefined ? { compareAtPrice: data.compareAtPrice } : {}),
        ...(data.stockQuantity !== undefined ? { stockQuantity: data.stockQuantity } : {}),
        ...(data.lowStockThreshold !== undefined ? { lowStockThreshold: data.lowStockThreshold } : {}),
        ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(productVariants.id, id))
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Response.json({ error: `SKU "${data.sku}" is already in use — choose a different one.` }, { status: 409 });
    }
    throw error;
  }

  // If this variant was explicitly un-defaulted, make sure the product still has exactly one default
  // by promoting another active variant when none remain marked as default.
  if (row && !row.isDefault) {
    const siblings = await db
      .select({ id: productVariants.id, isDefault: productVariants.isDefault })
      .from(productVariants)
      .where(eq(productVariants.productId, row.productId));
    if (!siblings.some((v) => v.isDefault)) {
      const fallback = siblings.find((v) => v.id !== row.id) ?? siblings[0];
      if (fallback) {
        await db.update(productVariants).set({ isDefault: true }).where(eq(productVariants.id, fallback.id));
      }
    }
  }

  await auditLogEntry({ actorEmail: admin.email, action: "variant.update", entityType: "variant", entityId: id, detail: data, before: variantSnapshot(existing), after: row ? variantSnapshot(row) : undefined, source: "admin", ip: requestIp(request) });

  runInBackground(syncProductSearch(existing.productId), "syncProductSearch");
  runInBackground(checkStockAlerts([id]), "checkStockAlerts");

  return Response.json({ variant: row });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;

  const [existing] = await db.select().from(productVariants).where(eq(productVariants.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Variant not found." }, { status: 404 });

  const [row] = await db
    .update(productVariants)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(productVariants.id, id))
    .returning();

  if (existing.isDefault) {
    const [fallback] = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.productId, existing.productId));
    if (fallback && fallback.id !== id) {
      await db.update(productVariants).set({ isDefault: true }).where(eq(productVariants.id, fallback.id));
    }
  }

  await auditLogEntry({ actorEmail: admin.email, action: "variant.archive", entityType: "variant", entityId: id, before: variantSnapshot(existing), after: row ? variantSnapshot(row) : undefined, source: "admin", ip: requestIp(request) });

  runInBackground(syncProductSearch(existing.productId), "syncProductSearch");

  return Response.json({ ok: true, variant: row });
}
