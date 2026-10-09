import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  BASE,
  CRON_SECRET,
  adminCookie,
  cleanOrders,
  clearPushDevices,
  clearSales,
  createSale,
  fakeToken,
  mockFcm,
  placeOrder,
  setStock,
  sql,
  variantBySku,
  warmUp,
  setBankDeposit,
} from "../support/helpers";

const SKU = "NA-TE-SAS-M";
const PHONE = "+923001234567";

async function registerAdminDevice(request: APIRequestContext, token = fakeToken("admin")) {
  await adminCookie(request);
  const res = await request.post(`${BASE}/api/admin/push`, { data: { token } });
  expect(res.status()).toBe(201);
  expect((await res.json()).ready, "server can send (service account configured)").toBe(true);
  return token;
}

async function orderId(orderNumber: string): Promise<string> {
  const [row] = (await sql`select id from orders where order_number = ${orderNumber}`) as Array<{ id: string }>;
  return row.id;
}

async function setStatus(request: APIRequestContext, orderNumber: string, toStatus: string) {
  const id = await orderId(orderNumber);
  // Cancelling has its own endpoint (and rules) – everything else is a plain forward step.
  if (toStatus === "cancelled") return request.post(`${BASE}/api/admin/orders/${id}/cancel`, { data: { reason: "customer_asked" } });
  return request.post(`${BASE}/api/admin/orders/${id}/status`, { data: { toStatus } });
}

test.beforeAll(async ({ request }) => {
  await setBankDeposit(true);
  await warmUp(request, ["/api/push/customer", "/api/admin/push", "/api/cron/sales"]);
});
test.beforeEach(async () => {
  await cleanOrders();
  await clearPushDevices();
  await clearSales();
  await mockFcm.reset();
});
test.afterAll(async () => {
  await setBankDeposit(false);
  await cleanOrders();
  await clearPushDevices();
  await clearSales();
});

