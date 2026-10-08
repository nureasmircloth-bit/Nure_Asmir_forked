import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";

export const dynamic = "force-dynamic";

/** Finds a customer by order number so a reply can be addressed to them (name, email, phone). */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const number = (new URL(request.url).searchParams.get("order") ?? "").trim().toUpperCase().slice(0, 40);
  if (!number) return Response.json({ error: "Type an order number first." }, { status: 400 });
  const [order] = await db
    .select({ orderNumber: orders.orderNumber, name: orders.customerName, email: orders.customerEmail, phone: orders.customerPhone })
    .from(orders)
    .where(eq(orders.orderNumber, number))
    .limit(1);
  if (!order) return Response.json({ error: "No order has that number." }, { status: 404 });
  return Response.json({ order });
}
