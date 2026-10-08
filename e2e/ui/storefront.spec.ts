import { expect, test } from "@playwright/test";
import { cleanOrders, clearSales, createSale, setStock, sql, variantBySku, warmUp } from "../support/helpers";
import { brokenImages, cartCountInHeader, noHorizontalOverflow, openProduct, pickSize, watchErrors } from "../support/ui";

const PAGES = ["/", "/shop", "/collections/shirts", "/collections/shalwar-kameez", "/products/olive-cargo-pants", "/about", "/contact", "/faq", "/policies/shipping", "/wishlist", "/cart", "/track-order", "/search?q=kameez"];

test.beforeAll(async ({ request }) => {
  await warmUp(request);
  await cleanOrders();
  await clearSales();
  for (const sku of ["NA-PA-CAR-30", "NA-PA-CAR-32", "NA-PA-CAR-34", "NA-PA-CAR-36"]) await setStock(sku, 20);
});

test.describe("every page renders cleanly", () => {
  for (const path of PAGES) {
    test(`${path}`, async ({ page }) => {
      const errors = watchErrors(page);
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("header.site-header")).toBeVisible();
      await noHorizontalOverflow(page, path);
      if (!["/cart", "/wishlist", "/track-order"].includes(path)) {
        const broken = await brokenImages(page);
        expect(broken, "images that failed to load").toEqual([]);
      }
      expect(errors, "console / page errors").toEqual([]);
    });
  }

  test("unknown URLs give a 404 page, not a crash", async ({ page }) => {
    const response = await page.goto("/products/does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.locator("body")).toContainText(/not found|404/i);
  });
});

test.describe("header", () => {
  test("menu drawer opens, lists live categories, closes on Escape and on scrim tap", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.getByLabel("Menu", { exact: true });
    await expect(drawer).toHaveClass(/is-open/);
    for (const name of ["Shalwar Kameez", "Shirts", "Pants", "Accessories"]) await expect(drawer.getByRole("link", { name })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).not.toHaveClass(/is-open/);
    await page.getByRole("button", { name: "Open menu" }).click();
    const width = page.viewportSize()!.width;
    await page.mouse.click(width - 8, 300); // the scrim, right of the 380px drawer
    await expect(drawer).not.toHaveClass(/is-open/);
  });

  test("search overlay → Enter goes to the results page and finds a product by a typo-tolerant-ish query", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Search", exact: true }).first().click();
    const input = page.getByRole("searchbox", { name: "Search products" });
    await expect(input).toBeVisible();
    await input.fill("cargo");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=cargo/);
    await expect(page.getByRole("link", { name: /Olive Cargo Pants/i }).first()).toBeVisible();
  });
});

test.describe("product page: sizes, bag, double-taps", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // Fresh storage for the first load only – reloads must keep what the test saved.
      if (!window.sessionStorage.getItem("__e2e_cleared")) {
        window.localStorage.clear();
        window.sessionStorage.setItem("__e2e_cleared", "1");
      }
    });
  });

  test("must choose a size; adding twice by double-tap adds one piece, not two", async ({ page }) => {
    await openProduct(page, "olive-cargo-pants");
    await page.getByRole("button", { name: "Add to bag" }).click();
    await expect(page.locator(".size-hint")).toContainText(/choose a size/i);

    await pickSize(page, "32");
    const add = page.getByRole("button", { name: /Add to bag/ });
    await add.dblclick();
    await expect(page.getByRole("button", { name: /Added to bag/ })).toBeVisible();
    expect(await cartCountInHeader(page)).toBe(1);
    // After the short lock lifts, a deliberate second add works.
    await expect(page.getByRole("button", { name: "Add to bag" })).toBeEnabled({ timeout: 3000 });
    await page.getByRole("button", { name: "Add to bag" }).click();
    expect(await cartCountInHeader(page)).toBe(2);
  });

  test("'Buy it now' pressed repeatedly opens the bag once with one piece and shows a spinner", async ({ page }) => {
    await openProduct(page, "olive-cargo-pants");
    await pickSize(page, "34");
    const buy = page.getByRole("button", { name: /Buy it now/ });
    await buy.click();
    await buy.click({ force: true, noWaitAfter: true }).catch(() => {});
    await expect(page).toHaveURL(/\/cart/);
    await expect(page.locator(".cart-lines article")).toHaveCount(1);
    await expect(page.locator(".quantity-control span")).toHaveText("1");
  });

  test("sold-out sizes are visibly disabled and cannot be picked", async ({ page }) => {
    await setStock("NA-PA-CAR-36", 0);
    await openProduct(page, "olive-cargo-pants");
    await expect(page.getByRole("radio", { name: "36", exact: true })).toBeDisabled();
    await expect(page.getByRole("radio", { name: "30", exact: true })).toBeEnabled();
    await setStock("NA-PA-CAR-36", 20);
  });
});

