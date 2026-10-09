import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { customerPushDevices, flashSaleProducts, flashSales, products } from "@/db/schema";
import { sendToCustomerTokens } from "@/lib/push/notify";

/**
 * Called by the 5-minute cron (app/api/cron/sales). For every flash sale that has just gone live and
 * has not been announced yet, push the news to shoppers who opted in:
 *   - a wishlisted product is in the sale  → "Your wishlist is on sale: <product> −20%"
 *   - otherwise, for devices that asked for sale alerts → "<sale name>: −20% until <date>"
 * `start_notified_at` is claimed with a guarded UPDATE first, so overlapping cron runs announce a
 * sale exactly once.
 */
export async function announceStartedSales(): Promise<{ announced: number }> {
  const now = new Date();
  const due = await db
    .select()
    .from(flashSales)
    .where(and(eq(flashSales.active, true), lte(flashSales.startsAt, now), gt(flashSales.endsAt, now), isNull(flashSales.startNotifiedAt)))
    .limit(10);

  let announced = 0;
  for (const sale of due) {
    const claimed = await db
      .update(flashSales)
      .set({ startNotifiedAt: now })
      .where(and(eq(flashSales.id, sale.id), isNull(flashSales.startNotifiedAt)))
      .returning({ id: flashSales.id });
    if (!claimed.length) continue;

    const links = await db.select({ productId: flashSaleProducts.productId }).from(flashSaleProducts).where(eq(flashSaleProducts.saleId, sale.id));
    const saleProductIds = new Set(links.map((link) => link.productId));
    const label = sale.discountType === "percent" ? `${sale.discountValue}% off` : `Rs. ${sale.discountValue.toLocaleString("en-PK")} off`;
    const until = sale.endsAt.toLocaleDateString("en-PK", { day: "numeric", month: "short" });

    const devices = await db
      .select({ token: customerPushDevices.token, wishlist: customerPushDevices.wishlist, salesOptIn: customerPushDevices.salesOptIn })
      .from(customerPushDevices)
      .where(eq(customerPushDevices.salesOptIn, true)); // only people who asked for sale alerts (a token for order updates is not that yes)
    if (!devices.length) continue;

    const names = new Map<string, string>();
    const wanted = [...new Set(devices.flatMap((device) => device.wishlist))].filter((id) => sale.appliesToAll || saleProductIds.has(id));
    if (wanted.length) {
      const rows = await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, wanted));
      for (const row of rows) names.set(row.id, row.name);
    }

    // Group devices that get the same message so each distinct payload is fanned out once.
    const groups = new Map<string, { title: string; body: string; tokens: string[] }>();
    for (const device of devices) {
      const hits = device.wishlist.filter((id) => names.has(id));
      let title: string;
      let body: string;
      if (hits.length) {
        const first = names.get(hits[0]) ?? "A saved piece";
        title = "Your wishlist is on sale";
        body = `${first}${hits.length > 1 ? ` and ${hits.length - 1} more` : ""} — ${label} until ${until}.`;
      } else if (device.salesOptIn) {
        title = sale.name;
        body = `${label} on selected pieces until ${until}.`;
      } else {
        continue;
      }
      const key = `${title}|${body}`;
      const group = groups.get(key) ?? { title, body, tokens: [] };
      group.tokens.push(device.token);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      await sendToCustomerTokens(group.tokens, { title: group.title, body: group.body, url: "/shop", tag: `sale-${sale.id}` });
    }
    announced += 1;
  }
  return { announced };
}

