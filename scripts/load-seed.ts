// Fills a DISPOSABLE database with a lot of fake data so the shop and the admin can be tried with realistic volumes (pagination, search,
// listing speed). Everything it makes is tagged ("lt-" slugs, "LT-" order numbers, "LT " names) so it can be removed again.
//
//   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/load-seed.ts [--products 1500] [--orders 8000] [--clean]
//
// It refuses to run unless the HOST NAME of DATABASE_URL is the throw-away test branch (ep-restless-art-…), and never touches the real
// shop's database.
import { neon } from "@neondatabase/serverless";

/** Fails closed: only a disposable test database may be touched, judged by the host name alone (never by words elsewhere in the URL). */
function assertDisposable(url: string): void {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // not a URL at all
  }
  if (!/^ep-restless-art-[a-z0-9]+(-pooler)?\./.test(host)) {
    console.error("Refusing to run: DATABASE_URL is not the disposable e2e test branch.");
    process.exit(1);
  }
}
const url = process.env.DATABASE_URL ?? "";
assertDisposable(url);
const arg = (name: string, fallback: number) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? Number(process.argv[index + 1]) || fallback : fallback;
};
const PRODUCTS = arg("products", 1500);
const ORDERS = arg("orders", 8000);
const sql = neon(url);

async function clean() {
  await sql`delete from orders where order_number like 'LT-%'`;
  await sql`delete from products where slug like 'lt-%'`;
  console.log("removed the load-test data");
}

async function main() {
  if (process.argv.includes("--clean")) return clean();
  await clean();
  const started = Date.now();

  await sql`
    insert into products (category_id, name, slug, type_label, short_description, description, status, featured, badge, published_at, created_at, updated_at)
    select (select id from categories order by created_at offset (g % greatest((select count(*) from categories), 1)) limit 1),
           'LT ' || (array['Kameez Shalwar','Waistcoat Set','Cargo Pants','Oxford Shirt','Leather Belt','Wallet','Polo Shirt','Chino Pants'])[1 + g % 8] || ' ' || g,
           'lt-' || g, (array['Kameez Shalwar','Waistcoat','Pants','Shirt','Belt','Wallet','Polo','Chino'])[1 + g % 8],
           'Load-test product ' || g, 'A long enough description for load-test product ' || g || ' so that listing pages carry realistic text.',
           case when g % 25 = 0 then 'draft' else 'published' end, g % 40 = 0, case when g % 9 = 0 then 'New' else null end,
           now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval, now()
    from generate_series(1, ${PRODUCTS}) g`;
  console.log(`products: ${PRODUCTS}`);

  await sql`
    insert into product_variants (product_id, name, sku, color, size, price, stock_quantity, is_default, status)
    select p.id, s.size, 'LT-' || substr(p.slug, 4) || '-' || s.size, (array['Black','Navy','Olive','Cream','Brown'])[1 + (substr(p.slug, 4))::int % 5], s.size,
           1500 + ((substr(p.slug, 4))::int % 40) * 250, 5 + ((substr(p.slug, 4))::int * 7) % 40, s.size = 'M', 'active'
    from products p, (values ('S'), ('M'), ('L')) as s(size) where p.slug like 'lt-%'`;
  await sql`
    insert into product_images (product_id, r2_key, alt_text, content_type, byte_size, width, height, sort_order, is_primary, status)
    select p.id, 'loadtest/' || substr(p.slug, 4) || '-' || n, p.name || ' photo ' || n, 'image/webp', 40000, 900, 1200, n, n = 0, 'active'
    from products p, generate_series(0, 2) n where p.slug like 'lt-%'`;
  console.log("variants and photos added");

  await sql`
    insert into orders (order_number, customer_name, customer_phone, customer_email, city, province, address, subtotal, delivery_charge, discount, total, payment_method, payment_status, order_status, created_at, updated_at)
    select 'LT-' || g, 'Load Customer ' || g, '0300' || lpad((1000000 + g)::text, 7, '0'), null,
           (array['Lahore','Karachi','Islamabad','Faisalabad','Multan','Peshawar'])[1 + g % 6], (array['Punjab','Sindh','Islamabad','Punjab','Punjab','KPK'])[1 + g % 6],
           'House ' || g || ', Street ' || (g % 90), 0, 250, 0, 0, 'cod', 'pending',
           (array['pending_confirmation','confirmed','processing','packed','shipped','delivered','delivered','delivered','cancelled'])[1 + g % 9],
           now() - ((g * 37) % 260000 || ' minutes')::interval, now()
    from generate_series(1, ${ORDERS}) g`;
  await sql`
    insert into order_items (order_id, product_id, variant_id, product_name, variant_name, sku, unit_price, quantity, line_total)
    select o.id, v.product_id, v.id, p.name, v.name, v.sku, v.price, 1 + (substr(o.order_number, 4))::int % 3, v.price * (1 + (substr(o.order_number, 4))::int % 3)
    from orders o
    join lateral (select * from product_variants pv where pv.sku like 'LT-%' order by pv.sku offset ((substr(o.order_number, 4))::int * 3) % ${PRODUCTS * 3} limit 1) v on true
    join products p on p.id = v.product_id
    where o.order_number like 'LT-%'`;
  // The money columns are filled from the items, so every order's subtotal and total match its lines (totals = lines + delivery - discount).
  await sql`
    update orders o set subtotal = s.lines, total = s.lines + o.delivery_charge - o.discount
    from (select order_id, sum(line_total)::int as lines from order_items group by order_id) s
    where s.order_id = o.id and o.order_number like 'LT-%'`;
  console.log(`orders: ${ORDERS} (with items)  in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((error) => {
  console.error("load seed failed:", error.message);
  process.exit(1);
});
