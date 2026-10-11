// Numbers for the admin Home screen. One function per question so each can be read (and tested) on its own;
// everything is grouped in Pakistan time so "today" means the shop's today.

import { sql } from "drizzle-orm";
import { db } from "@/db";

import { RANGES, isRangeKey, type RangeKey } from "./ranges";

export { RANGES, isRangeKey };
export type { RangeKey };

const DAY = 86_400_000;
const PKT_OFFSET = 5 * 3_600_000; // Pakistan has no daylight saving: always UTC+5

/** Midnight at the start of today in Pakistan, as a real instant. */
export function startOfTodayPkt(now = new Date()): Date {
  const shifted = new Date(now.getTime() + PKT_OFFSET);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - PKT_OFFSET);
}

export function resolveRange(key: RangeKey, now = new Date()) {
  const days = RANGES.find((range) => range.key === key)?.days ?? 30;
  const today = startOfTodayPkt(now);
  const from = new Date(today.getTime() - (days - 1) * DAY);
  const to = new Date(today.getTime() + DAY);
  const prevFrom = new Date(from.getTime() - days * DAY);
  return { key, days, from, to, prevFrom, prevTo: from };
}

type Rows<T> = { rows: T[] };
const rowsOf = <T>(result: unknown): T[] => (result as Rows<T>).rows ?? [];

// "Counts as a sale": placed and not cancelled / returned.
const LIVE = sql`o.order_status not in ('cancelled', 'returned')`;

export type Totals = { orders: number; sales: number; delivered: number; cancelled: number; customers: number };

async function totals(from: Date, to: Date): Promise<Totals> {
  const [row] = rowsOf<{ orders: number; sales: number; delivered: number; cancelled: number; customers: number }>(
    await db.execute(sql`
      select count(*) filter (where ${LIVE})::int as orders,
             coalesce(sum(o.total) filter (where ${LIVE}), 0)::bigint::float8 as sales,
             count(*) filter (where o.order_status = 'delivered')::int as delivered,
             count(*) filter (where o.order_status in ('cancelled','returned'))::int as cancelled,
             count(distinct regexp_replace(o.customer_phone, '\\D', '', 'g')) filter (where ${LIVE})::int as customers
      from orders o
      where o.created_at >= ${from.toISOString()}::timestamptz and o.created_at < ${to.toISOString()}::timestamptz`),
  );
  return { orders: row?.orders ?? 0, sales: Number(row?.sales ?? 0), delivered: row?.delivered ?? 0, cancelled: row?.cancelled ?? 0, customers: row?.customers ?? 0 };
}

export type DayPoint = { day: string; label: string; sales: number; orders: number };

async function daily(from: Date, to: Date): Promise<DayPoint[]> {
  const found = rowsOf<{ day: string; sales: number; orders: number }>(
    await db.execute(sql`
      select to_char(o.created_at at time zone 'Asia/Karachi', 'YYYY-MM-DD') as day,
             coalesce(sum(o.total), 0)::bigint::float8 as sales,
             count(*)::int as orders
      from orders o
      where ${LIVE} and o.created_at >= ${from.toISOString()}::timestamptz and o.created_at < ${to.toISOString()}::timestamptz
      group by 1`),
  );
  const byDay = new Map(found.map((row) => [row.day, row]));
  const out: DayPoint[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += DAY) {
    const key = new Date(t + PKT_OFFSET).toISOString().slice(0, 10);
    const hit = byDay.get(key);
    out.push({ day: key, label: new Date(t + PKT_OFFSET).toLocaleDateString("en-PK", { day: "numeric", month: "short", timeZone: "UTC" }), sales: Number(hit?.sales ?? 0), orders: hit?.orders ?? 0 });
  }
  return out;
}

export type NamedValue = { name: string; value: number; extra?: number; image?: string | null };

async function topProducts(from: Date, to: Date): Promise<NamedValue[]> {
  return rowsOf<{ name: string; units: number; revenue: number; image: string | null }>(
    await db.execute(sql`
      select oi.product_name as name, sum(oi.quantity)::int as units, sum(oi.line_total)::bigint::float8 as revenue, max(oi.image_url) as image
      from order_items oi join orders o on o.id = oi.order_id
      where ${LIVE} and o.created_at >= ${from.toISOString()}::timestamptz and o.created_at < ${to.toISOString()}::timestamptz
      group by oi.product_name order by revenue desc limit 6`),
  ).map((row) => ({ name: row.name, value: Number(row.revenue), extra: row.units, image: row.image }));
}

async function topCities(from: Date, to: Date): Promise<NamedValue[]> {
  return rowsOf<{ city: string; orders: number; sales: number }>(
    await db.execute(sql`
      select initcap(lower(trim(o.city))) as city, count(*)::int as orders, sum(o.total)::bigint::float8 as sales
      from orders o
      where ${LIVE} and o.created_at >= ${from.toISOString()}::timestamptz and o.created_at < ${to.toISOString()}::timestamptz
      group by 1 order by orders desc, sales desc limit 6`),
  ).map((row) => ({ name: row.city, value: row.orders, extra: Number(row.sales) }));
}

async function paymentMix(from: Date, to: Date): Promise<NamedValue[]> {
  return rowsOf<{ method: string; orders: number }>(
    await db.execute(sql`
      select o.payment_method as method, count(*)::int as orders
      from orders o
      where ${LIVE} and o.created_at >= ${from.toISOString()}::timestamptz and o.created_at < ${to.toISOString()}::timestamptz
      group by 1 order by orders desc`),
  ).map((row) => ({ name: row.method === "cod" ? "Cash on delivery" : row.method === "bank_deposit" ? "Bank transfer" : row.method, value: row.orders }));
}

