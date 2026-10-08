import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { BASE, cleanOrders, clearSales, mockTcs, orderIdOf, placeOrder, setStock, sql, variantBySku, warmUp } from "../support/helpers";
import { makePng, watchErrors } from "../support/ui";
import { hashPassword } from "../../lib/auth/password";

/** Small screens: the admin is laptop-only, so every phone/tablet project must see the friendly notice instead. */
test.describe("laptop-only gate", () => {
  test("on a phone or tablet the admin shows 'please use a laptop' and no controls", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 1280) >= 1024, "desktop profiles are covered below");
    await page.goto("/admin/login");
    await expect(page.getByRole("heading", { name: /open this on a laptop or computer/i })).toBeVisible();
    await expect(page.getByLabel("Password")).toBeHidden();
  });

  test("shrinking a desktop window below 1024px switches to the notice, widening brings the panel back", async ({ page, viewport, browserName, isMobile }) => {
    test.skip(browserName !== "chromium" || isMobile || (viewport?.width ?? 0) < 1024, "one desktop browser is enough");
    await page.goto("/admin/login");
    await expect(page.getByLabel("Password")).toBeVisible();
    await page.setViewportSize({ width: 820, height: 900 });
    await expect(page.getByRole("heading", { name: /open this on a laptop/i })).toBeVisible();
    await expect(page.getByLabel("Password")).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByLabel("Password")).toBeVisible();
  });
});

