// Sets up (or tops up) the PRACTICE shop's database. Safe to run again: it only fills what is missing.
//
//   DATABASE_URL=<the practice connection string> ADMIN_EMAIL=practice@nureasmir.com ADMIN_INITIAL_PASSWORD=<anything> npx tsx scripts/sandbox-setup.ts
//
// 1. runs scripts/seed.ts, which creates the practice owner, settings, delivery areas, categories, products with pictures and banners;
// 2. adds a few pretend orders in different stages, so every lesson has something to work on;
// 3. remembers how everything looks as "the starting data" (what the Start again button restores).
//
// It refuses to run unless the connection looks at the "practice" schema (see scripts/practice-create.ts), so it can never touch the real tables.
import { spawnSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { captureBaseline, hasBaseline } from "../lib/sandbox";

const FORCE = process.argv.includes("--force");

async function count(table: string): Promise<number> {
  const result = (await db.execute(sql.raw(`select count(*)::int as n from "${table}"`))) as unknown as { rows: Array<{ n: number }> };
  return Number(result.rows[0]?.n ?? 0);
}

type Stage = { status: string; payment: string; paid: boolean; tracking?: string; courierStatus?: string; hoursAgo: number };
const STAGES: Stage[] = [
  { status: "pending_confirmation", payment: "cod", paid: false, hoursAgo: 1 },
  { status: "pending_confirmation", payment: "cod", paid: false, hoursAgo: 3 },
  { status: "confirmed", payment: "cod", paid: false, hoursAgo: 7 },
  { status: "confirmed", payment: "cod", paid: false, hoursAgo: 20 },
  { status: "packed", payment: "cod", paid: false, hoursAgo: 30 },
  { status: "shipped", payment: "cod", paid: false, tracking: "779900123456", courierStatus: "Shipment Picked Up", hoursAgo: 52 },
  { status: "delivered", payment: "cod", paid: true, tracking: "779900123457", courierStatus: "Delivered", hoursAgo: 120 },
  { status: "delivered", payment: "cod", paid: true, tracking: "779900123458", courierStatus: "Delivered", hoursAgo: 190 },
  { status: "cancelled", payment: "cod", paid: false, hoursAgo: 96 },
];
const PEOPLE = [
  ["Ahmed Raza", "03011234567", "Lahore", "Punjab"],
  ["Bilal Khan", "03219876543", "Karachi", "Sindh"],
  ["Hamza Sheikh", "03331112233", "Islamabad", "Islamabad Capital Territory"],
  ["Usman Ali", "03455556677", "Faisalabad", "Punjab"],
  ["Saad Mehmood", "03008889900", "Peshawar", "Khyber Pakhtunkhwa"],
] as const;

async function addPretendOrders() {
  if ((await count("orders")) > 0 && !FORCE) return;
  const variants = (await db.execute(
    sql`select v.id as variant_id, v.product_id, v.sku, v.name as variant_name, v.price, p.name as product_name from product_variants v join products p on p.id = v.product_id where v.status = 'active' order by p.name, v.sku limit 12`,
  )) as unknown as { rows: Array<{ variant_id: string; product_id: string; sku: string; variant_name: string; price: number; product_name: string }> };
  if (!variants.rows.length) {
    console.log("No products yet, so no pretend orders.");
    return;
  }
  let n = 0;
  for (const stage of STAGES) {
    const [name, phone, city, province] = PEOPLE[n % PEOPLE.length];
    const item = variants.rows[(n * 2) % variants.rows.length];
    const quantity = 1 + (n % 2);
    const subtotal = item.price * quantity;
    const delivery = subtotal >= 10000 ? 0 : 250;
    const number = `PR-${String(100100 + n)}`;
    const created = new Date(Date.now() - stage.hoursAgo * 3_600_000).toISOString();
    const created_order = (await db.execute(sql`
      insert into orders (order_number, customer_name, customer_phone, city, province, address, subtotal, delivery_charge, total, payment_method, payment_status, order_status,
        courier_tracking_number, courier_status, courier_booked_at, handed_over_at, cancelled_at, cancel_reason, cancelled_by, created_at, updated_at)
      values (${number}, ${name}, ${phone}, ${city}, ${province}, ${`House ${10 + n}, Street ${n + 2}, ${city}`}, ${subtotal}, ${delivery}, ${subtotal + delivery}, ${stage.payment},
        ${stage.paid ? "paid" : "pending"}, ${stage.status}, ${stage.tracking ?? null}, ${stage.courierStatus ?? null}, ${stage.tracking ? created : null},
        ${stage.status === "shipped" || stage.status === "delivered" ? created : null}, ${stage.status === "cancelled" ? created : null},
        ${stage.status === "cancelled" ? "Customer changed their mind" : null}, ${stage.status === "cancelled" ? "customer" : null}, ${created}, ${created})
      returning id`)) as unknown as { rows: Array<{ id: string }> };
    const orderId = created_order.rows[0].id;
    await db.execute(sql`
      insert into order_items (order_id, product_id, variant_id, product_name, variant_name, sku, unit_price, quantity, line_total)
      values (${orderId}, ${item.product_id}, ${item.variant_id}, ${item.product_name}, ${item.variant_name}, ${item.sku}, ${item.price}, ${quantity}, ${subtotal})`);
    await db.execute(sql`insert into order_status_history (order_id, from_status, to_status, note, actor_email, created_at) values (${orderId}, null, ${stage.status}, 'Pretend order for practice', 'practice', ${created})`);
    n += 1;
  }
  console.log(`Added ${n} pretend orders.`);
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set (use the PRACTICE connection string).");
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_INITIAL_PASSWORD) throw new Error("ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD (any practice sign-in) are required.");
  process.env.PRACTICE_DATABASE_URL = url; // the helpers below work on "the practice tables"; here that is simply this connection

  // The one safety check that matters: this must be the practice user, looking at the practice schema – never the real tables.
  const where = (await db.execute(sql`select current_schema() as schema, current_user as who`)) as unknown as { rows: Array<{ schema: string; who: string }> };
  if (where.rows[0]?.schema !== "practice") throw new Error(`Refusing to continue: this connection looks at the "${where.rows[0]?.schema}" tables, not the practice ones.`);

  if (!(await hasBaseline()) || FORCE) {
    const seed = spawnSync(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "scripts/seed.ts"], { stdio: "inherit", env: process.env });
    if (seed.status !== 0) throw new Error("The starting catalogue could not be created.");
    await addPretendOrders();
    console.log(`Saved the starting data (${await captureBaseline()} tables).`);
  } else {
    console.log("The practice tables are already set up.");
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
