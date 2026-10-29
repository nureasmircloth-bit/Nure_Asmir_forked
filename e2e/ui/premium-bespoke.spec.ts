import { expect, test } from "@playwright/test";
import { BASE, placeOrder, sql, variantBySku, warmUp } from "../support/helpers";

/**
 * Premium-shop rules: a piece can be "price on request" (no price, no bag, ask on WhatsApp), ready-to-wear and made-to-order pieces show
 * their own delivery time, international orders go to WhatsApp, the returns policy names what cannot be refunded, and the home page has no
 * four-point strip under the banner.
 */
const SKU = "NA-TE-SAS-M";

test.describe("price on request, delivery times and international orders", () => {
  test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "one desktop browser is enough");
  test.describe.configure({ timeout: 180_000, mode: "serial" });

  let productId = "";
  let slug = "";
  let name = "";
  let original: { price_on_request: boolean; fulfilment: string } | undefined;
  let originalSettings: { ready_delivery_text: string; bespoke_delivery_text: string } | undefined;

  test.beforeAll(async ({ request }) => {
    const variant = await variantBySku(SKU);
    productId = variant.productId;
    const [row] = (await sql`select slug, name from products where id = ${productId}`) as Array<{ slug: string; name: string }>;
    slug = row.slug;
    name = row.name;
    original = { price_on_request: false, fulfilment: "ready" }; // the seed values, not whatever an interrupted run left behind
    originalSettings = { ready_delivery_text: "", bespoke_delivery_text: "" };
    await sql`update products set price_on_request = false, fulfilment = 'ready' where id = ${productId}`;
    await sql`update site_settings set ready_delivery_text = '', bespoke_delivery_text = '' where id = 'store'`;
    await warmUp(request, [`/products/${slug}`, "/shop", "/checkout", "/policies/returns", "/"]);
  });
  test.afterAll(async () => {
    if (original) await sql`update products set price_on_request = ${original.price_on_request}, fulfilment = ${original.fulfilment} where id = ${productId}`;
    if (originalSettings) await sql`update site_settings set ready_delivery_text = ${originalSettings.ready_delivery_text}, bespoke_delivery_text = ${originalSettings.bespoke_delivery_text} where id = 'store'`;
  });

  test("a price-on-request, made-to-order piece: no price, no bag, an Ask on WhatsApp button and the bespoke delivery time", async ({ page, request }) => {
    await sql`update products set price_on_request = true, fulfilment = 'bespoke' where id = ${productId}`;
    await sql`update site_settings set bespoke_delivery_text = '' where id = 'store'`;
    await page.goto(`/products/${slug}`);
    await expect(page.locator(".product-buy .product-price")).toHaveText("Price on request");
    await expect(page.getByRole("button", { name: /Add to bag/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Buy it now/ })).toHaveCount(0);
    const ask = page.getByRole("link", { name: "Ask for the price on WhatsApp" });
    await expect(ask).toBeVisible();
    const href = (await ask.getAttribute("href")) ?? "";
    expect(href).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
    expect(decodeURIComponent(href)).toContain(name);
    await expect(page.locator(".purchase-notes")).toContainText("Made to order");
    await expect(page.locator(".purchase-notes")).toContainText("12–14 working days");

    // Google gets no price for it
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(ld ?? "").not.toContain('"offers"');

    // the shop lists it as "Price on request", and a price range leaves it out
    const shop = await (await request.get(`${BASE}/shop`)).text();
    expect(shop).toContain("Price on request");
    const all = (await (await request.get(`${BASE}/api/catalog/page?cat=all&sort=newest&page=1`)).json()) as { products: Array<{ slug: string; priceOnRequest?: boolean }> };
    expect(all.products.find((p) => p.slug === slug)?.priceOnRequest).toBe(true);
    const ranged = (await (await request.get(`${BASE}/api/catalog/page?cat=all&sort=newest&page=1&min=1&max=99999999`)).json()) as { products: Array<{ slug: string }> };
    expect(ranged.products.map((p) => p.slug)).not.toContain(slug);

    // and it can never be bought through the website, even by a hand-made request
    const variant = await variantBySku(SKU);
    const placed = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }] });
    expect(placed.status).toBe(409);
    expect(String(placed.body.error)).toMatch(/price on request|priced on request/i);
  });

  test("a ready-to-wear piece shows its price, the bag buttons and the delivery time set in Settings", async ({ page }) => {
    await sql`update products set price_on_request = false, fulfilment = 'ready' where id = ${productId}`;
    await sql`update site_settings set ready_delivery_text = 'E2E 2–3 working days' where id = 'store'`;
    await page.goto(`/products/${slug}`);
    await expect(page.locator(".product-buy .product-price")).toContainText("Rs");
    await expect(page.getByRole("button", { name: /Add to bag/ })).toBeVisible();
    await expect(page.locator(".purchase-notes")).toContainText("Ready to wear");
    await expect(page.locator(".purchase-notes")).toContainText("E2E 2–3 working days");
    const abroad = page.locator(".purchase-notes").getByRole("link", { name: "Order on WhatsApp" });
    expect(decodeURIComponent((await abroad.getAttribute("href")) ?? "")).toContain("outside Pakistan");
  });

  test("checkout: one quiet line for Pakistan, and a WhatsApp route for a shopper abroad", async ({ page, request }) => {
    const variant = await variantBySku(SKU);
    await page.goto("/");
    await page.evaluate((v) => {
      localStorage.setItem("nure-asmir-cart", JSON.stringify([{ variantId: v.id, slug: "x", name: "E2E Abroad Shirt", variantName: "M", sku: v.sku, price: v.price, quantity: 1, available: 5, addedAt: Date.now() }]));
    }, variant);
    await page.route("**/api/geo/country", (route) => route.fulfill({ json: { country: "PK" } }));
    await page.goto("/checkout");
    await expect(page.locator(".intl-notice")).toContainText("Ordering from outside Pakistan?");
    await expect(page.locator(".intl-notice.is-abroad")).toHaveCount(0);

    await page.unroute("**/api/geo/country");
    await page.route("**/api/geo/country", (route) => route.fulfill({ json: { country: "AE" } }));
    await page.reload();
    const notice = page.locator(".intl-notice.is-abroad");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("DHL");
    const link = notice.getByRole("link", { name: "Continue on WhatsApp" });
    await expect(link).toHaveAttribute("href", /wa\.me/); // the shop settings load a moment after the page
    const href = (await link.getAttribute("href")) ?? "";
    expect(decodeURIComponent(href)).toContain("E2E Abroad Shirt");
    // the checkout form itself is not offered abroad
    await expect(page.locator("form.checkout-layout")).toHaveCount(0);

    // and the order API refuses a shopper abroad even if the form is bypassed (Vercel sets this header from the connection)
    const refused = await request.post(`${BASE}/api/orders`, { headers: { "cf-ipcountry": "AE", "Idempotency-Key": `e2e-abroad-${Date.now()}`, "x-forwarded-for": `10.9.${Date.now() % 250}.7` }, data: { items: [{ variantId: variant.id, quantity: 1 }] } });
    expect(refused.status()).toBe(403);
    expect(String(((await refused.json()) as { error?: string }).error)).toMatch(/WhatsApp/);
  });

  test("returns policy names what is never refunded; shipping explains international orders; no strip under the banner", async ({ page }) => {
    await page.goto("/policies/returns");
    const returns = page.locator("main");
    await expect(returns).toContainText("wear and tear");
    await expect(returns).toContainText("spot or stain");
    await expect(returns).toContainText("perfume");
    await page.goto("/policies/shipping");
    await expect(page.locator("main")).toContainText("International orders");
    await expect(page.locator("main")).toContainText("DHL");
    await page.goto("/");
    await expect(page.locator(".service-strip")).toHaveCount(0);
    await expect(page.getByText("Nationwide delivery", { exact: true })).toHaveCount(0);
  });
});
