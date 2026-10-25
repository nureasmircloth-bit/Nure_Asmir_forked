import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { mediaUrl } from "@/lib/media-url";
import { HelpBox } from "../../_ui/client";
import { Icon } from "../../_ui/icons";
import { EmptyState, PageHeader, Pager, Tabs } from "../../_ui/ui";
import { StockGroup, type StockGroupData, type StockRowData } from "./stock-row";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stock" };

/** Products per page – each product carries all its colours and sizes, so this is the number of list rows, not of sizes. */
const PAGE_SIZE = 20;
const SHOW = [
  { key: "all", label: "Everything" },
  { key: "low", label: "Running low" },
  { key: "out", label: "Sold out" },
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProductRaw = { id: string; name: string; status: string; category: string; imageKey: string | null; widths: number[] | null };
type VariantRaw = { id: string; productId: string; color: string; size: string | null; sku: string; price: number; stock: number; reserved: number; low: number; matches: boolean };
type Rows<T> = { rows: T[] };
const rowsOf = <T,>(result: unknown): T[] => (result as Rows<T>).rows ?? [];

export default async function StockPage({ searchParams }: { searchParams: Promise<{ show?: string; q?: string; page?: string; cat?: string }> }) {
  const params = await searchParams;
  const show = SHOW.find((item) => item.key === params.show)?.key ?? "all";
  const q = (params.q ?? "").trim().slice(0, 60);
  const cat = params.cat && UUID.test(params.cat) ? params.cat : "";
  const page = Math.max(1, Number(params.page) || 1);
  const like = `%${q.replace(/[%_\\]/g, "")}%`;

  // A variant "matches" when it passes the search and the Running low / Sold out tab. A product is listed when any variant matches.
  const variantMatch = sql`v.status = 'active' ${q ? sql`and (p.name like ${like} or v.sku like ${like} or v.size like ${like} or v.color like ${like})` : sql``}
    ${show === "low" ? sql`and v.stock_quantity - v.reserved_quantity between 1 and v.low_stock_threshold` : show === "out" ? sql`and v.stock_quantity - v.reserved_quantity <= 0` : sql``}`;
  const productFilter = sql`p.status <> 'archived' ${cat ? sql`and p.category_id = ${cat}` : sql``}
    and exists (select 1 from product_variants v where v.product_id = p.id and ${variantMatch})`;

  const [productsResult, countResult, totalsResult, categoriesResult] = await Promise.all([
    db.execute(sql`
      select p.id, p.name, p.status, c.name as category,
             (select i.r2_key from product_images i where i.product_id = p.id and i.status = 'active' order by i.is_primary desc, i.sort_order limit 1) as "imageKey",
             (select i.variant_widths from product_images i where i.product_id = p.id and i.status = 'active' order by i.is_primary desc, i.sort_order limit 1) as widths
      from products p join categories c on c.id = p.category_id
      where ${productFilter}
      order by p.name, p.id
      limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`),
    db.execute(sql`select count(*) as n from products p where ${productFilter}`),
    db.execute(sql`
      select count(*) filter (where v.stock_quantity - v.reserved_quantity between 1 and v.low_stock_threshold) as low,
             count(*) filter (where v.stock_quantity - v.reserved_quantity <= 0) as out,
             count(distinct p.id) as "all"
      from product_variants v join products p on p.id = v.product_id
      where v.status = 'active' and p.status <> 'archived' ${cat ? sql`and p.category_id = ${cat}` : sql``}`),
    db.execute(sql`
      select c.id, c.name, count(distinct p.id) as n
      from categories c join products p on p.category_id = c.id and p.status <> 'archived'
      join product_variants v on v.product_id = p.id and v.status = 'active'
      group by c.id, c.name order by c.name`),
  ]);

  const productRows = rowsOf<ProductRaw>(productsResult);
  const total = Number(rowsOf<{ n: number }>(countResult)[0]?.n ?? 0);
  const counts = rowsOf<{ low: number; out: number; all: number }>(totalsResult)[0] ?? { low: 0, out: 0, all: 0 };
  const categories = rowsOf<{ id: string; name: string; n: number }>(categoriesResult);
  const totalAll = categories.reduce((sum, item) => sum + item.n, 0);

  // Second, small query: every colour and size of just the products on this page.
  let variants: VariantRaw[] = [];
  if (productRows.length) {
    const ids = sql.join(productRows.map((row) => sql`${row.id}`), sql`, `);
    variants = rowsOf<VariantRaw>(
      await db.execute(sql`
        select v.id, v.product_id as "productId", v.color, v.size, v.sku, v.price, v.stock_quantity as stock, v.reserved_quantity as reserved,
               v.low_stock_threshold as low, (${variantMatch}) as matches
        from product_variants v join products p on p.id = v.product_id
        where v.product_id in (${ids}) and v.status = 'active'
        order by v.color, v.created_at, v.size`),
    );
  }

  const groups = productRows.map<StockGroupData>((product) => {
    const own = variants.filter((variant) => variant.productId === product.id);
    const rows = own.map<StockRowData>((variant) => ({
      id: variant.id,
      productId: product.id,
      product: product.name,
      color: variant.color,
      size: variant.size,
      sku: variant.sku,
      price: variant.price,
      stock: variant.stock,
      reserved: variant.reserved,
      low: variant.low,
      matches: variant.matches,
    }));
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      status: product.status,
      image: product.imageKey ? mediaUrl(product.imageKey, product.widths) : null,
      rows,
    };
  });

  const filtered = show !== "all" || Boolean(q);
  const href = (next: { show?: string; page?: number; cat?: string }) => {
    const search = new URLSearchParams();
    const s = next.show ?? show;
    const c = next.cat === undefined ? cat : next.cat;
    if (s !== "all") search.set("show", s);
    if (c) search.set("cat", c);
    if (q) search.set("q", q);
    if (next.page && next.page > 1) search.set("page", String(next.page));
    const text = search.toString();
    return `/admin/stock${text ? `?${text}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Stock"
        intro="One line for each product. Open a product to see its colours and how many of each size you have."
        actions={
          <Link className="a-btn" href="/admin/products/bulk#update" title="Download all prices and stock as a sheet, change numbers in Excel, and upload it back">
            <Icon name="sheet" /> Update with Excel
          </Link>
        }
      />
      <HelpBox id="stock">
        <ol>
          <li>Each line is <strong>one product</strong> with the total you have. Press the line to open it and see every <strong>colour</strong> and <strong>size</strong>.</li>
          <li>Change <strong>In stock</strong> or <strong>Price</strong> for a size, then press <strong>Save</strong> on that row. Customers see it straight away.</li>
          <li><strong>Held</strong> is what is promised to customers who have ordered but not received yet. When a size reaches 0 it shows <strong>Sold out</strong> on your website by itself.</li>
          <li>Use the <strong>category buttons</strong> to look at only shirts, only trousers, and so on.</li>
        </ol>
      </HelpBox>

      {categories.length > 1 && (
        <nav className="a-chips" aria-label="Category">
          <Link href={href({ cat: "", page: 1 })} aria-current={!cat ? "page" : undefined} scroll={false} prefetch={false}>
            All categories <span>{totalAll}</span>
          </Link>
          {categories.map((item) => (
            <Link key={item.id} href={href({ cat: item.id, page: 1 })} aria-current={cat === item.id ? "page" : undefined} scroll={false} prefetch={false}>
              {item.name} <span>{item.n}</span>
            </Link>
          ))}
        </nav>
      )}

      <Tabs items={SHOW.map((item) => ({ href: href({ show: item.key, page: 1 }), label: item.label, count: item.key === "all" ? counts.all : item.key === "low" ? counts.low : counts.out, active: item.key === show, hot: item.key !== "all" && (item.key === "low" ? counts.low : counts.out) > 0 }))} />
      <form method="get" action="/admin/stock" className="a-row" style={{ marginBottom: 14 }} role="search">
        {show !== "all" && <input type="hidden" name="show" value={show} />}
        {cat && <input type="hidden" name="cat" value={cat} />}
        <div style={{ flex: 1, maxWidth: 420 }}>
          <input name="q" defaultValue={q} placeholder="Find by product name, colour, size or code…" aria-label="Find stock" />
        </div>
        <button className="a-btn">
          <Icon name="search" size={17} /> Find
        </button>
        {q && (
          <Link className="a-btn a-btn-quiet" href={href({ page: 1 }).replace(/([?&])q=[^&]*&?/, "$1").replace(/[?&]$/, "")} prefetch={false}>
            Clear
          </Link>
        )}
      </form>
      <div className="a-card">
        {groups.length ? (
          <div className="a-table-wrap">
            <table className="a-table a-stock">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Colours</th>
                  <th className="num">In stock</th>
                  <th className="num">Held</th>
                  <th>For sale</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              {groups.map((group) => (
                <StockGroup key={group.id} group={group} startOpen={filtered && group.rows.some((row) => row.matches)} onlyMatches={show !== "all"} />
              ))}
            </table>
          </div>
        ) : (
          <EmptyState icon="grid" title={!filtered && !cat ? "No products yet" : "Nothing to show"}>
            {show === "low" ? "Nothing is running low. 🎉" : show === "out" ? "Nothing is sold out." : "Try a different search or category."}
          </EmptyState>
        )}
        <Pager page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(next) => href({ page: next })} />
      </div>
    </>
  );
}
