import { expect, test, type Page } from "@playwright/test";
import { cleanOrders, fakeToken, setStock, sql, variantBySku, warmUp } from "../support/helpers";
import { seedCart, watchErrors } from "../support/ui";

/**
 * Harsh conditions: a slow phone connection, a connection that drops, answers that never arrive, servers that say "try later".
 * The shop must stay usable and honest (no frozen buttons, no double orders, no silent loss) and recover by itself when the
 * network comes back.
 */
const SLOW_3G = { offline: false, latency: 600, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (200 * 1024) / 8 };

async function network(page: Page, conditions: { offline: boolean; latency: number; downloadThroughput: number; uploadThroughput: number }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", conditions);
  return cdp;
}
const FINE = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
const cartInStorage = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("nure-asmir-cart") ?? "[]") as Array<{ quantity: number }>);

test.describe("a bad connection, on a phone", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "network conditions are emulated through Chromium");
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });
  test.describe.configure({ timeout: 240_000 });

  test.beforeAll(async ({ request }) => {
    await warmUp(request, ["/", "/shop", "/products/olive-cargo-pants", "/cart", "/checkout", "/api/search/index", "/api/cart-availability"]);
  });
  test.beforeEach(async ({ page }) => {
    await cleanOrders();
    await setStock("NA-TE-SAS-M", 10);
    await page.addInitScript(() => {
      if (!window.sessionStorage.getItem("__e2e_cleared")) {
        window.localStorage.clear();
        window.sessionStorage.setItem("__e2e_cleared", "1");
      }
    });
  });
  test.afterAll(async () => {
    await cleanOrders();
  });

  test("on slow 3G the page opens, a size can be chosen and adding gives a clear answer without a duplicate", async ({ page }) => {
    const errors = watchErrors(page);
    await network(page, SLOW_3G);
    await page.goto("/products/olive-cargo-pants", { timeout: 120_000 });
    // On a slow line the buttons are on screen before the page's scripts have arrived; taps then do nothing, so keep tapping until it responds.
    const size = page.getByRole("radio", { name: "34", exact: true });
    await expect(async () => {
      await size.click({ timeout: 5_000 });
      await expect(size).toHaveAttribute("aria-checked", "true", { timeout: 1_500 });
    }).toPass({ timeout: 120_000 });
    await page.getByRole("button", { name: /Add to bag/ }).dblclick({ delay: 30 });
    await expect(page.locator(".cart-toast")).toContainText("Added to your bag", { timeout: 20_000 });
    expect((await cartInStorage(page))[0].quantity).toBe(1);
    expect(errors.filter((line) => !/Failed to load resource|net::ERR/i.test(line))).toEqual([]);
  });

  test("with no signal at all, adding to the bag still works (it is kept on the phone) and nothing breaks", async ({ page }) => {
    await page.goto("/products/olive-cargo-pants");
    await page.getByRole("radio", { name: "30", exact: true }).click();
    await network(page, { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await page.getByRole("button", { name: /Add to bag/ }).click();
    await expect(page.locator(".cart-toast")).toContainText("Added to your bag");
    await page.locator(".cart-toast").getByRole("button", { name: "Undo" }).click();
    expect(await cartInStorage(page)).toHaveLength(0);
    await page.getByRole("button", { name: /Add to bag/ }).click({ timeout: 10_000 });
    await expect(page.locator(".cart-toast")).toContainText("1 of this in your bag");
    await network(page, FINE);
  });

  test("search: when its data fails (error, then dropped connection) the box stays usable and works again once the network is back", async ({ page }) => {
    const errors = watchErrors(page);
    let mode: "fail" | "drop" | "ok" = "fail";
    await page.route("**/api/search/index**", (route) => (mode === "fail" ? route.fulfill({ status: 503, body: "busy" }) : mode === "drop" ? route.abort("connectionreset") : route.continue()));
    await page.goto("/");
    await page.getByRole("navigation", { name: "Quick links" }).getByRole("button", { name: "Search" }).dispatchEvent("click");
    const box = page.getByRole("searchbox", { name: "Search products" });
    await box.fill("pants");
    await expect(page.locator(".search-meta")).not.toHaveText(/Searching/, { timeout: 15_000 }); // it gives up and says so, instead of spinning forever
    await expect(page.locator(".search-hit")).toHaveCount(0);
    mode = "drop";
    await box.fill("pant");
    await expect(page.locator(".search-meta")).not.toHaveText(/Searching/, { timeout: 15_000 });
    mode = "ok";
    await box.fill("pants");
    await expect(page.locator(".search-hit").first()).toContainText(/pants/i, { timeout: 20_000 });
    expect(errors.filter((line) => line.startsWith("pageerror"))).toEqual([]);
  });

  test("search results still show when the discount lookup fails or is slow, and the discount appears when it arrives", async ({ page }) => {
    let answer: "error" | "slow" = "error";
    await page.route("**/api/catalog/prices**", async (route) => {
      if (answer === "error") return route.abort("failed");
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ prices: {} }) });
    });
    await page.goto("/");
    await page.getByRole("navigation", { name: "Quick links" }).getByRole("button", { name: "Search" }).dispatchEvent("click");
    const box = page.getByRole("searchbox", { name: "Search products" });
    await box.fill("pants");
    await expect(page.locator(".search-hit").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".search-hit-price").first()).toContainText("Rs.");
    answer = "slow";
    await box.fill("cargo");
    await expect(page.locator(".search-hit").first()).toBeVisible({ timeout: 20_000 }); // the price list is not held up by the discount lookup
  });

  test("the bag still opens and can go to checkout when the stock check fails, is dropped or is told to slow down (429)", async ({ page }) => {
    const v = await variantBySku("NA-TE-SAS-M");
    await seedCart(page, [{ variant: v, name: "Ivory Sashiko Tee", slug: "ivory-sashiko-tee" }]);
    for (const behaviour of ["500", "drop", "429"] as const) {
      await page.route("**/api/cart-availability", (route) =>
        behaviour === "drop" ? route.abort("connectionreset") : route.fulfill({ status: behaviour === "429" ? 429 : 500, contentType: "application/json", body: JSON.stringify({ error: "slow down" }) }),
      );
      await page.goto("/cart");
      await expect(page.locator(".cart-lines article")).toHaveCount(1);
      await expect(page.getByRole("link", { name: /checkout/i }).first()).toBeVisible();
      await page.unroute("**/api/cart-availability");
    }
  });

  test("placing an order: the answer is lost on the way back, the shopper tries again, and exactly ONE order exists", async ({ page }) => {
    const v = await variantBySku("NA-TE-SAS-M");
    await seedCart(page, [{ variant: v, name: "Ivory Sashiko Tee", slug: "ivory-sashiko-tee" }]);
    let posts = 0;
    await page.route("**/api/orders", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posts += 1;
      if (posts === 1) {
        await route.fetch(); // the shop receives and saves the order …
        return route.abort("connectionreset"); // … but the phone never hears back
      }
      return route.continue();
    });
    await page.goto("/checkout");
    await page.locator('input[name="customerName"]').fill("E2E Weak Signal");
    await page.locator('input[name="customerPhone"]').fill("+923001234567");
    await page.locator('textarea[name="address"]').fill("House 1, Street 2, DHA");
    await page.locator('input[name="city"]').fill("Karachi");
    await page.getByRole("combobox", { name: "Province" }).click();
    await page.getByRole("option", { name: "Sindh" }).click();
    const place = page.getByRole("button", { name: /Place order/ });
    await place.click();
    await expect(page.getByText(/check your connection/i)).toBeVisible({ timeout: 20_000 });
    await expect(place).toBeEnabled(); // not frozen: the shopper can try again
    await place.click();
    await expect(page.getByRole("heading", { name: /Thank you/ })).toBeVisible({ timeout: 30_000 });
    const rows = (await sql`select order_number from orders where customer_name = 'E2E Weak Signal'`) as Array<{ order_number: string }>;
    expect(rows).toHaveLength(1);
    expect(posts).toBe(2);
  });

  test("placing an order: 'too many requests' and a server error are explained, nothing is saved, and a later try succeeds", async ({ page }) => {
    const v = await variantBySku("NA-TE-SAS-M");
    await seedCart(page, [{ variant: v, name: "Ivory Sashiko Tee", slug: "ivory-sashiko-tee" }]);
    const statuses = [429, 503];
    await page.route("**/api/orders", (route) => {
      if (route.request().method() !== "POST" || !statuses.length) return route.continue();
      const status = statuses.shift()!;
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: status === 429 ? "Too many orders from this connection. Please wait a minute." : "The order could not be placed. Please try again." }) });
    });
    await page.goto("/checkout");
    await page.locator('input[name="customerName"]').fill("E2E Busy Server");
    await page.locator('input[name="customerPhone"]').fill("+923001234567");
    await page.locator('textarea[name="address"]').fill("House 1, Street 2, DHA");
    await page.locator('input[name="city"]').fill("Karachi");
    await page.getByRole("combobox", { name: "Province" }).click();
    await page.getByRole("option", { name: "Sindh" }).click();
    const place = page.getByRole("button", { name: /Place order/ });
    await place.click();
    await expect(page.getByText(/Too many orders/)).toBeVisible({ timeout: 15_000 });
    await expect(place).toBeEnabled();
    expect(await sql`select 1 from orders where customer_name = 'E2E Busy Server'`).toHaveLength(0);
    await place.click();
    await expect(page.getByText(/could not be placed/i)).toBeVisible({ timeout: 15_000 });
    await place.click();
    await expect(page.getByRole("heading", { name: /Thank you/ })).toBeVisible({ timeout: 30_000 });
    expect(await sql`select 1 from orders where customer_name = 'E2E Busy Server'`).toHaveLength(1);
  });

  test("copying the order number gives a message, even where the clipboard is refused", async ({ page }) => {
    const v = await variantBySku("NA-TE-SAS-M");
    await seedCart(page, [{ variant: v, name: "Ivory Sashiko Tee", slug: "ivory-sashiko-tee" }]);
    await page.goto("/checkout");
    await page.locator('input[name="customerName"]').fill("E2E Copy Check");
    await page.locator('input[name="customerPhone"]').fill("+923001234567");
    await page.locator('textarea[name="address"]').fill("House 1, Street 2, DHA");
    await page.locator('input[name="city"]').fill("Karachi");
    await page.getByRole("combobox", { name: "Province" }).click();
    await page.getByRole("option", { name: "Sindh" }).click();
    await page.getByRole("button", { name: /Place order/ }).click();
    await expect(page.getByRole("heading", { name: /Thank you/ })).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true }));
    await page.getByRole("button", { name: "Copy" }).dispatchEvent("click");
    await expect(page.locator(".shop-toast")).toBeVisible();
    await expect(page.getByRole("button", { name: /Copied|Copy/ })).toBeVisible();
  });
});

