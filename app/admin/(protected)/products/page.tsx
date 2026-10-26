import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, products } from "@/db/schema";
import { mediaUrl } from "@/lib/media-url";
import { HelpBox } from "../../_ui/client";
import { PrefetchExcel } from "../../_ui/prefetch-excel";
import { Icon } from "../../_ui/icons";
import { Badge, EmptyState, PageHeader, Pager, Tabs, Thumb, pkr, when } from "../../_ui/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Products" };

const PAGE_SIZE = 25;
const FILTERS = [
  { key: "all", label: "All" },
  { key: "published", label: "On the website" },
  { key: "draft", label: "Hidden" },
  { key: "low", label: "Running low" },
  { key: "archived", label: "Removed" },
] as const;

type Row = { id: string; name: string; type: string; status: string; category: string; created: Date; minPrice: number | null; maxPrice: number | null; sizes: number; colors: number; available: number | null; lowCount: number; imageKey: string | null; widths: number[] | null; featured: boolean };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string; page?: string; cat?: string }> }) {
  const params = await searchParams;
  const filter = FILTERS.find((item) => item.key === params.filter)?.key ?? "all";
  const q = (params.q ?? "").trim().slice(0, 60);
  const page = Math.max(1, Number(params.page) || 1);
  const cat = /^[0-9a-f-]{36}$/i.test(params.cat ?? "") ? params.cat : undefined;
  const like = `%${q.replace(/[%_]/g, "")}%`;

  const where = sql`${filter === "all" ? sql`p.status <> 'archived'` : filter === "low" ? sql`p.status <> 'archived'` : sql`p.status = ${filter}`}
    ${q ? sql`and (p.name like ${like} or p.type_label like ${like} or exists (select 1 from product_variants sv where sv.product_id = p.id and sv.sku like ${like}))` : sql``}
    ${cat ? sql`and p.category_id = ${cat}` : sql``}`;
  const having = filter === "low" ? sql`where s."lowCount" > 0` : sql``;

  const base = sql`
    select p.id, p.name, p.type_label as type, p.status, p.featured, p.created_at as created, c.name as category,
           s.min_price as "minPrice", s.max_price as "maxPrice", s.sizes, s.colors, s.available, s.low_count as "lowCount",
           (select i.r2_key from product_images i where i.product_id = p.id and i.status = 'active' order by i.is_primary desc, i.sort_order, i.created_at limit 1) as "imageKey",
           (select i.variant_widths from product_images i where i.product_id = p.id and i.status = 'active' order by i.is_primary desc, i.sort_order, i.created_at limit 1) as widths
    from products p
    join categories c on c.id = p.category_id
    left join (
      select v.product_id, min(v.price) as min_price, max(v.price) as max_price, count(*) as sizes, count(distinct lower(v.color)) as colors,
             sum(max(0, v.stock_quantity - v.reserved_quantity)) as available,
             count(*) filter (where v.stock_quantity - v.reserved_quantity <= v.low_stock_threshold) as low_count
      from product_variants v where v.status = 'active' group by v.product_id
    ) s on s.product_id = p.id
    where ${where}`;

  const [result, totalResult, catRows, counts] = await Promise.all([
    db.execute(sql`select * from (${base}) s ${having} order by created desc limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`),
    db.execute(sql`select count(*) as n from (${base}) s ${having}`),
    db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
    db.select({ status: products.status, n: sql<number>`count(*)` }).from(products).groupBy(products.status),
  ]);
  const rows = ((result as unknown as { rows: Row[] }).rows ?? []).map((row) => ({ ...row, created: new Date(row.created) }));
  const total = Number(((totalResult as unknown as { rows: Array<{ n: number }> }).rows ?? [])[0]?.n ?? 0);
  const countOf = (status: string) => counts.find((row) => row.status === status)?.n ?? 0;
  const href = (next: Partial<{ filter: string; page: number }>) => {
    const search = new URLSearchParams();
    const f = next.filter ?? filter;
    if (f !== "all") search.set("filter", f);
    if (q) search.set("q", q);
    if (cat) search.set("cat", cat);
    if (next.page && next.page > 1) search.set("page", String(next.page));
    const text = search.toString();
    return `/admin/products${text ? `?${text}` : ""}`;
  };
  const tabCount: Record<string, number | undefined> = { all: countOf("published") + countOf("draft"), published: countOf("published"), draft: countOf("draft"), archived: countOf("archived"), low: undefined };

  return (
    <>
      <PrefetchExcel />
      <PageHeader
        title="Products"
        intro="Everything you sell. Click a product to change its photos, price or stock."
        actions={
          <>
            <Link className="a-btn" href="/admin/products/bulk" title="Add or update many products at once using an Excel / Google Sheets file">
              <Icon name="sheet" /> Add many with Excel
            </Link>
            <Link className="a-btn a-btn-primary" href="/admin/products/new">
              <Icon name="plus" /> Add product
            </Link>
          </>
        }
      />
      <HelpBox id="products">
        <ol>
          <li>Press <strong>Add product</strong> to add one thing. It takes about three minutes.</li>
          <li>Have many products? Press <strong>Add many with Excel</strong>. We give you a sheet to fill in — then you upload it.</li>
          <li>To change only prices or stock, the <Link href="/admin/stock" style={{ textDecoration: "underline" }}>Stock page</Link> is quicker.</li>
        </ol>
      </HelpBox>
      <Tabs items={FILTERS.map((item) => ({ href: href({ filter: item.key }), label: item.label, count: tabCount[item.key], active: item.key === filter }))} />
      <form method="get" action="/admin/products" className="a-row" style={{ marginBottom: 14 }} role="search">
        {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
        <div style={{ flex: 1, maxWidth: 420 }}>
          <input name="q" defaultValue={q} placeholder="Find a product by name or code…" aria-label="Find a product" />
        </div>
        <select name="cat" defaultValue={cat ?? ""} aria-label="Category" style={{ width: 220 }}>
          <option value="">All categories</option>
          {catRows.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="a-btn">
          <Icon name="search" size={17} /> Find
        </button>
        {(q || cat) && (
          <Link className="a-btn a-btn-quiet" href={href({ filter })} >
            Clear
          </Link>
        )}
      </form>

      <div className="a-card">
        {rows.length ? (
          <div className="a-table-wrap">
            <table className="a-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th className="num">Price</th>
                  <th>Stock</th>
                  <th>On website?</th>
                  <th>
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/admin/products/${row.id}`} className="a-prodcell">
                        <Thumb src={row.imageKey ? mediaUrl(row.imageKey, row.widths) : null} />
                        <span>
                          <strong>{row.name}</strong>
                          <small>
                            {row.type} · {row.colors > 1 ? `${row.colors} colours · ` : ""}{row.sizes} size{row.sizes === 1 ? "" : "s"}{row.colors > 1 ? " in all" : ""}
                            {row.featured ? " · on home page" : ""}
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td>{row.category}</td>
                    <td className="num a-money">{row.minPrice == null ? "—" : row.minPrice === row.maxPrice ? pkr(row.minPrice) : `${pkr(row.minPrice)} – ${pkr(row.maxPrice)}`}</td>
                    <td>
                      {row.available == null || row.sizes === 0 ? (
                        <Badge tone="muted">No sizes yet</Badge>
                      ) : row.available <= 0 ? (
                        <Badge tone="bad">Sold out</Badge>
                      ) : row.lowCount > 0 ? (
                        <Badge tone="new">{row.available} left · some sizes low</Badge>
                      ) : (
                        <span>{row.available} in stock</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={row.status === "published" ? "done" : "muted"}>{row.status === "published" ? "On website" : row.status === "draft" ? "Hidden" : "Removed"}</Badge>
                      <small className="a-faint">added {when(row.created)}</small>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link className="a-btn a-btn-sm" href={`/admin/products/${row.id}`}>
                        <Icon name="edit" size={15} /> Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="box" title={q || cat || filter !== "all" ? "No product found" : "You have not added any products yet"} action={!q && !cat && filter === "all" ? <Link className="a-btn a-btn-primary" href="/admin/products/new">Add your first product</Link> : undefined}>
            {q || cat || filter !== "all" ? "Try a different search or filter." : "Add one product by hand, or add many at once with an Excel sheet."}
          </EmptyState>
        )}
        <Pager page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(next) => href({ page: next })} />
      </div>
    </>
  );
}

