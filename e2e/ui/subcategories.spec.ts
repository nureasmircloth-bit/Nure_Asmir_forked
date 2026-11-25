import { expect, test } from "@playwright/test";
import { sql, warmUp } from "../support/helpers";

/**
 * Older "quick groups": words stored on a category. The admin no longer edits them (real categories inside categories replace them), but the shop still
 * shows ones that exist as chips on the category page; picking one narrows the page. They are plain data, so they also have to survive the move to D1.
 */
test.describe("subcategories", () => {
  test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "one desktop browser is enough");
  test.describe.configure({ timeout: 240_000 });

  let original: string | null = null;
  test.beforeAll(async ({ request }) => {
    // Fail closed: this test writes a category directly, so it may only ever run against the local test database.
    expect(process.env.LOCAL_DB_PATH ?? "", "the app under test must use the local test database").toContain("e2e.sqlite");
    expect(process.env.D1_HTTP_DATABASE_ID ?? "", "no real D1 database may be configured").toBe("");
    const [row] = (await sql`select subcategories from categories where slug = 'shirts'`) as Array<{ subcategories: string | null }>;
    original = row?.subcategories ?? null;
    await warmUp(request, ["/collections/shirts"]);
  });
  test.afterAll(async () => {
    await sql`update categories set subcategories = ${original} where slug = 'shirts'`;
  });

  test("saved quick groups still show as chips on the category page and narrow it", async ({ page }) => {
    await sql`update categories set subcategories = 'Sashiko, Crane, Paisley' where slug = 'shirts'`;
    // Controlled starting point: before any filter is chosen, both products are on the page (so "Crane is gone" below can only come from the filter).
    await page.goto("/collections/shirts");
    await expect(page.getByText("Ivory Sashiko Tee").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Ivory Crane Tee").first()).toBeVisible();
    const chips = page.getByRole("navigation", { name: /types/i });
    await expect(chips.getByRole("link")).toHaveText(["All", "Sashiko", "Crane", "Paisley"]);
    await chips.getByRole("link", { name: "Sashiko" }).click();
    await expect(page).toHaveURL(/q=Sashiko/);
    await expect(page.getByText("Ivory Sashiko Tee").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Ivory Crane Tee")).toHaveCount(0);

    // and with them cleared the chips are gone
    await sql`update categories set subcategories = null where slug = 'shirts'`;
    await page.goto("/collections/shirts");
    await expect(page.getByRole("navigation", { name: /types/i })).toHaveCount(0);
  });
});
