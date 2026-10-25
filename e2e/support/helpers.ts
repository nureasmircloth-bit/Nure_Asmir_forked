import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { expect, type APIRequestContext } from "@playwright/test";

export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
export const MOCK = process.env.E2E_MOCK_FCM ?? "http://127.0.0.1:4010";
export const CRON_SECRET = process.env.E2E_CRON_SECRET ?? "e2e-cron-secret";

const NOW_MS = "(cast(unixepoch('subsec') * 1000 as integer))";
const UNIT_MS: Record<string, number> = { second: 1000, seconds: 1000, minute: 60_000, minutes: 60_000, hour: 3_600_000, hours: 3_600_000, day: 86_400_000, days: 86_400_000 };

/** The tests were written for Postgres; the few idioms they use are spelled the SQLite way here, so the specs stay readable. */
function translate(text: string): string {
  return text
    .replace(/now\(\)\s*-\s*interval\s*'(\d+)\s*(\w+)'/gi, (_m, n: string, unit: string) => `(${NOW_MS} - ${Number(n) * (UNIT_MS[unit.toLowerCase()] ?? 1000)})`)
    .replace(/make_interval\(days\s*=>\s*([^)]+)\)/gi, "($1 * 86400000)")
    .replace(/\bnow\(\)/gi, NOW_MS)
    .replace(/::(int|integer|bigint|text|uuid|date|jsonb|float8|numeric)\b/gi, "")
    .replace(/\bjsonb_array_length\(/gi, "json_array_length(")
    .replace(/\bilike\b/gi, "like");
}

const dbFile = process.env.LOCAL_DB_PATH ?? process.env.E2E_LOCAL_DB ?? ".local-db/e2e.sqlite";
let client: Database.Database | null = null;
function local(): Database.Database {
  if (!client) {
    client = new Database(dbFile);
    client.pragma("journal_mode = WAL");
    client.pragma("busy_timeout = 8000");
  }
  return client;
}

/** Tagged-template SQL against the disposable local test database (the same SQLite file the app under test uses). Returns the rows. */
export async function sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<Array<Record<string, any>>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const text = translate(strings.reduce((acc, part, i) => acc + part + (i < values.length ? "?" : ""), ""));
  const params = values.map((v) => (v instanceof Date ? v.getTime() : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? Date.parse(v) : typeof v === "boolean" ? (v ? 1 : 0) : v && typeof v === "object" ? JSON.stringify(v) : v)) as Array<string | number | null>;
  const statement = local().prepare(text);
  return statement.reader ? (statement.all(...params) as Array<Record<string, unknown>>) : (statement.run(...params), []);
}

export type Variant = { id: string; productId: string; sku: string; name: string; price: number; stock: number; reserved: number };

export async function variantBySku(sku: string): Promise<Variant> {
  const rows = await sql`select id, product_id as "productId", sku, name, price, stock_quantity as stock, reserved_quantity as reserved from product_variants where sku = ${sku}`;
  if (!rows.length) throw new Error(`variant ${sku} not found`);
  return rows[0] as Variant;
}

export async function setStock(sku: string, stock: number, reserved = 0): Promise<Variant> {
  await sql`update product_variants set stock_quantity = ${stock}, reserved_quantity = ${reserved}, stock_alert_state = 'ok', status = 'active', updated_at = now() where sku = ${sku}`;
  return variantBySku(sku);
}