test.describe("admin alerts", () => {
  test("a new order pushes to the registered admin device (via a signed service-account token)", async ({ request }) => {
    const token = await registerAdminDevice(request);
    const variant = await setStock(SKU, 20);
    const placed = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], name: "E2E Ayesha" });
    expect(placed.status).toBe(201);

    const push = await mockFcm.waitFor((m) => m.token === token && m.data.title.startsWith("New order"));
    expect(push.data.title).toContain(String(placed.body.orderNumber));
    expect(push.data.body).toContain("E2E Ayesha");
    expect(push.data.url).toBe("/admin/orders");
    expect(await mockFcm.tokenRequests(), "OAuth token fetched once and the JWT verified by the mock").toBeGreaterThanOrEqual(1);
  });

  test("an absurdly long customer name is refused at checkout and can never poison push delivery", async ({ request }) => {
    const token = await registerAdminDevice(request);
    const variant = await setStock(SKU, 20);
    const refused = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], name: "E2E " + "A".repeat(5000) });
    expect(refused.status).toBe(400);

    const longButLegal = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], name: "E2E " + "B".repeat(115) });
    expect(longButLegal.status).toBe(201);
    const push = await mockFcm.waitFor((m) => m.token === token && m.data.title.startsWith("New order"));
    expect(Buffer.byteLength(JSON.stringify(push.data))).toBeLessThan(4096);
    expect((await sql`select count(*)::int as n from admin_push_devices`)[0].n, "device kept").toBe(1);
  });

  test("dead tokens are pruned, but a payload error never deletes working devices", async ({ request }) => {
    const good = await registerAdminDevice(request);
    await adminCookie(request);
    await request.post(`${BASE}/api/admin/push`, { data: { token: fakeToken("dead") } });
    await request.post(`${BASE}/api/admin/push`, { data: { token: fakeToken("badarg") } });
    expect((await sql`select count(*)::int as n from admin_push_devices`)[0].n).toBe(3);

    const variant = await setStock(SKU, 20);
    await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], name: "E2E Prune" });
    await mockFcm.waitFor((m) => m.token === good);
    await expect
      .poll(async () => ((await sql`select token from admin_push_devices`) as Array<{ token: string }>).map((r) => r.token.split("-")[0]).sort(), { timeout: 10_000 })
      .toEqual(["admin", "badarg"]); // "dead" removed; "badarg" (INVALID_ARGUMENT) kept
  });

  test("low-stock then out-of-stock alerts fire once each, and re-arm after a restock", async ({ request }) => {
    const token = await registerAdminDevice(request);
    const variant = await setStock(SKU, 5); // default alert threshold: 3

    const a = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], name: "E2E A" }); // 4 left
    expect(a.status).toBe(201);
    await mockFcm.waitFor((m) => m.token === token && m.data.title.startsWith("New order"));
    expect((await mockFcm.received()).filter((m) => m.data.title === "Low stock")).toHaveLength(0);

    const b = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], name: "E2E B" }); // 3 left → low
    expect(b.status).toBe(201);
    const low = await mockFcm.waitFor((m) => m.data.title === "Low stock");
    expect(low.data.body).toMatch(/only 3 left/);

    const c = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], name: "E2E C" }); // 2 left → still "low": no repeat
    expect(c.status).toBe(201);
    const d = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 2 }], name: "E2E D" }); // 0 left → out
    expect(d.status).toBe(201);
    await mockFcm.waitFor((m) => m.data.title === "Out of stock");

    const all = await mockFcm.received();
    expect(all.filter((m) => m.data.title === "Low stock"), "low-stock alert is not repeated").toHaveLength(1);
    expect(all.filter((m) => m.data.title === "Out of stock")).toHaveLength(1);

    // A sold-out attempt must not create noise either.
    expect((await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], name: "E2E E" })).status).toBe(409);
    expect((await mockFcm.received()).filter((m) => m.data.title === "Out of stock")).toHaveLength(1);

    // Cancel D → stock back, state re-arms silently…
    expect((await setStatus(request, String(d.body.orderNumber), "cancelled")).status()).toBe(200);
    await expect.poll(async () => (await variantBySku(SKU)).reserved).toBe(3);
    expect((await sql`select stock_alert_state as s from product_variants where sku = ${SKU}`)[0].s).toBe("low");
    // …and cancelling A, B, C gets it back to ok; selling out again alerts again.
    for (const order of [a, b, c]) await setStatus(request, String(order.body.orderNumber), "cancelled");
    await expect.poll(async () => (await sql`select stock_alert_state as s from product_variants where sku = ${SKU}`)[0].s).toBe("ok");
    await mockFcm.reset();
    await placeOrder(request, { items: [{ variantId: variant.id, quantity: 5 }], name: "E2E F" });
    await mockFcm.waitFor((m) => m.data.title === "Out of stock");
  });
});

