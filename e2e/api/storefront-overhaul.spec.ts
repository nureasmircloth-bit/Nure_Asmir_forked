import { expect, test } from "@playwright/test";
import { BASE, adminCookie, cleanOrders, freshIp, placeOrder, setBankDeposit, setStock, sql, warmUp, zoneId } from "../support/helpers";

const SKU = "NA-TE-SAS-M";
const reset = async () => {
  await sql`update site_settings set delivery_mode = 'zones', flat_delivery_charge = 250, free_delivery_threshold = 10000, bank_deposit_enabled = false, announcement_mode = 'auto', announcement_lines = '' where id = 'store'`;
};

test.beforeAll(async ({ request }) => {
  await warmUp(request, ["/api/checkout/options", "/api/catalog/page", "/api/catalog/facets", "/api/geo/country", "/api/geo/reverse", "/faq"]);
  await reset();
});
test.afterAll(async () => {
  await reset();
  await cleanOrders();
  await sql`delete from faqs where question like 'E2E %'`;
  await sql`delete from products where name like 'E2E Fil %'`;
  await sql`delete from categories where slug = 'e2e-filters'`;
});

test.describe("payment: cash on delivery only until the owner switches bank transfer on", () => {
  test("a bank-transfer order is refused while it is off – even if someone sends it by hand", async ({ request }) => {
    const variant = await setStock(SKU, 20);
    const refused = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], payment: "bank_deposit" });
    expect(refused.status).toBe(400);
    expect(String(refused.body.error)).toMatch(/cash on delivery/i);
    const ok = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], payment: "cod" });
    expect(ok.status).toBe(201);
  });
  test("unknown payment methods are refused", async ({ request }) => {
    const variant = await setStock(SKU, 20);
    const zone = await zoneId(request);
    for (const method of ["card", "COD", "", 5, null]) {
      const res = await request.post(`${BASE}/api/orders`, {
        headers: { "Idempotency-Key": crypto.randomUUID(), "x-forwarded-for": freshIp() },
        data: { customerName: "E2E Shopper", customerPhone: "+923001234567", city: "Karachi", province: "Sindh", address: "Test street 1", zoneId: zone, paymentMethod: method, items: [{ variantId: variant.id, quantity: 1 }] },
      });
      expect(res.status(), String(method)).toBe(400);
    }
  });
  test("once switched on, bank transfer works; switched off again, it is refused again", async ({ request }) => {
    const variant = await setStock(SKU, 20);
    await setBankDeposit(true);
    expect((await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], payment: "bank_deposit" })).status).toBe(201);
    await setBankDeposit(false);
    expect((await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], payment: "bank_deposit" })).status).toBe(400);
  });
  test("the checkout page is told bank transfer is off and is not given the bank details", async ({ request }) => {
    await sql`update site_settings set bank_name = 'E2E Bank', bank_account_number = '123456' where id = 'store'`;
    const off = (await (await request.get(`${BASE}/api/checkout/options`)).json()) as { settings: Record<string, unknown>; zones: Array<{ cities?: string[]; provinces?: string[] }> };
    expect(off.settings.bankDepositEnabled).toBe(false);
    expect(off.settings.bankAccountNumber).toBe("");
    expect(JSON.stringify(off)).not.toContain("E2E Bank");
    expect(off.zones.length).toBeGreaterThan(0);
    expect(Array.isArray(off.zones[0].cities)).toBe(true);
    await setBankDeposit(true);
    const on = (await (await request.get(`${BASE}/api/checkout/options`)).json()) as { settings: Record<string, unknown> };
    expect(on.settings.bankAccountNumber).toBe("123456");
    await setBankDeposit(false);
    await sql`update site_settings set bank_name = '', bank_account_number = '' where id = 'store'`;
  });
});

