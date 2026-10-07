import { expect, test, type Page } from "@playwright/test";
import { BASE, sql, warmUp } from "../support/helpers";

test.describe("admin: Google text, own search words, banner crop frames", () => {
  test.skip(({ browserName, isMobile, viewport }) => browserName !== "chromium" || isMobile || (viewport?.width ?? 0) < 1000, "admin UI is exercised on desktop Chromium");
  test.describe.configure({ timeout: 180_000 });

  async function login(page: Page) {
    await sql`delete from login_attempts`;
    await page.goto("/admin/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
  }

  let productId = "";
  let slug = "";
  let original: { description: string | null; title: string | null; seoDescription: string | null } = { description: null, title: null, seoDescription: null };
  test.beforeAll(async ({ request }) => {
    await warmUp(request, ["/api/admin/login", "/admin/login", "/shop"]);
    const [row] = (await sql`select p.id, p.slug from products p join product_variants v on v.product_id = p.id where v.sku = 'NA-TE-SAS-M' limit 1`) as Array<{ id: string; slug: string }>;
    productId = row.id;
    slug = row.slug;
    const [before] = (await sql`select description, seo_title as title, seo_description as "seoDescription" from products where id = ${productId}`) as Array<typeof original>;
    original = before;
    // start from the automatic draft, so typing the owner's own words is a real change
    await sql`update products set seo_title = 'Automatic title', seo_description = 'Automatic description', seo_keywords = null, seo_locked = false where id = ${productId}`;
  });
  test.afterAll(async () => {
    await sql`update products set description = ${original.description}, seo_title = ${original.title}, seo_description = ${original.seoDescription}, seo_keywords = null, seo_locked = false where id = ${productId}`;
  });

  test("the product page warns that Google decides and can take up to a month, and the advanced box keeps the owner's own words", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/products/${productId}`);
    const note = page.getByRole("note").filter({ hasText: "Google decides" });
    await expect(note).toBeVisible();
    await expect(note).toContainText("up to a month");
    await expect(page.getByText("a preview, not live yet")).toBeVisible();

    await page.getByText("Advanced: write the Google text yourself").click();
    await page.getByLabel(/Title on Google/).fill("E2E Hand written Google title");
    await page.getByLabel(/Two lines under the title/).fill("E2E Hand written description for Google, with delivery all over Pakistan.");
    await page.getByLabel(/Your own search words/).fill("e2e eid kurta, e2e wedding wear");
    await expect(page.getByText("e2e eid kurta", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Save/ }).first().click();
    await expect(page.locator(".a-toast").first()).toContainText(/saved/i, { timeout: 30_000 });

    const [row] = (await sql`select seo_title as title, seo_description as description, seo_keywords as keywords, seo_locked as locked from products where id = ${productId}`) as Array<Record<string, unknown>>;
    expect(row).toEqual({ title: "E2E Hand written Google title", description: "E2E Hand written description for Google, with delivery all over Pakistan.", keywords: "e2e eid kurta, e2e wedding wear", locked: true });

    // the words reach search engines through the product's structured data
    await expect
      .poll(async () => (await (await page.request.get(`${BASE}/products/${slug}`)).text()).includes("e2e eid kurta, e2e wedding wear"), { timeout: 40_000 })
      .toBe(true);
  });

  test("saving the product again never replaces hand-written Google text with a helper draft", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/products/${productId}`);
    const description = page.getByLabel(/^Description/).first();
    await description.fill(`${await description.inputValue()} Extra line.`);
    await page.getByRole("button", { name: /^Save/ }).first().click();
    await expect(page.locator(".a-toast").first()).toContainText(/saved/i, { timeout: 30_000 });
    const [row] = (await sql`select seo_title as title from products where id = ${productId}`) as Array<{ title: string }>;
    expect(row.title).toBe("E2E Hand written Google title");
  });

  test("banner pictures are cropped to exactly the frame the shop shows (wide on computers, 4:5 on phones)", async ({ page }) => {
    await login(page);
    await page.goto("/admin/campaign");
    await expect(page.getByText(/wide, 8:3/).first()).toBeVisible();
    await expect(page.getByText(/tall, 4:5/).first()).toBeVisible();
    await expect(page.getByText(/9:16|16:9/)).toHaveCount(0);
  });
});