test.describe("customer order updates", () => {
  test("only the real phone number can subscribe a device to an order", async ({ request }) => {
    const variant = await setStock(SKU, 20);
    const placed = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], phone: PHONE });
    const orderNumber = String(placed.body.orderNumber);
    const token = fakeToken("cust");

    const wrong = await request.post(`${BASE}/api/push/customer`, { data: { token, orderNumber, phone: "+923009999999" } });
    expect(wrong.status()).toBe(403);
    const missing = await request.post(`${BASE}/api/push/customer`, { data: { token, orderNumber: "NA-000000-000000", phone: PHONE } });
    expect(missing.status()).toBe(403);
    const ok = await request.post(`${BASE}/api/push/customer`, { data: { token, orderNumber, phone: "0300 1234567" } });
    expect(ok.status(), "same number in a different format still matches").toBe(201);
  });

  test("confirmed → on its way → delivered reaches the customer's device exactly once each", async ({ request }) => {
    const variant = await setStock(SKU, 20);
    const placed = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], phone: PHONE });
    const orderNumber = String(placed.body.orderNumber);
    const token = fakeToken("cust");
    expect((await request.post(`${BASE}/api/push/customer`, { data: { token, orderNumber, phone: PHONE } })).status()).toBe(201);
    await adminCookie(request);
    await mockFcm.reset();

    for (const [status, title] of [
      ["confirmed", "Order confirmed"],
      ["processing", null],
      ["packed", null],
      ["shipped", "Your order is on its way"],
      ["delivered", "Order delivered"],
    ] as const) {
      const res = await setStatus(request, orderNumber, status);
      expect(res.status(), status).toBe(200);
      if (title) {
        const push = await mockFcm.waitFor((m) => m.token === token && m.data.title === title);
        expect(push.data.body).toContain(orderNumber);
        expect(push.data.url).toContain("/track-order?order=");
      }
    }
    const sent = (await sql`select event from order_events_sent where order_id = ${await orderId(orderNumber)} order by event`) as Array<{ event: string }>;
    expect(sent.map((r) => r.event)).toEqual(["confirmed", "delivered", "shipped"]);
    const customerPushes = (await mockFcm.received()).filter((m) => m.token === token);
    expect(customerPushes).toHaveLength(3);
    // delivering converts the reservation into a real stock reduction
    const after = await variantBySku(SKU);
    expect([after.stock, after.reserved]).toEqual([19, 0]);
  });

  test("cancellation notifies the customer; an unrelated device hears nothing", async ({ request }) => {
    const variant = await setStock(SKU, 20);
    const placed = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 2 }], phone: PHONE });
    const orderNumber = String(placed.body.orderNumber);
    const mine = fakeToken("cust");
    const stranger = fakeToken("other");
    await request.post(`${BASE}/api/push/customer`, { data: { token: mine, orderNumber, phone: PHONE } });
    await request.post(`${BASE}/api/push/customer`, { data: { token: stranger, salesOptIn: true } });
    await adminCookie(request);
    await mockFcm.reset();

    expect((await setStatus(request, orderNumber, "cancelled")).status()).toBe(200);
    const push = await mockFcm.waitFor((m) => m.token === mine && m.data.title === "Order cancelled");
    expect(push.data.body).toContain("cancelled");
    expect((await mockFcm.received()).filter((m) => m.token === stranger)).toHaveLength(0);
    expect((await variantBySku(SKU)).reserved).toBe(0);
  });

  test("bank deposit: receipt upload alerts the owner, approval tells the customer 'payment received'", async ({ request }) => {
    const adminToken = await registerAdminDevice(request);
    const variant = await setStock(SKU, 20);
    const placed = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], phone: PHONE, payment: "bank_deposit" });
    expect(placed.status).toBe(201);
    const orderNumber = String(placed.body.orderNumber);
    const token = fakeToken("cust");
    await request.post(`${BASE}/api/push/customer`, { data: { token, orderNumber, phone: PHONE } });

    // a real (tiny) PNG receipt
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==", "base64");
    const upload = await request.post(`${BASE}/api/orders/payment-proof`, {
      multipart: { orderId: String(placed.body.orderId), file: { name: "receipt.png", mimeType: "image/png", buffer: png } },
    });
    expect(upload.status()).toBe(201);
    const alert = await mockFcm.waitFor((m) => m.token === adminToken && m.data.title === "Payment proof received");
    expect(alert.data.body).toContain(orderNumber);

    await adminCookie(request);
    const [proof] = (await sql`select id from payment_proofs where order_id = ${String(placed.body.orderId)}`) as Array<{ id: string }>;
    const approve = await request.patch(`${BASE}/api/admin/payment-proofs/${proof.id}`, { data: { status: "approved" } });
    expect(approve.status()).toBe(200);
    const paid = await mockFcm.waitFor((m) => m.token === token && m.data.title === "Payment received");
    expect(paid.data.body).toContain(orderNumber);
    expect((await sql`select payment_status as s from orders where order_number = ${orderNumber}`)[0].s).toBe("paid");

    // approving again (double click) must not announce twice
    await request.patch(`${BASE}/api/admin/payment-proofs/${proof.id}`, { data: { status: "approved" } });
    await new Promise((r) => setTimeout(r, 1500));
    expect((await mockFcm.received()).filter((m) => m.token === token && m.data.title === "Payment received")).toHaveLength(1);
  });

  test("the private payment-proof bucket is not readable anonymously, only via a short-lived signed link", async ({ request }) => {
    const variant = await setStock(SKU, 20);
    const placed = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }], payment: "bank_deposit" });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==", "base64");
    await request.post(`${BASE}/api/orders/payment-proof`, { multipart: { orderId: String(placed.body.orderId), file: { name: "r.png", mimeType: "image/png", buffer: png } } });
    const [proof] = (await sql`select id, r2_key as key from payment_proofs where order_id = ${String(placed.body.orderId)}`) as Array<{ id: string; key: string }>;

    const endpoint = process.env.E2E_S3_ENDPOINT;
    const direct = await fetch(`${endpoint}/nure-asmir-private/${proof.key}`);
    expect(direct.status, "anonymous read of the private bucket").toBe(403);

    await adminCookie(request);
    const signed = (await (await request.get(`${BASE}/api/admin/payment-proofs/${proof.id}`)).json()) as { url: string };
    expect((await fetch(signed.url)).status).toBe(200);
  });
});