test.describe("delivery charge is decided on the server by the owner's rule", () => {
  test.describe.configure({ timeout: 240_000 }); // each order is a dozen database round trips
  async function chargeFor(request: import("@playwright/test").APIRequestContext, quantity: number) {
    const variant = await setStock(SKU, 50);
    const placed = await placeOrder(request, { items: [{ variantId: variant.id, quantity }] });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    return { charge: Number(placed.body.deliveryCharge), subtotal: variant.price * quantity, total: Number(placed.body.total) };
  }
  test("zones: the area's price below the free amount, free at or above it", async ({ request }) => {
    await sql`update site_settings set delivery_mode = 'zones', free_delivery_threshold = 10000 where id = 'store'`;
    const [{ charge: zoneCharge }] = (await sql`select delivery_charge as charge from delivery_zones where id = ${await zoneId(request)}`) as Array<{ charge: number }>;
    const small = await chargeFor(request, 1);
    if (small.subtotal < 10000) expect(small.charge).toBe(zoneCharge);
    await sql`update site_settings set free_delivery_threshold = ${small.subtotal} where id = 'store'`;
    expect((await chargeFor(request, 1)).charge, "exactly at the free amount").toBe(0);
    await sql`update site_settings set free_delivery_threshold = ${small.subtotal + 1} where id = 'store'`;
    expect((await chargeFor(request, 1)).charge, "one rupee below").toBe(zoneCharge);
  });
  test("a free-delivery amount of 0 switches free delivery OFF (it used to make everything free)", async ({ request }) => {
    await sql`update site_settings set delivery_mode = 'zones', free_delivery_threshold = 0 where id = 'store'`;
    const [{ charge: zoneCharge }] = (await sql`select delivery_charge as charge from delivery_zones where id = ${await zoneId(request)}`) as Array<{ charge: number }>;
    expect((await chargeFor(request, 5)).charge).toBe(zoneCharge);
  });
  test("flat: one price whatever the area; the total adds up", async ({ request }) => {
    await sql`update site_settings set delivery_mode = 'flat', flat_delivery_charge = 175, free_delivery_threshold = 1000000 where id = 'store'`;
    const order = await chargeFor(request, 1);
    expect(order.charge).toBe(175);
    expect(order.total).toBe(order.subtotal + 175);
  });
  test("tcs mode falls back to the area price while no TCS tariff exists, so an order is never blocked", async ({ request }) => {
    await sql`update site_settings set delivery_mode = 'tcs', free_delivery_threshold = 1000000 where id = 'store'`;
    const [{ charge: zoneCharge }] = (await sql`select delivery_charge as charge from delivery_zones where id = ${await zoneId(request)}`) as Array<{ charge: number }>;
    expect((await chargeFor(request, 1)).charge).toBe(zoneCharge);
  });
  test("an unknown mode in the database behaves like 'zones'", async ({ request }) => {
    await sql`update site_settings set delivery_mode = 'something-odd', free_delivery_threshold = 1000000 where id = 'store'`;
    const [{ charge: zoneCharge }] = (await sql`select delivery_charge as charge from delivery_zones where id = ${await zoneId(request)}`) as Array<{ charge: number }>;
    expect((await chargeFor(request, 1)).charge).toBe(zoneCharge);
    await reset();
  });
});

