import { expect, test, type Page } from "@playwright/test";
import { BASE, cleanOrders, setBankDeposit, sql, variantBySku, warmUp } from "../support/helpers";
import { makePng, noHorizontalOverflow, seedCart, watchErrors } from "../support/ui";

const SKU = "NA-TE-SAS-M";
const LAHORE = { label: "Park Lane Tower, Tufail Road, Cantt, Lahore, Punjab", address: "Park Lane Tower, Tufail Road", city: "Lahore", province: "Punjab", lat: 31.5204, lon: 74.3587 };

test.describe("storefront overhaul", () => {
  test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "desktop Chromium is the reference browser; a phone-sized run is below");
  test.describe.configure({ timeout: 240_000 });

  test.beforeAll(async ({ request }) => {
    await warmUp(request, ["/checkout", "/shop", "/faq", "/api/checkout/options", "/api/catalog/facets", "/api/geo/country"]);
    await sql`update site_settings set bank_deposit_enabled = false, announcement_mode = 'auto', announcement_lines = '', delivery_mode = 'zones', free_delivery_threshold = 10000 where id = 'store'`;
  });
  test.afterAll(async () => {
    await cleanOrders();
    await sql`update site_settings set bank_deposit_enabled = false, announcement_mode = 'auto', announcement_lines = '', delivery_mode = 'zones', flat_delivery_charge = 250, free_delivery_threshold = 10000 where id = 'store'`;
    await sql`delete from faqs where question like 'E2E %'`;
    await sql`delete from products where name like 'E2E UI Fil %'`;
    await sql`delete from categories where slug = 'e2e-ui-filters'`;
  });
  test.beforeEach(async ({ page }) => {
    // never talk to outside services from a test: rates and flag pictures are stubbed
    await page.route("**/api/currency", (route) => route.fulfill({ json: { date: "2026-01-01", fetchedAt: Date.now(), rates: { PKR: 1, USD: 0.0036, GBP: 0.0027, EUR: 0.0033, AED: 0.0132, SAR: 0.0135, CAD: 0.005, AUD: 0.0055 } } }));
  });

  test.describe("top bar", () => {
    test("shows the rules the owner set – cash on delivery and the real free-delivery amount", async ({ page }) => {
      await page.goto("/");
      const bar = page.locator(".announcement");
      await expect(bar).toContainText("Cash on delivery available all over Pakistan");
      await expect(bar).toContainText("Free delivery on orders above Rs. 10,000");
      // it follows the setting: change the amount, the text changes
      await sql`update site_settings set free_delivery_threshold = 7500 where id = 'store'`;
      await page.goto("/shop");
      await expect(page.locator(".announcement")).toContainText("Rs. 7,500");
      await sql`update site_settings set free_delivery_threshold = 0 where id = 'store'`;
      await page.goto("/shop");
      await expect(page.locator(".announcement")).not.toContainText("Free delivery");
      await sql`update site_settings set free_delivery_threshold = 10000, announcement_mode = 'off' where id = 'store'`;
      await page.goto("/shop");
      await expect(page.locator(".announcement")).toHaveCount(0);
      await sql`update site_settings set announcement_mode = 'auto' where id = 'store'`;
    });
  });

  test.describe("checkout", () => {
    async function openCheckout(page: Page, quantity = 1) {
      const v = await variantBySku(SKU);
      await seedCart(page, [{ variant: v, name: "Ivory Sashiko Tee", slug: "ivory-sashiko-tee", quantity }]);
      await page.goto("/checkout");
      await expect(page.locator('textarea[name="address"]')).toBeVisible({ timeout: 30_000 });
    }

    test("only cash on delivery is offered, and no bank details leak into the page", async ({ page }) => {
      await sql`update site_settings set bank_name = 'E2E Bank', bank_account_number = '987654' where id = 'store'`;
      await openCheckout(page);
      await expect(page.getByText("Cash on delivery").first()).toBeVisible();
      await expect(page.getByText("Bank deposit")).toHaveCount(0);
      expect(await page.content()).not.toContain("987654");
      await sql`update site_settings set bank_name = '', bank_account_number = '' where id = 'store'`;
    });

    test("when the owner switches bank transfer on, the choice appears; the page says nothing about it until then", async ({ page }) => {
      await setBankDeposit(true);
      await openCheckout(page);
      await expect(page.getByText("Bank deposit").first()).toBeVisible();
      await setBankDeposit(false);
    });

    test("the province and delivery-zone dropdowns are the shop's own: keyboard, typing a letter, Esc and clicking away all work", async ({ page }) => {
      await openCheckout(page);
      const province = page.getByRole("combobox", { name: "Province" });
      await expect(province).toContainText("Choose province");
      await province.focus();
      await page.keyboard.press("ArrowDown");
      const list = page.getByRole("listbox", { name: "Province" });
      await expect(list).toBeVisible();
      expect(await list.getByRole("option").count()).toBe(7);
      await page.keyboard.type("si");
      await page.keyboard.press("Enter");
      await expect(province).toContainText("Sindh");
      await expect(list).toHaveCount(0);

      await province.click();
      await expect(list).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(list).toHaveCount(0);
      await province.click();
      await page.locator("h1").first().click({ position: { x: 5, y: 5 } }).catch(() => undefined);
      await page.mouse.click(5, 300);
      await expect(list).toHaveCount(0);

      const zone = page.getByRole("combobox", { name: "Delivery zone" });
      await zone.click();
      const options = page.getByRole("listbox", { name: "Delivery zone" }).getByRole("option");
      expect(await options.count()).toBeGreaterThanOrEqual(3);
      await expect(options.first()).toContainText(/days/);
      await options.nth(1).click();
      await expect(zone).toContainText("Lahore");
    });

    test("a province must be chosen: the order is not sent without it", async ({ page }) => {
      await openCheckout(page);
      await page.locator('input[name="customerName"]').fill("E2E No Province");
      await page.locator('input[name="customerPhone"]').fill("+923001234567");
      await page.locator('textarea[name="address"]').fill("House 1");
      await page.locator('input[name="city"]').fill("Karachi");
      expect(await page.locator("form", { has: page.locator('textarea[name="address"]') }).evaluate((form) => (form as HTMLFormElement).checkValidity()), "the checkout form is not valid without a province").toBe(false);
      await page.getByRole("button", { name: /Place order/ }).click();
      await page.waitForTimeout(600);
      expect(await sql`select 1 from orders where customer_name = 'E2E No Province'`).toHaveLength(0);
    });

    test("'Use my current location' asks permission, then fills in address, city, province and the right delivery area – and the pin is saved with the order", async ({ page, context }) => {
      await context.grantPermissions(["geolocation"]);
      await context.setGeolocation({ latitude: 31.5204, longitude: 74.3587 });
      let asked = 0;
      await page.route("**/api/geo/reverse*", (route) => {
        asked += 1;
        return route.fulfill({ json: { result: LAHORE } });
      });
      await openCheckout(page);
      await page.getByRole("button", { name: "Use my current location" }).click();
      await expect(page.locator('textarea[name="address"]')).toHaveValue(/Park Lane Tower/);
      await expect(page.locator('input[name="city"]')).toHaveValue("Lahore");
      await expect(page.getByRole("combobox", { name: "Province" })).toContainText("Punjab");
      await expect(page.getByRole("combobox", { name: "Delivery zone" })).toContainText("Lahore & Islamabad");
      await expect(page.getByText(/Location set/)).toBeVisible();
      await expect(page.getByText("Delivery area set to Lahore & Islamabad")).toBeVisible();
      expect(asked).toBe(1);

      await page.locator('input[name="customerName"]').fill("E2E GPS Buyer");
      await page.locator('input[name="customerPhone"]').fill("+923001234567");
      await page.getByRole("button", { name: /Place order/ }).click();
      await expect(page.getByRole("heading", { name: /Thank you/ })).toBeVisible({ timeout: 30_000 });
      const [row] = (await sql`select delivery_latitude as lat, delivery_longitude as lon, city, province from orders where customer_name = 'E2E GPS Buyer'`) as Array<{ lat: number; lon: number; city: string; province: string }>;
      expect(row).toEqual({ lat: 31.5204, lon: 74.3587, city: "Lahore", province: "Punjab" });
    });

    test("location trouble is explained in plain words and never blocks typing the address by hand", async ({ page, context }) => {
      await openCheckout(page);
      // 1. permission refused
      await context.clearPermissions();
      await page.getByRole("button", { name: "Use my current location" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /blocked|could not find|allow/i })).toBeVisible({ timeout: 20_000 });
      // 2. a place outside Pakistan
      await context.grantPermissions(["geolocation"]);
      await context.setGeolocation({ latitude: 51.5074, longitude: -0.1278 });
      await page.getByRole("button", { name: "Use my current location" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /outside Pakistan/i })).toBeVisible({ timeout: 20_000 });
      // 3. the map service is down
      await context.setGeolocation({ latitude: 31.5204, longitude: 74.3587 });
      await page.route("**/api/geo/reverse*", (route) => route.fulfill({ json: { unavailable: true } }));
      await page.getByRole("button", { name: "Use my current location" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /could not turn it into an address/i })).toBeVisible({ timeout: 20_000 });
      // the form still works by hand
      await page.locator('textarea[name="address"]').fill("Typed by hand");
      await expect(page.locator('textarea[name="address"]')).toHaveValue("Typed by hand");
    });

    test("the map opens on demand, a tap moves the pin, the address follows, and 'Use this location' fills the form", async ({ page }) => {
      await page.route("**/api/geo/tiles/**", (route) => route.fulfill({ contentType: "image/png", body: makePng(256, 256, [220, 215, 205]) }));
      let lookups = 0;
      await page.route("**/api/geo/reverse*", (route) => {
        lookups += 1;
        return route.fulfill({ json: { result: { ...LAHORE, label: `Pin ${lookups}: ${LAHORE.label}` } } });
      });
      await openCheckout(page);
      expect(await page.locator(".leaflet-container").count(), "the map library is not loaded until it is needed").toBe(0);
      await page.getByRole("button", { name: "Pick on the map" }).click();
      const map = page.locator(".leaflet-container");
      await expect(map).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/^Pin 1/)).toBeVisible({ timeout: 10_000 });
      await map.click({ position: { x: 120, y: 90 } });
      await expect(page.getByText(/^Pin 2/)).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: "Use this location" }).click();
      await expect(page.locator('textarea[name="address"]')).toHaveValue(/Park Lane Tower/);
      await expect(page.getByRole("combobox", { name: "Province" })).toContainText("Punjab");
      await expect(map).toHaveCount(0);
      expect(lookups, "one lookup per settled pin, not one per mouse movement").toBeLessThanOrEqual(3);
    });

    test("the delivery charge and the 'add Rs. X more' hint follow the owner's rule", async ({ page }) => {
      await openCheckout(page);
      const summary = page.locator(".checkout-total");
      const price = (await variantBySku(SKU)).price;
      if (price < 10000) {
        await expect(summary).toContainText(`Add Rs. ${(10000 - price).toLocaleString("en-PK")} more to get free delivery`);
        await expect(summary.getByText("Complimentary")).toHaveCount(0);
      }
      await sql`update site_settings set free_delivery_threshold = ${price} where id = 'store'`;
      await page.reload();
      await expect(page.locator(".checkout-total")).toContainText("Complimentary", { timeout: 20_000 });
      await expect(page.locator(".checkout-total").getByText(/more to get free delivery/)).toHaveCount(0);
      await sql`update site_settings set free_delivery_threshold = 10000, delivery_mode = 'flat', flat_delivery_charge = 175 where id = 'store'`;
      await page.reload();
      await expect(page.locator(".checkout-total")).toContainText("175", { timeout: 20_000 });
      await sql`update site_settings set delivery_mode = 'zones' where id = 'store'`;
    });
  });

  test.describe("shop filters", () => {
    test.beforeAll(async () => {
      await sql`delete from products where name like 'E2E UI Fil %'`;
      await sql`delete from categories where slug = 'e2e-ui-filters'`;
      const [cat] = (await sql`insert into categories (name, slug, sort_order) values ('E2E UI Filters', 'e2e-ui-filters', 99) returning id`) as Array<{ id: string }>;
      const make = async (name: string, variants: Array<[string, string, number, number]>) => {
        const [p] = (await sql`insert into products (category_id, name, slug, type_label, status, published_at) values (${cat.id}, ${name}, ${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}, 'Shirt', 'published', now()) returning id`) as Array<{ id: string }>;
        let first = true;
        for (const [size, color, price, stock] of variants) {
          await sql`insert into product_variants (product_id, name, sku, color, size, price, stock_quantity, is_default) values (${p.id}, ${`${color} / ${size}`}, ${`E2EUI-${name.slice(-1)}-${color}-${size}`.toUpperCase().replace(/\s/g, "")}, ${color}, ${size}, ${price}, ${stock}, ${first})`;
          first = false;
        }
      };
      await make("E2E UI Fil A", [["M", "Olive", 3000, 5], ["L", "Olive", 3500, 0], ["M", "Navy", 8000, 2]]);
      await make("E2E UI Fil B", [["One size", "Black", 12000, 1]]);
      await make("E2E UI Fil C", [["S", "Olive", 2000, 0]]);
    });
    const shown = async (page: Page) => page.evaluate(() => [...new Set([...document.querySelectorAll<HTMLAnchorElement>(".shop-grid a.pcard-title")].map((a) => a.textContent?.trim() ?? ""))].sort());
    const countText = (page: Page) => page.locator(".result-count").first();

    test("every filter narrows the list, shows as a removable tag, lives in the web address and survives a reload", async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto("/shop?cat=e2e-ui-filters");
      await expect(countText(page)).toHaveText("3 products");
      await expect.poll(() => shown(page)).toEqual(["E2E UI Fil A", "E2E UI Fil B", "E2E UI Fil C"]);

      await page.getByRole("button", { name: /^Filters/ }).click();
      const panel = page.getByRole("dialog", { name: "Filter products" });
      await expect(panel).toBeVisible();
      // the panel only offers what exists in this category
      await expect(panel.getByRole("button", { name: "M", exact: true })).toBeVisible();
      await expect(panel.getByRole("button", { name: "One size" })).toBeVisible();
      await expect(panel.getByRole("button", { name: "Navy" })).toBeVisible();
      await expect(panel.getByRole("slider", { name: "Lowest price" })).toBeVisible();

      await panel.getByRole("button", { name: "M", exact: true }).click();
      await expect(panel.getByRole("button", { name: /Show 1 product$/ })).toBeVisible({ timeout: 15_000 });
      await panel.getByRole("button", { name: /Show 1 product$/ }).click();
      await expect(page.getByRole("dialog", { name: "Filter products" })).toBeHidden();
      await expect.poll(() => shown(page)).toEqual(["E2E UI Fil A"]);
      await expect(page.locator(".active-filters")).toContainText("Size M");
      expect(page.url()).toContain("sizes=M");

      await page.reload();
      await expect.poll(() => shown(page)).toEqual(["E2E UI Fil A"]);
      await expect(page.getByRole("button", { name: /^Filters \(1\)/ })).toBeVisible();

      // add a price range typed by hand, then colour and stock
      await page.getByRole("button", { name: /^Filters/ }).click();
      await panel.getByRole("button", { name: "Navy" }).click();
      await panel.getByLabel("Lowest price in rupees").fill("5000");
      await expect(panel.getByRole("button", { name: /Show 1 product$/ })).toBeVisible({ timeout: 15_000 });
      await panel.getByLabel("Only show what is in stock").check();
      await expect(panel.getByRole("button", { name: /Show 1 product$/ })).toBeVisible({ timeout: 15_000 });
      await panel.getByRole("button", { name: /Show 1 product$/ }).click();
      await expect(page.locator(".active-filters")).toContainText("Navy");
      await expect(page.locator(".active-filters")).toContainText("In stock");

      // remove tags one at a time, then everything
      await page.locator(".active-filters button", { hasText: "In stock" }).click();
      await page.locator(".active-filters button", { hasText: "Navy" }).click();
      await expect(page.locator(".active-filters")).not.toContainText("Navy");
      await page.locator(".active-filters .clear-all").click();
      await expect(page.locator(".active-filters")).toHaveCount(0);
      await expect(countText(page)).toHaveText("3 products");
      expect(page.url()).not.toContain("sizes=");
      expect(errors).toEqual([]);
    });

    test("a filter nothing matches says so and offers a way back", async ({ page }) => {
      await page.goto("/shop?cat=e2e-ui-filters&min=11000&colors=Olive");
      await expect(page.getByText("Nothing matches these filters.")).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "Clear the filters" }).click();
      await expect(countText(page)).toHaveText("3 products");
    });

    test("sorting uses the shop's own dropdown, by keyboard and mouse", async ({ page }) => {
      await page.goto("/shop?cat=e2e-ui-filters");
      const sort = page.getByRole("combobox", { name: "Sort products" });
      await expect(sort).toContainText("Newest first");
      await sort.click();
      await page.getByRole("option", { name: "Price, high to low" }).click();
      await expect(sort).toContainText("high to low");
      await expect(page.getByRole("listbox", { name: "Sort products" }), "the list closes after a mouse choice").toHaveCount(0);
      await expect.poll(async () => (await page.locator(".shop-grid a.pcard-title").first().textContent())?.trim()).toBe("E2E UI Fil B");
      expect(page.url()).toContain("sort=high");
      // by keyboard: the list opens on the current choice ("high to low"); one step up is "low to high", two is "newest first"
      await sort.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("Enter");
      await expect(sort).toContainText("low to high");
      await expect.poll(async () => (await page.locator(".shop-grid a.pcard-title").first().textContent())?.trim()).toBe("E2E UI Fil C");
      await sort.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("listbox", { name: "Sort products" })).toBeVisible();
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("Enter");
      await expect(sort).toContainText("Newest first");
    });

    test("on a phone the filter panel fits, scrolls and closes with the ✕ and Esc; nothing sticks out sideways", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 760 });
      await page.goto("/shop?cat=e2e-ui-filters");
      await noHorizontalOverflow(page, "shop on a phone");
      await page.getByRole("button", { name: /^Filters/ }).click();
      const panel = page.getByRole("dialog", { name: "Filter products" });
      await expect(panel).toBeVisible();
      const box = (await panel.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(375);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await page.getByRole("button", { name: /^Filters/ }).click();
      await page.getByRole("button", { name: "Close filters" }).click();
      await expect(panel).toBeHidden();
    });
  });

  test.describe("product photo zoom", () => {
    test("resting the mouse on the photo magnifies it; tapping opens it full size; arrows and Esc work; the magnifier button works from the keyboard", async ({ page }) => {
      await page.goto("/products/olive-cargo-pants");
      const stage = page.locator(".product-stage.zoomable");
      await expect(stage).toBeVisible();
      const box = (await stage.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
      const lens = page.locator(".zoom-lens");
      await expect(lens).toBeVisible();
      const first = await lens.evaluate((el) => (el as HTMLElement).style.backgroundPosition);
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7);
      await expect.poll(() => lens.evaluate((el) => (el as HTMLElement).style.backgroundPosition)).not.toBe(first);
      expect(await lens.evaluate((el) => (el as HTMLElement).style.backgroundImage)).toMatch(/url\(/);
      await page.mouse.move(box.x - 40, box.y - 40);
      await expect(lens).toHaveCount(0);

      await stage.click({ position: { x: 40, y: 40 } });
      const viewer = page.getByRole("dialog", { name: /photo 1 of/ });
      await expect(viewer).toBeVisible();
      const photos = await page.locator(".product-thumbnails button").count();
      if (photos > 1) {
        await page.keyboard.press("ArrowRight");
        await expect(page.getByRole("dialog", { name: /photo 2 of/ })).toBeVisible();
        await page.keyboard.press("ArrowLeft");
        await expect(page.getByRole("dialog", { name: /photo 1 of/ })).toBeVisible();
      }
      await page.keyboard.press("Escape");
      await expect(viewer).toHaveCount(0);

      await page.getByRole("button", { name: "View this photo full size" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: /photo 1 of/ })).toBeVisible();
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByRole("dialog", { name: /photo 1 of/ })).toHaveCount(0);
      // the page scrolls again after closing
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    });
  });

  test.describe("currency and the floating buttons", () => {
    test("a visitor from the UAE starts on dirhams with a flag; their own choice then wins and is remembered", async ({ page }) => {
      await page.route("**/api/geo/country", (route) => route.fulfill({ json: { country: "AE" } }));
      await page.goto("/");
      const main = page.locator(".currency-main");
      await expect(main).toContainText("AED", { timeout: 15_000 });
      await expect(main.locator("img")).toHaveAttribute("src", /\/flags\/ae\.svg/);
      await main.click();
      const list = page.getByRole("listbox", { name: "Currency" });
      expect(await list.locator("img").count()).toBe(8);
      await list.getByRole("option", { name: /USD/ }).click();
      await expect(main).toContainText("USD");
      await page.reload();
      await expect(page.locator(".currency-main")).toContainText("USD"); // the choice, not the country, now decides
    });

    test("a visitor from Pakistan, or from nowhere we can tell, stays on rupees", async ({ page }) => {
      await page.route("**/api/geo/country", (route) => route.fulfill({ json: { country: "PK" } }));
      await page.goto("/");
      await expect(page.locator(".currency-main")).toContainText("PKR");
      const fresh = await page.context().browser()!.newContext();
      const other = await fresh.newPage();
      await other.route("**/api/geo/country", (route) => route.fulfill({ json: { country: null } }));
      await other.goto(`${BASE}/`);
      await expect(other.locator(".currency-main")).toContainText("PKR");
      await fresh.close();
    });

    test("the country lookup failing does not break the page", async ({ page }) => {
      const errors = watchErrors(page);
      await page.route("**/api/geo/country", (route) => route.abort());
      await page.goto("/");
      await expect(page.locator(".currency-main")).toContainText("PKR");
      expect(errors.filter((e) => !/geo\/country|ERR_FAILED|Failed to fetch/.test(e))).toEqual([]);
    });

    test("the ✕ hides the currency selector and the WhatsApp button, they stay hidden after a reload, and the footer link brings them back", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator(".currency-switcher")).toBeVisible();
      await expect(page.locator(".float-whatsapp")).toBeVisible();
      await page.getByRole("button", { name: "Hide the currency selector" }).click();
      await expect(page.locator(".currency-switcher")).toHaveCount(0);
      await page.getByRole("button", { name: "Hide the WhatsApp button" }).click();
      await expect(page.locator(".float-whatsapp")).toHaveCount(0);

      await page.reload();
      await expect(page.locator(".currency-switcher")).toHaveCount(0);
      await expect(page.locator(".float-whatsapp")).toHaveCount(0);
      await page.goto("/shop");
      await expect(page.locator(".float-whatsapp")).toHaveCount(0); // on other pages too

      const restore = page.getByRole("button", { name: "Show the chat and currency buttons" });
      await restore.scrollIntoViewIfNeeded();
      await restore.click();
      await expect(page.locator(".currency-switcher")).toBeVisible();
      await expect(page.locator(".float-whatsapp")).toBeVisible();
      await expect(restore).toHaveCount(0);
    });

    test("a hidden button comes back by itself after a week", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Hide the WhatsApp button" }).click();
      await page.evaluate(() => window.localStorage.setItem("na-hide-whatsapp", String(Date.now() - 1000)));
      await page.reload();
      await expect(page.locator(".float-whatsapp")).toBeVisible();
    });

    test("with storage blocked, the buttons simply stay visible and nothing crashes", async ({ page }) => {
      const errors = watchErrors(page);
      await page.addInitScript(() => {
        Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
      });
      await page.goto("/");
      await expect(page.locator(".float-whatsapp")).toBeVisible();
      await page.getByRole("button", { name: "Hide the WhatsApp button" }).click();
      expect(errors.filter((e) => /blocked/.test(e))).toEqual([]);
    });

    test("on a small phone the two buttons do not cover the add-to-bag button or each other", async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 640 });
      await page.goto("/products/olive-cargo-pants");
      const wa = (await page.locator(".float-whatsapp").boundingBox())!;
      const cur = (await page.locator(".currency-switcher").boundingBox())!;
      expect(wa.x + wa.width).toBeLessThanOrEqual(cur.x);
      await noHorizontalOverflow(page, "product page on a phone");
    });
  });

  test.describe("FAQ page", () => {
    test("shows the owner's questions with live numbers, and nothing about bank deposit while it is off", async ({ page }) => {
      await sql`delete from faqs where question like 'E2E %'`;
      await sql`insert into faqs (question, answer, sort_order) values ('E2E Live number?', 'Free above Rs. {{freeAbove}} and held {{codHours}} hours.', 999)`;
      await page.goto("/faq");
      await expect(page.getByText("E2E Live number?")).toBeVisible();
      await page.getByText("E2E Live number?").click();
      await expect(page.getByText(/Free above Rs\. 10,000 and held \d+ hours\./)).toBeVisible();
      expect((await page.content()).toLowerCase()).not.toContain("bank deposit");
      expect(await page.content()).toContain('"@type":"FAQPage"');
    });
  });

  test.describe("contact page", () => {
    test("shows the real support email instead of 'coming soon'", async ({ page }) => {
      await sql`update site_settings set support_email = 'support@nureasmir.com' where id = 'store'`;
      await page.goto("/contact");
      const mail = page.locator("main").getByRole("link", { name: "support@nureasmir.com" }).first();
      await expect(mail).toBeVisible();
      await expect(mail).toHaveAttribute("href", "mailto:support@nureasmir.com");
      await expect(page.locator("article", { hasText: "Email" }).getByText("Coming soon.")).toHaveCount(0);
      await expect(page.locator("footer").getByRole("link", { name: "support@nureasmir.com" }).first()).toBeVisible();
    });
  });
});

