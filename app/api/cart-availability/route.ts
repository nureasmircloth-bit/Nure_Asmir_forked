import { expireReservations } from "@/lib/orders";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { productVariants, products } from "@/db/schema";
import { applySales, loadFreshActiveSales } from "@/lib/sales";

export const dynamic = "force-dynamic";

/**
 * Public, read-only check for the items sitting in a visitor's cart (the cart lives in the browser,
 * so there is no server session to look it up from). Returns, per variant, the stock that is
 * available *right now* and the price the shopper would be charged right now (flash sales
 * included), so the cart / checkout pages can flag items that sold out or changed price since they
 * were added. `/api/orders` re-validates everything again at purchase time regardless.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const variantIds: string[] = Array.isArray(body?.variantIds) ? body.variantIds.filter((id: unknown): id is string => typeof id === "string") : [];
  if (!variantIds.length || variantIds.length > 50) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  // Expired holds are released here too, so a shopper's bag never shows stock as taken by an order that has already run out of time
  // (the scheduled sweep only runs every few hours).
  await expireReservations().catch(() => undefined);
  const [rows, sales] = await Promise.all([
    db
      .select({
        id: productVariants.id,
        productId: productVariants.productId,
        price: productVariants.price,
        stockQuantity: productVariants.stockQuantity,
        reservedQuantity: productVariants.reservedQuantity,
        status: productVariants.status,
        productStatus: products.status,
        priceOnRequest: products.priceOnRequest,
        comingSoon: products.comingSoon,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, variantIds)),
    loadFreshActiveSales(),
  ]);

  const byId = new Map(rows.map((row) => [row.id, row]));
  const availability = variantIds.map((id) => {
    const row = byId.get(id);
    const live = !!row && row.status === "active" && row.productStatus === "published" && !row.priceOnRequest && !row.comingSoon; // priced on request or coming soon: never in a bag
    return {
      variantId: id,
      available: live ? Math.max(0, row.stockQuantity - row.reservedQuantity) : 0,
      price: row ? (applySales(row.price, row.productId, sales)?.price ?? row.price) : null,
    };
  });

  return Response.json({ availability }, { headers: { "Cache-Control": "no-store" } });
}
