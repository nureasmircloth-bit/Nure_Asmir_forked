import { desc, eq, like as likeCi, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { phoneDigits } from "@/db/sql-compat";
import { orders, products, productVariants } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { statusLabel } from "@/lib/order-rules";

export const dynamic = "force-dynamic";

/** Quick finder behind the Ctrl+K box: orders (number / name / phone / tracking) and products (name / SKU). */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 2) return Response.json({ results: [] });

  const like = `%${q.replace(/[%_]/g, "")}%`;
  const digits = q.replace(/\D/g, "");
  const [orderRows, productRows] = await Promise.all([
    db
      .select({ id: orders.id, number: orders.orderNumber, name: orders.customerName, status: orders.orderStatus, total: orders.total })
      .from(orders)
      .where(
        or(
          likeCi(orders.orderNumber, like),
          likeCi(orders.customerName, like),
          likeCi(orders.courierTrackingNumber, like),
          digits.length >= 4 ? sql`${phoneDigits(orders.customerPhone)} like ${`%${digits}%`}` : undefined,
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(6),
    db
      .selectDistinct({ id: products.id, name: products.name, status: products.status })
      .from(products)
      .leftJoin(productVariants, eq(productVariants.productId, products.id))
      .where(or(likeCi(products.name, like), likeCi(productVariants.sku, like)))
      .limit(6),
  ]);

  return Response.json({
    results: [
      ...orderRows.map((o) => ({ group: "Orders", label: `${o.number} · ${o.name}`, sub: `${statusLabel(o.status)} · PKR ${o.total.toLocaleString("en-PK")}`, href: `/admin/orders/${o.id}` })),
      ...productRows.map((p) => ({ group: "Products", label: p.name, sub: p.status === "published" ? "On the website" : p.status === "draft" ? "Hidden (draft)" : "Archived", href: `/admin/products/${p.id}` })),
    ],
  });
}
