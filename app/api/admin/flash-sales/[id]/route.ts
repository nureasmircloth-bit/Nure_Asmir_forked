import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { chunked } from "@/db/sql-compat";
import { flashSaleProducts, flashSales } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { auditLogEntry } from "@/lib/admin/audit";
import { saleSchema } from "@/lib/flash-sale-schema";

export const dynamic = "force-dynamic";

/** Updates a flash sale and its product links for an authenticated admin using validated sale settings. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;

  const parsed = saleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid sale." }, { status: 400 });
  const data = parsed.data;

  const [sale] = await db
    .update(flashSales)
    .set({
      name: data.name,
      discountType: data.discountType,
      discountValue: data.discountValue,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      active: data.active,
      appliesToAll: data.appliesToAll,
      updatedAt: new Date(),
    })
    .where(eq(flashSales.id, id))
    .returning();
  if (!sale) return Response.json({ error: "Sale not found." }, { status: 404 });

  // The Neon HTTP driver has no transactions: add the new links first, then remove the ones no longer wanted, so a failure in between
  // leaves a sale with too many products rather than a live sale with none.
  const wanted = data.appliesToAll ? [] : data.productIds;
  // (in pieces: the database takes at most 100 values in one statement)
  for (const part of chunked(wanted, 40)) await db.insert(flashSaleProducts).values(part.map((productId) => ({ saleId: id, productId }))).onConflictDoNothing();
  const have = await db.select({ productId: flashSaleProducts.productId }).from(flashSaleProducts).where(eq(flashSaleProducts.saleId, id));
  const keep = new Set(wanted);
  for (const part of chunked(have.map((row) => row.productId).filter((productId) => !keep.has(productId)))) {
    await db.delete(flashSaleProducts).where(and(eq(flashSaleProducts.saleId, id), inArray(flashSaleProducts.productId, part)));
  }
  await auditLogEntry({ actorEmail: admin.email, action: "flash-sale.update", entityType: "flash_sale", entityId: id, detail: { name: data.name } });
  return Response.json({ sale: { ...sale, productIds: data.appliesToAll ? [] : data.productIds } });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const [row] = await db.delete(flashSales).where(eq(flashSales.id, id)).returning({ id: flashSales.id });
  if (!row) return Response.json({ error: "Sale not found." }, { status: 404 });
  await auditLogEntry({ actorEmail: admin.email, action: "flash-sale.delete", entityType: "flash_sale", entityId: id });
  return Response.json({ ok: true });
}