test.describe("wishlist", () => {
  test("heart toggles, survives a reload, shows on the wishlist page and updates the header count", async ({ page }) => {
    await page.addInitScript(() => {
      // Fresh storage for the first load only – reloads must keep what the test saved.
      if (!window.sessionStorage.getItem("__e2e_cleared")) {
        window.localStorage.clear();
        window.sessionStorage.setItem("__e2e_cleared", "1");
      }
    });
    await page.goto("/shop");
    const first = page.locator(".pcard").first();
    await first.hover();
    const heart = first.getByRole("button", { name: /Add .* to wishlist/ });
    await heart.click();
    await expect(first.getByRole("button", { name: /Remove .* from wishlist/ })).toBeVisible();
    await expect(page.locator('a[aria-label^="Wishlist"] .cart-count')).toHaveText("1");

    await page.reload();
    await expect(page.locator(".pcard").first().getByRole("button", { name: /Remove .* from wishlist/ })).toBeVisible();

    await page.goto("/wishlist");
    await expect(page.locator(".pcard")).toHaveCount(1);
    await page.locator(".pcard").first().getByRole("button", { name: /Remove .* from wishlist/ }).click();
    await expect(page.getByText("Nothing saved yet.")).toBeVisible();
  });

  test("tapping the heart does not navigate to the product", async ({ page }) => {
    await page.addInitScript(() => {
      // Fresh storage for the first load only – reloads must keep what the test saved.
      if (!window.sessionStorage.getItem("__e2e_cleared")) {
        window.localStorage.clear();
        window.sessionStorage.setItem("__e2e_cleared", "1");
      }
    });
    await page.goto("/shop");
    await page.locator(".pcard").first().getByRole("button", { name: /to wishlist/ }).click();
    await expect(page).toHaveURL(/\/shop$/);
  });
});

test.describe("currency switcher", () => {
  test("switching to USD converts every price; PKR is restored on demand; survives reload", async ({ page }) => {
    await page.route("**/api/currency", (route) =>
      route.fulfill({ json: { date: "2026-10-05", fetchedAt: Date.now(), rates: { PKR: 1, USD: 0.0036, GBP: 0.0027 } } }),
    );
    await page.addInitScript(() => {
      // Fresh storage for the first load only – reloads must keep what the test saved.
      if (!window.sessionStorage.getItem("__e2e_cleared")) {
        window.localStorage.clear();
        window.sessionStorage.setItem("__e2e_cleared", "1");
      }
    });
    await page.goto("/shop");
    await expect(page.locator(".pcard-price").first()).toContainText("Rs.");
    await page.getByRole("button", { name: /PKR/ }).click();
    await page.getByRole("option", { name: /USD/ }).click();
    await expect(page.locator(".pcard-price").first()).toContainText("$");
    await page.reload();
    await expect(page.locator(".pcard-price").first()).toContainText("$");
    await page.getByRole("button", { name: /USD/ }).click();
    await page.getByRole("option", { name: /PKR/ }).click();
    await expect(page.locator(".pcard-price").first()).toContainText("Rs.");
  });

  test("if exchange rates are unavailable, prices stay in PKR instead of breaking", async ({ page }) => {
    await page.route("**/api/currency", (route) => route.fulfill({ status: 503, json: { error: "down" } }));
    await page.addInitScript(() => {
      // Fresh storage for the first load only – reloads must keep what the test saved.
      if (!window.sessionStorage.getItem("__e2e_cleared")) {
        window.localStorage.clear();
        window.sessionStorage.setItem("__e2e_cleared", "1");
      }
    });
    await page.goto("/shop");
    await page.getByRole("button", { name: /PKR/ }).click();
    await page.getByRole("option", { name: /EUR/ }).click();
    await expect(page.locator(".pcard-price").first()).toContainText("Rs.");
  });
});

test.describe("flash sale on the storefront", () => {
  test.afterEach(async () => {
    await clearSales();
  });

  test("shows the new price, struck-through original, −% badge and a live countdown", async ({ page }) => {
    const variant = await variantBySku("NA-PA-CAR-34");
    await createSale({ name: "UI sale", value: 20, productIds: [variant.productId], endsInMinutes: 90 });
    await page.goto("/shop");
    const card = page.locator(".pcard", { hasText: "Olive Cargo Pants" });
    await expect(card.locator(".pcard-badge.sale")).toHaveText(/−20%/);
    await expect(card.locator(".pcard-price s")).toContainText("7,900");
    await expect(card.locator(".pcard-price")).toContainText("6,320");

    await openProduct(page, "olive-cargo-pants");
    await expect(page.locator(".sale-banner")).toBeVisible();
    await expect(page.locator(".sale-countdown")).toContainText(/01:[0-9]{2}:[0-9]{2}/);
    const first = await page.locator(".sale-countdown").textContent();
    await page.waitForTimeout(2100);
    expect(await page.locator(".sale-countdown").textContent()).not.toBe(first);
  });

  test("no sale → no badge, no countdown", async ({ page }) => {
    await page.goto("/shop");
    await expect(page.locator(".pcard-badge.sale")).toHaveCount(0);
    await openProduct(page, "olive-cargo-pants");
    await expect(page.locator(".sale-banner")).toHaveCount(0);
  });
});

