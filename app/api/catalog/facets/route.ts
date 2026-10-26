import { sql } from "drizzle-orm";
import { db } from "@/db";
import { sortSizes } from "@/lib/catalog-filters";

export const dynamic = "force-dynamic";

type Rows<T> = { rows: T[] };
const rowsOf = <T>(result: unknown): T[] => (result as Rows<T>).rows ?? [];

/**
 * What the shop's filter panel can offer: the cheapest and dearest price, and the sizes and colours that really exist (with how many
 * products have each), for the whole shop or one category. One small cached read, so opening the filters costs the database almost nothing.
 */
export async function GET(request: Request) {
  const cat = (new URL(request.url).searchParams.get("cat") ?? "").trim();
  const slug = /^[a-z0-9-]{1,80}$/.test(cat) && cat !== "all" ? cat : null;
  const scope = slug ? sql`and c.slug = ${slug}` : sql``;
  const base = sql`from product_variants v join products p on p.id = v.product_id join categories c on c.id = p.category_id where p.status = 'published' and v.status = 'active' ${scope}`;

  const [range, sizes, colors] = await Promise.all([
    db.execute(sql`select min(v.price) as "min", max(v.price) as "max" ${base}`),
    db.execute(sql`select min(v.size) as value, count(distinct p.id) as n ${base} and coalesce(v.size, '') <> '' group by lower(v.size)`),
    db.execute(sql`select min(v.color) as value, count(distinct p.id) as n ${base} and coalesce(v.color, '') <> '' group by lower(v.color) order by count(distinct p.id) desc, min(v.color)`),
  ]);
  const price = rowsOf<{ min: number | null; max: number | null }>(range)[0] ?? { min: null, max: null };
  const sizeRows = rowsOf<{ value: string; n: number }>(sizes);
  const order = sortSizes(sizeRows.map((row) => row.value));
  return Response.json(
    {
      price: { min: price.min ?? 0, max: price.max ?? 0 },
      sizes: order.map((value) => ({ value, count: sizeRows.find((row) => row.value === value)?.n ?? 0 })),
      colors: rowsOf<{ value: string; n: number }>(colors).map((row) => ({ value: row.value, count: row.n })),
    },
    { headers: { "Cache-Control": "public, max-age=30, s-maxage=120, stale-while-revalidate=600" } },
  );
}
