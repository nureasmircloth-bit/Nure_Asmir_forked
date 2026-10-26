import { and, desc, eq, like as likeCi, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { phoneDigits } from "@/db/sql-compat";
import { orders } from "@/db/schema";

export const ORDER_TABS = [
  { key: "action", label: "Needs you", help: "New orders waiting to be confirmed, and bank receipts waiting to be checked." },
  { key: "pack", label: "To pack & send", help: "Confirmed orders. Pack them and hand them to TCS." },
  { key: "tcs", label: "With TCS", help: "TCS has the parcel and is delivering it." },
  { key: "done", label: "Delivered", help: "Orders the customer has received." },
  { key: "closed", label: "Cancelled & returned", help: "Orders that did not complete." },
  { key: "all", label: "All orders", help: "Everything, newest first." },
] as const;
export type OrderTab = (typeof ORDER_TABS)[number]["key"];

export function isOrderTab(value: string | undefined): value is OrderTab {
  return ORDER_TABS.some((tab) => tab.key === value);
}

// NB: raw "orders"."id" – Drizzle omits table names in single-table selects, which would make the subqueries compare against their own id column.
const outerId = sql.raw('"orders"."id"');
const proofPending = sql`exists (select 1 from payment_proofs p where p.order_id = ${outerId} and p.status = 'pending')`;

function tabCondition(tab: OrderTab): SQL | undefined {
  switch (tab) {
    case "action":
      return or(eq(orders.orderStatus, "pending_confirmation"), and(inArray(orders.orderStatus, ["confirmed", "processing", "packed"]), proofPending));
    case "pack":
      return inArray(orders.orderStatus, ["confirmed", "processing", "packed"]);
    case "tcs":
      return eq(orders.orderStatus, "shipped");
    case "done":
      return eq(orders.orderStatus, "delivered");
    case "closed":
      return inArray(orders.orderStatus, ["cancelled", "returned"]);
    default:
      return undefined;
  }
}

function searchCondition(q: string): SQL | undefined {
  const text = q.trim();
  if (!text) return undefined;
  const digits = text.replace(/\D/g, "");
  const like = `%${text.replace(/[%_]/g, "")}%`;
  return or(
    likeCi(orders.orderNumber, like),
    likeCi(orders.customerName, like),
    likeCi(orders.courierTrackingNumber, like),
    likeCi(orders.city, like),
    digits.length >= 4 ? sql`${phoneDigits(orders.customerPhone)} like ${`%${digits}%`}` : undefined,
  );
}

export type OrderListRow = {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  city: string;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  createdAt: Date;
  courierTrackingNumber: string | null;
  courierStatus: string | null;
  handedOverAt: Date | null;
  pieces: number;
  firstImage: string | null;
  firstItem: string | null;
  proofPending: boolean;
  refundStatus: string | null;
};

export async function listOrders(options: { tab: OrderTab; q?: string; page?: number; pageSize?: number }): Promise<{ rows: OrderListRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = options.pageSize ?? 25;
  const page = Math.max(1, options.page ?? 1);
  const where = and(tabCondition(options.tab), searchCondition(options.q ?? ""));

  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        city: orders.city,
        total: orders.total,
        paymentMethod: orders.paymentMethod,
        paymentStatus: orders.paymentStatus,
        orderStatus: orders.orderStatus,
        createdAt: orders.createdAt,
        courierTrackingNumber: orders.courierTrackingNumber,
        courierStatus: orders.courierStatus,
        handedOverAt: orders.handedOverAt,
        pieces: sql<number>`coalesce((select sum(oi.quantity) from order_items oi where oi.order_id = ${outerId}), 0)`,
        firstImage: sql<string | null>`(select oi.image_url from order_items oi where oi.order_id = ${outerId} order by oi.id limit 1)`,
        firstItem: sql<string | null>`(select oi.product_name from order_items oi where oi.order_id = ${outerId} order by oi.id limit 1)`,
        proofPending,
        refundStatus: sql<string | null>`(select r.status from refund_requests r where r.order_id = ${outerId})`,
      })
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)` }).from(orders).where(where),
  ]);
  return { rows: rows.map((row) => ({ ...row, proofPending: Boolean(row.proofPending) })), total: count?.n ?? 0, page, pageSize };
}

export async function orderTabCounts(): Promise<Record<OrderTab, number>> {
  const [row] = await db
    .select({
      action: sql<number>`count(*) filter (where ${orders.orderStatus} = 'pending_confirmation' or (${orders.orderStatus} in ('confirmed','processing','packed') and ${proofPending}))`,
      pack: sql<number>`count(*) filter (where ${orders.orderStatus} in ('confirmed','processing','packed'))`,
      tcs: sql<number>`count(*) filter (where ${orders.orderStatus} = 'shipped')`,
      done: sql<number>`count(*) filter (where ${orders.orderStatus} = 'delivered')`,
      closed: sql<number>`count(*) filter (where ${orders.orderStatus} in ('cancelled','returned'))`,
      all: sql<number>`count(*)`,
    })
    .from(orders);
  return { action: row?.action ?? 0, pack: row?.pack ?? 0, tcs: row?.tcs ?? 0, done: row?.done ?? 0, closed: row?.closed ?? 0, all: row?.all ?? 0 };
}