test.describe("forgotten and stale bags", () => {
  test("a bag left untouched for more than 14 days is discarded", async ({ page }) => {
    const variant = await variantBySku("NA-PA-CAR-34");
    await page.addInitScript(
      ([key, v, old]) => window.localStorage.setItem(key as string, JSON.stringify([{ variantId: (v as { id: string }).id, slug: "olive-cargo-pants", name: "Olive Cargo Pants", variantName: "x", sku: "x", price: 7900, quantity: 1, available: 10, addedAt: old }])),
      ["nure-asmir-cart", variant, Date.now() - 15 * 24 * 3600 * 1000],
    );
    await page.goto("/cart");
    await expect(page.getByText("Your bag is waiting.")).toBeVisible();
  });

  test("a recent bag is kept, and repriced / clamped / dropped to match the live catalogue", async ({ page }) => {
    const sold = await variantBySku("NA-PA-CAR-30");
    const few = await variantBySku("NA-PA-CAR-32");
    const moved = await variantBySku("NA-PA-CAR-34");
    await setStock("NA-PA-CAR-30", 0); // sold out since added
    await setStock("NA-PA-CAR-32", 2); // only 2 left now
    await setStock("NA-PA-CAR-34", 20); // price changed since added
    await page.addInitScript(
      ([key, rows]) => window.localStorage.setItem(key as string, JSON.stringify(rows)),
      [
        "nure-asmir-cart",
        [
          { variantId: sold.id, slug: "olive-cargo-pants", name: "Olive Cargo Pants (30)", variantName: "30", sku: sold.sku, price: 7900, quantity: 1, available: 9, addedAt: Date.now() - 3600_000 },
          { variantId: few.id, slug: "olive-cargo-pants", name: "Olive Cargo Pants (32)", variantName: "32", sku: few.sku, price: 7900, quantity: 5, available: 9, addedAt: Date.now() - 3600_000 },
          { variantId: moved.id, slug: "olive-cargo-pants", name: "Olive Cargo Pants (34)", variantName: "34", sku: moved.sku, price: 6000, quantity: 1, available: 9, addedAt: Date.now() - 3600_000 },
        ],
      ],
    );
    await page.goto("/cart");
    const notice = page.locator(".cart-stock-notice");
    await expect(notice).toContainText("no longer available");
    await expect(notice).toContainText("quantity adjusted");
    await expect(notice).toContainText("Prices changed");
    await expect(page.locator(".cart-lines article")).toHaveCount(2); // sold-out line removed
    await expect(page.locator(".cart-lines article", { hasText: "(32)" }).locator(".quantity-control span")).toHaveText("2");
    await expect(page.locator(".cart-lines article", { hasText: "(34)" })).toContainText("7,900");
    for (const sku of ["NA-PA-CAR-30", "NA-PA-CAR-32"]) await setStock(sku, 20);
  });

  test("the bag is re-checked when the tab becomes visible again after a long time away", async ({ page }) => {
    const v = await variantBySku("NA-PA-CAR-36");
    await setStock("NA-PA-CAR-36", 10);
    await page.addInitScript(
      ([key, rows]) => {
        if (!window.localStorage.getItem(key as string)) window.localStorage.setItem(key as string, JSON.stringify(rows));
      },
      ["nure-asmir-cart", [{ variantId: v.id, slug: "olive-cargo-pants", name: "Olive Cargo Pants (36)", variantName: "36", sku: v.sku, price: 7900, quantity: 1, available: 10, addedAt: Date.now() }]],
    );
    await page.goto("/cart");
    await expect(page.locator(".cart-lines article")).toHaveCount(1);
    await setStock("NA-PA-CAR-36", 0); // someone buys the last one while the tab sits in the background
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator(".cart-stock-notice")).toContainText("no longer available");
    await expect(page.getByText("Your bag is waiting.")).toBeVisible();
    await setStock("NA-PA-CAR-36", 20);
  });
});

test("DB sanity: the test branch, not production, is in use", async () => {
  const [row] = (await sql`select current_setting('neon.branch_id', true) as b`) as Array<{ b: string | null }>;
  expect(row.b === null || /quiet-fire/.test(row.b)).toBe(true);
});
