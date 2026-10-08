import { expect, test, type Page } from "@playwright/test";
import { BASE, clearSales, createSale, sql, warmUp } from "../support/helpers";

test.describe("shopping on a phone", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "phone behaviour is exercised in Chromium with a phone-sized screen");
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async ({ request }) => {
    await warmUp(request, ["/", "/shop", "/products/olive-cargo-pants", "/products/tan-leather-belt", "/api/catalog/prices"]);
  });
  test.afterAll(async () => {
    await clearSales();
  });

  test("the bottom bar offers Home, Shop, Search, Saved and Bag with thumb-sized buttons", async ({ page }) => {
    await page.goto("/shop");
    const bar = page.getByRole("navigation", { name: "Quick links" });
    await expect(bar).toBeVisible();
    for (const name of ["Home", "Shop", "Search", /Saved/, /Bag/]) {
      const item = bar.getByRole(name === "Search" ? "button" : "link", { name });
      const box = await item.boundingBox();
      expect(box!.height, String(name)).toBeGreaterThanOrEqual(56);
      expect(box!.width, String(name)).toBeGreaterThanOrEqual(60);
    }
    await bar.getByRole("link", { name: "Home" }).dispatchEvent("click"); // (the development-only Next.js badge sits on top of this corner)
    await expect(page).toHaveURL(/\/$/);
    await bar.getByRole("button", { name: "Search" }).dispatchEvent("click");
    await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
  });

  test("forgetting the size gets a calm hint under the sizes, and picking one clears it", async ({ page }) => {
    await page.goto("/products/olive-cargo-pants");
    await page.getByRole("button", { name: "Add to bag" }).click();
    const hint = page.locator(".size-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText(/choose a size/i);
    expect(await hint.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14); // no tiny red text
    await expect(page.locator(".purchase-message")).toHaveCount(0);
    await page.getByRole("radio", { name: "34", exact: true }).click();
    await expect(hint).toHaveCount(0);
  });

  test("a product with only one size asks for no size, and a size guide is one tap away on the others", async ({ page }) => {
    await page.goto("/products/tan-leather-belt");
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.locator(".choice-row-plain")).toContainText("One size");
    await page.getByRole("button", { name: "Add to bag" }).click();
    await expect(page.locator(".cart-toast")).toContainText("Added to your bag");
    await page.evaluate(() => localStorage.removeItem("nure-asmir-cart"));

    await page.goto("/products/olive-cargo-pants");
    await page.getByRole("button", { name: "Size guide" }).click();
    const guide = page.getByRole("dialog", { name: "Size guide" });
    await expect(guide).toContainText("Waist");
    await page.keyboard.press("Escape");
    await expect(guide).toHaveCount(0);
  });

  test("adding shows a spinner then a tick, a message with Undo, and a quick double tap adds only one", async ({ page }) => {
    await page.goto("/products/olive-cargo-pants");
    await page.evaluate(() => localStorage.removeItem("nure-asmir-cart"));
    await page.getByRole("radio", { name: "34", exact: true }).click();
    const add = page.getByRole("button", { name: /Add to bag|Adding|Added/ });
    await add.dblclick({ delay: 20 });
    await expect(page.getByRole("button", { name: /Adding/ })).toBeVisible();
    const toast = page.locator(".cart-toast");
    await expect(toast).toContainText("Added to your bag");
    await expect(toast).toContainText("1 of this in your bag");
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("nure-asmir-cart"))) ?? "[]")[0].quantity).toBe(1);
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(toast).toHaveCount(0);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("nure-asmir-cart"))) ?? "[]")).toHaveLength(0);
  });

  test("a running sale is visible where shoppers browse: cards, category tiles, the category page and the search box", async ({ page }) => {
    await createSale({ name: "E2E phone sale", value: 20, all: true, endsInMinutes: 120 });
    await sql`update site_settings set announcement_mode = 'auto' where id = 'store'`;
    await expect.poll(async () => (await (await page.request.get(`${BASE}/shop`)).text()).includes("−20%"), { timeout: 60_000 }).toBe(true);

    await page.goto("/");
    await expect(page.locator(".cat-tile-sale").first()).toContainText("Up to −20%");
    await expect(page.locator(".pcard-badge.sale").first()).toContainText("−20%");
    await page.goto("/collections/pants");
    await expect(page.locator(".listing-sale")).toContainText("−20%");
    await expect(page.locator(".pcard-price s").first()).toBeVisible();

    await page.goto("/");
    await page.getByRole("navigation", { name: "Quick links" }).getByRole("button", { name: "Search" }).click();
    await page.getByRole("searchbox", { name: "Search products" }).fill("pants");
    const hit = page.locator(".search-hit").first();
    await expect(hit).toContainText("−20%");
    await expect(hit.locator("s")).toBeVisible();
  });
});

