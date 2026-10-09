import { desc, inArray } from "drizzle-orm";
import { sandboxRoomMessage } from "@/lib/sandbox";
import { db } from "@/db";
import { flashSaleProducts, flashSales } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { auditLogEntry } from "@/lib/admin/audit";
import { saleSchema } from "@/lib/flash-sale-schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const sales = await db.select().from(flashSales).orderBy(desc(flashSales.startsAt)).limit(100);
  const links = sales.length
    ? await db
        .select()
        .from(flashSaleProducts)
        .where(
          inArray(
            flashSaleProducts.saleId,
            sales.map((sale) => sale.id),
          ),
        )
    : [];
  return Response.json({
    sales: sales.map((sale) => ({ ...sale, productIds: links.filter((link) => link.saleId === sale.id).map((link) => link.productId) })),
  });
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const full = await sandboxRoomMessage("flashSales"); // practice shop only: a small limit on how much can be created
  if (full) return Response.json({ error: full }, { status: 400 });

  const parsed = saleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid sale." }, { status: 400 });
  const data = parsed.data;

  const [sale] = await db
    .insert(flashSales)
    .values({
      name: data.name,
      discountType: data.discountType,
      discountValue: data.discountValue,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      active: data.active,
      appliesToAll: data.appliesToAll,
    })
    .returning();
  if (!data.appliesToAll && data.productIds.length) {
    await db.insert(flashSaleProducts).values(data.productIds.map((productId) => ({ saleId: sale.id, productId })));
  }
  await auditLogEntry({ actorEmail: admin.email, action: "flash-sale.create", entityType: "flash_sale", entityId: sale.id, detail: { name: data.name } });
  return Response.json({ sale: { ...sale, productIds: data.appliesToAll ? [] : data.productIds } }, { status: 201 });
}
