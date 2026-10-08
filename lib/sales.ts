import { and, eq, gt, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { flashSaleProducts, flashSales } from "@/db/schema";

/**
 * Flash sales. A sale is a time window plus a percentage / fixed-amount discount applied either to
 * every product or to a hand-picked list. The *server* decides the price at the moment an order is
 * placed (see app/api/orders/route.ts), so what a cached page or the shopper's cart shows is only
 * ever a preview.
 */
export type ActiveSale = {
  id: string;
  name: string;
  type: "percent" | "fixed";
  value: number;
  startsAt: Date;
  endsAt: Date;
  appliesToAll: boolean;
  productIds: Set<string>;
};

export type SalePrice = { price: number; originalPrice: number; sale: ActiveSale };

/** Price after one discount; never below Rs. 1 and never above the original. */
export function discountedPrice(price: number, type: "percent" | "fixed", value: number): number {
  const next = type === "percent" ? Math.round((price * (100 - Math.min(100, Math.max(0, value)))) / 100) : price - value;
  return Math.min(price, Math.max(1, next));
}

/** The best (lowest) price any active sale gives this product, or null when none applies. */
export function applySales(price: number, productId: string, sales: ActiveSale[]): SalePrice | null {
  let best: SalePrice | null = null;
  for (const sale of sales) {
    if (!sale.appliesToAll && !sale.productIds.has(productId)) continue;
    const next = discountedPrice(price, sale.type, sale.value);
    if (next < price && (!best || next < best.price)) best = { price: next, originalPrice: price, sale };
  }
  return best;
}

async function loadActiveSales(now: Date): Promise<ActiveSale[]> {
  const rows = await db
    .select()
    .from(flashSales)
    .where(and(eq(flashSales.active, true), lte(flashSales.startsAt, now), gt(flashSales.endsAt, now)));
  if (!rows.length) return [];
  const links = await db
    .select({ saleId: flashSaleProducts.saleId, productId: flashSaleProducts.productId })
    .from(flashSaleProducts)
    .where(
      inArray(
        flashSaleProducts.saleId,
        rows.map((row) => row.id),
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.discountType === "fixed" ? "fixed" : "percent",
    value: row.discountValue,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    appliesToAll: row.appliesToAll,
    productIds: new Set(links.filter((link) => link.saleId === row.id).map((link) => link.productId)),
  }));
}

let memo: { at: number; sales: ActiveSale[] } | null = null;
// 15 s in production; the e2e suite sets SALES_MEMO_MS=0 so a sale it just created is visible at once.
const MEMO_MS = Number(process.env.SALES_MEMO_MS ?? 15_000);

/** Active sales for page rendering — memoised per isolate for 15 s so a busy storefront doesn't hit
 * the database on every request. Order placement must call `loadFreshActiveSales` instead. */
export async function getActiveSales(): Promise<ActiveSale[]> {
  return (await getActiveSalesChecked()).sales;
}

/** The same as getActiveSales, and also says whether the list is real (`ok`) or the empty fallback after a failed load, so callers that
 * remember a derived result do not keep a wrong "no sale" answer. */
export async function getActiveSalesChecked(): Promise<{ sales: ActiveSale[]; ok: boolean }> {
  const now = Date.now();
  if (memo && now - memo.at < MEMO_MS) {
    // A memoised sale may have ended since it was loaded.
    return { sales: memo.sales.filter((sale) => sale.endsAt.getTime() > now && sale.startsAt.getTime() <= now), ok: true };
  }
  try {
    const sales = await loadActiveSales(new Date(now));
    memo = { at: now, sales };
    return { sales, ok: true };
  } catch (error) {
    // Pricing falls back to list prices rather than taking every storefront page down (e.g. a
    // migration that has not been applied yet). Order placement uses loadFreshActiveSales and fails loudly.
    console.error("getActiveSales failed — showing list prices", error);
    return { sales: [], ok: false };
  }
}

export function loadFreshActiveSales(): Promise<ActiveSale[]> {
  return loadActiveSales(new Date());
}
