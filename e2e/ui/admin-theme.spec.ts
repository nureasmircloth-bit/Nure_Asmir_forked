import { expect, test, type Page } from "@playwright/test";
import { BASE, sql, warmUp } from "../support/helpers";

/**
 * The admin's "Storefront theme & appearance" settings drive the whole shop: colours, corner radius and the heading font.
 * The test changes them in the admin, applies them (settings otherwise wait 5 minutes), and checks what a shopper's browser gets.
 */
test.describe("admin theme → storefront", () => {
  test.skip(({ browserName, isMobile, viewport }) => browserName !== "chromium" || isMobile || (viewport?.width ?? 0) < 1000, "admin UI is exercised on desktop Chromium");
  test.describe.configure({ timeout: 240_000 });

  const reset = () => sql`update site_settings set theme_preset = 'signature', theme_accent_color = '#c5a059', theme_background_color = '#ffffff', theme_text_color = '#111111', theme_surface_color = '#faf9f6', theme_radius = 'subtle', font_family = 'Cormorant Garamond', pending_changes = null, pending_apply_at = null where id = 'store'`;

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
    await warmUp(request, ["/api/admin/login", "/admin/login", "/admin/settings", "/contact", "/shop"]);
    await reset();
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
      return res.ok() && ((await res.json()) as { applied?: boolean }).applied === true;
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
});