test.describe("admin: menu, messages, story, top bar", () => {
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
  const reset = () => sql`update site_settings set announcement_mode = 'auto', announcement_lines = '', announcement_style = 'rotate', about_heading = '', about_body = '' where id = 'store'`;

  test.beforeAll(async ({ request }) => {
    await warmUp(request, ["/api/admin/login", "/admin/login"]);
    await reset();
  });
  test.afterAll(async () => {
    await reset();
    await sql`delete from admin_messages where title like 'E2E %'`;
  });

  test("the logo row stays put while the menu scrolls, and folding leaves a slim rail of icons", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 }); // short window: the menu is taller than the screen
    await login(page);
    const brand = page.locator(".adm-side .adm-brand");
    const before = await brand.boundingBox();
    const scroller = page.locator(".adm-side-scroll");
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
    const after = await brand.boundingBox();
    expect(after!.y).toBe(before!.y);
    await expect(page.locator(".adm-side-foot")).toBeInViewport();

    await page.getByRole("button", { name: "Hide the menu" }).click();
    await expect(page.locator(".adm-shell")).toHaveAttribute("data-side", "collapsed");
    await expect.poll(async () => (await page.locator(".adm-side").boundingBox())!.width).toBeLessThan(100);
    await scroller.evaluate((el) => (el.scrollTop = 0));
    await expect(page.locator(".adm-nav").getByRole("link", { name: "Orders", exact: true })).toBeVisible(); // the icon is still there to click
    await page.getByRole("button", { name: "Show the menu" }).click();
    await page.evaluate(() => (document.cookie = "adm-side=open; Path=/"));
  });

  test("Messages: write a notification, see how it looks, write an email reply with a ready-made text and a safe preview", async ({ page }) => {
    await login(page);
    await page.goto("/admin/messages");
    await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
    await page.getByLabel("Title").fill("E2E Eid sale");
    await page.getByLabel("Message", { exact: true }).fill("Up to 30% off until Sunday.");
    await expect(page.locator(".a-notif")).toContainText("E2E Eid sale");
    await expect(page.locator(".a-notif")).toContainText("Up to 30% off");

    await page.getByRole("tab", { name: "Email" }).click();
    await page.getByLabel("Start from a ready-made reply").selectOption({ index: 1 });
    await expect(page.getByLabel("Subject")).not.toHaveValue("");
    await page.getByLabel("Message", { exact: true }).fill("Hello <img src=x onerror=alert(1)>");
    await expect(page.locator(".a-mail-preview img")).toHaveCount(0);
    await expect(page.locator(".a-mail-preview")).toContainText("<img");
    await page.getByRole("radio", { name: /Everyone on my email list/ }).check();
    await expect(page.getByRole("radio", { name: /Everyone on my email list/ })).toBeChecked();
  });

  test("Our story page: edit the words, see them at once, save, and go back to the original", async ({ page }) => {
    await login(page);
    await page.goto("/admin/story");
    const heading = page.getByLabel("Big heading");
    await expect(heading).toHaveValue("Tradition in a modern form.");
    await heading.fill("E2E Our new heading");
    await expect(page.locator(".a-story-preview h3")).toHaveText("E2E Our new heading");
    await page.getByLabel(/^Text/).fill("First paragraph.\n\n> A big quote\n\nLast one with a [link](/contact).");
    await expect(page.locator(".a-story-preview blockquote")).toHaveText("A big quote");
    await expect(page.locator(".a-story-preview a")).toHaveAttribute("href", "/contact");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".a-toast").first()).toContainText("Our story page saved", { timeout: 20_000 });
    const [row] = (await sql`select about_heading as h, about_body as b from site_settings where id = 'store'`) as Array<{ h: string; b: string }>;
    expect(row.h).toBe("E2E Our new heading");
    expect(row.b).toContain("A big quote");
    // the shop says when the change will be visible
    await expect(page.locator(".a-delay-note")).toContainText(/about 5 minutes/, { timeout: 10_000 });

    await page.getByRole("button", { name: "Go back to the original wording" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(async () => ((await sql`select about_heading as h, about_body as b from site_settings where id = 'store'`) as Array<{ h: string; b: string }>)[0], { timeout: 20_000 })
      .toEqual({ h: "", b: "" });
  });

  test("Top bar: choose how the lines move, preview them on a phone and a computer, save, and the website follows", async ({ page }) => {
    await login(page);
    await page.goto("/admin/settings");
    const section = page.locator("section#topbar");
    await section.getByRole("radio", { name: /Scrolling, towards the left/ }).check();
    await section.getByRole("button", { name: /Preview on phone and computer/ }).click();
    const preview = page.getByRole("dialog", { name: "Top bar preview" });
    await expect(preview.locator(".a-device")).toHaveCount(2);
    await expect(preview.locator(".announcement-scroll")).toHaveCount(2);
    await expect(preview).toContainText("On a phone");
    await expect(preview).toContainText("On a computer");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.locator(".a-toast").first()).toContainText("Settings saved", { timeout: 20_000 });
    const [row] = (await sql`select announcement_style as s from site_settings where id = 'store'`) as Array<{ s: string }>;
    expect(row.s).toBe("scroll-left");
    await expect.poll(async () => (await (await page.request.get(`${BASE}/shop`)).text()).includes("announcement-scroll"), { timeout: 40_000 }).toBe(true);
  });
});
