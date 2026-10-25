import { sql } from "drizzle-orm";
import { db } from "@/db";
import { daysAgoMs, nowMs } from "@/db/sql-compat";
import { auditLogEntry } from "@/lib/admin/audit";

type Rows<T> = { rows: T[] };
const rowsOf = <T>(result: unknown): T[] => (result as Rows<T>).rows ?? [];

export const DEFAULT_SOLDOUT_DAYS = 90;

/** Days after which a fully sold-out product is hidden from the shop (0 = never: keep forever). */
export async function getSoldoutDays(): Promise<number> {
  const rows = rowsOf<{ d: number }>(await db.execute(sql`select soldout_hide_days as d from site_settings where id = 'store' limit 1`));
  const days = Number(rows[0]?.d ?? DEFAULT_SOLDOUT_DAYS);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
}

/**
 * Products where every size of every colour has been sold out – and nothing has been ordered or edited – for `days` days.
 * Used both to hide them and to find old photos that can be squeezed harder.
 */
export function idleSoldOutProducts(days: number) {
  const cutoff = daysAgoMs(days);
  return sql`
    select p.id, p.name from products p
    where p.status in ('published', 'archived')
      and exists (select 1 from product_variants v where v.product_id = p.id and v.status = 'active')
      and not exists (select 1 from product_variants v where v.product_id = p.id and v.status = 'active' and v.stock_quantity - v.reserved_quantity > 0)
      and not exists (select 1 from product_variants v where v.product_id = p.id and v.updated_at > ${cutoff})
      and not exists (select 1 from order_items oi join orders o on o.id = oi.order_id where oi.product_id = p.id and o.created_at > ${cutoff})
      and p.updated_at < ${cutoff}`;
}

/** Hides (archives) products that have been sold out for the owner's chosen number of days. Nothing is deleted, and the owner can show them again any time. */
export async function hideLongSoldOut(): Promise<{ days: number; hidden: Array<{ id: string; name: string }> }> {
  const days = await getSoldoutDays();
  if (!days) return { days, hidden: [] };
  const hidden = rowsOf<{ id: string; name: string }>(
    await db.execute(sql`
      update products set status = 'archived', updated_at = ${nowMs}
      where status = 'published' and id in (select id from (${idleSoldOutProducts(days)}) as idle)
      returning id, name`),
  );
  if (hidden.length) {
    await auditLogEntry({ actorEmail: "system", action: "product.auto_hide_sold_out", entityType: "product", entityId: hidden.map((h) => h.id).join(",").slice(0, 200), detail: { days, names: hidden.map((h) => h.name).slice(0, 20) } });
  }
  return { days, hidden };
}