/** Busiest hours (0–23, Pakistan time) – helps decide when to post offers. */
async function byHour(from: Date, to: Date): Promise<number[]> {
  const found = rowsOf<{ h: number; n: number }>(
    await db.execute(sql`
      select extract(hour from o.created_at at time zone 'Asia/Karachi')::int as h, count(*)::int as n
      from orders o
      where ${LIVE} and o.created_at >= ${from.toISOString()}::timestamptz and o.created_at < ${to.toISOString()}::timestamptz
      group by 1`),
  );
  const out = Array.from({ length: 24 }, () => 0);
  for (const row of found) out[row.h] = row.n;
  return out;
}

async function newVsReturning(from: Date, to: Date): Promise<{ fresh: number; returning: number }> {
  // One pass over the orders (not one search per customer): every customer's first order ever, then the customers who ordered in this
  // period are "new" when that first order falls inside the period and "returning" when it came before it.
  const [row] = rowsOf<{ fresh: number; returning: number }>(
    await db.execute(sql`
      with norm as (
        select regexp_replace(o.customer_phone, '\\D', '', 'g') as p, o.created_at
        from orders o where ${LIVE}
      ),
      firsts as (select p, min(created_at) as first_at from norm group by p),
      in_period as (
        select distinct p from norm where created_at >= ${from.toISOString()}::timestamptz and created_at < ${to.toISOString()}::timestamptz
      )
      select count(*) filter (where f.first_at >= ${from.toISOString()}::timestamptz)::int as fresh,
             count(*) filter (where f.first_at < ${from.toISOString()}::timestamptz)::int as returning
      from in_period r join firsts f on f.p = r.p`),
  );
  return { fresh: row?.fresh ?? 0, returning: row?.returning ?? 0 };
}

export type Todo = {
  toConfirm: number;
  waitingLong: number;
  receipts: number;
  toPack: number;
  withTcs: number;
  refunds: number;
  lowStock: number;
  outOfStock: number;
  unbooked: number;
};

export async function getTodo(): Promise<Todo> {
  const [row] = rowsOf<Todo>(
    await db.execute(sql`
      select
        (select count(*) from orders where order_status = 'pending_confirmation')::int as "toConfirm",
        (select count(*) from orders where order_status = 'pending_confirmation' and created_at < now() - interval '12 hours')::int as "waitingLong",
        (select count(*) from payment_proofs where status = 'pending')::int as "receipts",
        (select count(*) from orders where order_status in ('confirmed','processing','packed'))::int as "toPack",
        (select count(*) from orders where order_status = 'shipped')::int as "withTcs",
        (select count(*) from refund_requests where status in ('requested','approved'))::int as "refunds",
        (select count(*) from product_variants v join products p on p.id = v.product_id where v.status = 'active' and p.status = 'published' and v.stock_quantity - v.reserved_quantity between 1 and v.low_stock_threshold)::int as "lowStock",
        (select count(*) from product_variants v join products p on p.id = v.product_id where v.status = 'active' and p.status = 'published' and v.stock_quantity - v.reserved_quantity <= 0)::int as "outOfStock",
        (select count(*) from orders where order_status in ('confirmed','processing','packed') and (courier_tracking_number is null))::int as "unbooked"`),
  );
  return row ?? { toConfirm: 0, waitingLong: 0, receipts: 0, toPack: 0, withTcs: 0, refunds: 0, lowStock: 0, outOfStock: 0, unbooked: 0 };
}

export type LowStockRow = { productId: string; name: string; variant: string; available: number; image: string | null; widths: number[] | null };

export async function getLowStock(limit = 8): Promise<LowStockRow[]> {
  return rowsOf<LowStockRow>(
    await db.execute(sql`
      select p.id as "productId", p.name, v.name as variant, (v.stock_quantity - v.reserved_quantity)::int as available,
             (select i.r2_key from product_images i where i.product_id = p.id and i.status = 'active' order by i.is_primary desc, i.sort_order limit 1) as image,
             (select i.variant_widths from product_images i where i.product_id = p.id and i.status = 'active' order by i.is_primary desc, i.sort_order limit 1) as widths
      from product_variants v join products p on p.id = v.product_id
      where v.status = 'active' and p.status = 'published' and v.stock_quantity - v.reserved_quantity <= v.low_stock_threshold
      order by available asc, p.name limit ${limit}`),
  );
}

export type Analytics = {
  range: ReturnType<typeof resolveRange>;
  now: Totals;
  before: Totals;
  series: DayPoint[];
  products: NamedValue[];
  cities: NamedValue[];
  payments: NamedValue[];
  hours: number[];
  customers: { fresh: number; returning: number };
};

export async function getAnalytics(key: RangeKey): Promise<Analytics> {
  const range = resolveRange(key);
  const [now, before, series, products, cities, payments, hours, customers] = await Promise.all([
    totals(range.from, range.to),
    totals(range.prevFrom, range.prevTo),
    daily(range.from, range.to),
    topProducts(range.from, range.to),
    topCities(range.from, range.to),
    paymentMix(range.from, range.to),
    byHour(range.from, range.to),
    newVsReturning(range.from, range.to),
  ]);
  return { range, now, before, series, products, cities, payments, hours, customers };
}