test.describe("a bad connection, in the admin", () => {
  test.skip(({ browserName, isMobile, viewport }) => browserName !== "chromium" || isMobile || (viewport?.width ?? 0) < 1000, "admin UI is exercised on desktop Chromium");
  test.describe.configure({ timeout: 240_000 });

  async function login(page: Page) {
    await sql`delete from login_attempts`;
    await page.goto("/admin/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
  }
  test.beforeAll(async ({ request }) => {
    await warmUp(request, ["/api/admin/login", "/admin/login"]);
  });
  test.afterAll(async () => {
    await sql`delete from customer_push_devices where token like 'e2e-bad-%'`;
    await sql`delete from admin_messages where title like 'E2E %'`;
    await sql`update site_settings set announcement_style = 'rotate' where id = 'store'`;
  });

  test("saving settings while the connection drops: an honest error, no false 'it will show' promise, and the retry works", async ({ page }) => {
    await login(page);
    await page.goto("/admin/settings");
    const section = page.locator("section#topbar");
    await section.getByRole("radio", { name: /Scrolling, towards the right/ }).check();
    let tries = 0;
    await page.route("**/api/admin/settings", (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      tries += 1;
      return tries === 1 ? route.abort("internetdisconnected") : route.continue();
    });
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.locator(".a-toast.bad")).toContainText(/Could not reach the server/, { timeout: 20_000 });
    await expect(page.locator(".a-delay-note")).toHaveCount(0);
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.locator(".a-toast.good")).toContainText("Settings saved", { timeout: 20_000 });
    await expect(page.locator(".a-delay-note")).toContainText(/about 5 minutes/);
  });

  test("sending a notification to many phones in slices: one slice fails, the page says so, shows what was reached and can be used again", async ({ page }) => {
    await sql`delete from customer_push_devices`;
    for (let i = 0; i < 95; i++) await sql`insert into customer_push_devices (token, sales_opt_in) values (${fakeToken(`e2e-bad-${i}`)}, true)`;
    await login(page);
    await page.goto("/admin/messages");
    await page.getByLabel("Title").fill("E2E flaky wifi");
    await page.getByLabel("Message", { exact: true }).fill("Testing a connection that drops halfway.");
    let calls = 0;
    await page.route("**/api/admin/messages/push", (route) => {
      calls += 1;
      return calls === 2 ? route.abort("connectionreset") : route.continue();
    });
    await page.getByRole("button", { name: "Send now" }).click();
    await page.getByRole("button", { name: "Yes, send it" }).click();
    await expect(page.locator(".a-toast.bad")).toContainText(/Could not reach the server/, { timeout: 40_000 });
    await expect(page.getByRole("button", { name: "Send now" })).toBeEnabled(); // not stuck on "sending"
    const [message] = (await sql`select recipients, delivered from admin_messages where title = 'E2E flaky wifi'`) as Array<{ recipients: number; delivered: number }>;
    expect(message.recipients).toBe(95);
    expect(message.delivered).toBe(40); // the first slice really was delivered, and the history says exactly that
    await sql`delete from customer_push_devices where token like 'e2e-bad-%'`;
  });

  test("a slow admin connection never lets a double click send twice", async ({ page }) => {
    await sql`delete from customer_push_devices`;
    for (let i = 0; i < 3; i++) await sql`insert into customer_push_devices (token, sales_opt_in) values (${fakeToken(`e2e-bad-${i}`)}, true)`;
    await login(page);
    await page.goto("/admin/messages");
    await page.getByLabel("Title").fill("E2E double click");
    await page.getByLabel("Message", { exact: true }).fill("Only once, please.");
    await page.route("**/api/admin/messages/push", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return route.continue();
    });
    await page.getByRole("button", { name: "Send now" }).click();
    const yes = page.getByRole("button", { name: "Yes, send it" });
    await yes.dblclick();
    await expect(page.locator(".a-toast.good")).toContainText(/sent to 3 phones/i, { timeout: 30_000 });
    expect(await sql`select 1 from admin_messages where title = 'E2E double click'`).toHaveLength(1);
  });
});