test.describe("delivery pin from GPS or the map", () => {
  test.describe.configure({ timeout: 240_000 }); // each order is a dozen database round trips
  async function place(request: import("@playwright/test").APIRequestContext, extra: Record<string, unknown>) {
    const variant = await setStock(SKU, 30);
    const res = await request.post(`${BASE}/api/orders`, {
      headers: { "Idempotency-Key": crypto.randomUUID(), "x-forwarded-for": freshIp() },
      data: { customerName: "E2E Pin", customerPhone: "+923001234567", city: "Lahore", province: "Punjab", address: "Gulberg", zoneId: await zoneId(request), paymentMethod: "cod", items: [{ variantId: variant.id, quantity: 1 }], ...extra },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { orderNumber: string };
    return ((await sql`select delivery_latitude as lat, delivery_longitude as lon from orders where order_number = ${body.orderNumber}`) as Array<{ lat: number | null; lon: number | null }>)[0];
  }
  test("a pin inside Pakistan is saved; outside, partial or junk pins are quietly ignored", async ({ request }) => {
    expect(await place(request, { latitude: 31.520412, longitude: 74.358712 })).toEqual({ lat: 31.520412, lon: 74.358712 });
    expect(await place(request, { latitude: 51.5, longitude: -0.12 })).toEqual({ lat: null, lon: null });
    expect(await place(request, { latitude: 31.5 })).toEqual({ lat: null, lon: null });
    expect(await place(request, { latitude: "abc", longitude: "def" })).toEqual({ lat: null, lon: null });
    expect(await place(request, { latitude: null, longitude: null })).toEqual({ lat: null, lon: null });
    expect(await place(request, {})).toEqual({ lat: null, lon: null });
  });
});

test.describe("admin settings for the top bar, delivery and payment", () => {
  test.describe.configure({ timeout: 240_000 }); // each order is a dozen database round trips
  test("need a signed-in admin", async ({ playwright }) => {
    const anonymous = await playwright.request.newContext();
    expect((await anonymous.patch(`${BASE}/api/admin/settings`, { data: { deliveryMode: "flat" } })).status()).toBe(401);
    expect((await anonymous.get(`${BASE}/api/admin/faqs`)).status()).toBe(401);
    expect((await anonymous.post(`${BASE}/api/admin/faqs`, { data: { question: "x", answer: "y" } })).status()).toBe(401);
    await anonymous.dispose();
  });
  test("valid values are saved; invalid ones are refused and change nothing", async ({ request }) => {
    await adminCookie(request);
    const ok = await request.patch(`${BASE}/api/admin/settings`, { data: { announcementMode: "custom", announcementLines: "  Eid sale   is live \n\n Free gift\n", deliveryMode: "flat", flatDeliveryCharge: 199, bankDepositEnabled: true } });
    expect(ok.status()).toBe(200);
    const [row] = (await sql`select announcement_mode as mode, announcement_lines as lines, delivery_mode as dm, flat_delivery_charge as flat, bank_deposit_enabled as bank from site_settings where id = 'store'`) as Array<Record<string, unknown>>;
    expect(row).toEqual({ mode: "custom", lines: "Eid sale is live\nFree gift", dm: "flat", flat: 199, bank: 1 });
    for (const bad of [{ announcementMode: "loud" }, { deliveryMode: "drone" }, { flatDeliveryCharge: -5 }, { flatDeliveryCharge: 99999999 }, { bankDepositEnabled: "yes" }, { announcementLines: "x".repeat(2000) }]) {
      expect((await request.patch(`${BASE}/api/admin/settings`, { data: bad })).status(), JSON.stringify(bad).slice(0, 40)).toBe(400);
    }
    const [after] = (await sql`select delivery_mode as dm, flat_delivery_charge as flat from site_settings where id = 'store'`) as Array<Record<string, unknown>>;
    expect(after).toEqual({ dm: "flat", flat: 199 });
    await reset();
  });
  test("the top bar on the website follows the chosen mode", async ({ request }) => {
    await adminCookie(request);
    await request.patch(`${BASE}/api/admin/settings`, { data: { announcementMode: "auto", announcementLines: "E2E weekly drop", freeDeliveryThreshold: 10000 } });
    let html = await (await request.get(`${BASE}/shop`)).text();
    expect(html).toContain("Cash on delivery available all over Pakistan");
    expect(html).toContain("Free delivery on orders above Rs. 10,000");
    expect(html).toContain("E2E weekly drop");
    await request.patch(`${BASE}/api/admin/settings`, { data: { announcementMode: "custom", announcementLines: "E2E only my line" } });
    html = await (await request.get(`${BASE}/shop`)).text();
    expect(html).toContain("E2E only my line");
    expect(html).not.toContain("Free delivery on orders above");
    await request.patch(`${BASE}/api/admin/settings`, { data: { announcementMode: "off" } });
    html = await (await request.get(`${BASE}/shop`)).text();
    expect(html).not.toContain('class="announcement"');
    await reset();
  });
});

test.describe("FAQ editor", () => {
  test.describe.configure({ timeout: 240_000 }); // each order is a dozen database round trips
  test("add, edit, hide, reorder and delete – and the website follows, with live numbers in the answers", async ({ request }) => {
    await adminCookie(request);
    await sql`delete from faqs where question like 'E2E %'`;
    const make = async (question: string, answer: string) => ((await (await request.post(`${BASE}/api/admin/faqs`, { data: { question, answer } })).json()) as { faq: { id: string } }).faq.id;
    const a = await make("E2E First question?", "We hold orders for {{codHours}} hours and deliver free above Rs. {{ freeAbove }}.");
    const b = await make("E2E Second question?", "Second answer.");
    let html = await (await request.get(`${BASE}/faq`)).text();
    expect(html).toContain("E2E First question?");
    expect(html).toMatch(/hold orders for \d+ hours and deliver free above Rs\. 10,000/);
    expect(html).not.toContain("{{");
    expect(html.indexOf("E2E First question?")).toBeLessThan(html.indexOf("E2E Second question?"));

    expect((await request.post(`${BASE}/api/admin/faqs/reorder`, { data: { ids: [b, a] } })).status()).toBe(200);
    html = await (await request.get(`${BASE}/faq`)).text();
    expect(html.indexOf("E2E Second question?")).toBeLessThan(html.indexOf("E2E First question?"));

    expect((await request.patch(`${BASE}/api/admin/faqs/${a}`, { data: { active: false } })).status()).toBe(200);
    html = await (await request.get(`${BASE}/faq`)).text();
    expect(html).not.toContain("E2E First question?");
    expect((await request.patch(`${BASE}/api/admin/faqs/${b}`, { data: { answer: "Changed answer." } })).status()).toBe(200);
    expect(await (await request.get(`${BASE}/faq`)).text()).toContain("Changed answer.");

    expect((await request.delete(`${BASE}/api/admin/faqs/${a}`)).status()).toBe(200);
    expect((await request.delete(`${BASE}/api/admin/faqs/${a}`)).status(), "already gone").toBe(404);
    expect((await request.delete(`${BASE}/api/admin/faqs/${b}`)).status()).toBe(200);
  });
  test("bad input is refused: empty or oversized text, a bad id, unknown ids in a reorder", async ({ request }) => {
    await adminCookie(request);
    expect((await request.post(`${BASE}/api/admin/faqs`, { data: { question: "", answer: "x" } })).status()).toBe(400);
    expect((await request.post(`${BASE}/api/admin/faqs`, { data: { question: "ok?", answer: "" } })).status()).toBe(400);
    expect((await request.post(`${BASE}/api/admin/faqs`, { data: { question: "q".repeat(500), answer: "fine" } })).status()).toBe(400);
    expect((await request.patch(`${BASE}/api/admin/faqs/not-an-id`, { data: { active: false } })).status()).toBe(404);
    expect((await request.patch(`${BASE}/api/admin/faqs/${crypto.randomUUID()}`, { data: { active: false } })).status()).toBe(404);
    expect((await request.post(`${BASE}/api/admin/faqs/reorder`, { data: { ids: ["nope"] } })).status()).toBe(400);
    expect((await request.post(`${BASE}/api/admin/faqs/reorder`, { data: { ids: [crypto.randomUUID()] } })).status(), "unknown ids are skipped").toBe(200);
  });
  test("the starting questions are there and none of them promises bank deposit", async ({ request }) => {
    const html = await (await request.get(`${BASE}/faq`)).text();
    expect(html).toContain("Do you offer cash on delivery?");
    expect(html.toLowerCase()).not.toContain("bank deposit");
  });
});

test.describe("shop filters and what the filter panel offers", () => {
  type Card = { id: string; name: string; price: number };
  type Page = { products: Card[]; total: number };
  test.beforeAll(async () => {
    await sql`delete from products where name like 'E2E Fil %'`;
    await sql`delete from categories where slug = 'e2e-filters'`;
    const [cat] = (await sql`insert into categories (name, slug) values ('E2E Filters', 'e2e-filters') returning id`) as Array<{ id: string }>;
    const make = async (name: string, variants: Array<[string, string, number, number]>) => {
      const [p] = (await sql`insert into products (category_id, name, slug, type_label, status, published_at) values (${cat.id}, ${name}, ${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}, 'Shirt', 'published', now()) returning id`) as Array<{ id: string }>;
      let first = true;
      for (const [size, color, price, stock] of variants) {
        await sql`insert into product_variants (product_id, name, sku, color, size, price, stock_quantity, is_default) values (${p.id}, ${`${color} / ${size}`}, ${`E2EFIL-${name.slice(-1)}-${color}-${size}`.toUpperCase().replace(/\s/g, "")}, ${color}, ${size}, ${price}, ${stock}, ${first})`;
        first = false;
      }
    };
    await make("E2E Fil A", [["M", "Olive", 3000, 5], ["L", "Olive", 3500, 0], ["M", "Navy", 8000, 2]]);
    await make("E2E Fil B", [["One size", "Black", 12000, 1]]);
    await make("E2E Fil C", [["S", "olive", 2000, 0]]);
  });
  const get = async (request: import("@playwright/test").APIRequestContext, query: string) => (await (await request.get(`${BASE}/api/catalog/page?cat=e2e-filters&${query}`)).json()) as Page;
  const names = (page: Page) => page.products.map((p) => p.name).sort();

  test("no filters: everything in the category", async ({ request }) => {
    const all = await get(request, "");
    expect(names(all)).toEqual(["E2E Fil A", "E2E Fil B", "E2E Fil C"]);
    expect(all.total).toBe(3);
  });
  test("price range uses any size's price; either end alone works; a reversed range is put right", async ({ request }) => {
    expect(names(await get(request, "min=11000"))).toEqual(["E2E Fil B"]);
    expect(names(await get(request, "max=2500"))).toEqual(["E2E Fil C"]);
    expect(names(await get(request, "min=3200&max=9000"))).toEqual(["E2E Fil A"]);
    expect(names(await get(request, "min=9000&max=3200"))).toEqual(["E2E Fil A"]);
    expect(names(await get(request, "min=500000"))).toEqual([]);
  });
  test("size and colour are matched together on the same variant, ignoring capital letters", async ({ request }) => {
    expect(names(await get(request, "sizes=M"))).toEqual(["E2E Fil A"]);
    expect(names(await get(request, "colors=OLIVE"))).toEqual(["E2E Fil A", "E2E Fil C"]);
    expect(names(await get(request, "sizes=L&colors=Navy")), "no Navy in L").toEqual([]);
    expect(names(await get(request, "sizes=M&colors=Navy"))).toEqual(["E2E Fil A"]);
    expect(names(await get(request, "sizes=S,One%20size"))).toEqual(["E2E Fil B", "E2E Fil C"]);
  });
  test("in-stock only drops products with nothing left in the chosen size/colour", async ({ request }) => {
    expect(names(await get(request, "stock=1"))).toEqual(["E2E Fil A", "E2E Fil B"]);
    expect(names(await get(request, "colors=Olive&stock=1"))).toEqual(["E2E Fil A"]);
    expect(names(await get(request, "sizes=L&stock=1")), "L Olive has 0").toEqual([]);
  });
  test("the total always matches the filtered list, paging included", async ({ request }) => {
    const page = await get(request, "colors=Olive&sort=low");
    expect(page.total).toBe(page.products.length);
    expect(page.products.map((p) => p.price)).toEqual([...page.products.map((p) => p.price)].sort((x, y) => x - y));
    const beyond = await get(request, "colors=Olive&page=9");
    expect(beyond.products).toEqual([]);
    expect(beyond.total).toBe(2);
  });
  test("junk and attack-shaped input is harmless", async ({ request }) => {
    for (const query of ["sizes=%27%3B%20drop%20table%20products%3B--", "colors=%00%00", "min=abc&max=NaN", "sizes=" + "a,".repeat(500), "stock=%3Cscript%3E", "cat=%27--&min=1"]) {
      const res = await request.get(`${BASE}/api/catalog/page?cat=e2e-filters&${query}`);
      expect(res.status(), query.slice(0, 40)).toBe(200);
      expect(Array.isArray(((await res.json()) as Page).products)).toBe(true);
    }
    expect(await sql`select 1 from products where name = 'E2E Fil A'`).toHaveLength(1);
  });
  test("the filter panel is offered only what exists: price range, sizes in shopper order, colours (one per spelling)", async ({ request }) => {
    const facets = (await (await request.get(`${BASE}/api/catalog/facets?cat=e2e-filters`)).json()) as { price: { min: number; max: number }; sizes: Array<{ value: string; count: number }>; colors: Array<{ value: string; count: number }> };
    expect(facets.price).toEqual({ min: 2000, max: 12000 });
    expect(facets.sizes.map((s) => s.value)).toEqual(["S", "M", "L", "One size"]);
    expect(facets.colors.map((c) => c.value.toLowerCase()).sort()).toEqual(["black", "navy", "olive"]);
    expect(facets.colors.find((c) => c.value.toLowerCase() === "olive")?.count, "Olive is on two products").toBe(2);
    const everything = (await (await request.get(`${BASE}/api/catalog/facets`)).json()) as { price: { min: number } };
    expect(everything.price.min).toBeGreaterThan(0);
    const empty = (await (await request.get(`${BASE}/api/catalog/facets?cat=no-such-category`)).json()) as { price: { min: number; max: number }; sizes: unknown[] };
    expect(empty.price).toEqual({ min: 0, max: 0 });
    expect(empty.sizes).toEqual([]);
  });
});

test.describe("location services", () => {
  test("country comes from Cloudflare's header; junk or 'unknown' gives no country", async ({ request }) => {
    const ask = async (header?: string) => ((await (await request.get(`${BASE}/api/geo/country`, { headers: header === undefined ? {} : { "cf-ipcountry": header } })).json()) as { country: string | null }).country;
    expect(await ask("AE")).toBe("AE");
    expect(await ask("pk")).toBe("PK");
    expect(await ask("XX")).toBeNull();
    expect(await ask("T1")).toBeNull();
    expect(await ask("Pakistan")).toBeNull();
    expect(await ask("")).toBeNull();
    expect(await ask()).toBeNull();
  });
  test("reverse lookup refuses places outside Pakistan and bad coordinates without asking the map service", async ({ request }) => {
    for (const query of ["lat=51.5&lon=-0.12", "lat=0&lon=0", "lat=abc&lon=def", "", "lat=31.5", "lat=999&lon=999"]) {
      const res = await request.get(`${BASE}/api/geo/reverse?${query}`);
      expect(res.status(), query).toBe(400);
      expect(((await res.json()) as { outside?: boolean }).outside).toBe(true);
    }
  });
  test("a real Pakistani point is answered (with an address when the map service is reachable)", async ({ request }) => {
    const res = await request.get(`${BASE}/api/geo/reverse?lat=31.5204&lon=74.3587`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { result?: { city: string; province: string | null }; unavailable?: boolean };
    if (!body.unavailable) expect(body.result?.city.length).toBeGreaterThan(0);
  });
  test("map tiles: only real tile addresses are served; the key never reaches the browser", async ({ request }) => {
    for (const path of ["4/1/1", "19/1/1", "10/9999/5", "10/-1/5", "x/y/z", "10/1/1.5"]) {
      expect((await request.get(`${BASE}/api/geo/tiles/${path}`)).status(), path).toBe(404);
    }
    const tile = await request.get(`${BASE}/api/geo/tiles/12/2915/1668`);
    expect([200, 404, 502]).toContain(tile.status());
    if (tile.status() === 200) {
      expect(tile.headers()["content-type"]).toContain("image/png");
      expect(tile.headers()["cache-control"]).toContain("immutable");
    }
    expect(tile.url()).not.toContain("apiKey");
  });
});