test.describe("admin (desktop Chromium)", () => {
  test.skip(({ browserName, isMobile, viewport }) => browserName !== "chromium" || isMobile || (viewport?.width ?? 0) < 1000, "admin UI is exercised on desktop Chromium");

  async function login(page: Page) {
    await page.goto("/admin/login");
    await page.waitForLoadState("networkidle"); // let React hydrate before submitting
    await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
  }
  const toast = (page: Page) => page.locator(".a-toast");

  test.beforeAll(async ({ request }) => {
    await warmUp(request, ["/api/admin/login", "/admin/login"]);
  });
  test.beforeEach(async () => {
    // The login rate limiter (5 failures / 15 min / email) is doing its job – reset it between tests.
    await sql`delete from login_attempts`;
    await mockTcs.reset();
  });
  test.afterAll(async () => {
    await clearSales();
    await cleanOrders();
    await sql`delete from products where name like 'E2E %'`;
    await sql`delete from categories where name like 'E2E %'`;
    await sql`delete from store_locations where name like 'E2E %'`;
    await sql`delete from site_images`;
    await sql`update site_settings set support_phone = '+923116111963' where id = 'store'`;
  });

  test.describe("sign-in", () => {
    test("wrong password is refused, the right one opens the home screen", async ({ page }) => {
      await page.goto("/admin/login");
      await page.waitForLoadState("networkidle");
      await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
      await page.getByLabel("Password").fill("definitely-wrong-password");
      await page.getByRole("button", { name: /sign in/i }).click();
      await expect(page.getByRole("alert").filter({ hasText: /not correct|invalid|incorrect|wrong/i }).first()).toBeVisible({ timeout: 15_000 });
      await expect(page).toHaveURL(/\/admin\/login/);

      await login(page);
      await expect(page.getByRole("heading", { name: /good (morning|afternoon|evening)/i })).toBeVisible();
      await expect(page.locator(".adm-nav").getByRole("link", { name: /Orders/ })).toBeVisible();
    });

    test("protected pages redirect to the login form, and the return address cannot leave the admin", async ({ page }) => {
      for (const p of ["/admin", "/admin/orders", "/admin/products", "/admin/flash-sales", "/admin/refunds", "/admin/stock", "/admin/pictures", "/admin/settings", "/admin/products/bulk"]) {
        await page.goto(p);
        await expect(page).toHaveURL(/\/admin\/login/);
      }
      await page.goto("/admin/login?returnTo=//evil.example/steal");
      await page.waitForLoadState("networkidle");
      await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
      await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
      await page.getByRole("button", { name: /sign in/i }).click();
      await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
    });
  });

  test("every screen opens without errors", async ({ page }) => {
    const errors = watchErrors(page);
    await login(page);
    const screens: Array<[string, RegExp]> = [
      ["Orders", /Orders/],
      ["Refunds", /Refunds/],
      ["Products", /Products/],
      ["Stock", /Stock/],
      ["Categories", /Categories/],
      ["Flash sales", /Flash sales/],
      ["Discount codes", /Discount codes/],
      ["Email list", /Email list/],
      ["Website pictures", /Website pictures/],
      ["Delivery charges", /Delivery charges/],
      ["Settings", /Settings/],
    ];
    for (const [label, heading] of screens) {
      await page.locator(".adm-nav").getByRole("link", { name: label }).first().click();
      await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(heading, { timeout: 20_000 });
      await page.waitForLoadState("networkidle").catch(() => undefined);
    }
    for (const extra of ["/admin/products/new", "/admin/products/bulk", "/admin/orders/new", "/admin/campaign"]) {
      await page.goto(extra);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /alerts/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("comfort controls: night colours and bigger text are remembered", async ({ page }) => {
    await login(page);
    const root = page.locator(".adm");
    await expect(root).toHaveAttribute("data-text", "normal");
    await page.getByRole("button", { name: /colours/i }).click(); // light → night (auto → light first)
    const theme = await root.getAttribute("data-theme");
    expect(["light", "night", "auto"]).toContain(theme);
    while ((await root.getAttribute("data-theme")) !== "night") await page.getByRole("button", { name: /colours/i }).click();
    await page.getByRole("button", { name: /make the text bigger/i }).click();
    await expect(root).toHaveAttribute("data-text", "large");
    await page.reload();
    await expect(root).toHaveAttribute("data-theme", "night");
    await expect(root).toHaveAttribute("data-text", "large");
    await page.getByRole("button", { name: /text is large/i }).click();
    while ((await root.getAttribute("data-theme")) !== "light") await page.getByRole("button", { name: /colours/i }).click();
  });

  test("Ctrl+K finds an order by its number and opens it", async ({ page, request }) => {
    const v = await setStock("NA-TE-SAS-M", 20);
    const placed = await placeOrder(request, { items: [{ variantId: v.id, quantity: 1 }], name: "E2E Palette" });
    await login(page);
    await page.keyboard.press("Control+k");
    const box = page.getByRole("dialog", { name: "Search" }).getByRole("textbox");
    await expect(box).toBeVisible();
    await box.fill(String(placed.body.orderNumber));
    await page.getByRole("dialog", { name: "Search" }).getByRole("link", { name: new RegExp(String(placed.body.orderNumber)) }).first().click();
    await expect(page).toHaveURL(/\/admin\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(String(placed.body.orderNumber));
  });

  test.describe("orders", () => {
    test("the order list shows a new order under 'Needs you'; Confirm is one click, locked while working, and moves it on", async ({ page, request }) => {
      await cleanOrders();
      const v = await setStock("NA-TE-SAS-M", 20);
      const placed = await placeOrder(request, { items: [{ variantId: v.id, quantity: 2 }], name: "E2E Desk" });
      const number = String(placed.body.orderNumber);
      await login(page);
      await page.goto("/admin/orders");
      const row = page.locator("tbody tr", { hasText: number });
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(row).toContainText("New");
      await expect(row).toContainText("2 items");

      let hits = 0;
      await page.route("**/api/admin/orders/*/status", async (route) => {
        hits += 1;
        await new Promise((r) => setTimeout(r, 700));
        await route.continue();
      });
      const confirm = row.getByRole("button", { name: "Confirm" });
      await confirm.dblclick();
      await expect(row.getByRole("button", { name: /please wait/i })).toBeDisabled();
      await expect(toast(page).first()).toContainText(/confirmed/i, { timeout: 15_000 });
      expect(hits, "double click sends one request").toBe(1);
      const [saved] = (await sql`select order_status as s from orders where order_number = ${number}`) as Array<{ s: string }>;
      expect(saved.s).toBe("confirmed");
      await page.unroute("**/api/admin/orders/*/status");
    });

    test("order page: next step, copy/WhatsApp helpers, TCS booking, then cancelling is refused once TCS collects", async ({ page, request }) => {
      await cleanOrders();
      const v = await setStock("NA-TE-SAS-M", 20);
      const placed = await placeOrder(request, { items: [{ variantId: v.id, quantity: 1 }], name: "E2E Flow" });
      const number = String(placed.body.orderNumber);
      const id = await orderIdOf(number);
      await login(page);
      await page.goto(`/admin/orders/${id}`);
      await expect(page.getByText("Confirm this order with the customer")).toBeVisible();
      await expect(page.getByRole("link", { name: /WhatsApp the customer/ })).toHaveAttribute("href", /wa\.me\/923001234567/);
      await page.getByRole("button", { name: "Confirm order" }).click();
      await expect(page.getByText("Pack it and send it with TCS")).toBeVisible({ timeout: 15_000 });

      await page.getByRole("button", { name: "Book with TCS" }).click();
      const dialog = page.getByRole("dialog", { name: /book this parcel/i });
      await expect(dialog.getByLabel("Customer mobile")).toHaveValue("+923001234567");
      await dialog.getByLabel("Customer mobile").fill("03001234567");
      await dialog.getByRole("button", { name: "Book parcel" }).click();
      await expect(page.getByText("Waiting for TCS to collect it")).toBeVisible({ timeout: 20_000 });
      const [{ cn }] = (await sql`select courier_tracking_number as cn from orders where id = ${id}`) as Array<{ cn: string }>;
      expect(cn).toMatch(/^\d{12}$/);
      await expect(page.getByText(cn).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancel this order" })).toBeVisible();

      // TCS collects the parcel → cancelling disappears
      await mockTcs.setStatus(cn, "Shipment Picked Up");
      await page.getByRole("button", { name: "Check TCS now" }).click();
      await expect(page.getByText("On its way to the customer")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Cancel this order" })).toHaveCount(0);
      await expect(page.getByText(/TCS already has this parcel/i)).toBeVisible();
    });

    test("cancelling asks why, then releases the stock", async ({ page, request }) => {
      await cleanOrders();
      const v = await setStock("NA-TE-SAS-M", 20);
      const placed = await placeOrder(request, { items: [{ variantId: v.id, quantity: 3 }], name: "E2E Cancel" });
      const id = await orderIdOf(String(placed.body.orderNumber));
      expect((await variantBySku("NA-TE-SAS-M")).reserved).toBe(3);
      await login(page);
      await page.goto(`/admin/orders/${id}`);
      await page.getByRole("button", { name: "Cancel this order" }).click();
      const dialog = page.getByRole("dialog", { name: /cancel order/i });
      await dialog.getByLabel("Why are you cancelling?").selectOption("out_of_stock");
      await dialog.getByRole("button", { name: /yes, cancel the order/i }).dblclick();
      await expect(page.getByText("This order was cancelled", { exact: true })).toBeVisible({ timeout: 20_000 });
      expect((await variantBySku("NA-TE-SAS-M")).reserved).toBe(0);
    });

    test("a packing slip prints with the cash to collect", async ({ page, request }) => {
      await cleanOrders();
      const v = await setStock("NA-TE-SAS-M", 20);
      const placed = await placeOrder(request, { items: [{ variantId: v.id, quantity: 1 }], name: "E2E Slip" });
      const id = await orderIdOf(String(placed.body.orderNumber));
      await login(page);
      await page.goto(`/admin/orders/${id}/slip`);
      await expect(page.getByText(/Cash to collect: PKR/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Print slip" })).toBeVisible();
    });

    test("New order (phone order): search a product, place it, land on the order page", async ({ page }) => {
      await cleanOrders();
      await setStock("NA-TE-SAS-M", 20);
      await login(page);
      await page.goto("/admin/orders/new");
      await page.getByLabel("Customer name").fill("E2E Phone Customer");
      await page.getByLabel("Mobile number").fill("03211234567");
      await page.getByLabel("City").fill("Lahore");
      await page.getByLabel("Full address").fill("House 1, Street 2, Model Town");
      await page.getByLabel(/Search for a product/).fill("sashiko");
      await page.getByRole("button", { name: /Ivory Sashiko Tee/ }).first().click();
      await expect(page.getByText(/1 in stock|in stock/).first()).toBeVisible();
      let posts = 0;
      await page.route("**/api/admin/orders/place", async (route) => {
        posts += 1;
        await new Promise((r) => setTimeout(r, 600));
        await route.continue();
      });
      await page.getByRole("button", { name: "Place order" }).dblclick();
      await expect(page).toHaveURL(/\/admin\/orders\/[0-9a-f-]{36}$/, { timeout: 25_000 });
      expect(posts).toBe(1);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(/NA-/);
    });
  });

  test.describe("refunds screen", () => {
    test("owner approves and completes a refund request in the browser", async ({ page, request }) => {
      await cleanOrders();
      const v = await setStock("NA-TE-SAS-M", 20);
      const placed = await placeOrder(request, { items: [{ variantId: v.id, quantity: 1 }], name: "E2E Refund UI" });
      const id = await orderIdOf(String(placed.body.orderNumber));
      await sql`update orders set order_status = 'delivered', payment_status = 'paid' where id = ${id}`;
      await sql`insert into order_status_history (order_id, from_status, to_status, actor_email) values (${id}, 'shipped', 'delivered', 'system')`;
      await sql`insert into refund_requests (order_id, source, reason, details, amount, payout_method, payout_account, payout_title) values (${id}, 'customer', 'wrong_size', 'Too small', 5500, 'easypaisa', '03451234567', 'Test Person')`;

      await login(page);
      await expect(page.locator(".adm-nav").getByRole("link", { name: /Refunds/ }).locator(".count")).toHaveText("1");
      await page.goto("/admin/refunds");
      const card = page.locator("article", { hasText: String(placed.body.orderNumber) });
      await expect(card).toContainText("The size does not fit");
      await expect(card).toContainText("03451234567");
      await card.getByRole("button", { name: "Approve refund" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
      await expect(card.getByRole("button", { name: "Mark as refunded" })).toBeVisible({ timeout: 15_000 });
      await card.getByRole("button", { name: "Mark as refunded" }).click();
      await page.getByRole("dialog").getByLabel(/Payment reference/).fill("EP-1234");
      await page.getByRole("dialog").getByRole("button", { name: "Mark as refunded" }).click();
      await page.getByRole("link", { name: /^Refunded/ }).click();
      await expect(page.locator("article", { hasText: "EP-1234" })).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe("products", () => {
    test("add a product with sizes, price, stock and a photo — one page, one Save", async ({ page }) => {
      await sql`delete from products where name like 'E2E %'`;
      await login(page);
      await page.goto("/admin/products/new");
      await page.getByLabel("Product name").fill("E2E Linen Shirt");
      await page.getByLabel("What is it?").fill("Shirt");
      await page.getByLabel("Colour", { exact: true }).fill("Sand");
      await page.locator('input[type="file"]').first().setInputFiles({ name: "front.png", mimeType: "image/png", buffer: makePng() });
      await expect(page.locator(".a-photo .main-tag")).toBeVisible();
      await page.getByRole("button", { name: "S M L XL XXL" }).click();
      await expect(page.getByLabel("Size", { exact: true })).toHaveCount(5);
      const prices = page.getByLabel("Price", { exact: true });
      await prices.first().fill("4500");
      await page.getByRole("button", { name: "Use the first price for every size" }).click();
      await page.getByLabel("In stock", { exact: true }).first().fill("8");

      let creates = 0;
      await page.route("**/api/admin/products", async (route) => {
        if (route.request().method() === "POST") creates += 1;
        await route.continue();
      });
      await page.getByRole("button", { name: "Add product" }).dblclick();
      await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      expect(creates).toBe(1);

      const [product] = (await sql`select id, status, primary_colour as colour from products where name = 'E2E Linen Shirt'`) as Array<{ id: string; status: string; colour: string }>;
      expect(product).toMatchObject({ status: "published", colour: "Sand" });
      const variants = (await sql`select size, price, stock_quantity as stock, sku from product_variants where product_id = ${product.id} order by size`) as Array<{ size: string; price: number; stock: number; sku: string }>;
      expect(variants.map((v) => v.size).sort()).toEqual(["L", "M", "S", "XL", "XXL"]);
      expect(new Set(variants.map((v) => v.price))).toEqual(new Set([4500]));
      expect(new Set(variants.map((v) => v.sku)).size, "every size has its own product code").toBe(5);
      const [{ n }] = (await sql`select count(*)::int as n from product_images where product_id = ${product.id}`) as Array<{ n: number }>;
      expect(n).toBe(1);

      // and the customer can see it
      const shop = await page.request.get(`${BASE}/shop`);
      expect(await shop.text()).toContain("E2E Linen Shirt");
    });

    test("editing: change a price and hide the product; mistakes are explained before anything is saved", async ({ page }) => {
      await login(page);
      const [product] = (await sql`select id from products where name = 'E2E Linen Shirt'`) as Array<{ id: string }>;
      await page.goto(`/admin/products/${product.id}`);
      await page.getByLabel("Product name").fill("E2E Linen Shirt");
      await page.getByLabel("Old price", { exact: true }).first().fill("100");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText(/old price must be higher than the selling price/i)).toBeVisible();
      await page.getByLabel("Old price", { exact: true }).first().fill("6000");
      await page.getByLabel("Price", { exact: true }).first().fill("4200");
      await page.getByText("Hidden for now").click();
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(toast(page).first()).toContainText("Saved", { timeout: 30_000 });
      const [row] = (await sql`select p.status, v.price, v.compare_at_price as old from products p join product_variants v on v.product_id = p.id where p.id = ${product.id} order by v.created_at limit 1`) as Array<{ status: string; price: number; old: number }>;
      expect(row).toMatchObject({ status: "draft", price: 4200, old: 6000 });
    });

    test("stock screen: change a number, Save appears only for that row, and sold-out shows", async ({ page }) => {
      await login(page);
      await page.goto("/admin/stock?q=E2E%20Linen");
      // one list row per product (searching opens it); its sizes are the editable rows inside
      await expect(page.locator(".a-stock > tbody")).toHaveCount(1);
      const rows = page.locator(".a-stock-sizes tbody tr");
      await expect(rows).toHaveCount(5);
      const first = rows.first();
      await expect(first.getByRole("button", { name: "Save" })).toHaveCount(0);
      await first.getByLabel(/^Stock for/).fill("7");
      await expect(first.getByRole("button", { name: "Save" })).toBeVisible();
      await expect(rows.nth(1).getByRole("button", { name: "Save" })).toHaveCount(0);
      await first.getByRole("button", { name: "Save" }).click();
      await expect(toast(page).first()).toContainText(/saved/i, { timeout: 15_000 });
      // the row reloads with the saved numbers (its Save button goes away) before we edit it again
      await expect(first.getByRole("button", { name: "Save" })).toHaveCount(0, { timeout: 15_000 });
      await expect(first.getByLabel(/^Stock for/)).toHaveValue("7");
      await first.getByLabel(/^Stock for/).fill("0");
      await first.getByRole("button", { name: "Save" }).click();
      await expect(first).toContainText("Sold out", { timeout: 15_000 });
    });

    test("same shirt in another colour: sizes and prices are copied, photos stay with their colour, the shop shows both", async ({ page }) => {
      await sql`delete from products where name = 'E2E Denim Shirt'`;
      await login(page);
      await page.goto("/admin/products/new");
      await page.getByLabel("Product name").fill("E2E Denim Shirt");
      await page.getByLabel("What is it?").fill("Shirt");
      await page.getByLabel("Colour", { exact: true }).fill("Indigo");
      await page.locator('input[type="file"]').first().setInputFiles({ name: "indigo.png", mimeType: "image/png", buffer: makePng() });
      await page.getByRole("button", { name: "S M L XL XXL" }).click();
      await page.getByLabel("Price", { exact: true }).first().fill("3900");
      await page.getByRole("button", { name: "Use the first price for every size" }).click();
      await page.getByLabel("In stock", { exact: true }).first().fill("5");

      // the second colour starts from the first one's sizes and prices, with no stock
      await page.getByRole("button", { name: "Add another colour" }).click();
      await page.getByLabel("New colour").fill("Charcoal");
      await page.getByRole("button", { name: "Add colour", exact: true }).click();
      await expect(page.getByLabel("Size", { exact: true })).toHaveCount(5);
      await expect(page.getByLabel("Price", { exact: true }).first()).toHaveValue("3900");
      await expect(page.getByLabel("In stock", { exact: true }).first()).toHaveValue("0");
      await expect(page.getByLabel("Colour", { exact: true })).toHaveValue("Charcoal");
      await page.locator('input[type="file"]').first().setInputFiles({ name: "charcoal.png", mimeType: "image/png", buffer: makePng() });
      await expect(page.locator(".a-photo")).toHaveCount(1); // only this colour's photos are shown
      await page.getByLabel("In stock", { exact: true }).first().fill("4");

      await page.getByRole("button", { name: "Add product" }).click();
      await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/, { timeout: 60_000 });

      const [product] = (await sql`select id, slug from products where name = 'E2E Denim Shirt'`) as Array<{ id: string; slug: string }>;
      const variants = (await sql`select color, sku, stock_quantity as stock from product_variants where product_id = ${product.id}`) as Array<{ color: string; sku: string; stock: number }>;
      expect(variants).toHaveLength(10);
      expect(new Set(variants.map((v) => v.color))).toEqual(new Set(["Indigo", "Charcoal"]));
      expect(new Set(variants.map((v) => v.sku)).size, "every size of every colour has its own code").toBe(10);
      const photos = (await sql`select i.is_primary as main, v.color from product_images i left join product_variants v on v.id = i.variant_id where i.product_id = ${product.id}`) as Array<{ main: boolean; color: string | null }>;
      expect(photos.map((p) => p.color).sort(), "each photo is linked to its colour").toEqual(["Charcoal", "Indigo"]);
      expect(photos.filter((p) => p.main)).toHaveLength(1);

      // reopening shows both colours with their own data
      await page.reload();
      await expect(page.getByRole("button", { name: /^Indigo/ })).toBeVisible();
      await page.getByRole("button", { name: /^Charcoal/ }).click();
      await expect(page.getByLabel("In stock", { exact: true }).first()).toHaveValue("4");
      await expect(page.locator(".a-photo")).toHaveCount(1);

      // the customer sees both colours on one product page
      const page1 = await page.request.get(`${BASE}/products/${product.slug}`);
      const html = await page1.text();
      expect(html).toContain("Indigo");
      expect(html).toContain("Charcoal");

      // stock: one line for the product with the total, sizes per colour inside
      await page.goto("/admin/stock?q=E2E%20Denim");
      await expect(page.locator(".a-stock > tbody")).toHaveCount(1);
      await expect(page.locator(".a-stock > tbody").first()).toContainText("E2E Denim Shirt");
      await expect(page.locator(".a-stock > tbody > tr").first().locator("td").nth(1)).toHaveText("2");
      await expect(page.locator(".a-stock > tbody > tr").first().locator("td").nth(2)).toHaveText("9");
      await expect(page.getByRole("region", { name: "Indigo sizes" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Charcoal sizes" })).toBeVisible();
    });

    test("preview: the unsaved draft shows as a phone page and a laptop page, colours and sizes can be tapped", async ({ page }) => {
      await login(page);
      await page.goto("/admin/products/new");
      await page.getByLabel("Product name").fill("E2E Preview Kurta");
      await page.getByLabel("Colour", { exact: true }).fill("Ivory");
      await page.getByRole("button", { name: "S M L XL XXL" }).click();
      await page.getByLabel("Price", { exact: true }).first().fill("6500");
      await page.getByRole("button", { name: "Add another colour" }).click();
      await page.getByLabel("New colour").fill("Black");
      await page.getByRole("button", { name: "Add colour", exact: true }).click();
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: /preview/i });
      await expect(dialog.getByRole("heading", { name: "E2E Preview Kurta" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Ivory" })).toBeVisible();
      await dialog.getByRole("button", { name: "Black" }).click();
      await expect(dialog.getByText("Colour: Black")).toBeVisible();
      await dialog.getByRole("button", { name: "Laptop" }).click();
      await expect(dialog.getByRole("button", { name: "Laptop" })).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      expect((await sql`select 1 from products where name = 'E2E Preview Kurta'`).length, "previewing never saves").toBe(0);
    });

    test("shop locations: add one, it is listed, the main shop cannot be removed", async ({ page }) => {
      await sql`delete from store_locations where name like 'E2E %'`;
      await login(page);
      await page.goto("/admin/locations");
      await expect(page.getByText("Main shop").first()).toBeVisible();
      await page.getByRole("button", { name: "Add a shop" }).click();
      await page.getByLabel("Shop name").fill("E2E Gulberg Outlet");
      await page.getByLabel("Full address").fill("12 Main Boulevard, Gulberg III");
      await page.getByLabel("City").fill("Lahore");
      await page.getByRole("button", { name: "Save shop" }).click();
      await expect(page.getByText("E2E Gulberg Outlet")).toBeVisible({ timeout: 15_000 });
      const rows = (await sql`select name, is_main as main from store_locations order by sort_order`) as Array<{ name: string; main: boolean }>;
      expect(rows.filter((r) => r.main)).toHaveLength(1);
      const mains = await page.request.get(`${BASE}/api/admin/locations`);
      const [main] = ((await mains.json()) as { locations: Array<{ id: string; isMain: boolean }> }).locations.filter((l) => l.isMain);
      const refused = await page.request.delete(`${BASE}/api/admin/locations/${main.id}`);
      expect(refused.status()).toBe(409);
    });

    test("pictures: JPG, PNG, WebP, AVIF and GIF all become five sharp, small WebP sizes that the shop serves", async ({ page }) => {
      await sql`delete from products where name = 'E2E Formats Kurta'`;
      await login(page);
      await page.goto("/admin/products/new");
      await page.getByLabel("Product name").fill("E2E Formats Kurta");
      await page.getByLabel("What is it?").fill("Kurta");
      await page.getByLabel("Colour", { exact: true }).fill("Ivory");
      await page.getByRole("button", { name: "One size only" }).click();
      await page.getByLabel("Price", { exact: true }).first().fill("4900");

      // Make large pictures in the browser itself (a gradient with fine detail, 2400 px wide) in each of the five formats.
      const files = await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 2400;
        canvas.height = 3200;
        const ctx = canvas.getContext("2d")!;
        const gradient = ctx.createLinearGradient(0, 0, 2400, 3200);
        gradient.addColorStop(0, "#c9b79c");
        gradient.addColorStop(1, "#3b2f2f");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 2400, 3200);
        for (let i = 0; i < 400; i++) {
          ctx.fillStyle = `rgba(${(i * 7) % 255},${(i * 13) % 255},${(i * 29) % 255},.35)`;
          ctx.fillRect((i * 97) % 2300, (i * 193) % 3100, 120, 18);
        }
        const toBase64 = async (type: string, quality?: number) => {
          const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
          if (!blob || blob.type !== type) return null; // this browser cannot write that format
          const buffer = new Uint8Array(await blob.arrayBuffer());
          let binary = "";
          for (const byte of buffer) binary += String.fromCharCode(byte);
          return { type, data: btoa(binary) };
        };
        return [await toBase64("image/jpeg", 0.95), await toBase64("image/png"), await toBase64("image/webp", 0.95), await toBase64("image/avif"), await toBase64("image/gif")];
      });
      const usable = files.filter((file): file is { type: string; data: string } => Boolean(file));
      expect(usable.length, "the browser can write at least JPG, PNG and WebP").toBeGreaterThanOrEqual(3);
      const names = usable.map((file) => ({ name: `shot.${file.type.split("/")[1]}`, mimeType: file.type, buffer: Buffer.from(file.data, "base64") }));
      await page.locator('input[type="file"]').first().setInputFiles(names);
      await expect(page.locator(".a-photo")).toHaveCount(names.length);
      await page.getByRole("button", { name: "Add product" }).click();
      await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/, { timeout: 90_000 });

      const rows = (await sql`select i.r2_key as key, i.variant_widths as widths, i.content_type as type, i.byte_size as bytes, i.width from product_images i join products p on p.id = i.product_id where p.name = 'E2E Formats Kurta'`) as Array<{ key: string; widths: number[]; type: string; bytes: number; width: number }>;
      expect(rows).toHaveLength(names.length);
      for (const row of rows) {
        expect(row.type).toBe("image/webp");
        expect(row.widths, "five sizes for a large picture").toEqual([320, 640, 960, 1280, 1600]);
        expect(row.bytes, "the stored picture is far smaller than the 2400 px original").toBeLessThan(400 * 1024);
        const largest = await page.request.get(`${BASE}/cdn/${row.key.replace(/\.[^.]+$/, "")}-w1600.webp`);
        expect(largest.status()).toBe(200);
        expect(largest.headers()["content-type"]).toContain("image/webp");
        expect(largest.headers()["cache-control"]).toContain("immutable");
        const small = await page.request.get(`${BASE}/cdn/${row.key.replace(/\.[^.]+$/, "")}-w320.webp`);
        expect(Number(small.headers()["content-length"] ?? (await small.body()).length)).toBeLessThan(largest.headers()["content-length"] ? Number(largest.headers()["content-length"]) : Infinity);
      }
    });

    test("training: every lesson steps through with the cursor always finding its target, and Play really types and clicks", async ({ page }) => {
      test.setTimeout(300_000); // two lessons are played in real time
      await login(page);
      await page.context().addCookies([{ name: "adm-lang", value: "en", url: BASE }]);
      await page.goto("/admin/training");
      await page.waitForLoadState("networkidle");
      const lessons = page.locator("nav[aria-label='Lessons'] button");
      const count = await lessons.count();
      expect(count).toBeGreaterThanOrEqual(10);
      const stage = page.locator(".tour-stage");
      for (let i = 0; i < count; i++) {
        await lessons.nth(i).click();
        const caption = page.locator(".tour-step");
        const total = Number(/of (\d+)/.exec((await caption.textContent()) ?? "")?.[1]);
        expect(total).toBeGreaterThanOrEqual(3);
        for (let step = 1; step <= total; step++) {
          await expect(caption).toHaveText(`Step ${step} of ${total}`);
          // allow the cursor to settle on this step's last target, then it must not be reported missing
          await page.waitForTimeout(120);
          await expect(stage, `lesson ${i + 1}, step ${step}: the cursor has nothing to point at`).not.toHaveAttribute("data-missing", /.+/);
          if (step < total) await page.getByRole("button", { name: "Next →" }).click();
        }
      }
      // Play lesson 1 at double speed: the search box gets typed into by itself and the player moves on.
      await lessons.nth(0).click();
      await page.getByRole("button", { name: "2×" }).click();
      await page.getByRole("button", { name: "▶ Play" }).click();
      await expect(stage).toContainText("0301 234", { timeout: 40_000 });
      await expect(page.getByRole("button", { name: "❚❚ Pause" })).toBeVisible();
      await page.getByRole("button", { name: "❚❚ Pause" }).click();
      // the finished lesson is remembered as watched
      await lessons.nth(0).click();
      await page.getByRole("button", { name: "2×" }).click();
      await page.getByRole("button", { name: "▶ Play" }).click();
      await expect(page.getByText(/You finished/)).toBeVisible({ timeout: 120_000 });
      await expect(lessons.nth(0)).toContainText("✓");
    });

    test("the menu can be folded away to use the whole width, it is remembered, and the lessons have a wide and a full-screen view", async ({ page }) => {
      await login(page);
      await page.context().addCookies([{ name: "adm-lang", value: "en", url: BASE }]);
      await page.goto("/admin/training");
      await page.waitForLoadState("networkidle");
      const side = page.locator(".adm-shell > .adm-side");
      await expect(side).toBeVisible();
      await page.getByRole("button", { name: "Hide the menu" }).click();
      // folded = a slim rail of icons, not a vanished menu
      await expect(page.locator(".adm-shell")).toHaveAttribute("data-side", "collapsed");
      await expect.poll(async () => (await side.boundingBox())!.width, "the menu folds to a narrow rail").toBeLessThan(100);
      await page.reload();
      await expect(page.locator(".adm-shell")).toHaveAttribute("data-side", "collapsed");
      expect((await side.boundingBox())!.width).toBeLessThan(100);

      // wide view: the lesson list steps aside and the pretend screen gets bigger
      const stage = page.locator(".tour-stage");
      const small = (await stage.boundingBox())!.height; // (only used to prove the window never grows past its real size of 760 px)
      expect(small).toBeGreaterThan(300);
      await page.getByRole("button", { name: "Wide view" }).click();
      await expect(page.locator("nav[aria-label='Lessons']")).toBeHidden();
      await expect(page.locator(".adm-shell")).toHaveAttribute("data-side", "collapsed");
      await expect.poll(async () => (await stage.boundingBox())!.height, "wide view stays large and fits the screen").toBeGreaterThan(480);
      expect((await stage.boundingBox())!.height).toBeLessThanOrEqual(small + 1 > 0 ? 760 : 760);
      await page.getByRole("button", { name: "▶ Play" }).click();
      await expect(page.locator(".tour-step")).toHaveText(/Step [2-9] of/, { timeout: 40_000 });
      await page.getByRole("button", { name: "❚❚ Pause" }).click();

      // full screen (falls back to the wide view where a browser refuses)
      await page.getByRole("button", { name: "Full screen" }).click();
      await expect.poll(async () => page.evaluate(() => Boolean(document.fullscreenElement) || document.querySelector(".tour")?.classList.contains("is-wide") === true)).toBe(true);
      await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());

      await page.getByRole("button", { name: "Show the menu" }).click();
      await expect.poll(async () => (await side.boundingBox())!.width).toBeGreaterThan(200);
      await page.evaluate(() => (document.cookie = "adm-side=open; Path=/"));
    });

    test("training: Roman Urdu by default with English one click away, a written guide, and the screens are the real admin", async ({ page }) => {
      await login(page);
      await page.goto("/admin/training");
      await page.waitForLoadState("networkidle");

      // Roman Urdu is what the owner sees first
      await expect(page.getByRole("button", { name: "Roman Urdu" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".tour-step")).toHaveText(/Qadam 1 \/ 6/);
      await expect(page.locator(".tour-caption p")).toContainText("Ye Home hai");
      await expect(page.getByRole("button", { name: "▶ Chalayein" })).toBeVisible();

      // the pretend screen is built from the real admin: the real menu, the real search box, real cards and buttons
      const frame = page.locator(".tour-frame");
      await expect(frame.locator("aside.adm-side")).toContainText("Website pictures");
      await expect(frame.locator(".adm-search-btn")).toBeVisible();
      await expect(frame.locator(".a-card").first()).toBeVisible();
      const box = (await frame.boundingBox())!;
      const real = await page.locator(".adm-side").first().boundingBox(); // the page's own menu
      expect(box.width, "shrunk to fit, never stretched").toBeLessThanOrEqual(1280);
      expect(real?.width).toBeGreaterThan(200);

      // the written guide, same lessons, same number of steps
      await page.getByRole("button", { name: "Parhein (text guide)" }).click();
      const guides = page.locator("section[id^='guide-']");
      expect(await guides.count()).toBeGreaterThanOrEqual(10);
      await expect(guides.first()).toContainText("Apna raasta jaanein");
      const urSteps = await guides.first().locator("ol li").count();

      // English is one click away, remembered, and has the same steps
      await page.getByRole("button", { name: "English", exact: true }).click();
      await expect(guides.first()).toContainText("Find your way around");
      expect(await guides.first().locator("ol li").count()).toBe(urSteps);
      const cookies = await page.context().cookies();
      expect(cookies.find((c) => c.name === "adm-lang")?.value).toBe("en");
      await page.reload();
      await expect(page.getByRole("button", { name: "English", exact: true })).toHaveAttribute("aria-pressed", "true");

      // every lesson has exactly as many Roman Urdu lines as it has steps
      await page.getByRole("button", { name: "Roman Urdu" }).click();
      await page.getByRole("button", { name: "Parhein (text guide)" }).click();
      const lessons = (await guides.count());
      for (let i = 0; i < lessons; i++) {
        const lines = await guides.nth(i).locator("ol li").count();
        await page.getByRole("button", { name: "Dekhein (video jaisa)" }).click();
        await page.locator("nav[aria-label='Lessons'] button").nth(i).click();
        await expect(page.locator(".tour-step")).toHaveText(new RegExp(`Qadam 1 / ${lines}$`));
        await page.getByRole("button", { name: "Parhein (text guide)" }).click();
      }
    });

    test("advanced settings: tucked away, and the sold-out time can be changed and set to 'forever'", async ({ page }) => {
      await sql`update site_settings set soldout_hide_days = 90 where id = 'store'`;
      await login(page);
      await page.goto("/admin/settings");
      const advanced = page.locator("details#advanced");
      await expect(advanced).not.toHaveAttribute("open", "");
      await advanced.locator("summary").click();
      await expect(advanced.getByLabel(/Hide sold-out products after/)).toHaveValue("90");
      await advanced.getByLabel(/Hide sold-out products after/).fill("0");
      await expect(advanced.getByText("Sold-out products stay on your website forever.")).toBeVisible();
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(toast(page).first()).toContainText(/saved/i, { timeout: 15_000 });
      expect(((await sql`select soldout_hide_days as d from site_settings where id = 'store'`) as Array<{ d: number }>)[0].d).toBe(0);
      await advanced.getByLabel(/Hide sold-out products after/).fill("90");
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(toast(page).last()).toContainText(/saved/i, { timeout: 15_000 });
    });

    test("developer login: sees only the technical page, owners cannot open it", async ({ page, browser }) => {
      const email = "e2e-dev@nureasmir.com";
      const password = "E2e-dev-Passw0rd-9";
      await sql`delete from admin_owners where email = ${email}`;
      await sql`insert into admin_owners (email, display_name, password_hash, role) values (${email}, 'Developer', ${await hashPassword(password)}, 'developer')`;
      // the owner gets a 404 for the developer page
      await login(page);
      await page.goto("/admin/developer");
      await expect(page.getByText(/could not be found|not found|404/i).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("heading", { name: "Services and keys" })).toHaveCount(0);
      await expect(page.getByText("Neon Storage")).toHaveCount(0);
      expect((await page.request.post(`${BASE}/api/developer/storage`)).status(), "the developer API refuses owners too").toBe(403);
      // the developer lands on it and sees only that link
      const other = await browser.newContext();
      const devPage = await other.newPage();
      await devPage.goto(`${BASE}/admin/login`);
      await devPage.waitForLoadState("networkidle");
      await devPage.getByLabel("Email").fill(email);
      await devPage.getByLabel("Password").fill(password);
      await devPage.getByRole("button", { name: /sign in/i }).click();
      await expect(devPage).toHaveURL(/\/admin\/developer$/, { timeout: 20_000 });
      await expect(devPage.getByRole("heading", { name: "Storage" })).toBeVisible();
      await expect(devPage.getByRole("heading", { name: "Services and keys" })).toBeVisible();
      await expect(devPage.getByRole("heading", { name: "Errors", exact: true })).toBeVisible();
      await expect(devPage.getByText("Neon Storage").first()).toBeVisible();
      await expect(devPage.getByText("Cloudflare R2").first()).toBeVisible();
      await expect(devPage.getByRole("link", { name: "Orders" })).toHaveCount(0);
      // secrets are never printed: no value of a configured key appears on the page
      const secret = process.env.GEOAPIFY_API_KEY;
      if (secret) expect(await devPage.content()).not.toContain(secret);
      await other.close();
      await sql`delete from admin_owners where email = ${email}`;
    });

    test("stock: category buttons show only that category, one list row per product", async ({ page }) => {
      await sql`delete from products where name = 'E2E Chino'`;
      await sql`delete from categories where name = 'E2E Trousers'`;
      const [cat] = (await sql`insert into categories (name, slug) values ('E2E Trousers', 'e2e-trousers') returning id`) as Array<{ id: string }>;
      const [prod] = (await sql`insert into products (category_id, name, slug, type_label, status) values (${cat.id}, 'E2E Chino', 'e2e-chino', 'Pants', 'published') returning id`) as Array<{ id: string }>;
      await sql`insert into product_variants (product_id, name, sku, color, size, price, stock_quantity, is_default) values (${prod.id}, 'Khaki / 32', 'E2E-CATTEST-32', 'Khaki', '32', 3000, 2, true), (${prod.id}, 'Khaki / 34', 'E2E-CATTEST-34', 'Khaki', '34', 3000, 3, false)`;
      await login(page);
      await page.goto("/admin/stock");
      await expect(page.getByRole("link", { name: /^All categories/ })).toBeVisible();
      await page.getByRole("link", { name: /^E2E Trousers/ }).click();
      await expect(page).toHaveURL(/cat=/);
      await expect(page.locator(".a-stock > tbody")).toHaveCount(1);
      await expect(page.locator(".a-stock")).toContainText("E2E Chino");
      await expect(page.locator(".a-stock")).not.toContainText("E2E Linen");
      // two sizes, one list row: the total is 5 and the sizes appear when it is opened
      await expect(page.locator(".a-stock > tbody > tr").first().locator("td").nth(2)).toHaveText("5");
      await page.getByRole("button", { name: /Sizes/ }).click();
      await expect(page.getByLabel("Stock for E2E Chino Khaki 32")).toHaveValue("2");
      await expect(page.getByLabel("Stock for E2E Chino Khaki 34")).toHaveValue("3");
    });

    test("home: changing the period updates the numbers in place — no reload, the page does not jump", async ({ page }) => {
      await login(page);
      await page.goto("/admin");
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => {
        (window as unknown as { __kept: number }).__kept = 1;
        window.scrollTo(0, 500);
      });
      const before = await page.evaluate(() => window.scrollY);
      expect(before).toBeGreaterThan(0);
      const answered = page.waitForResponse((response) => response.url().includes("/api/admin/analytics?range=90d") && response.ok());
      await page.getByRole("button", { name: "90 days" }).click();
      await answered;
      await expect(page.getByRole("button", { name: "90 days" })).toHaveAttribute("aria-pressed", "true");
      expect(await page.evaluate(() => (window as unknown as { __kept?: number }).__kept), "the page was not reloaded").toBe(1);
      expect(await page.evaluate(() => window.scrollY), "still scrolled where it was").toBeGreaterThan(0);
      await expect(page).toHaveURL(/range=90d/);
    });

    test("Excel: download the sheet, fill it in, upload it, add photos, and the products appear (and a bad row is explained)", async ({ page }) => {
      await sql`delete from products where name like 'E2E Bulk %'`;
      await login(page);
      await page.goto("/admin/products/bulk");
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: /Download the Excel sheet/ }).click();
      const download = await downloadPromise;
      const file = path.join(os.tmpdir(), `na-sheet-${Date.now()}.xlsx`);
      await download.saveAs(file);

      // fill the sheet the way an owner would
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file);
      expect(wb.worksheets.map((s) => s.name)).toEqual(["1 - How to fill", "2 - Your products", "3 - Example", "Lists"]);
      const sheet = wb.getWorksheet("2 - Your products")!;
      expect(String(sheet.getRow(1).getCell(1).value)).toBe("Product name*");
      const put = (r: number, v: Array<string | number>) => v.forEach((x, i) => (sheet.getRow(r).getCell(i + 1).value = x));
      put(2, ["E2E Bulk Polo", "Shirts", "Polo Shirt", "Navy", "M", 3800, "", 6, "", "Cotton", "A soft everyday polo.", "Yes", "polo-front.png", "New"]);
      put(3, ["E2E Bulk Polo", "Shirts", "Polo Shirt", "Navy", "L", 3800, 4500, 4, "", "", "", "Yes", "", ""]);
      put(4, ["E2E Bulk Chinos", "E2E Brand New Category", "Chinos", "Khaki", "32", 5200, "", 5, "E2E-CHINO-32", "", "", "Yes", "", ""]);
      put(5, ["E2E Bulk Broken", "Shirts", "Shirt", "Red", "M", "cheap", "", 1, "", "", "", "Yes", "", ""]);
      await wb.xlsx.writeFile(file);

      await page.locator('input[type="file"][accept*=".xlsx"]').first().setInputFiles(file);
      await expect(page.getByText(/2 products · 3 sizes ready/)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/1 problem/)).toBeVisible();
      await expect(page.locator("li", { hasText: /Row 5:/ })).toContainText(/Price .*cheap.* is not a number/);
      await expect(page.getByText("E2E Brand New Category").first()).toBeVisible();
      await page.getByRole("button", { name: /Next: add photos/ }).click();
      await page.locator('input[type="file"][accept*="image"]').setInputFiles({ name: "polo-front.png", mimeType: "image/png", buffer: makePng(600, 800, [40, 60, 120]) });
      await expect(page.getByText("1 of 1 found")).toBeVisible();
      await expect(page.getByText(/no photo.*Hidden|add them as Hidden|have no photo/i).first()).toBeVisible();
      await page.getByRole("button", { name: /Add 2 products now/ }).click();
      await expect(page.getByRole("heading", { name: "Done" })).toBeVisible({ timeout: 120_000 });
      await expect(page.getByText("E2E Bulk Polo")).toBeVisible();

      const products = (await sql`select p.name, p.status, (select count(*)::int from product_variants v where v.product_id = p.id) as sizes, (select count(*)::int from product_images i where i.product_id = p.id) as pics from products p where p.name like 'E2E Bulk %' order by p.name`) as Array<{ name: string; status: string; sizes: number; pics: number }>;
      expect(products).toEqual([
        { name: "E2E Bulk Chinos", status: "draft", sizes: 1, pics: 0 },
        { name: "E2E Bulk Polo", status: "published", sizes: 2, pics: 1 },
      ]);
      const [category] = await sql`select name from categories where name = 'E2E Brand New Category'`;
      expect(category).toBeTruthy();
      const [code] = await sql`select sku from product_variants where sku = 'E2E-CHINO-32'`;
      expect(code).toBeTruthy();
      fs.rmSync(file, { force: true });
    });

    test("Excel: change prices and stock by product code", async ({ page }) => {
      await login(page);
      await page.goto("/admin/products/bulk#update");
      await page.getByRole("link", { name: "Change prices & stock" }).click();
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: /Download prices & stock/ }).click();
      const file = path.join(os.tmpdir(), `na-stock-${Date.now()}.xlsx`);
      await (await downloadPromise).saveAs(file);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file);
      const sheet = wb.worksheets[0];
      let touched = 0;
      sheet.eachRow((row, index) => {
        if (index > 1 && String(row.getCell(3).value) === "E2E-CHINO-32") {
          row.getCell(4).value = 5400;
          row.getCell(6).value = 12;
          touched += 1;
        }
      });
      expect(touched).toBe(1);
      await wb.xlsx.writeFile(file);
      await page.locator('input[type="file"][accept=".xlsx,.csv"]').setInputFiles(file);
      await page.getByRole("button", { name: "Apply changes" }).click();
      await expect(page.getByText("E2E-CHINO-32")).toBeVisible({ timeout: 60_000 });
      const [v] = (await sql`select price, stock_quantity as stock from product_variants where sku = 'E2E-CHINO-32'`) as Array<{ price: number; stock: number }>;
      expect(v).toEqual({ price: 5400, stock: 12 });
      fs.rmSync(file, { force: true });
    });
  });

  test("Settings: contact details and social links save and show in the shop footer", async ({ page }) => {
    await login(page);
    await page.goto("/admin/settings");
    await page.getByLabel("Phone number").fill("+92 311 6111963");
    await page.getByLabel("TikTok page").fill("tiktok.com/@nure.asmir");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(toast(page).first()).toContainText("Settings saved", { timeout: 20_000 });
    await expect(page.getByLabel("TikTok page")).toHaveValue("https://tiktok.com/@nure.asmir");
    const shop = await (await page.request.get(`${BASE}/about`)).text();
    for (const host of ["facebook.com", "instagram.com", "tiktok.com", "wa.me"]) expect(shop, host).toContain(host);
    expect(shop).toContain("tel:+923116111963");
  });

  test("Settings: TCS connection test reports success against the (mock) courier", async ({ page }) => {
    await login(page);
    await page.goto("/admin/settings");
    await page.getByRole("button", { name: "Test TCS connection" }).click();
    await expect(page.getByText(/Connected to TCS/)).toBeVisible({ timeout: 20_000 });
  });

  test("Website pictures: replace the 'Our story' photo, see it live, and go back to the standard one", async ({ page }) => {
    await login(page);
    await page.goto("/admin/pictures");
    const card = page.locator("section", { hasText: "Photo on the “Our story” page" });
    await card.locator('input[type="file"]').setInputFiles({ name: "story.png", mimeType: "image/png", buffer: makePng(900, 1100, [150, 90, 60]) });
    await page.getByRole("button", { name: "Use this crop" }).click();
    await expect(toast(page).first()).toContainText("Picture changed", { timeout: 40_000 });
    const about = await (await page.request.get(`${BASE}/about`)).text();
    expect(about).toMatch(/\/cdn\/(r2\/)?site\//);
    await card.getByRole("button", { name: /standard picture again/ }).click();
    await expect(toast(page).last()).toContainText(/standard picture/, { timeout: 15_000 });
    expect(await sql`select 1 from site_images`).toHaveLength(0);
  });

  test("the writing helper drafts a description (and says so plainly when it cannot)", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/new");
    await page.getByRole("button", { name: /Write it for me/ }).click();
    await expect(toast(page).first()).toContainText(/product name first/i);
  });

  test.describe("deployment separation", () => {
    test("browsing the storefront never downloads admin code or admin styles", async ({ page }) => {
      const requested: string[] = [];
      page.on("request", (request) => requested.push(request.url()));
      for (const p of ["/", "/shop", "/products/olive-cargo-pants", "/cart", "/checkout", "/wishlist"]) {
        await page.goto(p);
        await page.waitForLoadState("networkidle").catch(() => undefined);
      }
      const adminHits = requested.filter((url) => /\/admin(\/|\.|-|_)|admin\.css|admin-|push-toggle|flash-sales|exceljs/i.test(new URL(url).pathname));
      expect(adminHits, "admin resources requested by the storefront").toEqual([]);
    });

    test("the storefront HTML links nothing from the admin stylesheet", async ({ request }) => {
      const html = await (await request.get("/")).text();
      expect(html).not.toMatch(/admin\.css|\.adm-shell/);
    });

    test("the Excel library is only fetched when the owner presses a button on the bulk page", async ({ page }) => {
      await login(page);
      const requested: string[] = [];
      page.on("request", (request) => requested.push(request.url()));
      await page.goto("/admin/products/bulk");
      await page.waitForLoadState("networkidle");
      expect(requested.some((u) => u.includes("exceljs"))).toBe(false);
    });
  });
});