let cachedZone: string | null = null;
export async function zoneId(request: APIRequestContext): Promise<string> {
  if (cachedZone) return cachedZone;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await request.get(`${BASE}/api/checkout/options`).catch(() => null);
    if (res?.ok()) {
      const json = (await res.json()) as { zones: Array<{ id: string }> };
      cachedZone = json.zones[0].id;
      return cachedZone;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("could not load delivery zones");
}

/** `next dev` compiles each route on first hit; warm the ones a test is about to hammer in parallel. */
export async function warmUp(request: APIRequestContext, paths: string[] = []): Promise<void> {
  await zoneId(request);
  for (const path of ["/api/health", "/api/cart-availability", "/api/orders", ...paths]) {
    await request.fetch(`${BASE}${path}`, { method: path === "/api/health" ? "GET" : "POST", data: {}, headers: { "Idempotency-Key": "warm" }, failOnStatusCode: false }).catch(() => null);
  }
}

let ipCounter = 10;
/** Distinct client IP per call so the in-memory checkout throttle never interferes with a test. */
export const freshIp = () => `10.${(ipCounter >> 8) & 255}.${ipCounter & 255}.${(ipCounter++ % 250) + 1}`;

export type PlaceOptions = {
  items: Array<{ variantId: string; quantity: number }>;
  key?: string;
  ip?: string;
  phone?: string;
  name?: string;
  payment?: "cod" | "bank_deposit";
};

export async function placeOrder(request: APIRequestContext, opts: PlaceOptions) {
  const zone = await zoneId(request);
  const response = await request.post(`${BASE}/api/orders`, {
    headers: { "Idempotency-Key": opts.key ?? randomUUID(), "x-forwarded-for": opts.ip ?? freshIp() },
    data: {
      customerName: opts.name ?? "E2E Shopper",
      customerPhone: opts.phone ?? "+923001234567",
      city: "Karachi",
      province: "Sindh",
      address: "Test street 1",
      zoneId: zone,
      paymentMethod: opts.payment ?? "cod",
      items: opts.items,
    },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status(), body };
}

export async function orderRows(namePrefix = "E2E") {
  return sql`select id, order_number as "orderNumber", order_status as "orderStatus", payment_status as "paymentStatus" from orders where customer_name like ${namePrefix + "%"} order by created_at desc`;
}

export async function cleanOrders() {
  await sql`delete from orders where customer_name like 'E2E%'`;
  await sql`delete from order_idempotency_keys where created_at < now() - interval '0 seconds' and order_id is null`;
}

export async function adminCookie(request: APIRequestContext): Promise<void> {
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_INITIAL_PASSWORD missing from .env.local");
  const res = await request.post(`${BASE}/api/admin/login`, { data: { email: process.env.E2E_ADMIN_EMAIL, password } });
  expect(res.status(), "admin login").toBe(200);
}

export const mockFcm = {
  async reset() {
    await fetch(`${MOCK}/received`, { method: "DELETE" });
  },
  async received(): Promise<Array<{ token: string; data: Record<string, string> }>> {
    const res = await fetch(`${MOCK}/received`);
    return ((await res.json()) as { received: Array<{ token: string; data: Record<string, string> }> }).received;
  },
  async tokenRequests(): Promise<number> {
    const res = await fetch(`${MOCK}/received`);
    return ((await res.json()) as { tokenRequests: number }).tokenRequests;
  },
  /** Polls until `predicate` matches (pushes are sent in the background after the response). */
  async waitFor(predicate: (m: { token: string; data: Record<string, string> }) => boolean, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = (await this.received()).find(predicate);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`no matching push within ${timeoutMs}ms; received: ${JSON.stringify(await this.received())}`);
  },
};

export const fakeToken = (label: string) => `${label}-${randomUUID()}${"x".repeat(24)}`;

export async function createSale(opts: { name: string; type?: "percent" | "fixed"; value: number; startsInMinutes?: number; endsInMinutes?: number; productIds?: string[]; all?: boolean; notified?: boolean }) {
  const startsAt = new Date(Date.now() + (opts.startsInMinutes ?? -5) * 60_000).toISOString();
  const endsAt = new Date(Date.now() + (opts.endsInMinutes ?? 60) * 60_000).toISOString();
  const rows = await sql`insert into flash_sales (name, discount_type, discount_value, starts_at, ends_at, active, applies_to_all, start_notified_at)
    values (${opts.name}, ${opts.type ?? "percent"}, ${opts.value}, ${startsAt}, ${endsAt}, true, ${opts.all ?? false}, ${opts.notified ? new Date().toISOString() : null}) returning id`;
  const id = (rows[0] as { id: string }).id;
  for (const productId of opts.productIds ?? []) await sql`insert into flash_sale_products (sale_id, product_id) values (${id}, ${productId})`;
  return id;
}

export async function clearSales() {
  await sql`delete from flash_sales`;
}

export async function clearPushDevices() {
  await sql`delete from customer_push_devices`;
  await sql`delete from admin_push_devices`;
}

export const MOCK_TCS = process.env.E2E_MOCK_TCS ?? "http://127.0.0.1:4011";
export const mockTcs = {
  async reset() {
    await fetch(`${MOCK_TCS}/__state`, { method: "DELETE" });
  },
  async state(): Promise<{ bookings: Array<{ cn: string; referenceno: string; codamount: number; pieces: number; cityname: string; mobile: string; cancelled: boolean }>; log: string[] }> {
    return (await fetch(`${MOCK_TCS}/__state`)).json();
  },
  async setStatus(cn: string, status: string) {
    await fetch(`${MOCK_TCS}/__status`, { method: "POST", body: JSON.stringify({ cn, status }) });
  },
};

export async function orderIdOf(orderNumber: string): Promise<string> {
  const [row] = (await sql`select id from orders where order_number = ${orderNumber}`) as Array<{ id: string }>;
  return row.id;
}

/** Bank transfer is OFF by default (cash on delivery only). The few tests about bank transfer switch it on for their own run. */
export async function setBankDeposit(on: boolean): Promise<void> {
  await sql`update site_settings set bank_deposit_enabled = ${on} where id = 'store'`;
}
