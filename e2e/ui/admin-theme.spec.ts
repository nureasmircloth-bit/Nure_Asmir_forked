import { expect, test, type Page } from "@playwright/test";
import { BASE, sql, warmUp } from "../support/helpers";

/**
 * The admin's "Storefront theme & appearance" settings drive the whole shop: colours, corner radius and the heading font.
 * The test changes them in the admin, applies them (settings otherwise wait 5 minutes), and checks what a shopper's browser gets.
 */
test.describe("admin theme → storefront", () => {
  test.skip(({ browserName, isMobile, viewport }) => browserName !== "chromium" || isMobile || (viewport?.width ?? 0) < 1000, "admin UI is exercised on desktop Chromium");
  test.describe.configure({ timeout: 240_000 });

  type Saved = { theme_preset: string; theme_accent_color: string; theme_background_color: string; theme_text_color: string; theme_surface_color: string; theme_radius: string; font_family: string; shop_description: string; newsletter_title: string; newsletter_text: string };
  let original: Saved | undefined;
  const reset = async () => {
    const o = original;
    if (!o) return;
    await sql`update site_settings set theme_preset = ${o.theme_preset}, theme_accent_color = ${o.theme_accent_color}, theme_background_color = ${o.theme_background_color}, theme_text_color = ${o.theme_text_color}, theme_surface_color = ${o.theme_surface_color}, theme_radius = ${o.theme_radius}, font_family = ${o.font_family}, shop_description = ${o.shop_description}, newsletter_title = ${o.newsletter_title}, newsletter_text = ${o.newsletter_text}, pending_changes = null, pending_apply_at = null where id = 'store'`;
  };

  async function login(page: Page) {
    await sql`delete from login_attempts where lower(email) = lower(${process.env.E2E_ADMIN_EMAIL!})`;
    await page.goto("/admin/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
  }

  test.beforeAll(async ({ request }) => {
    await warmUp(request, ["/api/admin/login", "/admin/login", "/admin/settings", "/contact", "/shop"]);
    const [row] = (await sql`select theme_preset, theme_accent_color, theme_background_color, theme_text_color, theme_surface_color, theme_radius, font_family, shop_description, newsletter_title, newsletter_text from site_settings where id = 'store'`) as Saved[];
    original = row;
  });
  test.afterAll(async () => {
    await reset();
  });

  test("colours, corner radius and a custom Google font chosen in the admin reach every shop page", async ({ page }) => {
    await login(page);
    await page.goto("/admin/settings");
    const appearance = page.locator("section#appearance");

    await appearance.locator("#s-themeBackgroundColor").fill("#fff4e6");
    await appearance.locator("#s-themeSurfaceColor").fill("#e8f1ea");
    await appearance.locator("#s-themeTextColor").fill("#1a1a40");
    await appearance.locator("#s-themeAccentColor").fill("#2e8b57");
    await appearance.locator("#s-themeRadius").selectOption("rounded");
    await appearance.locator("#s-fontFamily").selectOption("custom"); // the custom-font box opens and can be typed in
    await appearance.locator("#s-fontFamily-custom").fill("Bodoni Moda");

    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.locator(".a-toast").first()).toContainText("Settings saved", { timeout: 20_000 });
    await expect.poll(async () => {
      const res = await page.request.patch(`${BASE}/api/admin/settings`, { data: { action: "apply-now" } });
      return res.ok(); // with the buffer off in tests there is nothing waiting; this makes sure of it
    }, { timeout: 20_000 }).toBe(true);

    for (const path of ["/", "/shop", "/contact", "/faq"]) {
      await test.step(`shopper sees the new theme on ${path}`, async () => {
        await page.goto(`${BASE}${path}`);
        const seen = await page.evaluate(() => {
          const cs = getComputedStyle(document.documentElement);
          return {
            accent: cs.getPropertyValue("--gold").trim().toLowerCase(),
            ink: cs.getPropertyValue("--ink").trim().toLowerCase(),
            paper: cs.getPropertyValue("--paper").trim().toLowerCase(),
            surface: cs.getPropertyValue("--silk").trim().toLowerCase(),
            radius: cs.getPropertyValue("--radius-theme").trim(),
            display: cs.getPropertyValue("--display").trim(),
            bodyBackground: getComputedStyle(document.body).backgroundColor,
          };
        });
        expect(seen).toMatchObject({ accent: "#2e8b57", ink: "#1a1a40", paper: "#fff4e6", surface: "#e8f1ea", radius: "10px", bodyBackground: "rgb(255, 244, 230)" });
        expect(seen.display).toContain("Bodoni Moda");
        await expect(page.locator('link[href*="fonts.googleapis.com"][href*="Bodoni"]')).toHaveCount(1);
      });
    }

    // the admin panel keeps its own look, whatever colours the shop uses
    await page.goto("/admin");
    const panel = await page.locator(".adm").first().evaluate((el) => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
    expect(panel.background).not.toBe("rgb(255, 244, 230)");
    expect(panel.color).not.toBe("rgb(26, 26, 64)");
  });
  test("the footer description and the newsletter wording typed in the admin show on every page", async ({ page }) => {
    await login(page);
    await page.goto("/admin/settings");
    await page.getByLabel("Short description of your shop").fill("E2E Tailoring from Lahore, delivered everywhere.");
    await page.getByLabel("Newsletter heading").fill("E2E Join the list");
    await page.getByLabel("Newsletter line").fill("E2E First look at every drop.");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.locator(".a-toast").first()).toContainText("Settings saved", { timeout: 20_000 });
    await expect.poll(async () => {
      const res = await page.request.patch(`${BASE}/api/admin/settings`, { data: { action: "apply-now" } });
      return res.ok(); // with the buffer off in tests there is nothing waiting; this makes sure of it
    }, { timeout: 20_000 }).toBe(true);

    for (const path of ["/", "/contact"]) {
      await page.goto(`${BASE}${path}`);
      await expect(page.getByRole("heading", { name: "E2E Join the list" })).toBeVisible();
      await expect(page.getByText("E2E First look at every drop.")).toBeVisible();
      await expect(page.locator("footer").getByText("E2E Tailoring from Lahore, delivered everywhere.")).toBeVisible();
    }
    await page.goto(`${BASE}/`); // pages with their own description keep it; the home page uses the shop description
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "E2E Tailoring from Lahore, delivered everywhere.");
  });
});
