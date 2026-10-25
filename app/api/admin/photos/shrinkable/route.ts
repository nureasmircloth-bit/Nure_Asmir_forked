import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { getSoldoutDays, idleSoldOutProducts } from "@/lib/soldout-cleanup";
import { mediaUrl } from "@/lib/media-url";

export const dynamic = "force-dynamic";

/** Days used to decide "sold out for a long time" when the owner keeps sold-out products forever (so there is no hiding time set). */
const FALLBACK_DAYS = 90;
const BATCH = 25;

type Row = { id: string; key: string; widths: number[] | null; bytes: number };

/** Photos of products that have been sold out for a long time and have not been squeezed harder yet – the browser shrinks them in small batches. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const days = (await getSoldoutDays()) || FALLBACK_DAYS;
  const base = sql`from product_images i where i.status = 'active' and i.compacted_at is null and i.product_id in (select id from (${idleSoldOutProducts(days)}) as idle)`;
  const [list, total] = await Promise.all([
    db.execute(sql`select i.id, i.r2_key as key, i.variant_widths as widths, i.byte_size as bytes ${base} order by i.created_at limit ${BATCH}`),
    db.execute(sql`select count(*) as n, coalesce(sum(i.byte_size), 0) as bytes ${base}`),
  ]);
  const rows = ((list as unknown as { rows: Row[] }).rows ?? []).map((row) => ({ id: row.id, url: mediaUrl(row.key, null), bytes: Number(row.bytes) }));
  const totals = (total as unknown as { rows: Array<{ n: number; bytes: string | number }> }).rows?.[0];
  return Response.json({ days, images: rows, remaining: Number(totals?.n ?? 0), remainingBytes: Number(totals?.bytes ?? 0) });
}
