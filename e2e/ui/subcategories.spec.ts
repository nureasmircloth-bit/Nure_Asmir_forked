import { expect, test, type Page } from "@playwright/test";
import { sql, warmUp } from "../support/helpers";

/**
 * Subcategories: the owner types them (comma separated) next to each category in Admin -> Collections, and the shopper sees them as chips on the
 * category page and as links in the phone menu; picking one narrows the page. They are plain data, so they also have to survive the move to D1.
 */
test.describe("subcategories", () => {
  test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "one desktop browser is enough");
  test.describe.configure({ timeout: 240_000 });

  let original: string | null = null;

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
    const [row] = (await sql`select subcategories from categories where slug = 'shirts'`) as Array<{ subcategories: string | null }>;
    original = row?.subcategories ?? null;
    await warmUp(request, ["/collections/shirts", "/admin/collections"]);
  });
  test.afterAll(async () => {
    await sql`update categories set subcategories = ${original} where slug = 'shirts'`;
  });

  test("the owner edits a category's subcategories; the shop shows them and narrows the page", async ({ page }) => {
    await login(page);
    await page.goto("/admin/collections");
    await page.getByRole("button", { name: "Categories", exact: true }).click();
    const row = page.locator("tr", { has: page.locator('input[name="slug"][value="shirts"]') });
    await expect(row).toHaveCount(1);
    await row.locator('input[name="subcategories"]').fill("Sashiko, Crane, Paisley");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: /saved|updated/i }).first()).toContainText(/saved|updated/i, { timeout: 20_000 });
    const [saved] = (await sql`select subcategories from categories where slug = 'shirts'`) as Array<{ subcategories: string }>;
    expect(saved.subcategories).toBe("Sashiko, Crane, Paisley");

    await page.goto("/collections/shirts");
    const chips = page.getByRole("navigation", { name: /types/i });
    await expect(chips.getByRole("link")).toHaveText(["All", "Sashiko", "Crane", "Paisley"]);
    await chips.getByRole("link", { name: "Sashiko" }).click();
    await expect(page).toHaveURL(/q=Sashiko/);
    await expect(page.getByText("Ivory Sashiko Tee").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Ivory Crane Tee")).toHaveCount(0);

    // and the owner can take them away again
    await page.goto("/admin/collections");
    await page.getByRole("button", { name: "Categories", exact: true }).click();
    const again = page.locator("tr", { has: page.locator('input[name="slug"][value="shirts"]') });
    await again.locator('input[name="subcategories"]').fill("");
    await again.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: /saved|updated/i }).first()).toContainText(/saved|updated/i, { timeout: 20_000 });
    await page.goto("/collections/shirts");
    await expect(page.getByRole("navigation", { name: /types/i })).toHaveCount(0);
  });
});