test.describe("flash sales & wishlist alerts", () => {
  test("a live sale lowers the price everywhere the server decides it; a past or future sale does not", async ({ request }) => {
    const variant = await setStock(SKU, 20);
    const list = variant.price;

    await createSale({ name: "Live", value: 20, productIds: [variant.productId] });
    const avail = await request.post(`${BASE}/api/cart-availability`, { data: { variantIds: [variant.id] } });
    expect(((await avail.json()) as { availability: Array<{ price: number }> }).availability[0].price).toBe(Math.round(list * 0.8));

    const placed = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 2 }] });
    expect(placed.status).toBe(201);
    const [item] = (await sql`select unit_price as p, line_total as t from order_items where order_id = ${String(placed.body.orderId)}`) as Array<{ p: number; t: number }>;
    expect(item.p).toBe(Math.round(list * 0.8));
    expect(item.t).toBe(Math.round(list * 0.8) * 2);

    await clearSales();
    await createSale({ name: "Ended", value: 50, startsInMinutes: -120, endsInMinutes: -60, productIds: [variant.productId] });
    await createSale({ name: "Tomorrow", value: 50, startsInMinutes: 60 * 24, endsInMinutes: 60 * 25, productIds: [variant.productId] });
    const later = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }] });
    const [laterItem] = (await sql`select unit_price as p from order_items where order_id = ${String(later.body.orderId)}`) as Array<{ p: number }>;
    expect(laterItem.p, "expired / not-yet-started sales must not discount").toBe(list);
  });

  test("a sale that ends between 'add to bag' and 'place order' is priced at the moment of purchase", async ({ request }) => {
    const variant = await setStock(SKU, 20);
    const saleId = await createSale({ name: "Short", value: 30, productIds: [variant.productId] });
    const seen = ((await (await request.post(`${BASE}/api/cart-availability`, { data: { variantIds: [variant.id] } })).json()) as { availability: Array<{ price: number }> }).availability[0].price;
    expect(seen).toBeLessThan(variant.price);
    // (JS clock, not the database's: the app compares against its own time)
    await sql`update flash_sales set ends_at = ${new Date(Date.now() - 60_000).toISOString()} where id = ${saleId}`;
    const placed = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }] });
    const [item] = (await sql`select unit_price as p from order_items where order_id = ${String(placed.body.orderId)}`) as Array<{ p: number }>;
    expect(item.p).toBe(variant.price);
  });

  test("when a sale goes live: wishlist devices and sale-alert devices are told, once, and others are not", async ({ request }) => {
    const variant = await setStock(SKU, 20);
    const saved = fakeToken("wish");
    const optIn = fakeToken("optin");
    const bystander = fakeToken("none");
    const orderOnly = fakeToken("orderonly");
    await request.post(`${BASE}/api/push/customer`, { data: { token: saved, wishlist: [variant.productId], salesOptIn: true } });
    await request.post(`${BASE}/api/push/customer`, { data: { token: optIn, salesOptIn: true } });
    await request.post(`${BASE}/api/push/customer`, { data: { token: bystander } });
    // has the product on a wishlist, but never asked for sale alerts (only for updates about an order): must not be told
    await request.post(`${BASE}/api/push/customer`, { data: { token: orderOnly, wishlist: [variant.productId] } });

    await createSale({ name: "Weekend flash sale", value: 25, productIds: [variant.productId] });
    const run = async () => (await request.get(`${BASE}/api/cron/sales`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } })).json();
    expect((await run()).announced).toBe(1);

    const wishPush = await mockFcm.waitFor((m) => m.token === saved);
    expect(wishPush.data.title).toBe("Your wishlist is on sale");
    expect(wishPush.data.body).toContain("25% off");
    const optPush = await mockFcm.waitFor((m) => m.token === optIn);
    expect(optPush.data.title).toBe("Weekend flash sale");
    expect((await mockFcm.received()).filter((m) => m.token === bystander)).toHaveLength(0);
    expect((await mockFcm.received()).filter((m) => m.token === orderOnly)).toHaveLength(0);

    await mockFcm.reset();
    expect((await run()).announced, "second run must not announce again").toBe(0);
    await new Promise((r) => setTimeout(r, 500));
    expect(await mockFcm.received()).toHaveLength(0);
  });

  test("a wishlist item not in the sale does not trigger a wishlist alert", async ({ request }) => {
    const variant = await setStock(SKU, 20);
    const [other] = (await sql`select id from products where id <> ${variant.productId} limit 1`) as Array<{ id: string }>;
    const token = fakeToken("wish");
    await request.post(`${BASE}/api/push/customer`, { data: { token, wishlist: [other.id], salesOptIn: true } });
    await createSale({ name: "Narrow", value: 10, productIds: [variant.productId] });
    await request.get(`${BASE}/api/cron/sales`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    await new Promise((r) => setTimeout(r, 800));
    // the device did ask for sale alerts, so it hears about the sale itself, but never "your wishlist is on sale" (that item is not in it)
    expect((await mockFcm.received()).filter((m) => m.token === token && m.data.title === "Your wishlist is on sale")).toHaveLength(0);
  });

  test("admin flash-sale API validates input", async ({ request }) => {
    await adminCookie(request);
    const base = { name: "X", discountType: "percent", discountValue: 20, startsAt: new Date(Date.now() + 60_000).toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString(), appliesToAll: true };
    expect((await request.post(`${BASE}/api/admin/flash-sales`, { data: { ...base, discountValue: 95 } })).status(), "percent > 90").toBe(400);
    expect((await request.post(`${BASE}/api/admin/flash-sales`, { data: { ...base, endsAt: base.startsAt } })).status(), "ends before start").toBe(400);
    expect((await request.post(`${BASE}/api/admin/flash-sales`, { data: { ...base, appliesToAll: false, productIds: [] } })).status(), "no products").toBe(400);
    const good = await request.post(`${BASE}/api/admin/flash-sales`, { data: base });
    expect(good.status()).toBe(201);
    const id = (await good.json()).sale.id as string;
    expect((await request.delete(`${BASE}/api/admin/flash-sales/${id}`)).status()).toBe(200);
    expect(randomUUID()).toBeTruthy();
  });
});
